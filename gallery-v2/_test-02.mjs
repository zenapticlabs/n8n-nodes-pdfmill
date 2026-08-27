import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL(
  "./02-cohort-to-certificates.json",
  import.meta.url,
);
const descriptionUrl = new URL("./02-description.md", import.meta.url);
const rawWorkflow = await readFile(workflowUrl, "utf8");
const workflow = JSON.parse(rawWorkflow);
const description = await readFile(descriptionUrl, "utf8");

const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
const names = new Set(byName.keys());
const functionalNodes = workflow.nodes.filter(
  (node) => node.type !== "n8n-nodes-base.stickyNote",
);

function stableId(name) {
  const hex = createHash("sha256")
    .update(`pdfmill-gallery-v2-02:${name}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function edges(source, output = 0) {
  return workflow.connections[source]?.main?.[output] ?? [];
}

function edgeNames(source, output = 0) {
  return edges(source, output)
    .map((edge) => edge.node)
    .sort();
}

assert.equal(
  rawWorkflow,
  `${JSON.stringify(workflow, null, 2)}\n`,
  "workflow serialization must be stable",
);
assert.equal(
  functionalNodes.length,
  9,
  "expected nine functional nodes after the delivery join",
);
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

const buildNode = byName.get("Validate and build the cohort certificates");
const runBuild = new Function(
  "$json",
  "$execution",
  buildNode.parameters.jsCode,
);
const NativeDate = globalThis.Date;
const fixedTime = NativeDate.parse("2026-08-25T12:34:56.000Z");
const execution = { id: "1001", mode: "production" };
class FixedDate extends NativeDate {
  constructor(...args) {
    super(...(args.length === 0 ? [fixedTime] : args));
  }

  static now() {
    return fixedTime;
  }
}

const payload = {
  body: {
    programName: "Automation 101",
    org: "Acme Academy",
    issuerName: "Ada Lovelace",
    issuerTitle: "Head of Training",
    completionDate: "2026-08-01",
    attendees: [
      {
        name: "Alan Turing",
        email: "alan@example.com",
        hours: 12,
        grade: "Pass",
      },
      {
        fullName: "Grace Hopper",
        emailAddress: "grace@example.com",
        duration: "14",
        result: "Distinction",
        completionDate: "2026-08-02",
      },
    ],
  },
};

const collisionPayload = structuredClone(payload);
collisionPayload.body.attendees.push({
  name: "Katherine Johnson",
  email: "katherine@example.com",
  hours: 16,
});

let firstRun;
let replayRun;
let collisionRun;
let adjacentExecutionRun;
try {
  globalThis.Date = FixedDate;
  firstRun = runBuild(payload, execution);
  replayRun = runBuild(payload, execution);
  collisionRun = runBuild(collisionPayload, {
    id: "2001",
    mode: "production",
  });
  adjacentExecutionRun = runBuild(collisionPayload, {
    id: "2002",
    mode: "production",
  });
} finally {
  globalThis.Date = NativeDate;
}

assert.deepEqual(
  firstRun,
  replayRun,
  "the same execution and fixed-time fixture must replay deterministically",
);
assert.equal(firstRun.length, 2, "two attendees must fan out to two items");
assert(
  firstRun.every((item) => item.json.isValid === true),
  "all fan-out items must be valid",
);
assert.deepEqual(
  firstRun.map((item) => item.pairedItem),
  [{ item: 0 }, { item: 0 }],
);
assert.equal(
  firstRun[0].json.programName,
  "Automation 101",
  "programName alias must map",
);
assert.equal(
  firstRun[0].json.organization,
  "Acme Academy",
  "org alias must map",
);
assert.equal(
  firstRun[0].json.issuerName,
  "Ada Lovelace",
  "issuerName alias must map",
);
assert.equal(
  firstRun[1].json.recipientName,
  "Grace Hopper",
  "fullName alias must map",
);
assert.equal(
  firstRun[1].json.email,
  "grace@example.com",
  "emailAddress alias must map",
);
assert.equal(firstRun[1].json.hours, 14, "duration alias must map");
assert.equal(firstRun[1].json.grade, "Distinction", "result alias must map");
assert.equal(
  firstRun[1].json.completedAt,
  "2026-08-02",
  "attendee date alias must override cohort date",
);
assert.equal(firstRun[0].json.issuedAt, "2026-08-25");
assert.equal(firstRun[0].json.certificateNumber, "CERT-2026-1001-001");
assert.equal(firstRun[1].json.certificateNumber, "CERT-2026-1001-002");
assert.equal(
  new Set(firstRun.map((item) => item.json.certificateNumber)).size,
  firstRun.length,
  "certificate numbers must be unique within one execution",
);
assert.equal(
  collisionRun.length,
  3,
  "collision fixture must model a cohort of three",
);
assert.equal(
  collisionRun.some((item) =>
    adjacentExecutionRun.some(
      (adjacentItem) =>
        adjacentItem.json.certificateNumber === item.json.certificateNumber,
    ),
  ),
  false,
  "adjacent three-person executions at the same time must not share certificate numbers",
);

const [emptyRoster] = runBuild({ body: { attendees: [] } }, execution);
assert.equal(emptyRoster.json.isValid, false);
assert.equal(emptyRoster.json.issued, 0);
assert.match(emptyRoster.json.error, /non-empty attendees array/);

function assertRejected(body, label) {
  const result = runBuild({ body }, execution);
  assert.equal(
    result.length,
    1,
    `${label}: a malformed roster must produce one error item`,
  );
  assert.equal(result[0].json.isValid, false, `${label}: must be invalid`);
  assert.equal(result[0].json.issued, 0, `${label}: must issue nothing`);
  assert.equal(
    "email" in result[0].json,
    false,
    `${label}: invalid output must not resemble a sendable attendee`,
  );
  return result[0].json;
}

const invalidRosterBody = structuredClone(payload.body);
invalidRosterBody.attendees = [
  { name: "Valid", email: "valid@example.com", hours: 8 },
  { name: "Invalid", email: "not-an-email", hours: 8 },
  { name: "Missing", hours: 8 },
];
const invalidRoster = assertRejected(
  invalidRosterBody,
  "invalid and missing email batch",
);
assert.deepEqual(invalidRoster.invalidAttendees, [
  { position: 2, fields: ["email"] },
  { position: 3, fields: ["email"] },
]);
assert.match(invalidRoster.error, /attendee 2: email; attendee 3: email/);

for (const malformedEmail of [
  "alice@example.com,attacker",
  "a..b@example.com",
  "alice@example..com",
]) {
  const body = structuredClone(payload.body);
  body.attendees[1].emailAddress = malformedEmail;
  const rejection = assertRejected(body, `malformed email ${malformedEmail}`);
  assert.deepEqual(rejection.invalidAttendees, [
    { position: 2, fields: ["email"] },
  ]);
}

for (const { label, mutate, expectedField } of [
  {
    label: "missing program",
    mutate: (body) => delete body.programName,
    expectedField: "program",
  },
  {
    label: "missing organization",
    mutate: (body) => delete body.org,
    expectedField: "organization",
  },
  {
    label: "missing issuer name",
    mutate: (body) => delete body.issuerName,
    expectedField: "issuer.name",
  },
  {
    label: "missing issuer title",
    mutate: (body) => delete body.issuerTitle,
    expectedField: "issuer.title",
  },
  {
    label: "missing completion date",
    mutate: (body) => delete body.completionDate,
    expectedField: "completedAt (YYYY-MM-DD)",
  },
  {
    label: "invalid completion date",
    mutate: (body) => {
      body.completionDate = "2026-02-30";
    },
    expectedField: "completedAt (YYYY-MM-DD)",
  },
]) {
  const body = structuredClone(payload.body);
  mutate(body);
  const rejection = assertRejected(body, label);
  assert(
    rejection.invalidCohortFields.includes(expectedField),
    `${label}: expected ${expectedField}`,
  );
}

for (const { label, mutate, expectedField } of [
  {
    label: "missing attendee name",
    mutate: (attendee) => delete attendee.name,
    expectedField: "name",
  },
  {
    label: "missing attendee hours",
    mutate: (attendee) => delete attendee.hours,
    expectedField: "hours",
  },
  {
    label: "zero attendee hours",
    mutate: (attendee) => {
      attendee.hours = 0;
    },
    expectedField: "hours",
  },
  {
    label: "non-numeric attendee hours",
    mutate: (attendee) => {
      attendee.hours = "many";
    },
    expectedField: "hours",
  },
  {
    label: "invalid attendee completion date",
    mutate: (attendee) => {
      attendee.completionDate = "August someday";
    },
    expectedField: "completedAt (YYYY-MM-DD)",
  },
]) {
  const body = structuredClone(payload.body);
  mutate(body.attendees[0]);
  const rejection = assertRejected(body, label);
  assert.deepEqual(rejection.invalidAttendees, [
    { position: 1, fields: [expectedField] },
  ]);
}

assert.deepEqual(edgeNames("Is the entire roster valid?", 0), [
  "Generate each certificate PDF",
]);
assert.deepEqual(edgeNames("Is the entire roster valid?", 1), [
  "Return one 400 roster error",
]);
assert.equal(
  edges("Is the entire roster valid?", 1).length,
  1,
  "invalid roster must have one response path",
);

const pdf = byName.get("Generate each certificate PDF");
const gmail = byName.get("Email each certificate to its attendee");
const drive = byName.get("Archive each certificate in Google Drive");
const merge = byName.get("Wait for email and archive");
const errorResponse = byName.get("Return one 400 roster error");

assert.equal(pdf.parameters.binaryPropertyName, "data");
assert.deepEqual(
  edgeNames(pdf.name),
  [drive.name, gmail.name].sort(),
  "pdfmill must fan its binary directly to Gmail and Drive",
);
assert.deepEqual(edgeNames(gmail.name), [merge.name]);
assert.deepEqual(edgeNames(drive.name), [merge.name]);
assert.deepEqual(
  edges(gmail.name).map((edge) => edge.index),
  [0],
);
assert.deepEqual(
  edges(drive.name).map((edge) => edge.index),
  [1],
);
assert.deepEqual(edgeNames(merge.name), ["Return the issued count"]);
assert.equal(
  workflow.connections[gmail.name]?.main?.[0]?.some(
    (edge) => edge.node === drive.name,
  ),
  false,
);
assert.equal(
  gmail.parameters.options.attachmentsUi.attachmentsBinary[0].property,
  "data",
);
assert.equal(drive.parameters.inputDataFieldName, "data");

// Model n8n's fan-out with inert sinks: both direct branches receive the same
// pdfmill `data` bytes, without invoking Gmail or Google Drive.
const mockPdfItem = {
  json: { success: true },
  binary: {
    data: {
      data: Buffer.from("%PDF-1.4\nfixture certificate").toString("base64"),
    },
  },
};
const sinkInputs = Object.fromEntries(
  edgeNames(pdf.name).map((sinkName) => [
    sinkName,
    structuredClone(mockPdfItem),
  ]),
);
const binaryHash = (item) =>
  createHash("sha256")
    .update(Buffer.from(item.binary.data.data, "base64"))
    .digest("hex");
assert.equal(binaryHash(sinkInputs[gmail.name]), binaryHash(mockPdfItem));
assert.equal(binaryHash(sinkInputs[drive.name]), binaryHash(mockPdfItem));
assert.equal(
  binaryHash(sinkInputs[gmail.name]),
  binaryHash(sinkInputs[drive.name]),
);

assert.deepEqual(merge.parameters, {
  mode: "chooseBranch",
  numberInputs: 2,
  chooseBranchMode: "waitForAll",
  output: "empty",
});
assert.equal(merge.typeVersion, 3.2);

assert.equal(errorResponse.parameters.options.responseCode, 400);
assert.match(errorResponse.parameters.responseBody, /\$json\.error/);
assert.equal(
  functionalNodes.filter(
    (node) =>
      node.type === "n8n-nodes-base.respondToWebhook" &&
      node.parameters.options?.responseCode === 400,
  ).length,
  1,
  "workflow must contain exactly one 400 response node",
);

for (const node of functionalNodes) {
  assert.equal(
    "credentials" in node,
    false,
    `template must not embed credentials: ${node.name}`,
  );
}
assert.equal(
  pdf.parameters.template,
  "certificate",
  "template selector must be semantic, not a private ID",
);
assert.equal(
  drive.parameters.driveId.value,
  "My Drive",
  "Drive selector must remain generic",
);
assert.equal(
  drive.parameters.folderId.value,
  "root",
  "folder selector must remain generic",
);
assert.doesNotMatch(
  rawWorkflow,
  /(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|AIza[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~-]{20,}/,
  "workflow must not contain a credential-like secret",
);

const setup = byName.get("Setup: expected cohort payload").parameters.content;
assert.match(setup, /`issuer\.name` and `issuer\.title`/);
assert.match(setup, /Every attendee needs `name`/);
assert.match(setup, /`emailAddress`/);
assert.match(setup, /positive numeric `hours`/);
assert.match(setup, /n8n execution ID/);
assert.doesNotMatch(setup, /Only `attendees` is required/);
assert.match(buildNode.parameters.jsCode, /\$execution && \$execution\.id/);
assert.doesNotMatch(buildNode.parameters.jsCode, /%\s*100000/);

for (const heading of [
  "**Who's it for**",
  "**How it works**",
  "**How to set up**",
  "**Requirements**",
  "**How to customize**",
]) {
  assert(description.includes(heading), `description is missing ${heading}`);
}
const descriptionWords = description.trim().split(/\s+/).length;
assert(
  descriptionWords >= 180 && descriptionWords <= 320,
  `description word count out of range: ${descriptionWords}`,
);

console.log(
  "PASS 02: strict whole-roster validation, deterministic execution-scoped IDs, fan-out, one 400, direct binary branches, join, structure, docs, and secret hygiene",
);
