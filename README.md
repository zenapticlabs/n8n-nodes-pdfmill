# n8n-nodes-pdfmill

[![npm version](https://img.shields.io/npm/v/n8n-nodes-pdfmill?logo=npm&color=cb3837)](https://www.npmjs.com/package/n8n-nodes-pdfmill)
[![npm downloads](https://img.shields.io/npm/dw/n8n-nodes-pdfmill?logo=npm&color=cb3837)](https://www.npmjs.com/package/n8n-nodes-pdfmill)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Generate branded **PDF** and **PNG** documents from an n8n workflow — invoices,
quotes, reports, certificates, packing slips — powered by [pdfmill](https://pdfmill.dev).
Workflow data in, finished document out. No Chrome to host.

This is a community node for [n8n](https://n8n.io). It is a **thin client** over
the pdfmill render engine: it does not render anything itself, it calls the API
and hands you the document as a binary that flows straight into Gmail, Google
Drive, Slack, S3, or anywhere else.

## Install

In n8n (self-hosted or Cloud that allows community nodes):

**Settings → Community Nodes → Install**, then enter:

```
n8n-nodes-pdfmill
```

Or from a shell in your n8n instance:

```bash
npm install n8n-nodes-pdfmill
```

## Credential — “pdfmill API”

1. Create an API key in the [pdfmill dashboard](https://pdfmill.dev) → **API Keys**.
2. In n8n, add a **pdfmill API** credential:
   - **API Key** — the key you just created.
   - **Base URL** — leave as `https://api.pdfmill.dev` (only change it for a
     self-hosted engine).
3. Click **Test** — n8n verifies the key against the engine. Green means you're ready.

Your key rides n8n's credential system: it is never a node parameter and never logged.

## The node — “Generate PDF”

One node, two operations:

### 1. Generate from Template

Render one of your pdfmill templates with data.

| Field | What it is |
|---|---|
| **Template Name or ID** | Pick from your account (dropdown, loaded live), or set an ID via an expression. |
| **Data** | The values merged into the template's `{{variables}}`. Defaults to `{{ $json }}` — the incoming item — so the happy path is a single field. |
| **Format** | `PDF` (default) or `PNG`. |
| **Put Output File in Field** | Binary property to hold the document (default `data`). |
| **Options** | Page size, landscape, margins, scale, print background, file name. |

### 2. Generate from HTML

Render raw HTML you supply (usually an expression that maps HTML from an earlier
node). Same **Data / Format / Options / output** fields. `{{handlebars}}`
variables in the HTML are filled from **Data**.

### Output

- **Binary**: the rendered document on the chosen property (default `data`),
  with the correct filename + MIME type — chain it straight into an email/upload node.
- **JSON metadata**: `{ success, source, template, format, pages, bytes, durationMs, requestId, fileName, mimeType }`.

## Worked example — invoice → email (5 minutes)

1. **Manual Trigger** (or a Stripe/webhook trigger in production).
2. A node that produces the invoice data (a Set/Code node, or your real mapping).
3. **PDFmill** → operation *Generate from Template* → template **Invoice** →
   Data `{{ $json }}` → Format **PDF**.
4. **Gmail** → *Send* → add a binary attachment from the **data** property.

Five ready-made versions of this (payment→invoice→email, row→certificate→Drive,
form→report→Slack, scheduled summary, order→packing-slip) are in
[`gallery/`](./gallery) — import them directly.

## Errors

Every engine error surfaces with its **code**, a plain message, and a
**requestId** (quote it to support). n8n's **Continue On Fail** is honored — a
failing item passes an `{ error, code, requestId }` down the branch while good
items in the batch still render.

| Code | HTTP | Meaning | What to do |
|---|---|---|---|
| `UNAUTHORIZED` | 401 | Missing/invalid API key | Fix the pdfmill credential. |
| `QUOTA_EXCEEDED` | 402 | Monthly document cap reached | Upgrade the plan, or wait for the next period. |
| `INVALID_REQUEST` | 400 | Malformed request/data | Check the Data and Options. |
| `TEMPLATE_NOT_FOUND` | 404 | No such template ID | Pick a template from the dropdown. |
| `PAYLOAD_TOO_LARGE` | 413 | Request data too large | Reduce the payload. |
| `OUTPUT_TOO_LARGE` | 422 | Rendered document too large | Simplify the template/data. |
| `RENDER_TIMEOUT` | 504 | Render exceeded the time limit | Simplify the template, reduce size. |
| `RENDER_FAILED` | 500 | The engine could not render | Check the template/HTML + data. |
| `BUSY` | 429 | Rate-limited / at capacity | Retry with backoff. |
| `MISSING_CREDENTIAL` | — | No key/base URL configured | Complete the pdfmill credential. |
| `ENGINE_UNREACHABLE` | — | Could not reach the engine | Check the Base URL and network. |

## Compatibility

- n8n nodes API version **1**; requires Node.js **>= 20.15** (n8n's floor).
- The node is a thin client — it works against hosted pdfmill and any
  self-hosted pdfmill engine (set the credential Base URL).

## Development

```bash
pnpm install
pnpm --filter n8n-nodes-pdfmill run build       # tsc → dist + icons
pnpm --filter n8n-nodes-pdfmill run lint         # eslint-plugin-n8n-nodes-base (verification linter)
pnpm --filter n8n-nodes-pdfmill run test         # vitest (engine HTTP mocked)
```

A real node↔engine integration render is gated on env (see
[`scripts/integration-n8n.md`](./scripts/integration-n8n.md)):

```bash
PDFMILL_ENGINE_URL=http://localhost:8080 PDFMILL_API_KEY=... \
  pnpm --filter n8n-nodes-pdfmill run test
```

## License

MIT
