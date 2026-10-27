# Sales Order SO1 — build spec (the contract both builders code against)

> Read `docs/design/sales-order.md` (design, decisions, research), `docs/design/object-map.md`, `bpmsquarecore.md` (3b, 3c, 6b, 6c) and
> `MULTI_TENANT_GUARDRAILS.md` first. Types and the edit rule live in `src/lib/salesOrders/types.ts` (do not fork them).
> **SO1 = everything except ERP replication, ERP checks and sending to an ERP** (SO2 and SO3). The ERP tab ships as a shell showing
> the ERP id line and an empty state until a connector link exists.

## Database: `supabase/migrations/0212_sales_orders.sql` (hand-applied; code degrades on 42P01/42703)

- Tables `sales_order_types`, `sales_orders`, `sales_order_lines`, `sales_order_attachments` (mirror `standard_quote_attachments`, `0119`,
  including its storage rules), plus `products.lead_time_days int null`.
- Standard tenant-isolation RLS policy per table in the same migration; indexes on (tenant_id, ref), (tenant_id, account_id),
  (tenant_id, status), the source link; unique ref per tenant. Columns follow `src/lib/salesOrders/types.ts`.
- `scripts/seed-sales-orders-demo.sql` (idempotent, `is_demo` tenants only, turns the flag on, one default order type and 3 sample
  orders), bundle `scripts/run-bundle-21-sales-orders-2026-10-23.sql`, ledger line in PROJECT.md as pending on both DBs.

## Flag and nav

Feature `sales_orders` (platform-admin, default off: TenantFeatures, TenantEditor, NewTenantForm DEFAULT_FEATURES), workcenter key
`sales_orders`, nav item under Sales, `OBJECT_FEATURE` entries, `ROUTES.salesOrders / salesOrder / salesOrderNew`.

## Routes (all `requireTenantUser`, tenant-scoped, foreign ids verified, `logChange` on every mutation)

- `GET/POST /api/sales-orders`: list (filters status, account, q, page) and create. POST body: `{ type_id?, account_id, contact_id?,
  bill_to?, ship_to?, customer_po?, requested_date?, currency?, notes?, terms?, lines, source?: { type, id }, confirm_another? }`.
  With `source` the server COPIES lines, prices, tax, discount, currency, account, contact, pricing mode, customer PO and notes from that
  standard quote / quotation / opportunity (verified in tenant; quotes must be accepted / won, else 422; one order per source unless
  `confirm_another`). Without `type_id`, pick by the type rules (customer group, region, source type), else the default type.
  **Pricing mode comes from the TYPE; an order made from a quote inherits that quote's mode. Never a toggle.** Ref = `<prefix>-NNNN`
  counted per tenant and prefix with the invoiceRef / poRef probing pattern.
- `GET / PATCH / DELETE /api/sales-orders/[id]`: PATCH has an explicit allowlist and `orderEditable()` (annotatable fields notes,
  customer_po, custom_data also when `orderAnnotatable`); DELETE only `orderDeletable()`.
- `PUT /api/sales-orders/[id]/lines` (replace the set; recompute totals with `standardQuoteTotals.ts` rules; `expected_date` = max
  confirmed_date). `POST .../confirm` (draft to confirmed, sets confirmed_at, re-runs master-data availability, emits `order.confirmed`),
  `POST .../cancel` (reason required), `POST .../reopen` (confirmed to draft only when no ERP link).
- `GET / POST /api/sales-orders/[id]/availability` (POST refreshes): master-data availability per line: stock from `inventory_items`
  matched with `inventoryItemForProduct`; available now if `qty_on_hand >= qty` (date today), else `today + products.lead_time_days`
  (null date when no lead time); stored on the lines with `availability_source = 'master'` and the time. ERP rows (SO2) overwrite with
  source `erp` and are never edited here. Editing qty, date or lines clears `availability_at` (stale).
- `GET / POST /api/sales-orders/[id]/attachments`, `DELETE .../attachments/[aid]` (file upload like standard quote attachments; link =
  https URL, validated).
- `GET .../pdf`, print page `(print)/sales-orders/[id]/print` (uses the order TYPE's template blocks, each line's printed_text under
  the line, tenant letterhead); `POST .../email` (PDF attached, `resolveOutbound`, `email_log` kind `order`, emits `order.sent`);
  public signed link like `quotePublicLink.ts` (`salesOrderPublicLink.ts`, 90 days) with `pdf-public/[token]` and a print-public page;
  a `wa.me` message builder like the quotation one. The WhatsApp provider is sandbox only, so the button opens the link; say so in help.
- `GET / POST /api/sales-order-types`, `PATCH / DELETE /api/sales-order-types/[id]` (admin only; at least one default; a type that has
  orders is deactivated, not deleted).
- Every other 3b surface: v1 `GET /api/v1/sales-orders` + `/[id]` (no internal fields), `LIST_SOURCES`, `UNDOCUMENTED_ENDPOINTS`,
  `SCOPE_FOR_TYPE`, Data Workbench export / import / update (headers and lines, match on id only), field registry + PILOT type
  `sales_order`, custom fields tab, global search spec, ⌘K "New sales order", Nova timeline slot + comments OBJECTS + inbox LABEL/TABLE +
  `ROUTE_FOR`, change-history filter, analytics tile + reports metric, MCP tools + version bump, `ExternalRecordSlot` OBJECT_TABLES entry,
  events `order.created / confirmed / cancelled / sent` in the catalogue and emitters (coverage test passes), assistant
  `sources.ts` (Talk to data), a `create_record` registry entry or a DEFERRED reason in `src/lib/actions/registry.ts`, briefing facts
  ("N orders to confirm"), guide-mode `data-guide` ids on every control.
- Standard Quote and Quotation detail pages get **"Create sales order"** (accepted / won only, flag on) POSTing with `source`; the
  quote then shows the order ref as a fact, as the invoice link does.

## Screens (6b / 6c, PC and 375 px, InfoTip for explanations; the v5 mock-up in the session is the direction)

- **List:** ListFilterBar, status chips, sortable columns, pager; ref, customer, total, expected delivery, status.
- **Detail:** the **status path at the very top, above the order id** (Draft, Confirmed, Delivered, Invoiced, Paid; later steps grey with
  a hint until ERP data exists). Header row: ref, type chip, lock chip with the reason, one quiet pricing line ("Internal pricing, as
  quote SQ-…"), actions PDF / Email / WhatsApp / Confirm / Cancel / Reopen as the state allows, "Check with ERP" hidden until a
  connector exists. Tabs via `useUrlTab`:
  1. **Overview:** attention banner only when a line is late or short; Sold to and Bill to merged when the same; Ship to; three
     facts: Total incl. VAT, Expected delivery (with its source tag), Customer PO (with file count). Nothing else.
  2. **Lines:** table of item, qty, unit price, discount, line total; expandable "Printed text" per line; editable only by `orderEditable`.
  3. **Availability:** asked and wanted-by against confirmed and date, with the source tag ERP or Master data (estimate); stale banner
     with a Refresh action.
  4. **ERP:** ERP id line; transfer log and deliveries / invoices as an empty-state shell.
  5. **Documents and files:** the swimlane document flow (SVG, curved connectors, a status dot and amount per box, dashed = planned,
     each box a link; email, quote, order, deliveries, invoices) above the Files and links area (upload a file / add a link, typed
     Customer PO / Drawing / Other, who and when).
  6. **History:** RecordActivity / Nova timeline.
- **Create:** order type (auto-selected, changeable), customer search, contact, ship-to, customer PO, lines (reuse the standard quote
  line editor / picker if reusable as-is), notes.
- **Settings > Order types** (rule 6c): one table, a row opens a side panel (bottom sheet on phones): name, prefix, pricing mode,
  selection rules, PDF template blocks, accent and logo (standard quote template editor pattern), one default. Add to `settingsMenu.ts`.
