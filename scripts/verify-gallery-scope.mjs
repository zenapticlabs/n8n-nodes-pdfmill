#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const galleryDir = resolve(packageRoot, 'gallery-v2');
const baselinePath = resolve(galleryDir, '01-order-to-invoice.json');
const defaultCandidates = [
  '02-cohort-to-certificates.json',
  '03-form-to-report.json',
  '04-scheduled-weekly-report.json',
  '05-order-to-packing-slip.json',
].map((name) => resolve(galleryDir, name));

function isFunctional(node) {
  return node.type !== 'n8n-nodes-base.stickyNote';
}

function countBranchPoints(workflow) {
  const functionalNames = new Set(workflow.nodes.filter(isFunctional).map((node) => node.name));

  return Object.entries(workflow.connections ?? {}).filter(([source, connection]) => {
    if (!functionalNames.has(source)) return false;

    const nonEmptyOutputs = (connection.main ?? []).filter((output) =>
      (output ?? []).some((edge) => functionalNames.has(edge.node)),
    );
    return nonEmptyOutputs.length >= 2;
  }).length;
}

async function measure(path) {
  const workflow = JSON.parse(await readFile(path, 'utf8'));
  return {
    path,
    functionalNodes: workflow.nodes.filter(isFunctional).length,
    branchPoints: countBranchPoints(workflow),
  };
}

const candidates = process.argv
  .slice(2)
  .filter((path) => path !== '--')
  .map((path) => resolve(process.cwd(), path));
const paths = candidates.length > 0 ? candidates : defaultCandidates;
const baseline = await measure(baselinePath);
let failed = false;

console.log(
  `Approved floor: ${basename(baseline.path)} — ` +
    `${baseline.functionalNodes} functional nodes, ${baseline.branchPoints} branch point(s)`,
);

for (const path of paths) {
  const candidate = await measure(path);
  const failures = [];

  if (candidate.functionalNodes < baseline.functionalNodes) {
    failures.push(
      `${candidate.functionalNodes} functional nodes < approved floor ${baseline.functionalNodes}`,
    );
  }
  if (candidate.branchPoints < baseline.branchPoints) {
    failures.push(`${candidate.branchPoints} branch points < approved floor ${baseline.branchPoints}`);
  }

  if (failures.length === 0) {
    console.log(`PASS ${basename(path)} — ${candidate.functionalNodes} nodes, ${candidate.branchPoints} branch(es)`);
  } else {
    failed = true;
    console.error(`FAIL ${basename(path)} — ${failures.join('; ')}`);
  }
}

if (failed) {
  console.error(
    '\nScope floor failed. This check prevents obvious under-complexity; passing it does not replace ' +
      'the human substantiality review in the n8n-publish skill.',
  );
  process.exitCode = 1;
}
