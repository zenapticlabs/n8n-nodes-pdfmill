/**
 * Node ↔ engine integration proof (SC-003, honest M1-Chromium pattern).
 *
 * This drives the node's REAL execute()/loadOptions through its REAL
 * engineClient against a REAL running pdfmill engine over HTTP (global fetch
 * standing in for n8n's httpRequestWithAuthentication, same returnFullResponse
 * + arraybuffer + ignore-status contract). The double also plays the part n8n
 * itself plays in production: it applies the credential's `authenticate` rule
 * (`x-api-key: {{$credentials.apiKey}}`), which the node no longer does and
 * must not do. A real render comes back as real PDF bytes.
 *
 * It is GATED on env presence — skipped (with a printed reason) when no engine
 * is configured, exactly like the engine's DATABASE_URL / Chromium suites:
 *   PDFMILL_ENGINE_URL   e.g. http://localhost:8080
 *   PDFMILL_API_KEY      a key the engine authorizes (env-key or DB-issued)
 *
 * The FULL "installed inside a live n8n UI" end-to-end is documented + scripted
 * in ../scripts/integration-n8n.md (the part a headless sandbox can't automate).
 */
import type {
	IBinaryData,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
	INodePropertyOptions,
} from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Pdfmill } from '../nodes/Pdfmill/Pdfmill.node';

const ENGINE_URL = process.env.PDFMILL_ENGINE_URL;
const API_KEY = process.env.PDFMILL_API_KEY;
const RUN = Boolean(ENGINE_URL && API_KEY);

if (!RUN) {
	// eslint-disable-next-line no-console
	console.warn(
		'[integration.engine] SKIPPED — set PDFMILL_ENGINE_URL + PDFMILL_API_KEY to run the real node↔engine render.',
	);
}

const suite = RUN ? describe : describe.skip;

const TEST_NODE: INode = {
	id: 'int',
	name: 'PDFmill',
	type: 'n8n-nodes-pdfmill.pdfmill',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

/**
 * Real authenticated request over fetch, matching n8n's returnFullResponse +
 * ignoreHttpStatusErrors. Stands in for `helpers.httpRequestWithAuthentication`
 * and, like n8n, injects the credential's auth header itself.
 */
async function realHttpRequestWithAuthentication(
	credentialsType: string,
	options: IHttpRequestOptions,
) {
	if (credentialsType !== 'pdfmillApi') {
		throw new Error(`unexpected credential type: ${credentialsType}`);
	}
	const headers: Record<string, string> = { ...((options.headers as Record<string, string>) ?? {}) };
	// PdfmillApi.authenticate — applied by n8n in production, by us here.
	headers['x-api-key'] = API_KEY as string;
	if (options.json && options.body !== undefined) headers['content-type'] = 'application/json';
	const res = await fetch(options.url, {
		method: options.method ?? 'GET',
		headers,
		body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
	});
	const respHeaders = Object.fromEntries(res.headers.entries());
	let body: unknown;
	if (options.encoding === 'arraybuffer') {
		body = Buffer.from(await res.arrayBuffer());
	} else {
		const text = await res.text();
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
	}
	return { statusCode: res.status, headers: respHeaders, body };
}

const realHelpers = {
	httpRequestWithAuthentication: realHttpRequestWithAuthentication,
	async httpRequest(_options: IHttpRequestOptions): Promise<never> {
		throw new Error(
			'helpers.httpRequest must not be used — the node must call httpRequestWithAuthentication',
		);
	},
	async prepareBinaryData(buffer: Buffer, fileName?: string, mimeType?: string): Promise<IBinaryData> {
		return {
			data: Buffer.from(buffer).toString('base64'),
			mimeType: mimeType ?? 'application/octet-stream',
			fileName,
		} as IBinaryData;
	},
};

function execCtx(params: Record<string, unknown>): IExecuteFunctions {
	return {
		getInputData: () => [{ json: {} }],
		getNode: () => TEST_NODE,
		continueOnFail: () => false,
		getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		// baseUrl is all the node reads; the key is the credential system's job.
		getCredentials: async () => ({ baseUrl: ENGINE_URL }),
		helpers: realHelpers,
	} as unknown as IExecuteFunctions;
}

function loadCtx(): ILoadOptionsFunctions {
	return {
		getNode: () => TEST_NODE,
		getCredentials: async () => ({ baseUrl: ENGINE_URL }),
		helpers: realHelpers,
	} as unknown as ILoadOptionsFunctions;
}

suite('node ↔ engine integration [requires PDFMILL_ENGINE_URL + PDFMILL_API_KEY]', () => {
	it('SC-003: renders the invoice template end-to-end to a real PDF binary', async () => {
		const ctx = execCtx({
			operation: 'template',
			template: 'invoice',
			data: { invoiceNumber: 'INV-INT-1', currency: 'USD', total: 100 },
			format: 'pdf',
			binaryPropertyName: 'data',
			options: {},
		});
		const [out] = (await new Pdfmill().execute.call(ctx)) as INodeExecutionData[][];
		expect(out).toHaveLength(1);
		expect(out[0].json).toMatchObject({ success: true, template: 'invoice', format: 'pdf' });
		expect(Number(out[0].json.pages)).toBeGreaterThanOrEqual(1);

		const binary = out[0].binary?.data;
		expect(binary?.mimeType).toBe('application/pdf');
		const bytes = Buffer.from(binary!.data, 'base64');
		expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
		expect(bytes.length).toBeGreaterThan(1000);
	});

	it('renders raw HTML to a PNG binary', async () => {
		const ctx = execCtx({
			operation: 'html',
			html: '<h1 style="font-family:sans-serif">pdfmill ✓</h1>',
			data: {},
			format: 'png',
			binaryPropertyName: 'data',
			options: {},
		});
		const [out] = (await new Pdfmill().execute.call(ctx)) as INodeExecutionData[][];
		const bytes = Buffer.from(out[0].binary!.data.data, 'base64');
		expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47'); // PNG magic
	});

	it('loadOptions lists the account templates from the live engine (incl. invoice)', async () => {
		const options = (await new Pdfmill().methods.loadOptions.getTemplates.call(
			loadCtx(),
		)) as INodePropertyOptions[];
		expect(options.some((o) => o.value === 'invoice')).toBe(true);
		expect(options.every((o) => typeof o.name === 'string' && typeof o.value === 'string')).toBe(true);
	});
});
