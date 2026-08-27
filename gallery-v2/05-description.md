**Who's it for**

Ecommerce operators and fulfilment teams that need a warehouse-ready packing slip as soon as a
paid order is ready to pack. It replaces manual document export, warehouse notification, and Drive
filing while deliberately keeping customer prices out of the warehouse document.

**How it works**

A Webhook receives one paid order. Before any side effect, a Code node validates the order number,
order and shipment dates, warehouse mailbox, ship-from and ship-to addresses, and every line item's
SKU, description, and positive integer quantity. Empty or malformed input returns one 400 response,
so an invalid order is never partially processed. pdfmill renders the built-in Packing Slip template
with warehouse-facing facts only; source price fields are ignored. The resulting `data` binary fans
directly and independently to Gmail and Google Drive. Gmail sends the PDF to the validated warehouse
mailbox while Drive archives the same bytes. A Merge waits for both branches before the webhook
returns `packing_slip_ready`, the order number, and the total physical units.

**How to set up**

1. Install the verified pdfmill node and add pdfmill, Gmail, and Google Drive credentials.
2. Choose the Drive folder where completed packing slips should be archived.
3. Review the orange setup note, map any store-specific aliases, and POST paid orders to the
   Webhook's Production URL.

**Requirements**

Provide an order number, `YYYY-MM-DD` order date, one warehouse mailbox, complete ship-from and
ship-to names and addresses, and a non-empty items array. Every item needs a SKU, description, and
positive integer quantity. Shipment date defaults to today's UTC date; carrier, tracking number,
weight, and notes are optional.

**How to customize**

Map Shopify, WooCommerce, or custom store fields in the validation Code node, replace the built-in
Packing Slip template with your own pdfmill branding, or swap the warehouse and archive destinations.
Preserve whole-order validation, direct binary fan-out, and the post-delivery Merge.
