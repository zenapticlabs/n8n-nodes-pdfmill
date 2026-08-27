# n8n-nodes-pdfmill

This standalone public repository owns the published PDFmill community-node package and gallery workflows. Read `README.md` for the package contract and `VERIFICATION.md` before release or Creator Portal work.

When this repository is embedded in a larger program workspace, apply any explicitly supplied parent policy as an additional constraint. The repository must remain buildable and reviewable without depending on a parent checkout, named agent, or harness.

## Non-negotiables

- Keep the package a zero-runtime-dependency thin client over the PDFmill API.
- Authentication uses n8n’s credential system and `httpRequestWithAuthentication`; never read or log the API key in node code.
- Public workflows remain credential-free and contain no private resource IDs or real customer data.
- Run typecheck, lint, unit tests, build, deterministic gallery checks, and n8n’s community-package scan before release.
- npm publication uses the provenance-enabled GitHub Actions release workflow.
- Do not tag, publish, upload, accept Terms, or submit/resubmit without the human-controlled release boundary.
