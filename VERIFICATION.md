# PDFmill n8n verification and release

## Current state

`n8n-nodes-pdfmill@0.2.1` is published with npm provenance and verified by n8n. Its public listing is:

- Integration: <https://n8n.io/integrations/pdfmill/>
- npm: <https://www.npmjs.com/package/n8n-nodes-pdfmill>
- Source: <https://github.com/zenapticlabs/n8n-nodes-pdfmill>

The node name and package identity are service-bound. Do not reintroduce the deprecated job-named package.

## Local gates

Use the production-compatible Node runtime selected by the repository’s CI, then run:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:gallery-02
npm run verify:gallery-03
npm run verify:gallery-05
npx -y @n8n/scan-community-package@latest n8n-nodes-pdfmill
```

Gallery candidates additionally pass the shared current-n8n canvas render gate and a human end-to-end artifact read before submission. Credential-required nodes may legitimately show setup indicators in a credential-free gallery JSON. Never insert credentials or private resource IDs to hide them.

## Release

`.github/workflows/release.yml` publishes from a `v*` tag with npm provenance. Release only from a clean, reviewed commit:

1. Update `package.json` and `package-lock.json` to the same version.
2. Run every local gate above.
3. Commit and push through the repository’s normal review path.
4. Tag the reviewed commit `vX.Y.Z` and push the tag.
5. Confirm npm provenance and the expected package contents.

Do not create a replacement package for an ordinary review fix. Publish a new version of this package and use the existing Creator Portal resubmission unless n8n explicitly requires a new package identity.

## Creator Portal boundary

Agents may prepare, test, scan, render, inspect authenticated state, and stage non-binding text. A human performs MFA/OAuth, selects or uploads artifacts/video, accepts Terms or attestations, and submits or resubmits. Browser session state and credentials never enter this repository.

## Gallery ownership

- `gallery-v2/` contains the current substantial gallery candidates and their deterministic builders/tests.
- `gallery/` contains the original documentation workflows and versioned fixture snapshots.
- Only one template is placed into human review at a time.
- Every review round records the submitted JSON hash, portal state, reviewer words, and commit under review in the studio n8n evidence workspace.
