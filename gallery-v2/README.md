# gallery-v2 — substantial workflows for the n8n template gallery

The starter workflows in [`../gallery/`](../gallery) (minimal: manual trigger → hardcoded `Set` data → Generate PDF → deliver) were **rejected by n8n's template-gallery review as "too basic"** (creators@n8n.io, 2026-07-31). The gallery wants real, deployable end-to-end automations, not demos.

These are the **submission-track versions** of the same five document types. They were originally
called “beefed-up,” but human review proved that label was not a gate: the submitted five-node copy of
`03` and current `04` collapsed to linear product demos. `03` has since been rebuilt around validation,
a real Google Sheets source, two decision branches, and explicit correction/no-data outcomes. Read the
approved-template complexity floor below before treating any file as submission-ready:

| File                              | Doc type     | Shape                                                                                                                         |
| --------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `01-order-to-invoice.json`        | invoice      | Order webhook → validate + compute totals → IF guard → Generate PDF → email customer + archive to Drive → structured 200/400  |
| `02-cohort-to-certificates.json`  | certificate  | Cohort webhook → validate the **whole roster** → fan-out → Generate PDF → direct Gmail + Drive branches → wait/join → 200/400 |
| `03-form-to-report.json`          | report       | n8n **Form Trigger** → validate → Sheets lookup → aggregate/no-data branch → Generate PDF → Drive + email                     |
| `04-scheduled-weekly-report.json` | report       | Weekly **Schedule Trigger** → previous-ISO-week window → **two parallel HTTP sources** → Merge → reconcile → complete/data-gap branch → Generate PDF → Gmail + Drive → wait/join |
| `05-order-to-packing-slip.json`   | packing-slip | Store-order webhook → validate the **whole order** → price-free PDF → direct Gmail + Drive branches → wait/join → 200/400     |

## Status (2026-08-27)

- `01-order-to-invoice.json` is **LIVE** as n8n workflow
  [17604](https://n8n.io/workflows/17604/) after passing human review.
- `02-cohort-to-certificates.json` is **LIVE** as n8n workflow
  [18709](https://n8n.io/workflows/18709-issue-cohort-completion-certificates-with-pdfmill-gmail-and-google-drive/).
  Its reproducible nine-node build rejects the
  complete cohort before fan-out when the roster is empty, a cohort identity
  field is missing, or any attendee name, mailbox, hours, or date is invalid. Mailbox validation rejects
  multi-recipient strings and malformed dot placement before any item reaches Gmail. Certificate numbers
  include n8n's execution ID rather than a repeating time bucket. The pdfmill `data` binary fans directly
  to Gmail and Drive, and a Merge waits for both branches before the single success response. Deterministic
  fixtures cover two-attendee fan-out, aliases, adjacent executions, same-execution replay, every required field,
  malformed mailboxes, one-400 behavior, connection integrity, identical sink bytes, and secret/resource-ID
  hygiene. Fresh isolated imports with exact
  `n8n-nodes-pdfmill@0.2.1` passed first on highest **n8n 2.37.1**, then latest **2.36.7**: nine nodes,
  nine edges, resolved pdfmill node, and only the three intentionally unset credential warnings.
  All six stickies had zero clipping (minimum 98px headroom). The live engine returned an inspected
  79,394-byte, one-page landscape A4 certificate. Canvas and artifact evidence is retained by the
  publishing program separately from this standalone package repository. Gmail and Drive were not
  executed. The human uploaded the committed credential-free JSON and submitted it on 2026-08-25;
  the portal returned HTTP 200 with 15 total nodes and `reviewStatus: in_review`. On 2026-08-26 the
  dashboard moved it to **Published**, the public page returned HTTP 200 with the correct title and
  Gmail/Google Drive content, and the portal displayed **verified creator** status.
- `03-form-to-report.json` is **LIVE** as n8n workflow
  [18554](https://n8n.io/workflows/18554-collect-form-based-report-requests-and-send-pdfmill-pdfs-via-gmail-and-drive/).
  Its original five-node straight line was rejected as “currently too basic”; the published redesign
  has 11 functional nodes, two decisions, real Google Sheets metrics, and invalid-request/no-data outcomes.
  It passed the n8n 2.36.6 canvas gate (5 stickies, 0 clipped, 276px minimum headroom), live-engine PDF
  inspection, and isolated configured QA (0 node issues, two-row Sheets read, disposable Drive
  upload/delete). The gallery JSON remains credential- and resource-ID-free.
- `05-order-to-packing-slip.json` is **LIVE** as n8n workflow
  [18743](https://n8n.io/workflows/18743-issue-warehouse-packing-slips-with-pdfmill-gmail-and-google-drive/).
  Its deterministic nine-node build validates order identity, dates, the warehouse mailbox, both shipping addresses,
  and every line item's SKU, description, and positive integer quantity before any side effect. One
  malformed field returns one 400 response. Source prices never reach the normalized packing-slip
  data. The pdfmill `data` binary fans directly to Gmail and Drive, and a Merge waits for both before
  `packing_slip_ready`. Deterministic fixtures cover common store aliases, price omission, every
  required field, malformed mailboxes, invalid quantities, direct binary branches, join behavior,
  and secret/resource-ID hygiene. Fresh isolated imports with `n8n-nodes-pdfmill@0.2.1` passed on
  highest published **n8n 2.37.2** and latest/stable **2.36.7**: nine functional nodes, nine edges,
  resolved pdfmill node, and only the three intentionally unset credential warnings. All six
  stickies had zero clipping and 259px minimum headroom. The live engine returned an inspected
  33,330-byte, one-page portrait A4 packing slip with three SKUs and six physical units. Canvas and
  artifact evidence is retained by the publishing program separately from this standalone package
  repository. Gmail and Drive were not executed. The human uploaded the committed credential-free JSON and submitted it on
  2026-08-26. On 2026-08-27 the public page returned HTTP 200 under its published slug and the
  template API returned the same 15-node, nine-edge workflow under this creator, published with the
  submitted title. The exact submitted title, description, artifact hash, and portal response are
  retained in the publishing program's review record.
- `04-scheduled-weekly-report.json` is **READY FOR HUMAN SUBMISSION** after a redesign on 2026-08-29.
  Its original five-node straight line failed the complexity floor; the rebuild has **12 functional
  nodes**, derives the previous complete ISO week in UTC, pulls **two independent metric sources in
  parallel** (each retrying and continuing on failure), merges them, and reconciles them by shape
  rather than arrival order. Missing sources, missing fields, or an API error produce a **data-gap
  email that names what was missing** and render nothing; only complete data reaches pdfmill, whose
  binary then fans directly to Gmail and Drive with a Merge waiting for both. Deterministic fixtures
  cover ISO-week edges (including a W53 year boundary), source-order independence, `body` unwrapping,
  zero-activity weeks, partial fields, a failed request, absent `previous` data, and secret hygiene.
  Isolated imports with `n8n-nodes-pdfmill@0.2.1` passed on highest published **n8n 2.37.4** and
  latest/stable **2.36.8** with byte-identical canvases: six stickies, zero clipping, 176px minimum
  headroom, and the pdfmill node resolved. The documented sample ran through the workflow's own code
  and rendered an inspected one-page, 46,451-byte report. Gmail and Drive were not executed.
- All five workflows now pass the approved-template complexity floor; `04` was the last one below it.

n8n allows only one template under review at a time. Queue submissions, but do not submit another file
merely because the slot is open; it must pass both the render gate and the complexity floor.

### Approved-template complexity floor (founder ruling, 2026-08-23)

Future pdfmill submissions must be **at least as complex as the first approved template**, workflow
17604:

- **≥8 functional nodes** (sticky notes do not count); **and**
- meaningful control/data flow comparable to 17604: validation, an IF guard, explicit success and
  error outcomes, the PDF action, and operational delivery.

Node count alone cannot pass the gate. Duplicate delivery nodes do not substitute for a branch, merge,
batch fan-out/iteration, stateful decision/update, approval, or named retry/error path.

| File                              | Functional nodes | Gate                      | Reason                                                                              |
| --------------------------------- | ---------------: | ------------------------- | ----------------------------------------------------------------------------------- |
| `01-order-to-invoice.json`        |                8 | ✅ approved control       | validation + IF + success/error + Gmail/Drive                                       |
| `02-cohort-to-certificates.json`  |                9 | ✅ pass after remediation | strict whole-roster validation + IF + direct binary fan-out + Merge + success/error |
| `03-form-to-report.json`          |               11 | ✅ pass after redesign    | request validation + Sheets lookup + no-data branch + PDF/Drive/Gmail               |
| `04-scheduled-weekly-report.json` |               12 | ✅ pass after redesign    | window + two parallel sources + merge + reconciliation + data-gap branch + fan-out  |
| `05-order-to-packing-slip.json`   |                9 | ✅ pass after remediation | strict whole-order validation + IF + direct binary fan-out + Merge + success/error  |

The executable floor is:

```bash
npm run verify:gallery-scope
# Or gate one candidate before submission:
npm run verify:gallery-scope -- gallery-v2/02-cohort-to-certificates.json
```

It compares functional-node and branch-point counts against `01`. Passing prevents the obvious repeat;
it does not replace the human substantiality review in `n8n-publish`.

### Review history / lessons folded into the queue

1. **"Too basic"** (2026-07-31) — the simple `gallery/*.json` demos were rejected.
2. **"Sticky notes don't meet quality standards"** (2026-08-03) — annotation quality is a separate
   gate. The files use a yellow Overview, grey section backgrounds, setup notes where needed, and
   descriptive node names.
3. **"Currently too basic"** (2026-08-23) — `03` proved the first rebuild still underspecified
   “substantial.” Real trigger + Code transform + product node + Drive/Gmail is still a product demo.
   The approved workflow 17604 is now the minimum evidence-based floor.

The portal carries template state and resubmit controls, but for workflow 18554 it carried **no reviewer
reason**; it said the feedback was sent by email. Read both surfaces: portal for state, feedback email
(Inbox, All Mail, Spam) for the exact requested change.

## Notes

- The **simple** versions in `../gallery/` remain in place — they're embedded byte-identical in the `/guides/n8n-*-pdf` use-case pages as easy-to-follow teaching artifacts. These v2 versions are for the **gallery** only.
- All five are valid JSON with verified connection integrity, and use the pdfmill community node (`n8n-nodes-pdfmill.pdfmill`). Credentials (Gmail / Google Drive / pdfmill) are intentionally **unset** — the importer adds their own, as every template requires.
- `02` is generated by `_build-02.mjs` and gated by `_test-02.mjs` through
  `npm run verify:gallery-02`; rebuilding is deterministic.
- `05` is generated by `_build-05.mjs` and gated by `_test-05.mjs` through
  `npm run verify:gallery-05`; rebuilding is deterministic.
- Built via JS-object → `JSON.stringify` builders (avoids escaping bugs); each Code node was executed against mock inputs during construction.
