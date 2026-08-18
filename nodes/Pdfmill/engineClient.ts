/**
 * Thin typed client over the pdfmill engine (Principle II — the node renders
 * NOTHING; it calls the engine). Two calls: POST /v1/render and
 * GET /v1/templates. Uses n8n's `this.helpers.httpRequestWithAuthentication`
 * so the workspace's proxy config and TLS settings apply AND the credential
 * system injects the auth header itself — the node never reads, holds or logs
 * the API key. The `x-api-key` header comes from `PdfmillApi.authenticate`
 * (IAuthenticateGeneric); the only thing this client takes from the credential
 * is the non-secret `baseUrl` needed to build the URL.
 *
 * HTTP status errors are NOT thrown by the transport (`ignoreHttpStatusErrors`)
 * — this client reads the engine's named-error envelope itself and raises a
 * typed `EngineError` carrying { code, message, requestId, httpStatus }. The
 * node then maps that to the right n8n error (Principle V — nothing swallowed).
 */
import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
} from 'n8n-workflow';

/** Either context that can make credentialed HTTP calls (execute + loadOptions). */
export type EngineContext = IExecuteFunctions | ILoadOptionsFunctions;

/** The credential type name n8n resolves + authenticates with. */
export const CREDENTIALS_NAME = 'pdfmillApi';

/** The engine's named error codes (mirrors apps/engine/src/lib/errors.ts). */
export const ENGINE_ERROR_CODES = [
	'UNAUTHORIZED',
	'QUOTA_EXCEEDED',
	'INVALID_REQUEST',
	'TEMPLATE_NOT_FOUND',
	'PAYLOAD_TOO_LARGE',
	'OUTPUT_TOO_LARGE',
	'RENDER_TIMEOUT',
	'RENDER_FAILED',
	'BUSY',
] as const;

export type EngineErrorKind = 'api' | 'transport' | 'config';

/** Typed failure the node maps to NodeApiError / NodeOperationError. */
export class EngineError extends Error {
	readonly code: string;
	readonly kind: EngineErrorKind;
	readonly requestId?: string;
	readonly httpStatus?: number;

	constructor(opts: {
		code: string;
		message: string;
		kind: EngineErrorKind;
		requestId?: string;
		httpStatus?: number;
	}) {
		super(opts.message);
		this.name = 'EngineError';
		this.code = opts.code;
		this.kind = opts.kind;
		this.requestId = opts.requestId;
		this.httpStatus = opts.httpStatus;
	}
}

export interface RenderInput {
	template?: string;
	html?: string;
	data: IDataObject;
	format: 'pdf' | 'png';
	options?: IDataObject;
}

export interface RenderOutput {
	bytes: Buffer;
	contentType: string;
	pages: number;
	durationMs: number;
	requestId: string;
}

export interface TemplateOption {
	id: string;
	name: string;
}

interface FullResponse {
	statusCode: number;
	headers: Record<string, unknown>;
	body: unknown;
}

interface Credentials {
	baseUrl: string;
}

/**
 * Read ONLY the non-secret part of the credential. The API key is deliberately
 * never touched here — `httpRequestWithAuthentication` hands the credential to
 * n8n, which applies `authenticate` server-side.
 */
async function getCredentials(ctx: EngineContext): Promise<Credentials> {
	const creds = (await ctx.getCredentials(CREDENTIALS_NAME)) as IDataObject;
	const baseUrlRaw = typeof creds.baseUrl === 'string' ? creds.baseUrl.trim() : '';
	if (baseUrlRaw === '') {
		throw new EngineError({
			code: 'MISSING_CREDENTIAL',
			message: 'The pdfmill credential has an empty Base URL.',
			kind: 'config',
		});
	}
	return { baseUrl: baseUrlRaw.replace(/\/+$/, '') };
}

function toBuffer(body: unknown): Buffer {
	if (Buffer.isBuffer(body)) return body;
	if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
	if (ArrayBuffer.isView(body)) {
		return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
	}
	if (typeof body === 'string') return Buffer.from(body, 'utf8');
	if (body === null || body === undefined) return Buffer.alloc(0);
	// Already-parsed JSON object — re-serialize (only reached on JSON responses).
	return Buffer.from(JSON.stringify(body), 'utf8');
}

function parseJson(body: unknown): unknown {
	if (body !== null && typeof body === 'object' && !Buffer.isBuffer(body) && !(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
		return body;
	}
	const text = toBuffer(body).toString('utf8').trim();
	if (text === '') return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function lowerHeaders(headers: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers ?? {})) {
		out[k.toLowerCase()] = Array.isArray(v) ? String(v[0]) : String(v);
	}
	return out;
}

function intHeader(value: string | undefined, fallback: number): number {
	const n = Number.parseInt(value ?? '', 10);
	return Number.isFinite(n) ? n : fallback;
}

/** Best-effort code when the engine did not return a parseable named envelope. */
function codeForStatus(status: number): string {
	switch (status) {
		case 401:
			return 'UNAUTHORIZED';
		case 402:
			return 'QUOTA_EXCEEDED';
		case 404:
			return 'TEMPLATE_NOT_FOUND';
		case 413:
			return 'PAYLOAD_TOO_LARGE';
		case 429:
			return 'BUSY';
		case 504:
			return 'RENDER_TIMEOUT';
		default:
			return 'RENDER_FAILED';
	}
}

/** Map a non-2xx response body → typed EngineError, honoring the named envelope. */
function apiErrorFromResponse(body: unknown, status: number): EngineError {
	const parsed = parseJson(body);
	if (
		parsed !== null &&
		typeof parsed === 'object' &&
		'error' in parsed &&
		typeof (parsed as { error: unknown }).error === 'object' &&
		(parsed as { error: unknown }).error !== null
	) {
		const err = (parsed as { error: Record<string, unknown> }).error;
		const code = typeof err.code === 'string' ? err.code : codeForStatus(status);
		const message =
			typeof err.message === 'string' && err.message.length > 0
				? err.message
				: `pdfmill engine returned HTTP ${status}`;
		const requestId = typeof err.requestId === 'string' ? err.requestId : undefined;
		return new EngineError({ code, message, kind: 'api', requestId, httpStatus: status });
	}
	// Unparseable / non-JSON error body — still named, never a bare status.
	const snippet = toBuffer(body).toString('utf8').slice(0, 200);
	return new EngineError({
		code: codeForStatus(status),
		message: `pdfmill engine returned HTTP ${status}${snippet ? `: ${snippet}` : ''}`,
		kind: 'api',
		httpStatus: status,
	});
}

function transportError(e: unknown): EngineError {
	const message = e instanceof Error ? e.message : String(e);
	return new EngineError({
		code: 'ENGINE_UNREACHABLE',
		message: `could not reach the pdfmill engine: ${message}`,
		kind: 'transport',
	});
}

/** POST /v1/render → rendered document bytes + metadata. */
export async function engineRender(ctx: EngineContext, input: RenderInput): Promise<RenderOutput> {
	const { baseUrl } = await getCredentials(ctx);

	const body: IDataObject = { format: input.format, data: input.data };
	if (input.template !== undefined) body.template = input.template;
	if (input.html !== undefined) body.html = input.html;
	if (input.options && Object.keys(input.options).length > 0) body.options = input.options;

	const requestOptions: IHttpRequestOptions = {
		method: 'POST',
		url: `${baseUrl}/v1/render`,
		headers: { 'content-type': 'application/json' },
		body,
		json: true,
		encoding: 'arraybuffer',
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};

	let response: FullResponse;
	try {
		response = (await ctx.helpers.httpRequestWithAuthentication.call(
			ctx,
			CREDENTIALS_NAME,
			requestOptions,
		)) as unknown as FullResponse;
	} catch (e) {
		throw transportError(e);
	}

	const status = response.statusCode;
	if (status >= 200 && status < 300) {
		const headers = lowerHeaders(response.headers);
		const contentType =
			headers['content-type'] ?? (input.format === 'png' ? 'image/png' : 'application/pdf');
		return {
			bytes: toBuffer(response.body),
			contentType,
			pages: intHeader(headers['x-pdfmill-pages'], 0),
			durationMs: intHeader(headers['x-pdfmill-duration-ms'], 0),
			requestId: headers['x-request-id'] ?? '',
		};
	}
	throw apiErrorFromResponse(response.body, status);
}

/** GET /v1/templates → the account's renderable templates for the dropdown. */
export async function engineListTemplates(ctx: EngineContext): Promise<TemplateOption[]> {
	const { baseUrl } = await getCredentials(ctx);

	const requestOptions: IHttpRequestOptions = {
		method: 'GET',
		url: `${baseUrl}/v1/templates`,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};

	let response: FullResponse;
	try {
		response = (await ctx.helpers.httpRequestWithAuthentication.call(
			ctx,
			CREDENTIALS_NAME,
			requestOptions,
		)) as unknown as FullResponse;
	} catch (e) {
		throw transportError(e);
	}

	const status = response.statusCode;
	if (status >= 200 && status < 300) {
		const parsed = parseJson(response.body);
		const list =
			parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as IDataObject).templates)
				? ((parsed as IDataObject).templates as unknown[])
				: [];
		return list
			.filter((t): t is IDataObject => t !== null && typeof t === 'object' && typeof (t as IDataObject).id === 'string')
			.map((t) => {
				const id = t.id as string;
				const name = typeof t.name === 'string' && t.name.length > 0 ? t.name : id;
				return { id, name };
			});
	}
	throw apiErrorFromResponse(response.body, status);
}
