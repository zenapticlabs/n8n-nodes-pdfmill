import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = JSON.parse(
  await readFile(new URL('./03-form-to-report.json', import.meta.url), 'utf8'),
);

const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
const functionalNodes = workflow.nodes.filter(
  (node) => node.type !== 'n8n-nodes-base.stickyNote',
);
const names = new Set(workflow.nodes.map((node) => node.name));

assert.equal(functionalNodes.length, 11, 'expected 11 functional nodes');
assert.equal(
  functionalNodes.filter((node) => node.type === 'n8n-nodes-base.if').length,
  2,
  'expected two control-flow decisions',
);
assert.equal(
  functionalNodes.filter((node) => node.type === 'n8n-nodes-base.googleSheets').length,
  1,
  'expected one real metrics source',
);

for (const [source, connection] of Object.entries(workflow.connections)) {
  assert(names.has(source), `connection source does not exist: ${source}`);
  for (const output of connection.main ?? []) {
    for (const edge of output ?? []) {
      assert(names.has(edge.node), `connection target does not exist: ${edge.node}`);
    }
  }
}

const parseCode = byName.get('Parse and validate the request').parameters.jsCode;
const runParse = new Function('$json', '$input', '$', parseCode);
const validRequest = {
  'Report title': 'Q3 Business Review',
  'Report key': 'sales',
  Period: 'Q3 2026',
  'Recipient email': 'requester@example.com',
  'Highlights / summary': 'Enterprise expansion led growth.',
  'Prepared by': 'Operations',
};

const [parsedItem] = runParse(validRequest, undefined, undefined);
const parsed = parsedItem.json;
assert.equal(parsed.requestValid, true);
assert.deepEqual(parsed.validationErrors, []);
assert.equal(parsed.periodStart, '2026-07-01');
assert.equal(parsed.periodEnd, '2026-09-30');
assert.equal(parsed.reportKey, 'sales');

const [invalidItem] = runParse(
  { ...validRequest, Period: 'sometime next quarter' },
  undefined,
  undefined,
);
assert.equal(invalidItem.json.requestValid, false);
assert.match(invalidItem.json.validationErrors.join(' '), /Q3 2026/);

const metricRows = [
  {
    json: {
      'Report key': 'sales',
      Period: 'Q3 2026',
      Metric: 'Revenue',
      Current: '$128,400',
      Previous: '$114,200',
      Change: '+12.4%',
      Direction: 'up',
      Section: 'Performance',
      Commentary: 'Revenue grew on enterprise expansion.',
    },
  },
  {
    json: {
      'Report key': 'sales',
      Period: 'Q3 2026',
      Metric: 'Churn rate',
      Current: '2.9%',
      Previous: '2.5%',
      Change: '+0.4 pt',
      Direction: 'down',
      Section: 'Next steps',
      Commentary: 'Investigate churn by plan and cohort.',
    },
  },
];

const buildCode = byName.get('Build the report from metric rows').parameters.jsCode;
const runBuild = new Function('$json', '$input', '$', buildCode);
const lookup = (name) => {
  assert.equal(name, 'Parse and validate the request');
  return { first: () => ({ json: parsed }) };
};

const [reportItem] = runBuild(undefined, { all: () => metricRows }, lookup);
const report = reportItem.json;
assert.equal(report.dataAvailable, true);
assert.equal(report.kpis.length, 2);
assert.equal(report.table.rows.length, 2);
assert.equal(report.sections.length, 2);
assert.equal(report.kpis[1].down, true);
assert.equal(report.fileName, 'Q3 Business Review - Q3 2026.pdf');

const [emptyItem] = runBuild(undefined, { all: () => [{ json: {} }] }, lookup);
assert.equal(emptyItem.json.dataAvailable, false);
assert.match(emptyItem.json.missingReason, /sales/);
assert.match(emptyItem.json.missingReason, /Q3 2026/);

const sheets = byName.get('Load matching metrics from Google Sheets');
assert.equal(sheets.alwaysOutputData, true, 'no-data branch requires alwaysOutputData');
assert.equal(sheets.parameters.documentId.value, '', 'template must not contain a spreadsheet ID');
assert.equal(sheets.parameters.sheetName.value, '', 'template must not contain a sheet ID');
assert.equal('credentials' in sheets, false, 'template must not contain credentials');

console.log('PASS 03: valid + invalid request, matching + missing metrics, structure, and secret hygiene');
