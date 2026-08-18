/**
 * Unit tests for the Pdfmill node happy paths (SC-002, SC-005):
 * both operations, loadOptions, binary output + metadata, format=png, options
 * mapping, and multi-item batches. Engine HTTP is mocked.
 */
import type { IHttpRequestOptions, INodeExecutionData, INodePropertyOptions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Pdfmill } from '../nodes/Pdfmill/Pdfmill.node';
import {
	EXPECTED_CREDENTIALS_NAME,
	FAKE_PDF,
	FAKE_PNG,
	decodeBinary,
	makeExecuteFunctions,
	makeLoadOptionsFunctions,
	renderOkResponse,
	templatesOkResponse,
} from './helpers';

function runExecute(ctx: import('n8n-workflow').IExecuteFunctions) {
	return new Pdfmill().execute.call(ctx) as Promise<INodeExecutionData[][]>;
}

describe('Pdfmill.execute — Generate from Template (SC-005 happy path)', () => {
	it('renders the invoice template to a PDF binary + metadata', async () => {
		const { ctx, httpCalls, credentialTypes } = makeExecuteFunctions({
			items: [{ json: { invoiceNumber: 'INV-1' } }],
			params: {
				operation: 'template',
				template: 'invoice',
				data: { invoiceNumber: 'INV-1' },
				format: 'pdf',
				binaryPropertyName: 'data',
				options: {},
			},
			httpRequest: () => renderOkResponse(FAKE_PDF, { pages: 2, durationMs: 55, requestId: 'req_abc' }),
		});

		const [out] = await runExecute(ctx);
		expect(out).toHaveLength(1);
		const item = out[0];

		// JSON metadata
		expect(item.json).toMatchObject({
			success: true,
			source: 'template',
			template: 'invoice',
			format: 'pdf',
			pages: 2,
			bytes: FAKE_PDF.length,
			durationMs: 55,
			requestId: 'req_abc',
			fileName: 'invoice.pdf',
			mimeType: 'application/pdf',
		});

		// Binary output on the default `data` property, chainable to email/Drive
		const binary = item.binary?.data;
		expect(binary).toBeDefined();
		expect(binary?.mimeType).toBe('application/pdf');
		expect(binary?.fileName).toBe('invoice.pdf');
		expect(decodeBinary(binary!)).toEqual(FAKE_PDF);
		expect(item.pairedItem).toEqual({ item: 0 });

		// Correct engine call
		expect(httpCalls).toHaveLength(1);
		const call = httpCalls[0];
		expect(call.method).toBe('POST');
		expect(call.url).toBe('https://api.pdfmill.test/v1/render');
		// Auth rides n8n's credential system: the node asks for authenticated
		// transport and never hand-sets the key header (creator-portal review).
		expect(credentialTypes).toEqual([EXPECTED_CREDENTIALS_NAME]);
		expect((call.headers as Record<string, string> | undefined)?.['x-api-key']).toBeUndefined();
		expect(call.body).toMatchObject({ template: 'invoice', format: 'pdf', data: { invoiceNumber: 'INV-1' } });
		expect((call.body as Record<string, unknown>).html).toBeUndefined();
		// The document rides the response body, never a URL (binary-return only)
		expect(call.encoding).toBe('arraybuffer');
	});

	it('strips a trailing slash from the credential base URL', async () => {
		const { ctx, httpCalls } = makeExecuteFunctions({
			credentials: { apiKey: 'k', baseUrl: 'https://api.pdfmill.test/' },
			params: { operation: 'template', template: 'invoice', data: {}, format: 'pdf', binaryPropertyName: 'data' },
			httpRequest: () => renderOkResponse(FAKE_PDF),
		});
		await runExecute(ctx);
		expect(httpCalls[0].url).toBe('https://api.pdfmill.test/v1/render');
	});

	it('parses Data supplied as a JSON string', async () => {
		const { ctx, httpCalls } = makeExecuteFunctions({
			params: {
				operation: 'template',
				template: 'invoice',
				data: '{"total": 42, "currency": "USD"}',
				format: 'pdf',
				binaryPropertyName: 'data',
			},
			httpRequest: () => renderOkResponse(FAKE_PDF),
		});
		await runExecute(ctx);
		expect(httpCalls[0].body).toMatchObject({ data: { total: 42, currency: 'USD' } });
	});
});

describe('Pdfmill.execute — Generate from HTML', () => {
	it('renders raw HTML to a PDF on a custom binary property', async () => {
		const { ctx, httpCalls } = makeExecuteFunctions({
			params: {
				operation: 'html',
				html: '<h1>Hello</h1>',
				data: { name: 'World' },
				format: 'pdf',
				binaryPropertyName: 'file',
			},
			httpRequest: () => renderOkResponse(FAKE_PDF),
		});
		const [out] = await runExecute(ctx);
		expect(out[0].json).toMatchObject({ source: 'html', template: null, fileName: 'document.pdf' });
		expect(out[0].binary?.file).toBeDefined();
		expect(out[0].binary?.file?.fileName).toBe('document.pdf');
		const body = httpCalls[0].body as Record<string, unknown>;
		expect(body.html).toBe('<h1>Hello</h1>');
		expect(body.template).toBeUndefined();
	});
});

describe('Pdfmill.execute — format=png (SC-002)', () => {
	it('returns an image/png binary with a .png filename', async () => {
		const { ctx } = makeExecuteFunctions({
			params: { operation: 'template', template: 'certificate', data: {}, format: 'png', binaryPropertyName: 'data' },
			httpRequest: () => renderOkResponse(FAKE_PNG),
		});
		const [out] = await runExecute(ctx);
		expect(out[0].json).toMatchObject({ format: 'png', mimeType: 'image/png', fileName: 'certificate.png' });
		const binary = out[0].binary?.data;
		expect(binary?.mimeType).toBe('image/png');
		expect(decodeBinary(binary!).subarray(0, 4).toString('hex')).toBe('89504e47');
	});
});

describe('Pdfmill.execute — Options mapping', () => {
	it('maps only the set options to the engine request + honors a file name override', async () => {
		const { ctx, httpCalls } = makeExecuteFunctions({
			params: {
				operation: 'template',
				template: 'report',
				data: {},
				format: 'pdf',
				binaryPropertyName: 'data',
				options: {
					pageSize: 'A4',
					landscape: true,
					printBackground: false,
					scale: 1.5,
					marginTop: '1cm',
					marginLeft: '2cm',
					fileName: 'custom-report.pdf',
				},
			},
			httpRequest: () => renderOkResponse(FAKE_PDF),
		});
		const [out] = await runExecute(ctx);
		expect(out[0].json.fileName).toBe('custom-report.pdf');
		expect(out[0].binary?.data?.fileName).toBe('custom-report.pdf');
		expect((httpCalls[0].body as Record<string, unknown>).options).toEqual({
			pageSize: 'A4',
			landscape: true,
			printBackground: false,
			scale: 1.5,
			margin: { top: '1cm', left: '2cm' },
		});
	});

	it('omits the options key entirely when nothing is configured', async () => {
		const { ctx, httpCalls } = makeExecuteFunctions({
			params: { operation: 'template', template: 'invoice', data: {}, format: 'pdf', binaryPropertyName: 'data', options: {} },
			httpRequest: () => renderOkResponse(FAKE_PDF),
		});
		await runExecute(ctx);
		expect((httpCalls[0].body as Record<string, unknown>).options).toBeUndefined();
	});
});

describe('Pdfmill.execute — multi-item batch', () => {
	it('renders each input item and preserves pairing', async () => {
		const { ctx, httpCalls } = makeExecuteFunctions({
			items: [{ json: { n: 1 } }, { json: { n: 2 } }],
			params: (name, i) => {
				const base: Record<string, unknown> = {
					operation: 'template',
					template: 'invoice',
					data: { n: i + 1 },
					format: 'pdf',
					binaryPropertyName: 'data',
				};
				return base[name];
			},
			httpRequest: () => renderOkResponse(FAKE_PDF),
		});
		const [out] = await runExecute(ctx);
		expect(out).toHaveLength(2);
		expect(httpCalls).toHaveLength(2);
		expect(out[0].pairedItem).toEqual({ item: 0 });
		expect(out[1].pairedItem).toEqual({ item: 1 });
		expect((httpCalls[1].body as Record<string, unknown>).data).toEqual({ n: 2 });
	});
});

describe('Pdfmill.methods.loadOptions.getTemplates (FR-004)', () => {
	it('maps the engine template list to n8n dropdown options', async () => {
		const { ctx, httpCalls, credentialTypes } = makeLoadOptionsFunctions({
			httpRequest: () =>
				templatesOkResponse([
					{ id: 'invoice', name: 'Invoice' },
					{ id: 'quote', name: 'Quote' },
					{ id: 'packing-slip', name: 'Packing Slip' },
				]),
		});
		const options = (await new Pdfmill().methods.loadOptions.getTemplates.call(
			ctx,
		)) as INodePropertyOptions[];
		expect(options).toEqual([
			{ name: 'Invoice', value: 'invoice' },
			{ name: 'Quote', value: 'quote' },
			{ name: 'Packing Slip', value: 'packing-slip' },
		]);
		const call = httpCalls[0] as IHttpRequestOptions;
		expect(call.method).toBe('GET');
		expect(call.url).toBe('https://api.pdfmill.test/v1/templates');
		expect(credentialTypes).toEqual([EXPECTED_CREDENTIALS_NAME]);
		expect((call.headers as Record<string, string> | undefined)?.['x-api-key']).toBeUndefined();
	});

	it('surfaces an auth failure from loadOptions (bad key → clear error)', async () => {
		const { ctx } = makeLoadOptionsFunctions({
			httpRequest: () => ({
				statusCode: 401,
				headers: { 'content-type': 'application/json', 'x-request-id': 'req_x' },
				body: Buffer.from(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'bad key', requestId: 'req_x' } })),
			}),
		});
		await expect(new Pdfmill().methods.loadOptions.getTemplates.call(ctx)).rejects.toThrow(/UNAUTHORIZED/);
	});
});
