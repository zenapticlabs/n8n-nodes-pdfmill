import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, "02-cohort-to-certificates.json");

function stableId(name) {
  const hex = createHash("sha256")
    .update(`pdfmill-gallery-v2-02:${name}`)
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

const buildCertificatesCode = String.raw`// Validate the WHOLE roster before creating any attendee items.
// Required cohort identity: program, organization, issuer name/title, and completion date.
// Required per attendee: name, one standard mailbox address, and positive hours.
// No certificate is rendered or sent when any certificate fact is malformed.
const body = ($json.body && typeof $json.body === 'object') ? $json.body : $json;
const clean = (value) => String(value ?? '').trim();
const firstNonEmpty = (...values) => values.map(clean).find(Boolean) ?? '';
const isValidEmail = (email) => {
  if (!email || email.length > 254) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) return false;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_{|}~-]+$/.test(local)) return false;

  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) =>
    label.length > 0 &&
    label.length <= 63 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  );
};
const isIsoDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const attendees = Array.isArray(body.attendees) ? body.attendees : [];

if (attendees.length === 0) {
  return [{
    json: {
      isValid: false,
      error: 'The request must include a non-empty attendees array.',
      invalidCohortFields: [],
      invalidAttendees: [],
      issued: 0,
    },
    pairedItem: { item: 0 },
  }];
}

const programName = firstNonEmpty(body.program, body.programName, body.course);
const organization = firstNonEmpty(body.organization, body.org);
const issuer = (body.issuer && typeof body.issuer === 'object') ? body.issuer : {};
const issuerName = firstNonEmpty(issuer.name, body.issuerName);
const issuerTitle = firstNonEmpty(issuer.title, body.issuerTitle);
const cohortCompletedAt = firstNonEmpty(body.completedAt, body.completionDate);
const invalidCohortFields = [];
if (!programName) invalidCohortFields.push('program');
if (!organization) invalidCohortFields.push('organization');
if (!issuerName) invalidCohortFields.push('issuer.name');
if (!issuerTitle) invalidCohortFields.push('issuer.title');
if (!isIsoDate(cohortCompletedAt)) invalidCohortFields.push('completedAt (YYYY-MM-DD)');

const invalidAttendees = [];
const normalizedAttendees = attendees.map((value, index) => {
  const attendee = (value && typeof value === 'object') ? value : {};
  const recipientName = firstNonEmpty(attendee.name, attendee.recipientName, attendee.fullName);
  const email = firstNonEmpty(attendee.email, attendee.emailAddress);
  const hoursRaw = clean(attendee.hours) ? attendee.hours : attendee.duration;
  const hours = Number(hoursRaw);
  const completedAt = firstNonEmpty(attendee.completedAt, attendee.completionDate);
  const invalidFields = [];

  if (!recipientName) invalidFields.push('name');
  if (!isValidEmail(email)) invalidFields.push('email');
  if (clean(hoursRaw) === '' || !Number.isFinite(hours) || hours <= 0) invalidFields.push('hours');
  if (completedAt && !isIsoDate(completedAt)) invalidFields.push('completedAt (YYYY-MM-DD)');
  if (invalidFields.length > 0) invalidAttendees.push({ position: index + 1, fields: invalidFields });

  return { attendee, recipientName, email, hours, completedAt };
});

if (invalidCohortFields.length > 0 || invalidAttendees.length > 0) {
  const details = [];
  if (invalidCohortFields.length > 0) details.push('cohort fields: ' + invalidCohortFields.join(', '));
  for (const invalid of invalidAttendees) {
    details.push('attendee ' + invalid.position + ': ' + invalid.fields.join(', '));
  }
  return [{
    json: {
      isValid: false,
      error: 'The cohort request is invalid. Check ' + details.join('; ') + '.',
      invalidCohortFields,
      invalidAttendees,
      issued: 0,
    },
    pairedItem: { item: 0 },
  }];
}

const executionId = clean($execution && $execution.id);
if (!/^[A-Za-z0-9_-]+$/.test(executionId)) {
  throw new Error('n8n execution ID is unavailable or malformed; collision-resistant certificate numbers cannot be created.');
}
const executionToken = executionId;
const issuedAtDate = new Date();
const issuedAt = issuedAtDate.toISOString().slice(0, 10);
const year = issuedAtDate.getUTCFullYear();

return normalizedAttendees.map(({ attendee, recipientName, email, hours, completedAt }, index) => ({
  json: {
    isValid: true,
    certificateNumber: 'CERT-' + year + '-' + executionToken + '-' + String(index + 1).padStart(3, '0'),
    organization,
    recipientName,
    programName,
    hours,
    grade: firstNonEmpty(attendee.grade, attendee.result) || 'Completed',
    completedAt: completedAt || cohortCompletedAt,
    issuedAt,
    issuerName,
    issuerTitle,
    email,
  },
  pairedItem: { item: 0 },
}));`;

const webhook = node(
  "When a cohort completes",
  "n8n-nodes-base.webhook",
  2,
  [0, 1000],
  {
    httpMethod: "POST",
    path: "cohort-completed",
    responseMode: "responseNode",
    options: {},
  },
  { webhookId: stableId("cohort-completed-webhook") },
);

const buildCertificates = node(
  "Validate and build the cohort certificates",
  "n8n-nodes-base.code",
  2,
  [300, 1000],
  { jsCode: buildCertificatesCode },
);

const rosterValid = node(
  "Is the entire roster valid?",
  "n8n-nodes-base.if",
  2,
  [600, 1000],
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
          id: stableId("roster-valid-condition"),
          leftValue: "={{ $json.isValid }}",
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
  "Generate each certificate PDF",
  "n8n-nodes-pdfmill.pdfmill",
  1,
  [880, 1000],
  {
    operation: "template",
    template: "certificate",
    data: "={{ $json }}",
    format: "pdf",
    binaryPropertyName: "data",
    options: {},
  },
);

const gmail = node(
  "Email each certificate to its attendee",
  "n8n-nodes-base.gmail",
  2.1,
  [1180, 860],
  {
    sendTo:
      "={{ $('Validate and build the cohort certificates').item.json.email }}",
    subject:
      "=Your certificate for {{ $('Validate and build the cohort certificates').item.json.programName }}",
    message:
      "=Hi {{ $('Validate and build the cohort certificates').item.json.recipientName }},\n\nCongratulations on completing {{ $('Validate and build the cohort certificates').item.json.programName }} ({{ $('Validate and build the cohort certificates').item.json.hours }} hours, grade {{ $('Validate and build the cohort certificates').item.json.grade }}).\n\nYour certificate ({{ $('Validate and build the cohort certificates').item.json.certificateNumber }}) from {{ $('Validate and build the cohort certificates').item.json.organization }} is attached as a PDF.\n\nWith congratulations,\n{{ $('Validate and build the cohort certificates').item.json.issuerName }}\n{{ $('Validate and build the cohort certificates').item.json.issuerTitle }}, {{ $('Validate and build the cohort certificates').item.json.organization }}",
    options: { attachmentsUi: { attachmentsBinary: [{ property: "data" }] } },
  },
);

const drive = node(
  "Archive each certificate in Google Drive",
  "n8n-nodes-base.googleDrive",
  3,
  [1180, 1120],
  {
    resource: "file",
    operation: "upload",
    inputDataFieldName: "data",
    name: "=Certificate - {{ $('Validate and build the cohort certificates').item.json.recipientName }} - {{ $('Validate and build the cohort certificates').item.json.certificateNumber }}.pdf",
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
  [1480, 1000],
  {
    mode: "chooseBranch",
    numberInputs: 2,
    chooseBranchMode: "waitForAll",
    output: "empty",
  },
);

const successResponse = node(
  "Return the issued count",
  "n8n-nodes-base.respondToWebhook",
  1.1,
  [1760, 1000],
  {
    respondWith: "json",
    responseBody:
      '={{ { "issued": $(\'Validate and build the cohort certificates\').all().length, "program": $(\'Validate and build the cohort certificates\').first().json.programName, "organization": $(\'Validate and build the cohort certificates\').first().json.organization, "status": "issued" } }}',
    options: {},
  },
);

const errorResponse = node(
  "Return one 400 roster error",
  "n8n-nodes-base.respondToWebhook",
  1.1,
  [880, 1620],
  {
    respondWith: "json",
    responseBody: '={{ { "error": $json.error, "issued": 0 } }}',
    options: { responseCode: 400 },
  },
);

const notes = [
  sticky(
    "Overview",
    `## 🎓 Cohort completion → certificate PDFs

**Who it's for:** course, bootcamp, training, and webinar teams that issue personalized completion certificates to a whole cohort.

**What it does:** receives one cohort payload, validates **all certificate identity fields and every attendee mailbox before any work starts**, fans the valid roster out into one item per attendee, and generates a branded certificate PDF with pdfmill.

Each PDF goes **directly and in parallel** to Gmail and Google Drive. The Merge node waits for both delivery branches to finish before the webhook returns the issued count. Gmail output is never used as the source of the Drive upload.

**Control flow**
1. Receive and validate the complete roster and certificate facts.
2. Reject an empty roster or any invalid field with one 400 response.
3. Fan out the valid roster and render one PDF per attendee.
4. Email and archive the same pdfmill binary.
5. Wait for both branches, then return the issued count.

**Setup:** connect pdfmill, Gmail, and Google Drive credentials; choose an archive folder; then POST the documented payload to the Production webhook URL.`,
    [-80, 20],
    1160,
    680,
  ),
  sticky(
    "Section: Validate the whole roster",
    `## 1. Validate the whole roster
The Code node checks the complete batch before fan-out. Cohort identity fields and a non-empty \`attendees\` array are required; every attendee needs a name, one valid \`email\`/\`emailAddress\`, and positive hours. One bad field rejects the whole cohort, so a malformed request can never be partially sent.`,
    [-60, 760],
    800,
    640,
    7,
  ),
  sticky(
    "Section: Render each certificate",
    `## 2. Render each certificate
A valid roster becomes one item per attendee. pdfmill renders the Certificate template once for each item and writes the PDF binary to \`data\`.`,
    [780, 760],
    320,
    640,
    7,
  ),
  sticky(
    "Section: Deliver, join, and respond",
    `## 3. Deliver, join, and respond
The pdfmill output fans out directly to Gmail and Drive. Both nodes consume the same \`data\` binary. The Merge node waits for **both** successful branches before a single webhook response reports how many certificates were issued.`,
    [1120, 700],
    920,
    720,
    7,
  ),
  sticky(
    "Section: Reject the batch",
    `## Invalid roster → one 400
An empty roster, malformed mailbox, missing certificate identity, non-positive hours, or invalid completion date rejects the complete cohort with one clear 400 response. Nothing is rendered, emailed, or archived.`,
    [780, 1440],
    420,
    400,
    7,
  ),
  sticky(
    "Setup: expected cohort payload",
    `## Expected payload

POST a cohort to the Production webhook URL:

\`\`\`json
{
  "program": "Automation 101",
  "organization": "Acme Academy",
  "issuer": { "name": "Ada Lovelace", "title": "Head of Training" },
  "completedAt": "2026-08-01",
  "attendees": [
    { "name": "Alan Turing", "email": "alan@example.com", "hours": 12 },
    { "name": "Grace Hopper", "email": "grace@example.com", "hours": 12, "grade": "Distinction" }
  ]
}
\`\`\`

### Required cohort fields
- \`program\` (or \`programName\` / \`course\`)
- \`organization\` (or \`org\`)
- \`issuer.name\` and \`issuer.title\` (top-level aliases are accepted)
- \`completedAt\` as \`YYYY-MM-DD\` (or \`completionDate\`)

### Required attendee fields
- \`attendees\` must be a non-empty array.
- Every attendee needs \`name\`, one standard mailbox in \`email\` (or \`emailAddress\`), and positive numeric \`hours\` (or \`duration\`).

\`recipientName\`/\`fullName\`, \`result\`, and \`completionDate\` are accepted aliases. Attendee \`grade\` is optional and defaults to \`Completed\`; an attendee completion date may override the cohort date. Certificate numbers include the n8n execution ID, preventing adjacent workflow executions from sharing numbers.

Connect a pdfmill API credential, Gmail, and Google Drive. Select the Drive folder where certificates should be archived.`,
    [-60, 1460],
    800,
    920,
    4,
  ),
];

const workflow = {
  name: "Issue cohort certificates with pdfmill, Gmail, and Google Drive",
  nodes: [
    webhook,
    buildCertificates,
    rosterValid,
    pdf,
    gmail,
    drive,
    waitForDelivery,
    successResponse,
    errorResponse,
    ...notes,
  ],
  connections: {
    ...connect(webhook.name, [[buildCertificates.name]]),
    ...connect(buildCertificates.name, [[rosterValid.name]]),
    ...connect(rosterValid.name, [[pdf.name], [errorResponse.name]]),
    ...connect(pdf.name, [[gmail.name, drive.name]]),
    ...connect(gmail.name, [[target(waitForDelivery.name, 0)]]),
    ...connect(drive.name, [[target(waitForDelivery.name, 1)]]),
    ...connect(waitForDelivery.name, [[successResponse.name]]),
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
