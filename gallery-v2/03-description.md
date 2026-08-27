**Who's it for**

Operations, finance, and account teams that repeatedly turn a shared metrics sheet into a
client or internal PDF report. A requester can ask for a report without an analyst manually
finding rows, rebuilding a document, or handling delivery.

**How it works**

An n8n Form Trigger collects the report title, report key, period, recipient, and optional
summary. The workflow validates the request and emails precise corrections for unsupported
periods. Valid requests load Google Sheets rows matching both the report key and period.
Another validation branch notifies the requester when no metrics match instead of creating
an empty PDF. Matching rows are aggregated into KPIs, narrative sections, and a comparison
table. pdfmill renders one branded PDF, which is archived to Google Drive and emailed to the
requester.

**How to set up**

1. Install the verified pdfmill node and add your pdfmill API credential.
2. Connect Google Sheets, Google Drive, and Gmail credentials.
3. Select the metrics spreadsheet and sheet in the Google Sheets node.
4. Use the documented column schema in the orange setup note.
5. Choose the Drive folder, then share the Form Trigger URL.

**Requirements**

A pdfmill account plus Google Sheets, Google Drive, and Gmail access. The sheet needs columns
for Report key, Period, Metric, Current, Previous, Change, Direction, Section, and Commentary.

**How to customize**

Change the form fields and sheet filters to match your reporting taxonomy. Add metric rows or
narrative sections without editing the workflow. Replace the report template with your own
pdfmill template for different branding, or swap Gmail and Drive for your preferred delivery
and archive nodes.
