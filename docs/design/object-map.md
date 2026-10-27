# How BPMSquare objects hand over, and what leaves (scan of 2026-10-23)

> Read from code (migrations 0000 to 0208, routes, lib), not from memory. The two diagrams shown to the owner in chat are
> drawn from this. Paths: S = src/, A = src/app/api/, L = src/lib/.

## Process chains (exists = built)

1. **Market to cash.** Campaign / newsletter / form / event / WhatsApp / journey, then a touch and contact scoring, then a Lead
   (form submit, interest link, or the scoring cron), then Lead convert to Opportunity (`A/leads/[id]/convert`), then
   Opportunity convert to Standard Quote (`A/opportunities/[id]/convert`, lines re-priced), then email / PDF, then status
   `accepted`, then (flag-gated) an ERP Quote, Sales Order or Project (`L/middleware/dispatch.ts`). The ERP owns the order.
2. **Service to cash.** Account + Asset, then Case, then Inspection report, then Quotation (`case_id` sets the case's `quote_id`),
   then outcome `won`, then convert-to-invoice, then Invoice email, payments, paid. Or Work Order then invoice
   (`A/work-orders/[id]/invoice`).
3. **Procure.** Need on a Case / Quote / Standard Quote / Deal / Work Order / Fence project, then RFQ (soft link
   `rfqs.origin_type` + `origin_id`), then supplier replies (email, mailbox, portal), then award per line (feeds the pricing
   cost inputs), then a draft PO per supplier, then PO receive adds stock (only for lines with `inventory_item_id`).
4. **Estimate to order.** Estimate or Fence project, then Standard Quote (customer lines only, internal costs never written),
   then accepted, then an ERP Project target that can carry WBS, BOM and fence data.
5. **Workforce to invoice.** Employee + shift + site + roster (with project), then punch stamped with the project, then
   corrections / OT / leave, then project hours, then a draft Invoice per period (manual, month-end cron or API), guarded
   against double billing. Payroll leaves only as an XLSX file.
6. **Mail to record (shared Inbox, built 2026-10-24).** A customer writes to a channel address (forwarding) or the company
   mailbox (IMAP, read-only), then an `inbound_emails` row (body encrypted, files in a private bucket, labelled by type and
   size), then Create from this email makes a Standard Quote, WFM Project, Case, Lead or (via the workspace) Estimate, copies the
   files onto it (`record_files`, or the quote's own Attachments), stores sender and summary (`record_sources`) and links the
   message back. Replies leave through the channel's mailbox or `resolveOutbound`, logged as `email_log` kind `inbox`. Not
   exposed on v1, Data Workbench, Talk to data or the assistant: it is private correspondence.

## What leaves BPMSquare today

- **Email** (Resend, tenant Gmail or tenant mailbox; always through `resolveOutbound`; logged in `email_log`): Quotation,
  Standard Quote, Invoice (PDF attached), RFQ, campaigns, newsletters, journeys, form confirmations, event follow-up, WFM
  notices, auth. **No email sender** for Cases, Inspection Reports, Work Orders, POs or Contracts.
- **WhatsApp:** only a **sandbox** provider exists (it logs, sends nothing). Real sends today are manual `wa.me` links (quotation
  with its public PDF link, case page, RFQ supplier message).
- **Public signed links:** Quotation PDF (90-day HMAC), marketing links, forms, RFQ reply portal. Standard Quotes and Invoices
  have no public link.
- **PDF:** invoices, quotes, standard quotes, RFQs, process studies. **CSV / Excel:** Data Workbench export for 23 objects,
  estimate BOM/WBS (internal), WFM summaries, reports.
- **ERP:** accepted Standard Quote to D365 (Quote, Sales Order, Project) or a Call webhook; Account on demand; Fence project to a
  D365 project. SAP is **pull only**. Invoices, POs, work orders and RFQ awards are **not** pushed anywhere.
- **Webhooks and API:** event webhooks drain `change_log` (any object that logs); the Call webhook kind covers only accounts and
  standard quotes; the v1 API covers 14 object families plus a change feed scoped per key; MCP wraps v1.
- **Third parties:** Anthropic (many AI features, including web search), AWS Rekognition (WFM faces), Ola Maps (geocoding), web push.

## Gaps found (relevant to the Sales Order build)

- No Sales Order, delivery, goods receipt, supplier invoice or payment object.
- **Standard Quote cannot become an Invoice**; convert-to-invoice exists only for Quotations. Quotation and Standard Quote are two
  parallel quote objects with no conversion either way (the opportunity convert route refuses `quotation`).
- An accepted quote does **not** mark the deal won; deals close only by stage change. Lead conversion does not create a contact.
- **Case to Work Order has no creator:** work orders come only from import, dispatch only edits them.
- Quotation won does not create a Work Order; case parts do not consume stock; RFQ-made PO lines carry `product_id` but not
  `inventory_item_id`, and products and inventory items have no link (matched only by SKU).
- Several events are catalogued but never emitted (`quote.opened/accepted`, `contract.*`, `work_order.completed`, `rfq.*`, `wfm.*`);
  webhooks and the change feed carry only what writes `change_log`, not domain events; the status-hook registry is empty, so
  nothing propagates a status across objects except the direct calls above.

## What this means for the Sales Order

- It becomes the **natural close point:** order created from an accepted quote moves the deal to Won (new link), and ERP
  deliveries and invoices hang off the order (read-only), which also fills the missing quote-to-invoice path for ERP customers.
- It must accept **both quote objects** as source (`source_type`: standard_quote or quotation), since both exist.
- Real WhatsApp sending needs a live provider first (today sandbox only); the order's WhatsApp button uses the `wa.me` link
  with a public PDF link until then. A public signed link for orders is needed (Standard Quotes and Invoices have none).
- Emit proper domain events and write `change_log` so webhooks, the change feed, briefing and AI see orders from day one.
