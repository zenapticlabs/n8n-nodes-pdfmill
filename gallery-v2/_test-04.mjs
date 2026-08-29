import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL(
  "./04-scheduled-weekly-report.json",
  import.meta.url,
);
const descriptionUrl = new URL("./04-description.md", import.meta.url);
const rawWorkflow = await readFile(workflowUrl, "utf8");
const workflow = JSON.parse(rawWorkflow);
const description = await readFile(descriptionUrl, "utf8");

const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
const names = new Set(byName.keys());
const functionalNodes = workflow.nodes.filter(
  (node) => node.type !== "n8n-nodes-base.stickyNote",
);
const stickyNotes = workflow.nodes.filter(
  (node) => node.type === "n8n-nodes-base.stickyNote",
);

function stableId(name) {
  const hex = createHash("sha256")
    .update(`pdfmill-gallery-v2-04:${name}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function edgeNames(source, output = 0) {
  return (workflow.connections[source]?.main?.[output] ?? [])
    .map((edge) => edge.node)
    .sort();
}

// ---------------------------------------------------------------- structure

assert.equal(
  rawWorkflow,
  `${JSON.stringify(workflow, null, 2)}\n`,
  "workflow serialization must be stable",
);
assert.equal(
  functionalNodes.length,
  12,
  "expected twelve functional nodes after the redesign",
);
assert.equal(stickyNotes.length, 6, "expected six sticky notes");
assert.equal(
  new Set(workflow.nodes.map((node) => node.id)).size,
  workflow.nodes.length,
  "node IDs must be unique",
);
for (const node of workflow.nodes) {
  assert.equal(
    node.id,
    stableId(node.name),
    `node ID is not deterministic: ${node.name}`,
  );
}

for (const [source, connection] of Object.entries(workflow.connections)) {
  assert(names.has(source), `connection source does not exist: ${source}`);
  for (const output of connection.main ?? []) {
    for (const edge of output ?? []) {
      assert(
        names.has(edge.node),
        `connection target does not exist: ${edge.node}`,
      );
      assert.equal(
        edge.type,
        "main",
        `unexpected connection type from ${source}`,
      );
      assert(
        Number.isInteger(edge.index) && edge.index >= 0,
        `invalid target input from ${source}`,
      );
    }
  }
}

// The two sources must run in parallel from the window node, not in a chain.
assert.deepEqual(
  edgeNames("Set the weekly reporting window"),
  ["Fetch satisfaction scores", "Fetch ticket metrics"],
  "both metric sources must be fed directly by the reporting window",
);
assert.deepEqual(
  workflow.connections["Fetch ticket metrics"].main[0].map((edge) => [
    edge.node,
    edge.index,
  ]),
  [["Combine both metric sources", 0]],
  "ticket metrics must enter merge input 0",
);
assert.deepEqual(
  workflow.connections["Fetch satisfaction scores"].main[0].map((edge) => [
    edge.node,
    edge.index,
  ]),
  [["Combine both metric sources", 1]],
  "satisfaction scores must enter merge input 1",
);

for (const sourceName of [
  "Fetch ticket metrics",
  "Fetch satisfaction scores",
]) {
  const source = byName.get(sourceName);
  assert.equal(
    source.onError,
    "continueRegularOutput",
    `${sourceName} must continue so a dead API becomes a reported gap`,
  );
  assert.equal(source.retryOnFail, true, `${sourceName} must retry`);
  assert(source.maxTries >= 2, `${sourceName} must retry more than once`);
}

// Validation decides before any side effect: the PDF sits behind the IF.
assert.deepEqual(edgeNames("Are both sources complete?", 0), [
  "Generate the weekly report PDF",
]);
assert.deepEqual(edgeNames("Are both sources complete?", 1), [
  "Email a data-gap notice",
]);
assert.equal(
  workflow.connections["Email a data-gap notice"],
  undefined,
  "the data-gap branch must stop, never reach rendering or archiving",
);

// The pdfmill binary must fan out directly; Gmail output must never feed Drive.
assert.deepEqual(
  edgeNames("Generate the weekly report PDF"),
  ["Archive the report in Google Drive", "Email the report to the team"],
  "pdfmill must feed Gmail and Drive directly",
);
assert.deepEqual(
  workflow.connections["Email the report to the team"].main[0].map((edge) => [
    edge.node,
    edge.index,
  ]),
  [["Wait for email and archive", 0]],
);
assert.deepEqual(
  workflow.connections["Archive the report in Google Drive"].main[0].map(
    (edge) => [edge.node, edge.index],
  ),
  [["Wait for email and archive", 1]],
);
const join = byName.get("Wait for email and archive");
assert.equal(join.parameters.mode, "chooseBranch");
assert.equal(
  join.parameters.chooseBranchMode,
  "waitForAll",
  "must wait for both deliveries",
);

const pdfNode = byName.get("Generate the weekly report PDF");
assert.equal(pdfNode.type, "n8n-nodes-pdfmill.pdfmill");
assert.equal(pdfNode.parameters.template, "report");
assert.equal(pdfNode.parameters.binaryPropertyName, "data");
assert.equal(
  byName.get("Email the report to the team").parameters.options.attachmentsUi
    .attachmentsBinary[0].property,
  "data",
);
assert.equal(
  byName.get("Archive the report in Google Drive").parameters
    .inputDataFieldName,
  "data",
);

// -------------------------------------------------------- reporting window

const windowCode = byName.get("Set the weekly reporting window").parameters
  .jsCode;
const NativeDate = globalThis.Date;

function runWindow(isoInstant) {
  const fixedTime = NativeDate.parse(isoInstant);
  class FixedDate extends NativeDate {
    constructor(...args) {
      super(...(args.length === 0 ? [fixedTime] : args));
    }
    static now() {
      return fixedTime;
    }
  }
  globalThis.Date = FixedDate;
  try {
    return new Function(windowCode)()[0].json;
  } finally {
    globalThis.Date = NativeDate;
  }
}

const windowCases = [
  ["2026-08-27T08:00:00.000Z", "2026-08-17", "2026-08-23", "2026-W34"],
  ["2026-08-24T08:00:00.000Z", "2026-08-17", "2026-08-23", "2026-W34"],
  ["2027-01-04T08:00:00.000Z", "2026-12-28", "2027-01-03", "2026-W53"],
  ["2026-01-01T08:00:00.000Z", "2025-12-22", "2025-12-28", "2025-W52"],
];
for (const [instant, start, end, label] of windowCases) {
  const result = runWindow(instant);
  assert.equal(result.periodStart, start, `wrong window start for ${instant}`);
  assert.equal(result.periodEnd, end, `wrong window end for ${instant}`);
  assert.equal(result.weekLabel, label, `wrong ISO week label for ${instant}`);
}
const sampleWindow = runWindow("2026-08-27T08:00:00.000Z");
assert.equal(sampleWindow.fileSafeWeek, "2026-W34");
assert.match(
  sampleWindow.reportRecipient,
  /@example\.com$/,
  "recipient must stay an example address",
);
assert.match(
  sampleWindow.metricsBaseUrl,
  /^https:\/\/api\.example\.com$/,
  "metrics host must stay an example host",
);

// ------------------------------------------------------------ report build

const buildCode = byName.get("Validate and build the weekly report").parameters
  .jsCode;

function runBuild(items, reportWindow = sampleWindow) {
  const input = {
    all: () => items.map((json) => ({ json })),
  };
  const lookup = (nodeName) => {
    assert.equal(
      nodeName,
      "Set the weekly reporting window",
      "unexpected node reference",
    );
    return { first: () => ({ json: reportWindow }) };
  };
  return new Function("$input", "$", buildCode)(input, lookup)[0].json;
}

const ticketPayload = {
  ticketsOpened: 412,
  ticketsResolved: 398,
  firstResponseMinutes: 18.4,
  previous: {
    ticketsOpened: 377,
    ticketsResolved: 361,
    firstResponseMinutes: 22.7,
  },
};
const satisfactionPayload = {
  csatScore: 4.62,
  csatResponses: 214,
  previous: { csatScore: 4.41 },
};

const report = runBuild([ticketPayload, satisfactionPayload]);
assert.equal(report.isComplete, true);
assert.equal(report.status, "report_data_ready");
assert.equal(report.ticketsOpened, 412);
assert.equal(report.ticketsResolved, 398);
assert.equal(report.backlog, 14, "backlog must be opened minus resolved");
assert.equal(report.resolutionRate, 96.6);
assert.equal(report.csatScore, 4.62);
assert.equal(report.title, "Service desk performance - 2026-W34");
assert.equal(report.periodStart, "2026-08-17");
assert.equal(report.periodEnd, "2026-08-23");
assert.equal(report.kpis.length, 4);
assert.equal(report.sections.length, 2);
assert.equal(report.table.rows.length, 4);

// Source order must not matter: classification is by shape, not arrival.
const reversed = runBuild([satisfactionPayload, ticketPayload]);
assert.deepEqual(
  reversed,
  report,
  "source arrival order must not change the report",
);

// Direction semantics: better is "up" even when the number falls.
const rowsByLabel = new Map(report.table.rows.map((row) => [row.label, row]));
assert.equal(rowsByLabel.get("Median first response").change, "-18.9%");
assert.equal(
  rowsByLabel.get("Median first response").direction,
  "up",
  "a faster response is an improvement even though the number fell",
);
assert.equal(rowsByLabel.get("Tickets opened").change, "+9.3%");
assert.equal(
  rowsByLabel.get("Tickets opened").direction,
  "down",
  "more inbound tickets is not an improvement",
);
assert.equal(rowsByLabel.get("Tickets resolved").direction, "up");
assert.equal(rowsByLabel.get("Customer satisfaction").direction, "up");
const kpiByLabel = new Map(report.kpis.map((kpi) => [kpi.label, kpi]));
assert.equal(kpiByLabel.get("Median first response").down, false);
assert.equal(kpiByLabel.get("Tickets opened").down, true);

// Each KPI delta must describe ITS OWN value: the rate moves in points, not in resolved volume.
assert.equal(
  kpiByLabel.get("Resolution rate").delta,
  "+0.8 pt",
  "the resolution-rate delta must be the change in the rate, not in tickets resolved",
);
assert.equal(kpiByLabel.get("Resolution rate").down, false);
assert.notEqual(
  kpiByLabel.get("Resolution rate").delta,
  rowsByLabel.get("Tickets resolved").change,
  "the rate KPI must not reuse the resolved-volume change",
);

// No prior week must never become a fabricated comparison.
const firstRun = runBuild([
  { ticketsOpened: 100, ticketsResolved: 90, firstResponseMinutes: 12 },
  { csatScore: 4.1, csatResponses: 30 },
]);
assert.equal(firstRun.isComplete, true);
for (const row of firstRun.table.rows) {
  assert.equal(
    row.change,
    "No prior week",
    `fabricated comparison for ${row.label}`,
  );
  assert.equal(row.previous, "n/a");
}
for (const kpi of firstRun.kpis) {
  assert.equal(
    kpi.delta,
    "No prior week",
    `fabricated KPI delta for ${kpi.label}`,
  );
}

// A response wrapped in `body` is unwrapped.
const wrapped = runBuild([
  { body: ticketPayload },
  { body: satisfactionPayload },
]);
assert.equal(wrapped.isComplete, true);
assert.equal(wrapped.ticketsOpened, 412);

// ------------------------------------------------------- incomplete inputs

const missingSource = runBuild([ticketPayload]);
assert.equal(missingSource.isComplete, false);
assert.equal(missingSource.status, "incomplete_metrics");
assert.deepEqual(missingSource.missingSources, ["satisfaction scores"]);
assert.equal(
  missingSource.weekLabel,
  "2026-W34",
  "the gap notice must still name the week",
);

const failedRequest = runBuild([
  { error: { message: "connect ETIMEDOUT 10.0.0.4:443" } },
  satisfactionPayload,
]);
assert.equal(failedRequest.isComplete, false);
assert.deepEqual(failedRequest.missingSources, ["ticket metrics"]);
assert.equal(failedRequest.sourceErrors.length, 1);
assert.match(
  failedRequest.sourceErrors[0],
  /ETIMEDOUT/,
  "the API error must reach the notice",
);

const partialFields = runBuild([
  { ticketsOpened: 412, ticketsResolved: 398 },
  { csatScore: 4.6 },
]);
assert.equal(partialFields.isComplete, false);
assert.deepEqual(partialFields.missingSources, []);
assert.deepEqual(partialFields.missingFields, [
  "tickets.firstResponseMinutes",
  "satisfaction.csatResponses",
]);

const emptyResponses = runBuild([{}, {}]);
assert.equal(emptyResponses.isComplete, false);
assert.deepEqual(emptyResponses.missingSources, [
  "ticket metrics",
  "satisfaction scores",
]);

// A zero is data, not a missing field.
const zeroWeek = runBuild([
  { ticketsOpened: 0, ticketsResolved: 0, firstResponseMinutes: 0 },
  { csatScore: 0, csatResponses: 0 },
]);
assert.equal(
  zeroWeek.isComplete,
  true,
  "a genuinely quiet week is still a complete week",
);
assert.equal(zeroWeek.resolutionRate, 0);

// ------------------------------------------------------------- hygiene

const serialized = JSON.stringify(workflow);
for (const pattern of [
  /"credentials"\s*:/,
  /api[_-]?key/i,
  /bearer\s+[A-Za-z0-9._-]{8,}/i,
  /docs\.google\.com/i,
  /drive\.google\.com/i,
  /\bAIza[0-9A-Za-z_-]{10,}/,
  /\bsk-[A-Za-z0-9]{10,}/,
]) {
  assert(!pattern.test(serialized), `template must not contain ${pattern}`);
}
assert.equal(
  byName.get("Archive the report in Google Drive").parameters.folderId.value,
  "root",
  "no private Drive folder may ship in the template",
);
for (const match of serialized.match(
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
) ?? []) {
  assert.match(
    match,
    /@example\.com$/,
    `non-example address in template: ${match}`,
  );
}
assert.equal(workflow.active, false, "gallery templates must ship inactive");
assert.deepEqual(workflow.pinData, {}, "pin data must be empty");
assert.equal(workflow.meta.templateCredsSetupCompleted, false);

// --------------------------------------------------------------- description

for (const heading of ["Quick overview", "How it works", "Setup"]) {
  assert(
    description.includes(heading),
    `description is missing the ${heading} section`,
  );
}
assert(
  description.includes("data-gap") || description.includes("data gap"),
  "the description must state the incomplete-metrics outcome",
);
assert(
  !/@(?!example\.com)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(description),
  "description must not carry a real address",
);

console.log(
  `04-scheduled-weekly-report.json verified: ${functionalNodes.length} functional nodes, ${stickyNotes.length} stickies, two parallel sources, one decision, direct binary fan-out`,
);
