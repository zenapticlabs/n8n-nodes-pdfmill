import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, "04-scheduled-weekly-report.json");

function stableId(name) {
  const hex = createHash("sha256")
    .update(`pdfmill-gallery-v2-04:${name}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function node(name, type, typeVersion, position, parameters, extra = {}) {
  return {
    parameters,
    id: stableId(name),
    name,
    type,
    typeVersion,
    position,
    ...extra,
  };
}

function sticky(name, content, position, width, height, color) {
  const parameters = { content, height, width };
  if (color !== undefined) parameters.color = color;
  return node(name, "n8n-nodes-base.stickyNote", 1, position, parameters);
}

function target(name, index = 0) {
  return { name, index };
}

function connect(nodeName, outputs) {
  return {
    [nodeName]: {
      main: outputs.map((targets) =>
        targets.map((item) => {
          const destination = typeof item === "string" ? target(item) : item;
          return {
            node: destination.name,
            type: "main",
            index: destination.index,
          };
        }),
      ),
    },
  };
}

const reportingWindowCode = String.raw`// SETUP: change these two values to your own mailbox and metrics API.
const reportRecipient = 'weekly-report@example.com';
const metricsBaseUrl = 'https://api.example.com';

// Always report on the previous COMPLETE ISO week (Monday-Sunday, UTC), never a partial week.
const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const mondayOffset = (today.getUTCDay() + 6) % 7;
const periodStartDate = new Date(today);
periodStartDate.setUTCDate(today.getUTCDate() - mondayOffset - 7);
const periodEndDate = new Date(periodStartDate);
periodEndDate.setUTCDate(periodStartDate.getUTCDate() + 6);

const isoWeekOf = (date) => {
  const cursor = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7) + 3);
  const isoYear = cursor.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  return {
    isoYear,
    week: 1 + Math.round((cursor.getTime() - firstThursday.getTime()) / 604800000),
  };
};

const { isoYear, week } = isoWeekOf(periodStartDate);
const weekLabel = isoYear + '-W' + String(week).padStart(2, '0');
const asDate = (value) => value.toISOString().slice(0, 10);

return [{
  json: {
    weekLabel,
    fileSafeWeek: weekLabel.replace(/[^A-Za-z0-9._-]+/g, '-'),
    periodStart: asDate(periodStartDate),
    periodEnd: asDate(periodEndDate),
    generatedAt: asDate(today),
    reportRecipient,
    metricsBaseUrl,
  },
  pairedItem: { item: 0 },
}];`;

const buildReportCode = String.raw`// Reconcile TWO independent sources before anything is rendered or sent.
// Either request can fail or answer partially (both HTTP nodes continue on failure), so the
// report is built only when every required figure is present. Otherwise this returns an
// incomplete result and the workflow sends a data-gap notice instead of a misleading report.
const reportWindow = $('Set the weekly reporting window').first().json;
const inputs = $input.all().map((item) => (item.json && typeof item.json === 'object') ? item.json : {});
const unwrap = (row) => (row.body && typeof row.body === 'object') ? row.body : row;
const rows = inputs.map(unwrap);

const numeric = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const hasTickets = (row) => numeric(row.ticketsOpened) !== null || numeric(row.ticketsResolved) !== null;
const hasSatisfaction = (row) => numeric(row.csatScore) !== null;
const tickets = rows.find(hasTickets) ?? null;
const satisfaction = rows.find(hasSatisfaction) ?? null;
const sourceErrors = inputs
  .filter((row) => row.error)
  .map((row) => String((row.error && row.error.message) ? row.error.message : row.error).slice(0, 200));

const missingSources = [];
if (!tickets) missingSources.push('ticket metrics');
if (!satisfaction) missingSources.push('satisfaction scores');

const missingFields = [];
if (tickets) {
  for (const field of ['ticketsOpened', 'ticketsResolved', 'firstResponseMinutes']) {
    if (numeric(tickets[field]) === null) missingFields.push('tickets.' + field);
  }
}
if (satisfaction) {
  for (const field of ['csatScore', 'csatResponses']) {
    if (numeric(satisfaction[field]) === null) missingFields.push('satisfaction.' + field);
  }
}

if (missingSources.length > 0 || missingFields.length > 0) {
  return [{
    json: {
      weekLabel: reportWindow.weekLabel,
      periodStart: reportWindow.periodStart,
      periodEnd: reportWindow.periodEnd,
      reportRecipient: reportWindow.reportRecipient,
      isComplete: false,
      missingSources,
      missingFields,
      sourceErrors,
      status: 'incomplete_metrics',
    },
    pairedItem: { item: 0 },
  }];
}

const previousOf = (row) => (row.previous && typeof row.previous === 'object') ? row.previous : {};
const ticketsPrevious = previousOf(tickets);
const satisfactionPrevious = previousOf(satisfaction);

const round = (value, digits) => {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
};
const withThousands = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const percentChange = (current, previous, higherIsBetter) => {
  const base = numeric(previous);
  if (base === null || base === 0) {
    return { change: 'No prior week', direction: 'up', improved: true, previous: 'n/a' };
  }
  const ratio = ((current - base) / Math.abs(base)) * 100;
  const improved = higherIsBetter ? current >= base : current <= base;
  return {
    change: (ratio >= 0 ? '+' : '-') + round(Math.abs(ratio), 1) + '%',
    direction: improved ? 'up' : 'down',
    improved,
    previous: base,
  };
};

const opened = numeric(tickets.ticketsOpened) ?? 0;
const resolved = numeric(tickets.ticketsResolved) ?? 0;
const firstResponse = numeric(tickets.firstResponseMinutes) ?? 0;
const csat = numeric(satisfaction.csatScore) ?? 0;
const csatResponses = numeric(satisfaction.csatResponses) ?? 0;
const backlog = Math.max(opened - resolved, 0);
const resolutionRate = opened > 0 ? round((resolved / opened) * 100, 1) : 0;

const openedChange = percentChange(opened, ticketsPrevious.ticketsOpened, false);
const resolvedChange = percentChange(resolved, ticketsPrevious.ticketsResolved, true);

// The resolution-rate KPI must carry the change in the RATE, never the change in resolved volume.
const previousOpened = numeric(ticketsPrevious.ticketsOpened);
const previousResolved = numeric(ticketsPrevious.ticketsResolved);
const previousResolutionRate = (previousOpened !== null && previousOpened > 0 && previousResolved !== null)
  ? round((previousResolved / previousOpened) * 100, 1)
  : null;
const resolutionRateChange = previousResolutionRate === null
  ? { change: 'No prior week', improved: true }
  : {
      change: (resolutionRate >= previousResolutionRate ? '+' : '-') +
        round(Math.abs(resolutionRate - previousResolutionRate), 1) + ' pt',
      improved: resolutionRate >= previousResolutionRate,
    };
const responseChange = percentChange(firstResponse, ticketsPrevious.firstResponseMinutes, false);
const csatChange = percentChange(csat, satisfactionPrevious.csatScore, true);

const metricRows = [
  {
    label: 'Tickets opened',
    current: withThousands(opened),
    previous: openedChange.previous === 'n/a' ? 'n/a' : withThousands(openedChange.previous),
    change: openedChange.change,
    direction: openedChange.direction,
  },
  {
    label: 'Tickets resolved',
    current: withThousands(resolved),
    previous: resolvedChange.previous === 'n/a' ? 'n/a' : withThousands(resolvedChange.previous),
    change: resolvedChange.change,
    direction: resolvedChange.direction,
  },
  {
    label: 'Median first response',
    current: round(firstResponse, 1) + ' min',
    previous: responseChange.previous === 'n/a' ? 'n/a' : round(responseChange.previous, 1) + ' min',
    change: responseChange.change,
    direction: responseChange.direction,
  },
  {
    label: 'Customer satisfaction',
    current: round(csat, 2) + ' / 5',
    previous: csatChange.previous === 'n/a' ? 'n/a' : round(csatChange.previous, 2) + ' / 5',
    change: csatChange.change,
    direction: csatChange.direction,
  },
];

const summary = 'The service desk opened ' + withThousands(opened) + ' tickets and resolved ' +
  withThousands(resolved) + ' between ' + reportWindow.periodStart + ' and ' + reportWindow.periodEnd +
  ', a ' + resolutionRate + '% resolution rate with ' + withThousands(backlog) +
  ' still open at the end of the week. Median first response was ' + round(firstResponse, 1) +
  ' minutes and customer satisfaction averaged ' + round(csat, 2) + ' / 5 across ' +
  withThousands(csatResponses) + ' rated conversations. Every figure comes from the ticket and ' +
  'satisfaction APIs for this week only; no value is estimated or carried forward.';

return [{
  json: {
    isComplete: true,
    status: 'report_data_ready',
    weekLabel: reportWindow.weekLabel,
    fileSafeWeek: reportWindow.fileSafeWeek,
    reportRecipient: reportWindow.reportRecipient,
    ticketsOpened: opened,
    ticketsResolved: resolved,
    backlog,
    resolutionRate,
    csatScore: round(csat, 2),
    kicker: 'Weekly service desk report',
    title: 'Service desk performance - ' + reportWindow.weekLabel,
    subtitle: 'Ticket volume, resolution and customer satisfaction for ' +
      reportWindow.periodStart + ' to ' + reportWindow.periodEnd,
    periodStart: reportWindow.periodStart,
    periodEnd: reportWindow.periodEnd,
    generatedAt: reportWindow.generatedAt,
    author: 'Scheduled n8n reporting workflow',
    summary,
    kpis: [
      { label: 'Tickets opened', value: withThousands(opened), delta: openedChange.change, down: !openedChange.improved },
      { label: 'Resolution rate', value: resolutionRate + '%', delta: resolutionRateChange.change, down: !resolutionRateChange.improved },
      { label: 'Median first response', value: round(firstResponse, 1) + ' min', delta: responseChange.change, down: !responseChange.improved },
      { label: 'Customer satisfaction', value: round(csat, 2) + ' / 5', delta: csatChange.change, down: !csatChange.improved },
    ],
    sections: [
      {
        heading: 'Volume and resolution',
        body: 'Agents resolved ' + withThousands(resolved) + ' of ' + withThousands(opened) +
          ' tickets opened this week (' + resolutionRate + '%). ' + withThousands(backlog) +
          ' tickets remained open at the close of ' + reportWindow.periodEnd +
          ' and roll into the next reporting week.',
      },
      {
        heading: 'Responsiveness and satisfaction',
        body: 'Median first response was ' + round(firstResponse, 1) + ' minutes (' +
          responseChange.change + ' against the prior week). Satisfaction averaged ' +
          round(csat, 2) + ' / 5 from ' + withThousands(csatResponses) +
          ' rated conversations, so the score covers only customers who chose to rate.',
      },
    ],
    table: {
      caption: 'Week ' + reportWindow.weekLabel + ' against the prior week',
      rows: metricRows,
    },
  },
  pairedItem: { item: 0 },
}];`;

const schedule = node(
  "Every Monday 08:00",
  "n8n-nodes-base.scheduleTrigger",
  1.2,
  [-220, 1420],
  {
    rule: {
      interval: [
        {
          field: "weeks",
          triggerAtDay: [1],
          triggerAtHour: 8,
          triggerAtMinute: 0,
        },
      ],
    },
  },
);

const reportingWindow = node(
  "Set the weekly reporting window",
  "n8n-nodes-base.code",
  2,
  [80, 1420],
  { jsCode: reportingWindowCode },
);

const ticketMetrics = node(
  "Fetch ticket metrics",
  "n8n-nodes-base.httpRequest",
  4.2,
  [400, 1280],
  {
    url: "={{ $json.metricsBaseUrl }}/service-desk/tickets",
    sendQuery: true,
    queryParameters: {
      parameters: [
        { name: "start", value: "={{ $json.periodStart }}" },
        { name: "end", value: "={{ $json.periodEnd }}" },
      ],
    },
    options: { response: { response: { neverError: true } } },
  },
  {
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: "continueRegularOutput",
  },
);

const satisfactionMetrics = node(
  "Fetch satisfaction scores",
  "n8n-nodes-base.httpRequest",
  4.2,
  [400, 1560],
  {
    url: "={{ $json.metricsBaseUrl }}/service-desk/satisfaction",
    sendQuery: true,
    queryParameters: {
      parameters: [
        { name: "start", value: "={{ $json.periodStart }}" },
        { name: "end", value: "={{ $json.periodEnd }}" },
      ],
    },
    options: { response: { response: { neverError: true } } },
  },
  {
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 2000,
    onError: "continueRegularOutput",
  },
);

const combineSources = node(
  "Combine both metric sources",
  "n8n-nodes-base.merge",
  3.2,
  [700, 1420],
  { mode: "append", numberInputs: 2, options: {} },
);

const buildReport = node(
  "Validate and build the weekly report",
  "n8n-nodes-base.code",
  2,
  [980, 1420],
  { jsCode: buildReportCode },
);

const reportComplete = node(
  "Are both sources complete?",
  "n8n-nodes-base.if",
  2,
  [1260, 1420],
  {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: "",
        typeValidation: "strict",
        version: 2,
      },
      conditions: [
        {
          id: stableId("report-complete-condition"),
          leftValue: "={{ $json.isComplete }}",
          rightValue: "",
          operator: { type: "boolean", operation: "true", singleValue: true },
        },
      ],
      combinator: "and",
    },
    options: {},
  },
);

const pdf = node(
  "Generate the weekly report PDF",
  "n8n-nodes-pdfmill.pdfmill",
  1,
  [1560, 1280],
  {
    operation: "template",
    template: "report",
    data: "={{ $json }}",
    format: "pdf",
    binaryPropertyName: "data",
    options: {},
  },
);

const emailReport = node(
  "Email the report to the team",
  "n8n-nodes-base.gmail",
  2.1,
  [1860, 1160],
  {
    sendTo:
      "={{ $('Validate and build the weekly report').item.json.reportRecipient }}",
    subject:
      "=Service desk report {{ $('Validate and build the weekly report').item.json.weekLabel }}",
    message:
      "=The weekly service desk report is attached.\n\nWeek: {{ $('Validate and build the weekly report').item.json.weekLabel }} ({{ $('Validate and build the weekly report').item.json.periodStart }} to {{ $('Validate and build the weekly report').item.json.periodEnd }})\nTickets opened: {{ $('Validate and build the weekly report').item.json.ticketsOpened }}\nResolution rate: {{ $('Validate and build the weekly report').item.json.resolutionRate }}%\nCustomer satisfaction: {{ $('Validate and build the weekly report').item.json.csatScore }} / 5\nStill open at week end: {{ $('Validate and build the weekly report').item.json.backlog }}\n\nEvery figure in the PDF comes from the ticket and satisfaction APIs for this week only.",
    options: { attachmentsUi: { attachmentsBinary: [{ property: "data" }] } },
  },
);

const archiveReport = node(
  "Archive the report in Google Drive",
  "n8n-nodes-base.googleDrive",
  3,
  [1860, 1420],
  {
    resource: "file",
    operation: "upload",
    inputDataFieldName: "data",
    name: "=Service desk report - {{ $('Validate and build the weekly report').item.json.fileSafeWeek }}.pdf",
    driveId: {
      __rl: true,
      mode: "list",
      value: "My Drive",
      cachedResultName: "My Drive",
    },
    folderId: {
      __rl: true,
      mode: "list",
      value: "root",
      cachedResultName: "/ (Root folder)",
    },
    options: {},
  },
);

const waitForDelivery = node(
  "Wait for email and archive",
  "n8n-nodes-base.merge",
  3.2,
  [2160, 1280],
  {
    mode: "chooseBranch",
    numberInputs: 2,
    chooseBranchMode: "waitForAll",
    output: "empty",
  },
);

const dataGapNotice = node(
  "Email a data-gap notice",
  "n8n-nodes-base.gmail",
  2.1,
  [1560, 1840],
  {
    sendTo: "={{ $json.reportRecipient }}",
    subject:
      "=No service desk report for {{ $json.weekLabel }} - incomplete metrics",
    message:
      "=The weekly service desk report was NOT generated for {{ $json.weekLabel }} ({{ $json.periodStart }} to {{ $json.periodEnd }}).\n\nMissing sources: {{ $json.missingSources.join(', ') || 'none' }}\nMissing fields: {{ $json.missingFields.join(', ') || 'none' }}\nSource errors: {{ $json.sourceErrors.join(' | ') || 'none reported' }}\n\nNo PDF was rendered and nothing was archived. Fix the metrics API or the credentials, then run this workflow manually to publish the week.",
    options: {},
  },
);

const notes = [
  sticky(
    "Overview",
    `## 📈 Scheduled weekly report from two metric sources

**Who it's for:** support, ops and agency teams that owe someone the same report every week and want it produced, delivered and archived without a person assembling it.

**What it does:** every Monday it derives the previous complete ISO week, pulls **two independent metric sources in parallel**, and reconciles them. Only when every required figure is present does pdfmill render the branded report; the same binary is emailed and archived.

**The honest part:** a partial week never becomes a report. If either source fails, answers empty, or omits a required field, the workflow sends a **data-gap notice naming what was missing** and renders nothing. Both HTTP nodes retry three times and continue on failure, so a dead API produces an explained gap instead of a silent miss or a misleading PDF.

**Control flow**
1. Schedule → compute the previous Monday–Sunday window (UTC).
2. Fetch ticket metrics and satisfaction scores in parallel, with retries.
3. Merge both sources and reconcile them against the required fields.
4. Complete → render the PDF; incomplete → email a data-gap notice and stop.
5. Email and archive the same pdfmill binary, then wait for both branches.

**Setup:** open **Set the weekly reporting window** and change \`reportRecipient\` and \`metricsBaseUrl\`; connect pdfmill, Gmail and Google Drive; pick the Drive archive folder.`,
    [-280, 120],
    1200,
    700,
  ),
  sticky(
    "Section: Window and sources",
    `## 1. Window, then two sources
Always the **previous complete ISO week** in UTC, so a run never reports a partial week.

Both requests retry and **continue on failure**, so a dead endpoint becomes a reported gap instead of an aborted run.`,
    [-280, 1080],
    900,
    620,
    7,
  ),
  sticky(
    "Section: Reconcile before rendering",
    `## 2. Reconcile before rendering
The Code node classifies both responses **by shape, not arrival order**, and requires every figure.

Anything missing produces \`isComplete: false\` naming the gap, so no report is built from partial data.`,
    [660, 1080],
    880,
    620,
    7,
  ),
  sticky(
    "Section: Render, deliver, join",
    `## 3. Render, deliver and join
The pdfmill binary fans out **directly** to Gmail and Drive, and the Merge waits for both branches.`,
    [1540, 1020],
    880,
    700,
    7,
  ),
  sticky(
    "Incomplete week → data-gap notice",
    `## Incomplete metrics → a named gap
The team gets an email naming the missing sources, fields and API errors. Nothing is rendered or archived, so an empty inbox never hides a problem.`,
    [1540, 1620],
    880,
    380,
    7,
  ),
  sticky(
    "Setup: expected metrics responses",
    `## Expected responses

Point \`metricsBaseUrl\` at any API that answers these two GET requests with \`start\` and \`end\` query parameters.

\`/service-desk/tickets\`
\`\`\`json
{
  "ticketsOpened": 412,
  "ticketsResolved": 398,
  "firstResponseMinutes": 18.4,
  "previous": { "ticketsOpened": 377, "ticketsResolved": 361, "firstResponseMinutes": 22.7 }
}
\`\`\`

\`/service-desk/satisfaction\`
\`\`\`json
{
  "csatScore": 4.62,
  "csatResponses": 214,
  "previous": { "csatScore": 4.41 }
}
\`\`\`

### Required
- Tickets: \`ticketsOpened\`, \`ticketsResolved\`, \`firstResponseMinutes\`
- Satisfaction: \`csatScore\`, \`csatResponses\`

\`previous\` is optional — without it the report prints "No prior week" instead of a fabricated comparison. A response wrapped in \`body\` is unwrapped automatically.

### Credentials and setup
1. Edit \`reportRecipient\` and \`metricsBaseUrl\` in **Set the weekly reporting window**.
2. Add pdfmill, Gmail and Google Drive credentials.
3. Choose the Drive folder for the archive.
4. If your metrics API needs auth, add it on both HTTP nodes — never paste a token into this template.`,
    [-280, 1900],
    900,
    1060,
    4,
  ),
];

const workflow = {
  name: "Publish a weekly service desk report with pdfmill, Gmail, and Google Drive",
  nodes: [
    schedule,
    reportingWindow,
    ticketMetrics,
    satisfactionMetrics,
    combineSources,
    buildReport,
    reportComplete,
    pdf,
    emailReport,
    archiveReport,
    waitForDelivery,
    dataGapNotice,
    ...notes,
  ],
  connections: {
    ...connect(schedule.name, [[reportingWindow.name]]),
    ...connect(reportingWindow.name, [
      [ticketMetrics.name, satisfactionMetrics.name],
    ]),
    ...connect(ticketMetrics.name, [[target(combineSources.name, 0)]]),
    ...connect(satisfactionMetrics.name, [[target(combineSources.name, 1)]]),
    ...connect(combineSources.name, [[buildReport.name]]),
    ...connect(buildReport.name, [[reportComplete.name]]),
    ...connect(reportComplete.name, [[pdf.name], [dataGapNotice.name]]),
    ...connect(pdf.name, [[emailReport.name, archiveReport.name]]),
    ...connect(emailReport.name, [[target(waitForDelivery.name, 0)]]),
    ...connect(archiveReport.name, [[target(waitForDelivery.name, 1)]]),
  },
  active: false,
  settings: { executionOrder: "v1" },
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
  tags: [{ name: "pdfmill" }],
};

await writeFile(output, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
console.log(
  `wrote ${output} (${workflow.nodes.filter((item) => item.type !== "n8n-nodes-base.stickyNote").length} functional nodes)`,
);
