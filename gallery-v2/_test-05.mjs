import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL("./05-order-to-packing-slip.json", import.meta.url);
const descriptionUrl = new URL("./05-description.md", import.meta.url);
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
    .update(`pdfmill-gallery-v2-05:${name}`)
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

const buildNode = byName.get("Validate and build the packing slip");
const runBuild = new Function("$json", buildNode.parameters.jsCode);
const NativeDate = globalThis.Date;
const fixedTime = NativeDate.parse("2026-08-26T12:34:56.000Z");
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
    order_number: "#3187",
    created_at: "2026-08-25T15:30:00.000Z",
    shipped_at: "2026-08-26T09:15:00.000Z",
    fulfillmentEmail: "warehouse@example.com",
    warehouse: {
      name: "North Dock",
      address: "1 Fulfilment Way, Austin, TX 78701",
    },
    shipping: {
      first_name: "Ana",
      last_name: "Popescu",
      address_1: "22 Aviatorilor",
      city: "Bucharest",
      postcode: "011853",
      country: "Romania",
    },
    shipping_carrier: "DHL Express",
    tracking_number: "JD014600003118872291",
    line_items: [
      {
        variant_sku: "NTS-TENT-02",
        name: "Alpine two-person tent",
        qty: "1",
        price: "399.00",
      },
      {
        sku: "NTS-BTL-07",
        title: "Insulated steel bottle",
        quantity: 2,
        unitPrice: 35,
      },
    ],
    totalWeight: "4.6 kg",
    note: "Verify both SKUs before sealing the parcel.",
  },
};

let firstRun;
let replayRun;
let defaultShipmentDateRun;
try {
  globalThis.Date = FixedDate;
  firstRun = runBuild(payload);
  replayRun = runBuild(payload);
  const withoutShipmentDate = structuredClone(payload);
  delete withoutShipmentDate.body.shipped_at;
  defaultShipmentDateRun = runBuild(withoutShipmentDate);
} finally {
  globalThis.Date = NativeDate;
}

assert.deepEqual(
  firstRun,
  replayRun,
  "fixed-time valid input must replay deterministically",
);
assert.equal(
  firstRun.length,
  1,
  "one order must produce one packing slip item",
);
assert.equal(firstRun[0].json.isValid, true);
assert.deepEqual(firstRun[0].pairedItem, { item: 0 });
assert.equal(firstRun[0].json.orderNumber, "#3187");
assert.equal(firstRun[0].json.fileSafeOrderNumber, "3187");
assert.equal(firstRun[0].json.orderedAt, "2026-08-25");
assert.equal(firstRun[0].json.shippedAt, "2026-08-26");
assert.equal(defaultShipmentDateRun[0].json.shippedAt, "2026-08-26");
assert.equal(firstRun[0].json.warehouseEmail, "warehouse@example.com");
assert.deepEqual(firstRun[0].json.shipFrom, payload.body.warehouse);
assert.deepEqual(firstRun[0].json.shipTo, {
  name: "Ana Popescu",
  address: "22 Aviatorilor, Bucharest, 011853, Romania",
});
assert.equal(firstRun[0].json.carrier, "DHL Express");
assert.equal(firstRun[0].json.trackingNumber, "JD014600003118872291");
assert.equal(firstRun[0].json.totalItems, 3);
assert.equal(firstRun[0].json.totalWeight, "4.6 kg");
assert.deepEqual(firstRun[0].json.items, [
  {
    sku: "NTS-TENT-02",
    description: "Alpine two-person tent",
    quantity: 1,
  },
  {
    sku: "NTS-BTL-07",
    description: "Insulated steel bottle",
    quantity: 2,
  },
]);
for (const item of firstRun[0].json.items) {
  assert.deepEqual(
    Object.keys(item).sort(),
    ["description", "quantity", "sku"],
    "normalized packing-slip lines must contain no price fields",
  );
}
for (const forbidden of ["price", "unitPrice", "subtotal", "tax", "total"]) {
  assert.equal(
    forbidden in firstRun[0].json,
    false,
    `packing-slip output must omit ${forbidden}`,
  );
}

function assertRejected(body, label) {
  const result = runBuild({ body });
  assert.equal(
    result.length,
    1,
    `${label}: invalid input must produce one error item`,
  );
  assert.equal(result[0].json.isValid, false, `${label}: must be invalid`);
  assert.equal(result[0].json.status, "rejected", `${label}: must be rejected`);
  assert.equal(
    "warehouseEmail" in result[0].json,
    false,
    `${label}: invalid output must not resemble a sendable order`,
  );
  return result[0].json;
}

for (const { label, mutate, expectedField } of [
  {
    label: "missing order number",
    mutate: (body) => delete body.order_number,
    expectedField: "orderNumber",
  },
  {
    label: "missing order date",
    mutate: (body) => delete body.created_at,
    expectedField: "orderedAt (YYYY-MM-DD)",
  },
  {
    label: "invalid order date",
    mutate: (body) => {
      body.created_at = "2026-02-30";
    },
    expectedField: "orderedAt (YYYY-MM-DD)",
  },
  {
    label: "invalid shipment date",
    mutate: (body) => {
      body.shipped_at = "tomorrow";
    },
    expectedField: "shippedAt (YYYY-MM-DD)",
  },
  {
    label: "missing warehouse mailbox",
    mutate: (body) => delete body.fulfillmentEmail,
    expectedField: "warehouseEmail",
  },
  {
    label: "missing ship-from name",
    mutate: (body) => delete body.warehouse.name,
    expectedField: "shipFrom.name",
  },
  {
    label: "missing ship-from address",
    mutate: (body) => delete body.warehouse.address,
    expectedField: "shipFrom.address",
  },
  {
    label: "missing ship-to name",
    mutate: (body) => {
      delete body.shipping.first_name;
      delete body.shipping.last_name;
    },
    expectedField: "shipTo.name",
  },
  {
    label: "missing ship-to address",
    mutate: (body) => {
      delete body.shipping.address_1;
      delete body.shipping.city;
      delete body.shipping.postcode;
      delete body.shipping.country;
    },
    expectedField: "shipTo.address",
  },
  {
    label: "empty order",
    mutate: (body) => {
      body.line_items = [];
    },
    expectedField: "items (non-empty array)",
  },
]) {
  const body = structuredClone(payload.body);
  mutate(body);
  const rejection = assertRejected(body, label);
  assert(
    rejection.invalidOrderFields.includes(expectedField),
    `${label}: expected ${expectedField}`,
  );
}

for (const malformedEmail of [
  "warehouse@example.com,attacker",
  "a..b@example.com",
  "warehouse@example..com",
]) {
  const body = structuredClone(payload.body);
  body.fulfillmentEmail = malformedEmail;
  const rejection = assertRejected(body, `malformed email ${malformedEmail}`);
  assert(rejection.invalidOrderFields.includes("warehouseEmail"));
}

for (const { label, mutate, expectedFields } of [
  {
    label: "missing item SKU",
    mutate: (item) => delete item.variant_sku,
    expectedFields: ["sku"],
  },
  {
    label: "missing item description",
    mutate: (item) => delete item.name,
    expectedFields: ["description"],
  },
  {
    label: "zero quantity",
    mutate: (item) => {
      item.qty = 0;
    },
    expectedFields: ["quantity"],
  },
  {
    label: "negative quantity",
    mutate: (item) => {
      item.qty = -1;
    },
    expectedFields: ["quantity"],
  },
  {
    label: "fractional quantity",
    mutate: (item) => {
      item.qty = 1.5;
    },
    expectedFields: ["quantity"],
  },
  {
    label: "non-numeric quantity",
    mutate: (item) => {
      item.qty = "many";
    },
    expectedFields: ["quantity"],
  },
  {
    label: "malformed item object",
    mutate: (_item, body) => {
      body.line_items[0] = null;
    },
    expectedFields: ["sku", "description", "quantity"],
  },
]) {
  const body = structuredClone(payload.body);
  mutate(body.line_items[0], body);
  const rejection = assertRejected(body, label);
  assert.deepEqual(rejection.invalidItems, [
    { position: 1, fields: expectedFields },
  ]);
}

assert.deepEqual(edgeNames("Is the entire order valid?", 0), [
  "Generate the packing slip PDF",
]);
assert.deepEqual(edgeNames("Is the entire order valid?", 1), [
  "Return one 400 order error",
]);
assert.equal(edges("Is the entire order valid?", 1).length, 1);

const pdf = byName.get("Generate the packing slip PDF");
const gmail = byName.get("Email the packing slip to the warehouse");
const drive = byName.get("Archive the packing slip in Google Drive");
const merge = byName.get("Wait for warehouse email and archive");
const errorResponse = byName.get("Return one 400 order error");

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
assert.deepEqual(edgeNames(merge.name), ["Return packing_slip_ready"]);
assert.equal(
  workflow.connections[gmail.name]?.main?.[0]?.some(
    (edge) => edge.node === drive.name,
  ),
  false,
  "Gmail output must not feed the Drive upload",
);
assert.equal(
  gmail.parameters.options.attachmentsUi.attachmentsBinary[0].property,
  "data",
);
assert.match(gmail.parameters.sendTo, /warehouseEmail/);
assert.equal(gmail.parameters.sendTo.includes("@your-company"), false);
assert.equal(drive.parameters.inputDataFieldName, "data");
assert.equal(drive.parameters.driveId.value, "My Drive");
assert.equal(drive.parameters.folderId.value, "root");
assert.deepEqual(merge.parameters, {
  mode: "chooseBranch",
  numberInputs: 2,
  chooseBranchMode: "waitForAll",
  output: "empty",
});
assert.equal(errorResponse.parameters.options.responseCode, 400);

// Model n8n's fan-out with inert sinks: both branches receive the same pdfmill
// bytes without invoking Gmail or Google Drive.
const mockPdfItem = {
  json: { success: true },
  binary: {
    data: {
      data: Buffer.from("%PDF-1.4\nfixture packing slip").toString("base64"),
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

const everyObject = [];
const collectObjects = (value) => {
  if (!value || typeof value !== "object") return;
  everyObject.push(value);
  for (const nested of Object.values(value)) collectObjects(nested);
};
collectObjects(workflow);
assert(
  everyObject.every((value) => !("credentials" in value)),
  "gallery JSON must not embed credential bindings",
);
assert.doesNotMatch(
  rawWorkflow,
  /(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+|ghp_[A-Za-z0-9]+|AIza[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~-]{20,}/,
  "workflow must not contain a credential-like secret",
);

const stickyNodes = workflow.nodes.filter(
  (node) => node.type === "n8n-nodes-base.stickyNote",
);
assert.equal(stickyNodes.length, 6);
assert(stickyNodes.every((node) => node.parameters.height >= 400));
assert(stickyNodes.every((node) => node.parameters.width >= 320));

const descriptionWords = description.match(/[A-Za-z0-9][A-Za-z0-9'_-]*/g) ?? [];
assert(descriptionWords.length >= 200, "description must be substantial");
for (const heading of [
  "**Who's it for**",
  "**How it works**",
  "**How to set up**",
  "**Requirements**",
  "**How to customize**",
]) {
  assert(description.includes(heading), `description is missing ${heading}`);
}

console.log("gallery-v2/05 checks passed");
