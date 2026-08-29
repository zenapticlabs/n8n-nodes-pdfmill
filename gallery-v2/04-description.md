### Quick overview

Every Monday this workflow reports on the previous complete week: it pulls two independent metric
sources in parallel, reconciles them, renders a branded PDF report with pdfmill, emails it to the
team, and archives the same file in Google Drive. If either source is missing or partial, it sends a
data-gap notice naming what was missing instead of publishing an incomplete report.

### How it works

1. A Schedule Trigger runs weekly, and a Code node derives the previous complete ISO week
   (Monday–Sunday, UTC) so a run never reports a partial week.
2. Two HTTP Request nodes fetch ticket metrics and satisfaction scores in parallel for that window.
   Both retry and are set to continue on failure, so a dead endpoint becomes a reported gap rather
   than an aborted run.
3. A Merge node appends both responses, and a Code node classifies them by shape rather than arrival
   order, then checks every required figure.
4. If anything is missing, the workflow emails a data-gap notice listing the missing sources, missing
   fields, and API errors, and stops without rendering.
5. If the data is complete, pdfmill renders the built-in Report template with the reconciled KPIs,
   period comparison table, and written sections.
6. The same PDF binary goes directly to Gmail and Google Drive, and a Merge waits for both branches
   before the run finishes.

### Setup

1. Open **Set the weekly reporting window** and change `reportRecipient` to your team mailbox and
   `metricsBaseUrl` to your metrics API.
2. Add credentials for pdfmill, Gmail, and Google Drive.
3. In the Google Drive node, select the drive and folder where weekly reports should be archived.
4. If your metrics API requires authentication, add it on both HTTP Request nodes.

### Requirements

- A pdfmill account and API key (the community node is self-hosted only).
- Gmail and Google Drive credentials.
- An API that answers `GET /service-desk/tickets` and `GET /service-desk/satisfaction` with `start`
  and `end` query parameters, returning `ticketsOpened`, `ticketsResolved`, `firstResponseMinutes`,
  `csatScore`, and `csatResponses`. An optional `previous` object adds week-over-week comparisons;
  without it the report prints "No prior week" rather than a fabricated change.

### How to customize

- Change the schedule to daily or monthly; the window logic follows the trigger.
- Point the HTTP nodes at any metrics source, or swap one for a database or spreadsheet node.
- Edit the KPI list, table rows, and written sections in **Validate and build the weekly report**.
- Swap the pdfmill template for your own branded report, or add Slack alongside Gmail delivery.
