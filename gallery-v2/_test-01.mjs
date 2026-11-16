import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = JSON.parse(
  await readFile(new URL('./01-order-to-invoice.json', import.meta.url), 'utf8'),
);
const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
const pdf = 'Generate the invoice PDF';
const email = 'Email the invoice to the customer';
const archive = 'Archive the invoice to Google Drive';
const wait = 'Wait for email and archive';
const reply = 'Return success';
const edge = (node, index = 0) => ({ node, type: 'main', index });

// Gmail's successful send output is message metadata, with no input binary.
// Both sinks therefore need a direct PDF input; join only their receipts.
assert.deepEqual(workflow.connections[pdf].main, [[edge(email), edge(archive)]]);
assert.deepEqual(workflow.connections[email].main, [[edge(wait, 0)]]);
assert.deepEqual(workflow.connections[archive].main, [[edge(wait, 1)]]);
assert.deepEqual(workflow.connections[wait].main, [[edge(reply)]]);
assert.equal(byName.get(wait).type, 'n8n-nodes-base.merge');
assert.equal(byName.get(wait).typeVersion, 3.2);
assert.deepEqual(byName.get(wait).parameters, {
  mode: 'chooseBranch', numberInputs: 2, chooseBranchMode: 'waitForAll', output: 'empty',
});
assert.equal(byName.get(pdf).parameters.binaryPropertyName, 'data');
assert.deepEqual(byName.get(email).parameters.options.attachmentsUi.attachmentsBinary, [{ property: 'data' }]);
assert.equal(byName.get(archive).parameters.inputDataFieldName, 'data');
for (const name of [pdf, email, archive, wait]) {
  const node = byName.get(name);
  assert.equal(node.continueOnFail, undefined);
  assert.equal(node.onError, undefined);
}

const runBuild = new Function('$json', byName.get('Build & total the invoice').parameters.jsCode);
const [invoice] = runBuild({
  body: {
    invoiceNumber: 'INV-TEST-001', currency: 'USD', taxRate: 8.5,
    customer: { name: 'Example buyer', email: 'buyer@example.com' },
    items: [
      { description: 'Consulting', quantity: 10, unitPrice: 150 },
      { description: 'Setup fee', quantity: 1, unitPrice: 500 },
    ],
  },
});
assert.equal(invoice.json.isValid, true);
assert.equal(invoice.json.subtotal, 2000);
assert.equal(invoice.json.taxAmount, 170);
assert.equal(invoice.json.total, 2170);
assert.equal(runBuild({ body: { items: [] } })[0].json.isValid, false);

// One order per webhook. The empty Merge output contains two receipt paths;
// use the known single invoice explicitly rather than receipt item linking.
const expression = byName.get(reply).parameters.responseBody;
assert.ok(expression.startsWith('={{') && expression.endsWith('}}'));
assert.equal(expression.includes('.item.'), false);
const response = new Function('$', `return (${expression.slice(3, -2)});`)((name) => {
  assert.equal(name, 'Build & total the invoice');
  return { first: () => invoice };
});
assert.deepEqual(response, {
  invoiceNumber: 'INV-TEST-001', total: 2170, currency: 'USD', status: 'invoiced',
});
assert.equal(workflow.active, false);
assert.ok(workflow.nodes.every((node) => !node.credentials));
assert.ok(workflow.nodes.every((node) => !('pinData' in node)));
console.log('PASS 01: direct PDF delivery, wait-both success, invoice totals, empty-order guard, and hygiene');
