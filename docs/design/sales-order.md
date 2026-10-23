# Sales Order — design (draft for the owner, 2026-10-23)

> Not built. Opens, per rule 6c, with what is already there; answers the twelve new-object rules (`bpmsquarecore.md` 3c) one
> line each. Context and phasing: `docs/design/gcc-sales-estimating-plan.md` section 1.

## What is already there

- No Sales Order object. "Sales order" exists only as an ERP target of an accepted Standard Quote (`src/lib/middleware/erpOrder.ts`, D365).
- Header + lines pattern: Opportunities (`0120`) and Standard Quotes (`0053`, totals in `standardQuoteTotals.ts`). Full 3b surface list: Products.
- Document PDF templates: `standard_quote_templates` (`0054`, ordered toggleable blocks, accent colour, logo position); print pages under `src/app/(print)`.
- Senders: `resolveOutbound` (email), the WhatsApp identity; quote email/WhatsApp routes exist.
- Pricing: `priceDocumentLine` (`src/lib/pricing/quoteLine.ts`), customer price list read from D365 at send time.
- ERP: connector links, ERP id line (`ExternalRecordSlot`), Links / Mapping / Monitor / Resync on the middleware page.
- Status engine (`0070`), change log, assistant actions registry, Talk to data (`LIST_SOURCES`), guide manifests.

## The twelve rules

1. **Simple.** Create asks for customer, order type and lines; everything else defaults (currency, terms, ship-to from the account).
2. **Ease of use.** From a quote, "Create order" is one tap and copies lines and price source. Same words as quotes and invoices.
3. **Not crowded.** The record opens on the visual page below; no field list; explanations behind InfoTip.
4. **Collapsible.** Sections (Lines, Price, Linked documents, Customer and terms) open and close and remember it; lines page at 20; tabs on the full page: Overview, Lines, Documents, History.
5. **Pricing choice.** Per order: **Internal** (price list and pricing engine, editable until sent) or **External** (entered, or supplied by the ERP and then read-only). One switch, one line saying where the prices came from. Replicated-in orders are always External.
6. **PDF, email, WhatsApp, links.** PDF per order type (rule 11); Email and WhatsApp buttons on the record through the existing senders, logged; quote and order link both ways, shown in the Linked documents strip.
7. **Document flow.** An order is created from: a Standard Quote or Quotation (accepted), a Deal, a Lead, an incoming email (shared inbox "Create order"), another order (copy), or directly. `source_type` and `source_id` are stored and shown.
8. **AI by default.** Assistant reads orders; `create_record` card for "create an order for X from quote Y" (or deferral reason recorded); Talk to data source; analytics (orders by status, value, fulfilment, late promises); global search; ⌘K "New order"; briefing facts ("3 orders short on stock"); `data-guide` ids on every control.
9. **ERP.** Entity row `sales_orders` in D365 and SAP (inbound with watermark, status back, webhook for near-real-time); ERP checks (credit, price, tax, ATP) as connector calls with Passed / Warning / Failed chips; origin `erp` is read-only; origin `bpmsquare` locks when the ERP accepts it. Config only on the middleware page.
10. **Change log.** `logChange` on every mutation, object in the history filter, actor as a name, "via integration" when the ERP changed it.
11. **Order types.** `sales_order_types` (data, edited in Settings): name, numbering format, default statuses and required fields, custom fields, PDF template (block list, accent, logo position, same mechanism as `0054`), default pricing mode, default ERP order type, and any customer attribute that selects it (for example customer group or region picks the type). A workspace can have several; the order shows its type as a chip. Settings has one screen: a table of types, a row opens a side panel (6c pattern 4).
12. **Visual record page** (mock-up shown to the owner in chat):
    - **Journey strip:** Draft, Checked, Sent, Submitted, Fulfilled, Invoiced as one segmented bar with the current step marked, replacing a status dropdown. Chips under it: Credit, Prices, Stock.
    - **Lines at a glance:** each line is a bar split into shipped, available and short against the ordered quantity, not a table row of numbers; tap for price source and promise date.
    - **Price waterfall:** list, discount, tax, total as proportional bars, with the Internal / External switch above it.
    - **Linked documents strip:** email, quote, order, ERP order, invoice (planned, dashed), each a link.
    - **Collapsed by default:** customer, delivery and terms.
    - Phone: the same blocks stacked; the journey strip stays one row.

## Statuses

Stored as the ERP's label plus a spine (open / in progress / completed / cancelled) for the status engine. BPMSquare adds only `Draft` before the order exists in the ERP. The D365 salesorder state and status codes beyond Active are **verified on the trial org before building**.

## Locking, in one helper

`orderEditable(order)`: false when `origin = erp`, or when a `connector_links` row exists (the ERP accepted it), or when status is past Draft. PATCH, UI and API all call it. The same `origin` convention is reusable for invoices and POs.

## Phasing

SO1 object, types, PDF, send, link to quote, lock rule, 3b surfaces. SO2 D365 replication in, status back. SO3 ERP checks and send. SO4 SAP both ways.

## Open for the owner

Order-type attributes that should auto-select a type (customer group? region? quote type?); whether Draft orders may be deleted; whether an order can be created without a quote for every customer or only for those with an account.
