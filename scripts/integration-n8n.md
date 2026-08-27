# Integration testing — the node against a real engine and a real n8n

Two levels of end-to-end proof for SC-003. Level 1 is automated + CI-gated and
runs here; Level 2 is the full n8n-UI runtime, documented for a human/CI runner
because a headless sandbox cannot reliably boot n8n (the same honesty pattern as
the engine's Chromium/Postgres suites).

## Level 1 — node ↔ engine (automated, env-gated) ✅ runs in this repo

`test/integration.engine.test.ts` drives the node's **real** `execute()` and
`loadOptions` through its **real** `engineClient` against a **running pdfmill
engine** over HTTP, and asserts real PDF/PNG bytes come back. It is skipped
unless the engine env is present.

```bash
# 1. Point to any checkout of the standalone engine, then start it.
ENGINE_REPO="<path-to-pdfmill-engine-repository>"
( cd "$ENGINE_REPO" && \
  PDFMILL_API_KEYS=int-key PDFMILL_NO_SANDBOX=1 PDFMILL_SKIP_CHROME_PIN_CHECK=1 \
  PORT=8099 PDFMILL_HOST=127.0.0.1 pnpm --filter @pdfmill/engine start ) &

# 2. run the gated integration test against it
PDFMILL_ENGINE_URL=http://127.0.0.1:8099 PDFMILL_API_KEY=int-key npm test
```

This proves node → engineClient → HTTP → engine → Chrome → real document, plus
the live template dropdown. It does **not** exercise the n8n UI runtime.

## Level 2 — inside a real n8n (manual / CI with a service) ⏳ documented

```bash
# 1. Build + pack the node
npm run build
npm pack                                # → n8n-nodes-pdfmill-<v>.tgz

# 2. Start a throwaway n8n with an explicit isolated user directory.
PACKAGE_TARBALL="$(pwd)/n8n-nodes-pdfmill-<v>.tgz"
export N8N_USER_FOLDER="$(mktemp -d)"
mkdir -p "$N8N_USER_FOLDER/nodes"
( cd "$N8N_USER_FOLDER/nodes" && npm init -y >/dev/null 2>&1 && npm install "$PACKAGE_TARBALL" )
npx n8n@latest
# Restart this process after changing the installed community package.

# 3. Start any checkout of the standalone engine.
ENGINE_REPO="<path-to-pdfmill-engine-repository>"
( cd "$ENGINE_REPO" && \
  PDFMILL_API_KEYS=int-key PDFMILL_NO_SANDBOX=1 PORT=8080 pnpm --filter @pdfmill/engine start ) &
```

Then in the n8n UI:

1. **Credentials → New → pdfmill API**: API Key `int-key`, Base URL
   `http://localhost:8080`. Click **Test** → expect success (hits `/v1/templates`).
2. **Workflows → Import from File** → `gallery/01-payment-to-invoice-email.json`.
3. Open **Generate invoice PDF**, select the **pdfmill API** credential; confirm
   the **Template** dropdown lists Invoice/Quote/Report/Certificate/Packing Slip.
4. **Execute workflow** → the node outputs a **`data`** binary; download it →
   a valid PDF invoice. Switch **Format** to PNG → a PNG comes back.
5. Verify errors: set a bad API key → the node fails with **UNAUTHORIZED** + a
   requestId. Turn on **Continue On Fail** with a 2-item batch (one bad) → the
   bad item carries `{ error }`, the good one still renders.

### Cloud (n8n Cloud)

Community-node install is a Cloud setting; the credential Base URL must be the
**public** engine URL (`https://api.pdfmill.dev`). Everything else is identical.

## CI

`.github/workflows/ci.yml` runs typecheck, lint, tests, build, deterministic gallery checks, and the
n8n community-package scan on every PR. Level-1 integration can be wired into CI by starting the
engine as a step and exporting `PDFMILL_ENGINE_URL` + `PDFMILL_API_KEY` before
the test step (mirrors the engine CI's Chrome setup).
