/**
 * Error-surfacing tests (FR-006, Constitution V, SC-006): the FULL engine
 * named-error table maps to legible n8n errors carrying code + message +
 * requestId, and n8n's Continue-On-Fail is honored (a bad item fails soft, the
 * batch survives, good items still render). Nothing is swallowed.
 */
import { NodeApiError, NodeOperationError, type IExecuteFunctions, type INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Pdfmill } from '../nodes/Pdfmill/Pdfmill.node';
import {
	FAKE_PDF,
	decodeBinary,
	engineErrorResponse,
	makeExecuteFunctions,
	renderOkResponse,
} from './helpers';

function runExecute(ctx: IExecuteFunctions) {
	return new Pdfmill().execute.call(ctx) as Promise<INodeExecutionData[][]>;
}

async function capture(ctx: IExecuteFunctions): Promise<unknown> {
	try {
		await runExecute(ctx);
		return undefined;
	} catch (e) {
		return e;
	}
}

const templateParams = {
	operation: 'template',
	template: 'invoice',
	data: {},
	format: 'pdf',
	binaryPropertyName: 'data',
};

// The complete engine taxonomy (apps/engine/src/lib/errors.ts) → HTTP status.
const ENGINE_ERRORS: Array<{ code: string; status: number }> = [
	{ code: 'UNAUTHORIZED', status: 401 },
	{ code: 'QUOTA_EXCEEDED', status: 402 },
	{ code: 'INVALID_REQUEST', status: 400 },
	{ code: 'TEMPLATE_NOT_FOUND', status: 404 },
	{ code: 'PAYLOAD_TOO_LARGE', status: 413 },
	{ code: 'OUTPUT_TOO_LARGE', status: 422 },
	{ code: 'RENDER_TIMEOUT', status: 504 },
	{ code: 'RENDER_FAILED', status: 500 },
	{ code: 'BUSY', status: 429 },
];

describe('error map — every engine named code surfaces with code + message + requestId (SC-006)', () => {
	for (const { code, status } of ENGINE_ERRORS) {
		it(`${code} (${status}) → a NodeApiError carrying the code, message and requestId`, async () => {
			const requestId = `req_${code}`;
			const { ctx } = makeExecuteFunctions({
				params: templateParams,
				httpRequest: () => engineErrorResponse(code, status, `${code} detail`, requestId),
			});
			const err = await capture(ctx);
			expect(err).toBeInstanceOf(NodeApiError);
			const message = (err as Error).message;
			expect(message).toContain(code); // the named code
			expect(message).toContain(requestId); // the requestId for support
			expect(message).toContain(`${code} detail`); // the engine's own human message
			// the http status is preserved on the NodeApiError
			expect((err as NodeApiError).httpCode).toBe(String(status));
		});
	}
});

describe('error map — non-engine failures', () => {
	it('a transport failure (engine unreachable) → a legible NodeOperationError; code rides the description', async () => {
		const { ctx } = makeExecuteFunctions({
			params: templateParams,
			httpRequest: () => {
				throw new Error('connect ECONNREFUSED 127.0.0.1:8080');
			},
		});
		const err = await capture(ctx);
		expect(err).toBeInstanceOf(NodeOperationError);
		// n8n prettifies the ECONNREFUSED message; the machine code is preserved on .description
		expect((err as NodeOperationError).description).toContain('ENGINE_UNREACHABLE');
		expect((err as Error).message.length).toBeGreaterThan(0);
	});

	it('an empty Base URL → a NodeOperationError before any engine call', async () => {
		const { ctx, httpCalls } = makeExecuteFunctions({
			credentials: { apiKey: 'test-key', baseUrl: '' },
			params: templateParams,
			httpRequest: () => renderOkResponse(FAKE_PDF),
		});
		const err = await capture(ctx);
		expect(err).toBeInstanceOf(NodeOperationError);
		expect((err as Error).message).toContain('MISSING_CREDENTIAL');
		expect(httpCalls).toHaveLength(0); // failed fast, never hit the engine
	});

	/**
	 * BEHAVIOUR CHANGE (n8n creator-portal review, v0.2.0 → next):
	 * the node no longer reads the API key out of the credential, so it can no
	 * longer pre-empt an empty key with a local MISSING_CREDENTIAL error. Auth is
	 * the credential system's job; a missing/bad key is now the engine's 401,
	 * which still surfaces as a legible named error (nothing swallowed).
	 */
	it('an empty API key is no longer judged locally — the engine 401 surfaces as UNAUTHORIZED', async () => {
		const { ctx, credentialTypes } = makeExecuteFunctions({
			credentials: { apiKey: '', baseUrl: 'https://api.pdfmill.test' },
			params: templateParams,
			httpRequest: () => engineErrorResponse('UNAUTHORIZED', 401, 'missing or invalid API key', 'req_401'),
		});
		const err = await capture(ctx);
		expect(err).toBeInstanceOf(NodeApiError);
		expect((err as Error).message).toContain('UNAUTHORIZED');
		expect((err as Error).message).toContain('req_401');
		// the request still went out through the authenticated helper
		expect(credentialTypes).toEqual(['pdfmillApi']);
	});

	it('empty HTML on the HTML operation → a NodeOperationError before any engine call', async () => {
		const { ctx, httpCalls } = makeExecuteFunctions({
			params: { operation: 'html', html: '   ', data: {}, format: 'pdf', binaryPropertyName: 'data' },
			httpRequest: () => renderOkResponse(FAKE_PDF),
		});
		const err = await capture(ctx);
		expect(err).toBeInstanceOf(NodeOperationError);
		expect(httpCalls).toHaveLength(0); // failed fast, never hit the engine
	});

	it('invalid JSON in Data → a NodeOperationError, no engine call', async () => {
		const { ctx, httpCalls } = makeExecuteFunctions({
			params: { ...templateParams, data: '{not json' },
			httpRequest: () => renderOkResponse(FAKE_PDF),
		});
		const err = await capture(ctx);
		expect(err).toBeInstanceOf(NodeOperationError);
		expect((err as Error).message).toContain('not valid JSON');
		expect(httpCalls).toHaveLength(0);
	});
});

describe('Continue-On-Fail (Constitution V) — the batch survives a bad item', () => {
	it('a failing item attaches {error} and good items still render', async () => {
		let call = 0;
		const { ctx } = makeExecuteFunctions({
			items: [{ json: { n: 1 } }, { json: { n: 2 } }],
			continueOnFail: true,
			params: (name) =>
				({
					operation: 'template',
					template: 'invoice',
					data: {},
					format: 'pdf',
					binaryPropertyName: 'data',
				})[name],
			httpRequest: () => {
				call += 1;
				// first item hits the cap, second renders fine
				return call === 1
					? engineErrorResponse('QUOTA_EXCEEDED', 402, 'cap reached', 'req_cap')
					: renderOkResponse(FAKE_PDF, { requestId: 'req_ok' });
			},
		});

		const [out] = await runExecute(ctx);
		expect(out).toHaveLength(2);

		// item 0: soft failure with the named code + requestId on the JSON branch
		expect(out[0].json).toMatchObject({ success: false, code: 'QUOTA_EXCEEDED', requestId: 'req_cap' });
		expect(out[0].json.error).toContain('QUOTA_EXCEEDED');
		expect(out[0].binary).toBeUndefined();
		expect(out[0].pairedItem).toEqual({ item: 0 });

		// item 1: still rendered — one bad item did not kill the batch
		expect(out[1].json).toMatchObject({ success: true, requestId: 'req_ok' });
		expect(out[1].binary?.data).toBeDefined();
		expect(decodeBinary(out[1].binary!.data)).toEqual(FAKE_PDF);
	});

	it('without Continue-On-Fail the error propagates and aborts (nothing swallowed)', async () => {
		const { ctx } = makeExecuteFunctions({
			items: [{ json: {} }, { json: {} }],
			continueOnFail: false,
			params: templateParams,
			httpRequest: () => engineErrorResponse('RENDER_FAILED', 500, 'boom', 'req_boom'),
		});
		const err = await capture(ctx);
		expect(err).toBeInstanceOf(NodeApiError);
		expect((err as Error).message).toContain('RENDER_FAILED');
	});
});
