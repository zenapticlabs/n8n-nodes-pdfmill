**Who's it for**

Course, bootcamp, training, and webinar teams that issue personalized completion certificates
to a whole cohort. It replaces manual mail merge, PDF export, email, and archive work with one
controlled batch.

**How it works**

A Webhook receives cohort details and an attendees array. Before fan-out, a Code node validates
the cohort identity, completion date, attendee names, positive hours, and one standard mailbox
per attendee. Empty or malformed input returns one 400 response, so a bad cohort is never
partially sent. A valid roster becomes one item per attendee. Certificate numbers include the
n8n execution ID, preventing overlap between adjacent executions. pdfmill renders one branded
PDF per item. That binary fans directly to Gmail and Google Drive; neither branch depends on the
other's output. A Merge waits for both before the webhook returns the issued count.

**How to set up**

1. Install the verified pdfmill node and add pdfmill, Gmail, and Google Drive credentials.
2. Choose the Drive archive folder and review the orange setup note's payload.
3. POST completed cohorts to the Webhook's Production URL.

**Requirements**

Provide a non-empty attendees array plus the cohort program, organization, issuer name and
title, and a `YYYY-MM-DD` completion date. Every attendee needs a name, positive numeric hours,
and one mailbox in `email` or `emailAddress`. Grade is optional and defaults to `Completed`.

**How to customize**

Map source aliases in the validation Code node, replace the built-in Certificate template with
your own pdfmill branding, or swap the delivery and archive nodes. Preserve whole-roster
validation and the post-delivery Merge when changing destinations.
