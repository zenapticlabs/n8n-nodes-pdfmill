import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, "05-order-to-packing-slip.json");

function stableId(name) {
  const hex = createHash("sha256")
    .update(`pdfmill-gallery-v2-05:${name}`)
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

const buildPackingSlipCode = String.raw`// Validate the WHOLE order before rendering, emailing, or archiving anything.
// A packing slip is warehouse-facing: identity, addresses, SKUs, descriptions, and quantities.
// Price fields from the source order are deliberately ignored.
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
const addressObject = (value) => (value && typeof value === 'object') ? value : {};
const addressName = (value) => firstNonEmpty(
  value.name,
  [firstNonEmpty(value.firstName, value.first_name), firstNonEmpty(value.lastName, value.last_name)].filter(Boolean).join(' ')
);
const formattedAddress = (value) => firstNonEmpty(
  value.address,
  value.formattedAddress,
  [
    firstNonEmpty(value.address1, value.address_1),
    firstNonEmpty(value.address2, value.address_2),
    value.city,
    firstNonEmpty(value.province, value.state),
    firstNonEmpty(value.zip, value.postcode, value.postalCode),
    value.country,
  ].map(clean).filter(Boolean).join(', ')
);
const rawItems = Array.isArray(body.items)
  ? body.items
  : (Array.isArray(body.line_items) ? body.line_items : []);

const orderNumber = firstNonEmpty(body.orderNumber, body.name, body.order_number, body.orderId, body.id);
const orderedAtSource = firstNonEmpty(body.orderedAt, body.createdAt, body.created_at);
const orderedAt = /^\d{4}-\d{2}-\d{2}/.test(orderedAtSource) ? orderedAtSource.slice(0, 10) : orderedAtSource;
const shippedAtSource = firstNonEmpty(body.shippedAt, body.shipped_at) || new Date().toISOString().slice(0, 10);
const shippedAt = /^\d{4}-\d{2}-\d{2}/.test(shippedAtSource) ? shippedAtSource.slice(0, 10) : shippedAtSource;
const warehouseEmail = firstNonEmpty(body.warehouseEmail, body.fulfillmentEmail, body.fulfilmentEmail);

const rawShipTo = addressObject(body.shipTo ?? body.shipping ?? body.shippingAddress ?? body.shipping_address);
const rawCustomer = addressObject(body.customer);
const shipTo = {
  name: firstNonEmpty(addressName(rawShipTo), addressName(rawCustomer)),
  address: firstNonEmpty(formattedAddress(rawShipTo), formattedAddress(rawCustomer)),
};
const rawShipFrom = addressObject(body.shipFrom ?? body.warehouse ?? body.fulfillmentCenter ?? body.fulfilmentCentre);
const shipFrom = {
  name: addressName(rawShipFrom),
  address: formattedAddress(rawShipFrom),
};

const invalidOrderFields = [];
if (!orderNumber || orderNumber.length > 100) invalidOrderFields.push('orderNumber');
if (!isIsoDate(orderedAt)) invalidOrderFields.push('orderedAt (YYYY-MM-DD)');
if (!isIsoDate(shippedAt)) invalidOrderFields.push('shippedAt (YYYY-MM-DD)');
if (!isValidEmail(warehouseEmail)) invalidOrderFields.push('warehouseEmail');
if (!shipFrom.name) invalidOrderFields.push('shipFrom.name');
if (!shipFrom.address) invalidOrderFields.push('shipFrom.address');
if (!shipTo.name) invalidOrderFields.push('shipTo.name');
if (!shipTo.address) invalidOrderFields.push('shipTo.address');
if (rawItems.length === 0) invalidOrderFields.push('items (non-empty array)');

const invalidItems = [];
const items = rawItems.map((value, index) => {
  const item = (value && typeof value === 'object') ? value : {};
  const sku = firstNonEmpty(item.sku, item.variant_sku, item.variantSku, item.variantId, item.id);
  const description = firstNonEmpty(item.description, item.name, item.title);
  const quantitySource = clean(item.quantity) ? item.quantity : item.qty;
  const quantity = Number(quantitySource);
  const invalidFields = [];

  if (!sku) invalidFields.push('sku');
  if (!description) invalidFields.push('description');
  if (clean(quantitySource) === '' || !Number.isInteger(quantity) || quantity <= 0) invalidFields.push('quantity');
  if (invalidFields.length > 0) invalidItems.push({ position: index + 1, fields: invalidFields });

  return { sku, description, quantity };
});

if (invalidOrderFields.length > 0 || invalidItems.length > 0) {
  const details = [];
  if (invalidOrderFields.length > 0) details.push('order fields: ' + invalidOrderFields.join(', '));
  for (const invalid of invalidItems) details.push('item ' + invalid.position + ': ' + invalid.fields.join(', '));
  return [{
    json: {
      isValid: false,
      error: 'The packing-slip request is invalid. Check ' + details.join('; ') + '.',
      invalidOrderFields,
      invalidItems,
      status: 'rejected',
    },
    pairedItem: { item: 0 },
  }];
}

const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
const fileSafeOrderNumber = orderNumber
  .replace(/[^A-Za-z0-9._-]+/g, '_')
  .replace(/^_+|_+$/g, '') || 'order';

return [{
  json: {
    isValid: true,
    orderNumber,
    fileSafeOrderNumber,
    orderedAt,
    shippedAt,
    carrier: firstNonEmpty(body.carrier, body.shipping_carrier),
    trackingNumber: firstNonEmpty(body.trackingNumber, body.tracking_number),
    shipFrom,
    shipTo,
    items,
    totalItems,
    totalWeight: clean(body.totalWeight),
    notes: firstNonEmpty(body.notes, body.note) || 'Pick against the SKUs, verify every quantity, and mark the order fulfilled after dispatch.',
    warehouseEmail,
  },
  pairedItem: { item: 0 },
}];`;

const webhook = node(
  "When a paid order is ready to fulfil",
  "n8n-nodes-base.webhook",
  2,
  [0, 1000],
  {
    httpMethod: "POST",
    path: "paid-order-packing-slip",
    responseMode: "responseNode",
    options: {},
  },
  { webhookId: stableId("paid-order-packing-slip-webhook") },
);

const buildPackingSlip = node(
  "Validate and build the packing slip",
  "n8n-nodes-base.code",
  2,
  [300, 1000],
  { jsCode: buildPackingSlipCode },
);

const orderValid = node(
  "Is the entire order valid?",
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
          id: stableId("order-valid-condition"),
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
  "Generate the packing slip PDF",
  "n8n-nodes-pdfmill.pdfmill",
  1,
  [880, 1000],
  {
    operation: "template",
    template: "packing-slip",
    data: "={{ $json }}",
    format: "pdf",
    binaryPropertyName: "data",
    options: {},
  },
);

const gmail = node(
  "Email the packing slip to the warehouse",
  "n8n-nodes-base.gmail",
  2.1,
  [1180, 860],
  {
    sendTo:
      "={{ $('Validate and build the packing slip').item.json.warehouseEmail }}",
    subject:
      "=Order {{ $('Validate and build the packing slip').item.json.orderNumber }} is ready to pack ({{ $('Validate and build the packing slip').item.json.totalItems }} units)",
    message:
      "=A paid order is ready to pick and pack.\n\nOrder: {{ $('Validate and build the packing slip').item.json.orderNumber }}\nUnits: {{ $('Validate and build the packing slip').item.json.totalItems }}\nShip to: {{ $('Validate and build the packing slip').item.json.shipTo.name }}\nCarrier: {{ $('Validate and build the packing slip').item.json.carrier || 'Not assigned' }}\nTracking: {{ $('Validate and build the packing slip').item.json.trackingNumber || 'Not assigned' }}\n\nThe attached packing slip contains SKUs, descriptions, and quantities only—no prices. Pick against the SKUs and verify every quantity before dispatch.",
    options: { attachmentsUi: { attachmentsBinary: [{ property: "data" }] } },
  },
);

const drive = node(
  "Archive the packing slip in Google Drive",
  "n8n-nodes-base.googleDrive",
  3,
  [1180, 1120],
  {
    resource: "file",
    operation: "upload",
    inputDataFieldName: "data",
    name: "=Packing slip - {{ $('Validate and build the packing slip').item.json.fileSafeOrderNumber }}.pdf",
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
  "Wait for warehouse email and archive",
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
  "Return packing_slip_ready",
  "n8n-nodes-base.respondToWebhook",
  1.1,
  [1760, 1000],
  {
    respondWith: "json",
    responseBody:
      '={{ { "orderNumber": $(\'Validate and build the packing slip\').first().json.orderNumber, "totalItems": $(\'Validate and build the packing slip\').first().json.totalItems, "status": "packing_slip_ready" } }}',
    options: {},
  },
);

const errorResponse = node(
  "Return one 400 order error",
  "n8n-nodes-base.respondToWebhook",
  1.1,
  [880, 1620],
  {
    respondWith: "json",
    responseBody: '={{ { "error": $json.error, "status": "rejected" } }}',
    options: { responseCode: 400 },
  },
);

const notes = [
  sticky(
    "Overview",
    `## 📦 Paid order → warehouse packing slip

**Who it's for:** ecommerce and fulfilment teams that need a clean, price-free packing slip as soon as an order is ready to pack.

**What it does:** receives one paid order, validates the complete fulfilment payload before any side effect, and renders a branded packing slip with pdfmill. The PDF contains order identity, ship-from/ship-to addresses, SKUs, descriptions, and quantities—never prices.

The pdfmill binary goes **directly and in parallel** to Gmail and Google Drive. The Merge waits for both branches before the webhook returns \`packing_slip_ready\`. Gmail output is never reused as the Drive upload source.

**Control flow**
1. Receive and validate the whole order.
2. Reject missing identity, addresses, warehouse mailbox, dates, or malformed line items with one 400 response.
3. Render one price-free packing slip PDF.
4. Email and archive the same pdfmill binary.
5. Wait for both branches, then return the order number and unit count.

**Setup:** connect pdfmill, Gmail, and Google Drive credentials; choose an archive folder; then POST the documented payload to the Production webhook URL.`,
    [-80, 20],
    1160,
    720,
  ),
  sticky(
    "Section: Validate the whole order",
    `## 1. Validate the whole order
The Code node checks the complete order before rendering. Order identity, dates, ship-from and ship-to addresses, a warehouse mailbox, and a non-empty items array are required. Every item needs a SKU, description, and positive integer quantity. One bad field rejects the whole order, so a malformed request cannot trigger a partial fulfilment action.`,
    [-60, 800],
    800,
    640,
    7,
  ),
  sticky(
    "Section: Render the packing slip",
    `## 2. Render the packing slip
pdfmill renders the built-in Packing Slip template and writes the PDF binary to \`data\`. Source prices are deliberately ignored; only warehouse-facing item and shipping facts reach the document.`,
    [780, 800],
    320,
    640,
    7,
  ),
  sticky(
    "Section: Deliver, join, and respond",
    `## 3. Deliver, join, and respond
The pdfmill output fans out directly to Gmail and Drive. Both nodes consume the same \`data\` binary. Gmail sends to the validated warehouse mailbox, Drive archives the PDF, and the Merge waits for **both** successful branches before a single webhook response reports \`packing_slip_ready\`.`,
    [1120, 740],
    920,
    720,
    7,
  ),
  sticky(
    "Section: Reject the order",
    `## Invalid order → one 400
An empty order, malformed warehouse mailbox, missing address, invalid date, or line without a SKU, description, or positive integer quantity rejects the complete request. Nothing is rendered, emailed, or archived.`,
    [780, 1480],
    420,
    420,
    7,
  ),
  sticky(
    "Setup: expected paid-order payload",
    `## Expected payload

POST a paid order to the Production webhook URL:

\`\`\`json
{
  "orderNumber": "SO-2026-3187",
  "orderedAt": "2026-08-25",
  "shippedAt": "2026-08-26",
  "warehouseEmail": "warehouse@example.com",
  "shipFrom": { "name": "North Dock", "address": "1 Fulfilment Way, Austin, TX 78701" },
  "shipTo": { "name": "Ana Popescu", "address": "22 Aviatorilor, Bucharest" },
  "carrier": "DHL Express",
  "trackingNumber": "JD014600003118872291",
  "items": [
    { "sku": "NTS-TENT-02", "description": "Alpine two-person tent", "quantity": 1 },
    { "sku": "NTS-BTL-07", "description": "Insulated steel bottle", "quantity": 2 }
  ]
}
\`\`\`

### Required order fields
- \`orderNumber\`, \`orderedAt\` as \`YYYY-MM-DD\`, and one standard mailbox in \`warehouseEmail\`
- \`shipFrom.name\`, \`shipFrom.address\`, \`shipTo.name\`, and \`shipTo.address\`
- A non-empty \`items\` array; every item needs a SKU, description, and positive integer quantity

\`shippedAt\` defaults to today's UTC date. Carrier, tracking number, weight, and notes are optional. Common Shopify/WooCommerce aliases such as \`line_items\`, \`order_number\`, \`created_at\`, \`variant_sku\`, and \`qty\` are accepted. Source price fields are ignored.

Connect a pdfmill API credential, Gmail, and Google Drive. Select the Drive folder where packing slips should be archived.`,
    [-60, 1500],
    800,
    1040,
    4,
  ),
];

const workflow = {
  name: "Issue warehouse packing slips with pdfmill, Gmail, and Google Drive",
  nodes: [
    webhook,
    buildPackingSlip,
    orderValid,
    pdf,
    gmail,
    drive,
    waitForDelivery,
    successResponse,
    errorResponse,
    ...notes,
  ],
  connections: {
    ...connect(webhook.name, [[buildPackingSlip.name]]),
    ...connect(buildPackingSlip.name, [[orderValid.name]]),
    ...connect(orderValid.name, [[pdf.name], [errorResponse.name]]),
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
