/**
 * Gallery workflow generator (M3 T014).
 *
 * Emits the ready-to-import n8n workflow JSONs in this folder. Building them
 * programmatically guarantees valid JSON + escaping, and uses versioned snapshots
 * of the pdfmill starter fixtures from gallery/fixtures — so this public node repo
 * remains self-contained. Re-run with:  node gallery/_build.mjs
 *
 * These are the distribution artifact (Constitution I) — authored here, to be
 * submitted to the n8n template gallery at M5 (NOT submitted now).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (id) =>
	JSON.parse(readFileSync(join(here, 'fixtures', `${id}.json`), 'utf8'));

const PDFMILL_TYPE = 'n8n-nodes-pdfmill.pdfmill';

let idc = 0;
const nid = () => `${(idc++).toString().padStart(2, '0')}-${randomUUID()}`;

function node(name, type, typeVersion, position, parameters, extra = {}) {
	return { parameters, id: nid(), name, type, typeVersion, position, ...extra };
}

function sticky(name, content, position, width = 300, height = 260, color = 4) {
	return node(name, 'n8n-nodes-base.stickyNote', 1, position, { content, height, width, color });
}

function manualTrigger(position = [0, 300]) {
	return node("When clicking 'Execute workflow'", 'n8n-nodes-base.manualTrigger', 1, position, {});
}

/** A Set node (raw mode) that emits sample document data — the swap-in point for real data. */
function sampleData(name, obj, position) {
	return node(name, 'n8n-nodes-base.set', 3.4, position, {
		mode: 'raw',
		jsonOutput: JSON.stringify(obj, null, 2),
		options: {},
	});
}

function pdfmillTemplate(name, template, position, format = 'pdf', binaryPropertyName = 'data') {
	return node(name, PDFMILL_TYPE, 1, position, {
		operation: 'template',
		template,
		data: '={{ $json }}',
		format,
		binaryPropertyName,
		options: {},
	});
}

function chain(...names) {
	// Wire nodes left→right on the main output; sticky notes are excluded by caller.
	const connections = {};
	for (let i = 0; i < names.length - 1; i++) {
		connections[names[i]] = { main: [[{ node: names[i + 1], type: 'main', index: 0 }]] };
	}
	return connections;
}

function workflow(name, nodes, connections) {
	return {
		name,
		nodes,
		connections,
		active: false,
		settings: { executionOrder: 'v1' },
		pinData: {},
		meta: { templateCredsSetupCompleted: false },
		tags: [{ name: 'pdfmill' }],
		versionId: randomUUID(),
	};
}

function write(fileName, wf) {
	writeFileSync(join(here, fileName), JSON.stringify(wf, null, 2) + '\n', 'utf8');
	console.log('wrote', fileName, `(${wf.nodes.length} nodes)`);
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Payment → invoice PDF → email
// ─────────────────────────────────────────────────────────────────────────
{
	const trg = manualTrigger();
	const data = sampleData('Invoice data (sample)', fixture('invoice'), [220, 300]);
	const pdf = pdfmillTemplate('Generate invoice PDF', 'invoice', [440, 300]);
	const gmail = node('Email the invoice', 'n8n-nodes-base.gmail', 2.1, [660, 300], {
		sendTo: '={{ $json.billTo.email }}',
		subject: '=Invoice {{ $json.invoiceNumber }}',
		message:
			'=Hi {{ $json.billTo.name }},\n\nPlease find invoice {{ $json.invoiceNumber }} attached ({{ $json.total }} {{ $json.currency }} due {{ $json.dueAt }}).\n\nThank you!',
		options: { attachmentsUi: { attachmentsBinary: [{ property: 'data' }] } },
	});
	const notes = [
		sticky(
			'Sticky Note',
			'## 💳 Payment → Invoice PDF → Email\nWhen a customer pays, generate a branded PDF invoice and email it — no Chrome to host.\n\n**Setup:** add a **pdfmill** credential to the Generate node, and a **Gmail** (or SMTP) credential to the email node.',
			[0, 40],
			560,
			200,
			5,
		),
		sticky(
			'Sticky Note1',
			"### In production\nSwap the manual trigger for a **Stripe Trigger** (event `checkout.session.completed`) or a webhook, then map the payment fields into the invoice data.",
			[220, 520],
			300,
			200,
		),
		sticky(
			'Sticky Note2',
			'### The document\nThe PDF comes out on the **`data`** binary property and is attached to the email. Switch **Format** to PNG for an image instead.',
			[440, 520],
			300,
			200,
		),
	];
	write(
		'01-payment-to-invoice-email.json',
		workflow(
			'pdfmill — Payment to invoice PDF, emailed',
			[trg, data, pdf, gmail, ...notes],
			chain(trg.name, data.name, pdf.name, gmail.name),
		),
	);
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Sheet row → certificate PDF → Google Drive
// ─────────────────────────────────────────────────────────────────────────
{
	const trg = manualTrigger();
	const data = sampleData('Roster row (sample)', fixture('certificate'), [220, 300]);
	const pdf = pdfmillTemplate('Generate certificate PDF', 'certificate', [440, 300]);
	const drive = node('Upload to Google Drive', 'n8n-nodes-base.googleDrive', 3, [660, 300], {
		operation: 'upload',
		inputDataFieldName: 'data',
		name: '=Certificate - {{ $json.recipientName }}.pdf',
		driveId: { __rl: true, mode: 'list', value: 'My Drive' },
		folderId: { __rl: true, mode: 'list', value: 'root' },
		options: {},
	});
	const notes = [
		sticky(
			'Sticky Note',
			'## 🎓 Row → Certificate PDF → Drive\nTurn each row (a course completion, an attendee) into a personalised certificate and file it in Drive.\n\n**Setup:** a **pdfmill** credential on the Generate node and a **Google Drive** credential on the upload node.',
			[0, 40],
			560,
			200,
			5,
		),
		sticky(
			'Sticky Note1',
			'### In production\nReplace the manual trigger with a **Google Sheets Trigger** (or loop rows) so one certificate is generated per attendee.',
			[220, 520],
			300,
			200,
		),
	];
	write(
		'02-row-to-certificate-drive.json',
		workflow(
			'pdfmill — Sheet row to certificate PDF, saved to Drive',
			[trg, data, pdf, drive, ...notes],
			chain(trg.name, data.name, pdf.name, drive.name),
		),
	);
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Form / webhook → report PDF → Slack
// ─────────────────────────────────────────────────────────────────────────
{
	const trg = manualTrigger();
	const data = sampleData('Form submission (sample)', fixture('report'), [220, 300]);
	const pdf = pdfmillTemplate('Generate report PDF', 'report', [440, 300]);
	const slack = node('Post to Slack', 'n8n-nodes-base.slack', 2.3, [660, 300], {
		resource: 'file',
		operation: 'upload',
		binaryPropertyName: 'data',
		options: { fileName: '=Report - {{ $json.title }}.pdf' },
		channelId: { __rl: true, mode: 'name', value: '#reports' },
	});
	const notes = [
		sticky(
			'Sticky Note',
			'## 📝 Form → Report PDF → Slack\nWhen a form/webhook fires, build a formatted PDF report and drop it into a Slack channel.\n\n**Setup:** a **pdfmill** credential on the Generate node and a **Slack** credential on the upload node.',
			[0, 40],
			560,
			200,
			5,
		),
		sticky(
			'Sticky Note1',
			'### In production\nSwap the manual trigger for a **Webhook** or **n8n Form Trigger** and map the submission into the report’s fields, KPIs and table.',
			[220, 520],
			300,
			200,
		),
	];
	write(
		'03-form-to-report-slack.json',
		workflow(
			'pdfmill — Form to report PDF, posted to Slack',
			[trg, data, pdf, slack, ...notes],
			chain(trg.name, data.name, pdf.name, slack.name),
		),
	);
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Scheduled summary report → email (weekly)
// ─────────────────────────────────────────────────────────────────────────
{
	const trg = node('Every Monday 8am', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 300], {
		rule: { interval: [{ field: 'weeks', triggerAtDay: [1], triggerAtHour: 8 }] },
	});
	const data = sampleData('Weekly metrics (sample)', fixture('report'), [220, 300]);
	const pdf = pdfmillTemplate('Generate weekly report PDF', 'report', [440, 300]);
	const gmail = node('Email the report', 'n8n-nodes-base.gmail', 2.1, [660, 300], {
		sendTo: 'team@example.com',
		subject: '=Weekly report — {{ $json.periodStart }} to {{ $json.periodEnd }}',
		message: '=Hi team,\n\nThis week’s report is attached.\n\n— Automated by n8n + pdfmill',
		options: { attachmentsUi: { attachmentsBinary: [{ property: 'data' }] } },
	});
	const notes = [
		sticky(
			'Sticky Note',
			'## 📈 Scheduled → Report PDF → Email\nOn a schedule, gather your metrics, render a PDF summary, and email it to the team.\n\n**Setup:** a **pdfmill** credential on the Generate node and a **Gmail**/SMTP credential on the email node.',
			[0, 40],
			560,
			200,
			5,
		),
		sticky(
			'Sticky Note1',
			'### In production\nReplace the sample-data node with your real sources (HTTP Request, Postgres, Sheets…) mapped into the report’s KPIs, sections and table.',
			[220, 520],
			300,
			200,
		),
	];
	write(
		'04-scheduled-summary-report.json',
		workflow(
			'pdfmill — Scheduled weekly report PDF, emailed',
			[trg, data, pdf, gmail, ...notes],
			chain(trg.name, data.name, pdf.name, gmail.name),
		),
	);
}

// ─────────────────────────────────────────────────────────────────────────
// 5. New order → packing slip PDF → Google Drive
// ─────────────────────────────────────────────────────────────────────────
{
	const trg = manualTrigger();
	const data = sampleData('Order (sample)', fixture('packing-slip'), [220, 300]);
	const pdf = pdfmillTemplate('Generate packing slip PDF', 'packing-slip', [440, 300]);
	const drive = node('Save to Google Drive', 'n8n-nodes-base.googleDrive', 3, [660, 300], {
		operation: 'upload',
		inputDataFieldName: 'data',
		name: '=Packing slip - {{ $json.orderNumber }}.pdf',
		driveId: { __rl: true, mode: 'list', value: 'My Drive' },
		folderId: { __rl: true, mode: 'list', value: 'root' },
		options: {},
	});
	const notes = [
		sticky(
			'Sticky Note',
			'## 📦 Order → Packing Slip PDF → Drive\nOn a new order, generate a packing slip PDF and file it (or attach it to the fulfilment task).\n\n**Setup:** a **pdfmill** credential on the Generate node and a **Google Drive** credential on the save node.',
			[0, 40],
			560,
			200,
			5,
		),
		sticky(
			'Sticky Note1',
			'### In production\nReplace the manual trigger with your store’s **order webhook** (Shopify/WooCommerce/etc.) and map the order into the packing-slip fields.',
			[220, 520],
			300,
			200,
		),
	];
	write(
		'05-order-to-packing-slip-drive.json',
		workflow(
			'pdfmill — New order to packing slip PDF, saved to Drive',
			[trg, data, pdf, drive, ...notes],
			chain(trg.name, data.name, pdf.name, drive.name),
		),
	);
}

console.log('done.');
