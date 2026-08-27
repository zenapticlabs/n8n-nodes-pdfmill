import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, '03-form-to-report.json');

function stableId(name) {
  const hex = createHash('sha256').update(`pdfmill-gallery-v2-03:${name}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function node(name, type, typeVersion, position, parameters, extra = {}) {
  return { parameters, id: stableId(name), name, type, typeVersion, position, ...extra };
}

function sticky(name, content, position, width, height, color) {
  const parameters = { content, height, width };
  if (color !== undefined) parameters.color = color;
  return node(name, 'n8n-nodes-base.stickyNote', 1, position, parameters);
}

function connect(nodeName, outputs) {
  return {
    [nodeName]: {
      main: outputs.map((targets) =>
        targets.map((target) => ({ node: target, type: 'main', index: 0 })),
      ),
    },
  };
}

const parseRequestCode = `// Normalize the submitted request and reject unsupported periods explicitly.
// Accepted period formats: Q3 2026, July 2026, 2026-07, or an ISO date range.
const answers = $json;

const pick = (label) => {
  if (answers[label] !== undefined && answers[label] !== null) return answers[label];
  const wanted = String(label).toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const key of Object.keys(answers)) {
    if (key.toLowerCase().replace(/[^a-z0-9]/g, '') === wanted) return answers[key];
  }
  return undefined;
};

const clean = (value) => String(value ?? '').trim();
const iso = (date) => date.toISOString().slice(0, 10);
const monthNames = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function derivePeriod(label) {
  const value = clean(label);
  const explicit = value.match(/^(\\d{4}-\\d{2}-\\d{2})\\s+(?:to|through|-)\\s+(\\d{4}-\\d{2}-\\d{2})$/i);
  if (explicit) {
    const start = new Date(explicit[1] + 'T00:00:00Z');
    const end = new Date(explicit[2] + 'T00:00:00Z');
    if (!Number.isNaN(start.valueOf()) && !Number.isNaN(end.valueOf()) && start <= end) {
      return { start: explicit[1], end: explicit[2], cadence: 'Report' };
    }
    return null;
  }

  const quarter = value.match(/^Q([1-4])\\s+(\\d{4})$/i);
  if (quarter) {
    const startMonth = (Number(quarter[1]) - 1) * 3;
    const year = Number(quarter[2]);
    return {
      start: iso(new Date(Date.UTC(year, startMonth, 1))),
      end: iso(new Date(Date.UTC(year, startMonth + 3, 0))),
      cadence: 'Quarterly report',
    };
  }

  const named = value.match(/^([A-Za-z]+)\\s+(\\d{4})$/);
  if (named) {
    const month = monthNames.indexOf(named[1].toLowerCase());
    if (month >= 0) {
      const year = Number(named[2]);
      return {
        start: iso(new Date(Date.UTC(year, month, 1))),
        end: iso(new Date(Date.UTC(year, month + 1, 0))),
        cadence: 'Monthly report',
      };
    }
  }

  const isoMonth = value.match(/^(\\d{4})-(\\d{2})$/);
  if (isoMonth) {
    const year = Number(isoMonth[1]);
    const month = Number(isoMonth[2]) - 1;
    if (month >= 0 && month <= 11) {
      return {
        start: iso(new Date(Date.UTC(year, month, 1))),
        end: iso(new Date(Date.UTC(year, month + 1, 0))),
        cadence: 'Monthly report',
      };
    }
  }

  return null;
}

const title = clean(pick('Report title'));
const reportKey = clean(pick('Report key'));
const periodLabel = clean(pick('Period'));
const recipientEmail = clean(pick('Recipient email'));
const highlights = clean(pick('Highlights / summary'));
const author = clean(pick('Prepared by')) || 'n8n automation';
const period = derivePeriod(periodLabel);
const validationErrors = [];

if (!title) validationErrors.push('Report title is required.');
if (!reportKey) validationErrors.push('Report key is required.');
if (!recipientEmail || !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(recipientEmail)) {
  validationErrors.push('A valid recipient email is required.');
}
if (!period) {
  validationErrors.push('Use Q3 2026, July 2026, 2026-07, or 2026-07-01 to 2026-09-30 for Period.');
}

return [{
  json: {
    requestValid: validationErrors.length === 0,
    validationErrors,
    title,
    reportKey,
    periodLabel,
    periodStart: period?.start ?? '',
    periodEnd: period?.end ?? '',
    cadence: period?.cadence ?? 'Report',
    recipientEmail,
    highlights,
    author,
  },
}];`;

const buildReportCode = `// Turn matching Google Sheets rows into the pdfmill report payload.
// Expected columns: Report key, Period, Metric, Current, Previous, Change,
// Direction, Section, Commentary. One row represents one report metric.
const request = $('Parse and validate the request').first().json;
const value = (row, ...names) => {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') {
      return String(row[name]).trim();
    }
  }
  return '';
};

const rows = $input.all()
  .map((item) => item.json ?? {})
  .filter((row) => value(row, 'Metric', 'metric') && value(row, 'Current', 'current'));

const metrics = rows.map((row) => {
  const direction = value(row, 'Direction', 'direction').toLowerCase();
  return {
    label: value(row, 'Metric', 'metric'),
    current: value(row, 'Current', 'current'),
    previous: value(row, 'Previous', 'previous') || '—',
    change: value(row, 'Change', 'change') || '—',
    direction: direction === 'down' ? 'down' : 'up',
  };
});

const seenSections = new Set();
const sections = [];
for (const row of rows) {
  const heading = value(row, 'Section', 'section');
  const body = value(row, 'Commentary', 'commentary');
  const key = heading + '\\u0000' + body;
  if (heading && body && !seenSections.has(key)) {
    seenSections.add(key);
    sections.push({ heading, body });
  }
}

const dataAvailable = metrics.length > 0;
const generatedAt = new Date().toISOString().slice(0, 10);
const safeTitle = request.title.replace(/[\\/:*?"<>|]/g, '-');
const summary = request.highlights || (
  dataAvailable
    ? 'Automated summary built from ' + metrics.length + ' matching metric row' + (metrics.length === 1 ? '' : 's') + '.'
    : ''
);

return [{
  json: {
    ...request,
    dataAvailable,
    missingReason: dataAvailable
      ? ''
      : 'No rows matched Report key "' + request.reportKey + '" and Period "' + request.periodLabel + '".',
    kicker: request.cadence,
    subtitle: request.periodLabel + ' performance summary',
    generatedAt,
    summary,
    kpis: metrics.slice(0, 4).map((metric) => ({
      label: metric.label,
      value: metric.current,
      delta: metric.change,
      down: metric.direction === 'down',
    })),
    sections: sections.length
      ? sections
      : [{
          heading: 'Report notes',
          body: request.highlights || 'Add Section and Commentary values to the matching Google Sheets rows.',
        }],
    table: {
      caption: 'Key metrics vs previous period',
      rows: metrics.map((metric) => ({
        label: metric.label,
        current: metric.current,
        previous: metric.previous,
        change: metric.change,
        direction: metric.direction,
      })),
    },
    fileName: safeTitle + ' - ' + request.periodLabel + '.pdf',
  },
}];`;

const form = node('Report request form', 'n8n-nodes-base.formTrigger', 2.2, [0, 1000], {
  formTitle: 'Request a report',
  formDescription: 'Choose the report and period. Matching metrics are loaded from Google Sheets, validated, rendered to PDF, archived, and emailed.',
  formFields: {
    values: [
      { fieldLabel: 'Report title', placeholder: 'e.g. Q3 Business Review', requiredField: true },
      { fieldLabel: 'Report key', placeholder: 'e.g. sales', requiredField: true },
      {
        fieldLabel: 'Period',
        placeholder: 'e.g. Q3 2026, July 2026, or 2026-07-01 to 2026-09-30',
        requiredField: true,
      },
      {
        fieldLabel: 'Recipient email',
        fieldType: 'email',
        placeholder: 'name@company.com',
        requiredField: true,
      },
      {
        fieldLabel: 'Highlights / summary',
        fieldType: 'textarea',
        placeholder: 'Optional context to place in the report summary',
        requiredField: false,
      },
      { fieldLabel: 'Prepared by', placeholder: 'Your name or team', requiredField: false },
    ],
  },
  options: {
    formSubmittedText: 'Thanks. The workflow will validate the request and email either the finished report or a precise correction message.',
  },
});

const parseRequest = node(
  'Parse and validate the request',
  'n8n-nodes-base.code',
  2,
  [260, 1000],
  { jsCode: parseRequestCode },
);

const requestValid = node('Is the request valid?', 'n8n-nodes-base.if', 2, [540, 1000], {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [
      {
        id: stableId('request-valid-condition'),
        leftValue: '={{ $json.requestValid }}',
        rightValue: '',
        operator: { type: 'boolean', operation: 'true', singleValue: true },
      },
    ],
    combinator: 'and',
  },
  options: {},
});

const invalidRequestEmail = node(
  'Email request corrections',
  'n8n-nodes-base.gmail',
  2.1,
  [540, 1280],
  {
    sendTo: "={{ $('Parse and validate the request').first().json.recipientEmail }}",
    subject: "=We couldn't create {{ $('Parse and validate the request').first().json.title || 'your report' }}",
    message: "=Hi,\n\nWe couldn't create your report because the request needs correction:\n\n- {{ $('Parse and validate the request').first().json.validationErrors.join('\\n- ') }}\n\nSubmit the form again after correcting those fields.\n\n— n8n + pdfmill",
    options: {},
  },
);

const sheets = node(
  'Load matching metrics from Google Sheets',
  'n8n-nodes-base.googleSheets',
  4.7,
  [880, 900],
  {
    resource: 'sheet',
    operation: 'read',
    documentId: { __rl: true, mode: 'list', value: '', cachedResultName: 'Select metrics spreadsheet' },
    sheetName: { __rl: true, mode: 'list', value: '', cachedResultName: 'Select metrics sheet' },
    filtersUI: {
      values: [
        {
          lookupColumn: 'Report key',
          lookupValue: "={{ $('Parse and validate the request').first().json.reportKey }}",
        },
        {
          lookupColumn: 'Period',
          lookupValue: "={{ $('Parse and validate the request').first().json.periodLabel }}",
        },
      ],
    },
    options: {},
  },
  { alwaysOutputData: true },
);

const buildReport = node(
  'Build the report from metric rows',
  'n8n-nodes-base.code',
  2,
  [1140, 900],
  { jsCode: buildReportCode },
);

const metricsFound = node('Were matching metrics found?', 'n8n-nodes-base.if', 2, [1400, 900], {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [
      {
        id: stableId('metrics-found-condition'),
        leftValue: '={{ $json.dataAvailable }}',
        rightValue: '',
        operator: { type: 'boolean', operation: 'true', singleValue: true },
      },
    ],
    combinator: 'and',
  },
  options: {},
});

const noDataEmail = node('Email that no metrics matched', 'n8n-nodes-base.gmail', 2.1, [1400, 1200], {
  sendTo: "={{ $('Parse and validate the request').first().json.recipientEmail }}",
  subject: "=No metrics found for {{ $('Parse and validate the request').first().json.title }}",
  message: "=Hi,\n\n{{ $('Build the report from metric rows').first().json.missingReason }}\n\nCheck that the Google Sheet contains matching Report key and Period values, then submit the form again.\n\n— n8n + pdfmill",
  options: {},
});

const pdf = node('Generate the report PDF', 'n8n-nodes-pdfmill.pdfmill', 1, [1740, 820], {
  operation: 'template',
  template: 'report',
  data: '={{ $json }}',
  format: 'pdf',
  binaryPropertyName: 'data',
  options: {},
});

const drive = node('Archive the report in Google Drive', 'n8n-nodes-base.googleDrive', 3, [2000, 760], {
  resource: 'file',
  operation: 'upload',
  inputDataFieldName: 'data',
  name: "={{ $('Build the report from metric rows').first().json.fileName }}",
  driveId: { __rl: true, mode: 'list', value: 'My Drive', cachedResultName: 'My Drive' },
  folderId: { __rl: true, mode: 'list', value: 'root', cachedResultName: '/ (Root folder)' },
  options: {},
});

const successEmail = node('Email the finished report', 'n8n-nodes-base.gmail', 2.1, [2000, 1000], {
  sendTo: "={{ $('Build the report from metric rows').first().json.recipientEmail }}",
  subject: "=Your report is ready — {{ $('Build the report from metric rows').first().json.title }}",
  message: "=Hi,\n\nThe requested report — {{ $('Build the report from metric rows').first().json.title }} ({{ $('Build the report from metric rows').first().json.periodLabel }}) — is attached. It was built from {{ $('Build the report from metric rows').first().json.table.rows.length }} matching Google Sheets metric rows.\n\nPrepared by {{ $('Build the report from metric rows').first().json.author }}.\n\n— n8n + pdfmill",
  options: { attachmentsUi: { attachmentsBinary: [{ property: 'data' }] } },
});

const notes = [
  sticky(
    'Overview',
    `## 📊 Requested report → validated metrics → PDF

**Who it's for:** operations, finance, and account teams that repeatedly build the same client or internal report from a shared metrics sheet.

**What it does:** accepts a report request through an n8n Form, validates the period, loads matching metric rows from Google Sheets, rejects missing data with a useful email, renders the finished report with pdfmill, archives it in Drive, and emails the PDF.

**Control flow**
1. Parse the request and reject unsupported dates.
2. Match **Report key + Period** against Google Sheets.
3. Stop and notify the requester when no rows match.
4. Aggregate rows into KPIs, narrative sections, and a comparison table.
5. Render once, then deliver the same binary to Drive and Gmail.

**Setup:** select the metrics spreadsheet and sheet; connect Google Sheets, Gmail, Drive, and pdfmill credentials; then share the Form Trigger URL.`,
    [-80, 20],
    1120,
    700,
  ),
  sticky(
    'Section: Collect and validate',
    `## 1. Collect and validate
The form captures a report key, period, recipient, and optional context. Invalid period formats take the lower branch and receive a correction email; they never consume a render.`,
    [-60, 760],
    860,
    800,
    7,
  ),
  sticky(
    'Section: Load and verify metrics',
    `## 2. Load and verify metrics
Google Sheets returns rows matching both the report key and period. The Code node converts them into the report schema. An empty result takes the lower branch and tells the requester exactly what did not match.`,
    [820, 680],
    840,
    820,
    7,
  ),
  sticky(
    'Section: Render and deliver',
    `## 3. Render and deliver
pdfmill creates one PDF binary. n8n sends that same binary to Google Drive and Gmail, so the archived copy and requester attachment are identical.`,
    [1680, 620],
    620,
    720,
    7,
  ),
  sticky(
    'Setup: metrics sheet schema',
    `## Metrics sheet schema

Create one row per metric with these exact headers:

| Report key | Period | Metric | Current | Previous | Change | Direction | Section | Commentary |
|---|---|---|---|---|---|---|---|---|
| sales | Q3 2026 | Revenue | $128,400 | $114,200 | +12.4% | up | Performance | Revenue grew on enterprise expansion. |
| sales | Q3 2026 | Churn rate | 2.9% | 2.5% | +0.4 pt | down | Next steps | Investigate churn by plan and cohort. |

- **Report key** and **Period** must exactly match the form values.
- **Metric** and **Current** are required for a row to count.
- **Previous**, **Change**, and **Direction** populate the comparison table.
- Repeating the same **Section + Commentary** is deduplicated.
- \`Direction = down\` marks the KPI delta as adverse; other values render as up.

The Google Sheets node deliberately has no document selected. Choose your sheet during setup; never publish a real spreadsheet ID in a template.`,
    [820, 1540],
    1080,
    700,
    4,
  ),
];

const workflow = {
  name: 'Collect report requests, validate Google Sheets metrics, and generate PDF reports with pdfmill',
  nodes: [
    form,
    parseRequest,
    requestValid,
    invalidRequestEmail,
    sheets,
    buildReport,
    metricsFound,
    noDataEmail,
    pdf,
    drive,
    successEmail,
    ...notes,
  ],
  connections: {
    ...connect(form.name, [[parseRequest.name]]),
    ...connect(parseRequest.name, [[requestValid.name]]),
    ...connect(requestValid.name, [[sheets.name], [invalidRequestEmail.name]]),
    ...connect(sheets.name, [[buildReport.name]]),
    ...connect(buildReport.name, [[metricsFound.name]]),
    ...connect(metricsFound.name, [[pdf.name], [noDataEmail.name]]),
    ...connect(pdf.name, [[drive.name, successEmail.name]]),
  },
  active: false,
  settings: { executionOrder: 'v1' },
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
  tags: [{ name: 'pdfmill' }],
};

await writeFile(output, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
console.log(`wrote ${output} (${workflow.nodes.filter((item) => item.type !== 'n8n-nodes-base.stickyNote').length} functional nodes)`);
