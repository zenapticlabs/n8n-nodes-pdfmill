# n8n verification demo video — reusable recording script

**Status:** historical procedure. PDFmill is already verified. Retained for a future review request or a new service node.

## Reviewer-facing format

- Follow the Creator Portal’s current duration and continuity requirements; re-read them before recording.
- Use the exact package version under review.
- Record one clean end-to-end execution in a real n8n instance.
- Keep credentials masked and all setup off-camera.

## Before recording

1. Use an isolated n8n instance that permits the package under review.
2. Configure the service credential in n8n’s credential store. Never place the key in workflow JSON, this repository, screenshots, or narration.
3. Prepare a synthetic input and know the expected artifact/output.
4. Complete a rehearsal and inspect the output before recording the submission take.

## Suggested take

1. Show the exact installed package and version.
2. Create a workflow and insert the service-named node.
3. Show the available operations without exposing credentials.
4. Execute the primary operation using synthetic input.
5. Show the returned binary/structured output and inspect the resulting artifact.
6. If tool use is part of the submitted node contract, demonstrate one bounded tool call without exposing model credentials or private data.

Stop recording after the successful result. Do not splice failures out of a take if the portal requires a continuous recording; re-record cleanly instead.

## Human boundary

A human selects/uploads the final video, accepts any portal attestations, and submits it for review. An agent may prepare the workflow, validate the take, and stage non-binding text, but may not perform those binding actions.
