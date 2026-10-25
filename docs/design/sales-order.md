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
5. **Pricing mode is a company decision per order type, not a switch on the order.** The order type says Internal (price list and pricing engine) or External (supplied by the ERP, read-only). An order always uses its type's mode; an order made from a quote uses that quote's mode, so a quote priced internally gives an internally priced order. No Internal/External toggle on the order or the quote. The order shows one quiet line saying which it is. Line level: unit price, discount, tax and line total are primary columns; each line also has **printed text** that appears on the PDF.
6. **PDF, email, WhatsApp, links.** PDF per order type (rule 11); Email and WhatsApp buttons on the record through the existing senders, logged; quote and order link both ways, shown in the Linked documents strip.
7. **Document flow.** An order is created from: a Standard Quote or Quotation (accepted), a Deal, a Lead, an incoming email (shared inbox "Create order"), another order (copy), or directly. `source_type` and `source_id` are stored and shown.
8. **AI by default.** Assistant reads orders; `create_record` card for "create an order for X from quote Y" (or deferral reason recorded); Talk to data source; analytics (orders by status, value, fulfilment, late promises); global search; ⌘K "New order"; briefing facts ("3 orders short on stock"); `data-guide` ids on every control.
9. **ERP.** Entity row `sales_orders` in D365 and SAP (inbound with watermark, status back, webhook for near-real-time); ERP checks (credit, price, tax, ATP) as connector calls with Passed / Warning / Failed chips; origin `erp` is read-only; origin `bpmsquare` locks when the ERP accepts it. Config only on the middleware page.
10. **Change log.** `logChange` on every mutation, object in the history filter, actor as a name, "via integration" when the ERP changed it.
11. **Order types.** `sales_order_types` (data, edited in Settings): name, numbering format, default statuses and required fields, custom fields, PDF template (block list, accent, logo position, same mechanism as `0054`), default pricing mode, default ERP order type, and any customer attribute that selects it (for example customer group or region picks the type). A workspace can have several; the order shows its type as a chip. Settings has one screen: a table of types, a row opens a side panel (6c pattern 4).
12. **Visual record page** (mock-ups v1 and v2 shown to the owner in chat; v2 is the direction):
    - **Tabs:** Overview, Lines, **Availability** (ATP and lead times), ERP, Documents, History (`useUrlTab`).
    - **Overview:** basic customer info (name, contact, bill-to and ship-to in two lines), the journey strip (Draft, Sent, Submitted, Delivered, Invoiced, Paid) as one segmented bar replacing a status dropdown, check chips under it (Credit, Price, Stock), the total with its one-line breakdown, and customer / delivery / terms collapsed.
    - **Availability:** per line, requested quantity and date against confirmed quantity and date (the SAP schedule-line idea). Source is shown on each row: **ERP** (read-only, with the time it was fetched) when the order is replicated or checked in the ERP, otherwise **master data** (stock on hand from inventory, lead time from the product, a promise date computed from both, labelled an estimate). One tab, one rule, no bars elsewhere.
    - **Lines:** a real line table with unit price, discount, tax and line total per line, and an expandable **Printed text** per line for the PDF. No fulfilment bars: they only mean something when the ERP data is available, so that information lives in the ERP tab.
    - **ERP:** deliveries and invoices (number, date, amount, status) read from the ERP, with "last synced" and a Refresh; shown only when the connection returns it; nothing editable.
    - **Documents:** the linked-documents flow (email, quote, order, deliveries, invoices), each a link.
    - Phone: tabs scroll, blocks stack, the journey strip stays one row.

## Final design (v3 mock-up, owner delegated the combination 2026-10-23)

The best of each system, in BPMSquare's own shape:
- **From SAP:** a **Check with ERP** step before sending (Simulate: price, credit, availability, nothing saved) and a separate **Send to ERP** (Transfer) with a transfer log on the ERP tab; availability as **schedule-line pairs** (asked and wanted-by against confirmed and date); availability marked **stale** when quantities change until checked again; delivery and billing sub-status next to the main status; a **document flow** graph.
- **From Dynamics:** few, clear actions (Check, Send, PDF, Email, WhatsApp); deliveries and invoices as plain related records; partial fulfilment shown as "1 of 2".
- **From Salesforce:** the **path** across the top (Draft, Sent, Submitted, Delivered, Invoiced, Paid) and a hub of linked records (Documents tab).
- **BPMSquare's own:** one quiet pricing line (no toggle), source tags on every ERP-fed value (ERP read-only with fetch time, or Master data estimate), printed text per line, order types with their own PDF design, everything AI-ready.
- **The path sits at the very top of the page, above the order id, and stays on every tab** (owner, 2026-10-23); delivery and billing sub-status sit just under it, right-aligned.
- **Overview is lean (owner, 2026-10-23, after challenge):** Sold to and Bill to (merged into one block when they are the same), Ship to, then three facts: **Total incl. VAT**, **Expected delivery** (the latest confirmed date across lines, tagged with its source) and **Customer PO** (number plus file count). Nothing else. Check results (credit, price, stock) are **not shown as chips**: they live on the ERP tab with their time, and surface on Overview only as one "needs attention" banner when something fails or a line is late (a blocker stays visible, a pass stays quiet; rule 6b).
- **Tabs:** Overview, Lines, Availability, ERP, **Documents and files** (plus History).
- **Documents and files:** a swimlane document flow (email, quote, order, then deliveries each followed by their invoice, curved connectors, a status dot and amount per box, dashed for planned, every box opens its record) and a **Files and links** area under it: upload files and add links, each typed (Customer PO, Drawing, Other) with who and when. Attachments follow the same storage and tenant rules as other record attachments (verify the existing mechanism before building; if none exists it is one small table plus a private bucket path per tenant). Mobile: tabs scroll, blocks stack.

**Choices made without the owner (revisit if wrong):**
- **Order-type selection:** an ordered list of rules per workspace (customer group, region, source quote type); the first match wins; otherwise the default type; the person can always change the type on a draft.
- **Lead time:** a `lead_time_days` product custom field (products have none today). Master-data availability = stock on hand now, else today + lead time, labelled an estimate.
- **Fetched invoices** are display-only on the order for now.
- **Stale rule:** editing quantity, date or lines on a draft marks previous check results stale; Send to ERP re-runs the check automatically.

## Decisions made by the owner (2026-10-23)

- Draft orders can be deleted; once sent, never.
- Anything that comes from the ERP is read-only here. An order sent from BPMSquare is read-only here once the ERP accepts it, the same way a Cloud for Customer order is read-only in C4C once transferred.
- Overview carries basic customer info; a dedicated Availability tab holds ATP and lead times (ERP data when replicated, else master data).

## How others do it (research, schematic visuals shown in chat)

- **SAP ECC (VA01/VA03):** header plus item grid in tabs; each item has Conditions (pricing) and **Schedule lines** (requested vs confirmed quantity and date) where the availability check shows; short stock opens delivery proposals; Document flow as a tree. Steal: schedule-line pairs for the Availability tab, document flow with per-document status.
- **SAP S/4HANA Fiori and Sales Cloud V2 / C4C:** header facets with separate overall, delivery and billing statuses; a Process flow graph; **Simulate** (pricing, ATP, credit, nothing saved) then **Transfer**; the ERP order id written to External ID; transfer, pricing and cancellation statuses with logs; delivery and billing data flow back; ATP is cleared when the quantity changes until simulated again; all follow-up (delivery, billing) runs in the ERP. Steal: Simulate before Send ("Check with ERP"), separate delivery and billing statuses, ATP invalidated on edit, a transfer log.
- **Dynamics 365 Sales:** command bar (Submit, Fulfill, Create invoice, Cancel), one status field (Active, Submitted, Fulfilled complete/partial, Invoiced, Canceled), Invoices as a related list; ATP lives outside the order. Steal: few clear actions, partial fulfilment as a reason, invoices as related records.
- **Salesforce:** a path (Draft, Activated, then fulfilment states), Order Products and related lists (fulfilment orders, invoices, payments, shipments), and an Order Summary rollup; Activate locks the lines. Steal: the path across the top (our journey strip) and the hub-of-linked-records idea (our Documents tab).
- Common to all of them: pricing, ATP and credit are asked of the system of record at a defined moment (simulate or save), the order is locked after the transfer, and the follow-up documents come back as read-only records. That is the model chosen here.

## Statuses

Stored as the ERP's label plus a spine (open / in progress / completed / cancelled) for the status engine. BPMSquare adds only `Draft` before the order exists in the ERP. The D365 salesorder state and status codes beyond Active are **verified on the trial org before building**.

## Locking, in one helper

`orderEditable(order)`: false when `origin = erp`, or when a `connector_links` row exists (the ERP accepted it), or when status is past Draft. PATCH, UI and API all call it. The same `origin` convention is reusable for invoices and POs.

## ERP follow-up: deliveries and invoices after the order is sent

**What exists:** scheduled pull jobs (`/api/connectors/cron/dynamics365` hourly, `sap_s4` hourly) that pull customers, vendors and products by watermark, the Resync tab, `connector_links`, the Monitor tab. **What does not:** any entity for orders, deliveries or invoices, so today nothing fetches an invoice after an order is sent.

**Plan:** add three inbound entities to the connectors, each linked to the order by the ERP's own order reference (stored in `connector_links` when the ERP accepts it): `sales_order_status` (header state and status), `deliveries` (D365 Dataverse and F&O shipments or packing slips; SAP outbound deliveries) and `invoices` (customer invoices with amount, due date, paid state, and their payments). Two ways in, both configured only on the middleware page:
1. **Follow-up job:** every cycle, for orders sent and not yet closed, ask the ERP for their related documents (a lookup by order id, so cost grows with open orders, not with the whole ERP). Closed orders drop out of the job.
2. **ERP webhook:** the ERP calls the workspace's inbound endpoint on a status, delivery or invoice change, for near-real-time updates; the job stays as the safety net.
Stored as read-only rows (`erp_documents`: order, kind, number, date, amount, status, raw reference), shown on the ERP tab and rolled up into the journey strip (Delivered, Invoiced, Paid). A Refresh button runs the same lookup for one order. The exact D365 tables and fields (Dataverse `invoice.salesorderid`, F&O packing slip and customer invoice journals) and the SAP document flow are **verified on the trial orgs before building**. Customer invoices fetched this way are shown against the order; creating BPMSquare invoices from them is a separate decision.

## Phasing

SO1 object, types, PDF, send, link to quote, lock rule, 3b surfaces. SO2 D365 replication in, status back, ERP tab (deliveries, invoices) and the follow-up job. SO3 ERP checks and send. SO4 SAP both ways.

## Open for the owner

Order-type attributes that should auto-select a type (customer group? region? quote type?); whether Draft orders may be deleted; whether an order can be created without a quote for every customer or only for those with an account.

## SO2 (decided 2026-10-24): Dynamics 365 orders in, invoices and deliveries as read-only ERP documents

Scope of what can be built and proven on the owner's trial (Dataverse Sales Premium; the Finance trial has no environment, so F&O is untested):
- **Orders in:** a new inbound entity `sales_orders` on the D365 connector (`salesorders` with `order_details` lines expanded), idempotent through `connector_links`,
  written to `sales_orders` as `origin = 'erp'` (read-only through `orderEditable`), customer matched to an Account through its linked external id, lines copied as
  read-only lines, order number shown as the ERP number. Status is stored as the ERP's own label (OData formatted value of `statuscode`) plus a spine from
  `statecode` (0 Active = in progress, 1 Submitted = in progress, 2 Canceled = cancelled, 3 Fulfilled = completed, 4 Invoiced = completed); no exact status
  code table is assumed, labels come from the organisation.
- **Status back for orders BPMSquare sent:** the follow-up job refreshes `sales_orders` whose `connector_links` row exists (status, totals, ERP number) and rolls the
  journey strip forward (Submitted, Delivered, Invoiced, Paid).
- **ERP documents:** table `erp_documents` (tenant, order, kind `delivery|invoice`, ERP number, date, amount, currency, status, raw reference id, fetched_at), read-only,
  service-role writes only. Dataverse invoices (`invoices` with `_salesorderid_value`: `invoicenumber`, `totalamount`, `duedate`, `statecode` 0 Active / 1 Closed / 2 Paid /
  3 Canceled) are fetched per order and in the follow-up job; the delivery kind is written only when a connector returns it (F&O packing slips and SAP deliveries are SO4).
- **ERP tab:** deliveries and invoices tables with "last synced" and Refresh (same lookup for one order), nothing editable, empty states that say what is connected.
- **Middleware page:** Links row "Sales orders" (inbound, off by default, `When` = schedule), Resync supports it, messages appear in the Monitor with the ERP number.
- **Webhook:** inbound ERP endpoint `POST /api/middleware/webhook/sales-order` (signed with the workspace's existing webhook secret machinery) triggers the same refresh for one order id.
SO3 follows: ERP checks (Check with ERP: price, credit, availability, nothing saved) and Send to ERP with a transfer log.

### SO2 built (2026-10-24)

- **Where it lives:** `src/lib/connectors/d365/orders.ts` (pull, refresh, follow-up), `orderMap.ts` (pure mapping), `src/lib/salesOrders/erpDocs.ts`, migration `0216` / bundle 27, `POST /api/sales-orders/[id]/erp-refresh`, `POST /api/middleware/webhook/sales-order`.
- **Webhook credential:** the workspace's existing ERP webhook secret (Settings > Integrations). The ERP signs the raw body the same way BPMSquare signs what it sends: `X-BPMSquare-Signature` = hex HMAC-SHA256. The tenant is the request host's, never the body's; anything that fails to verify is a bare 401.
- **Cron:** no new entry. The hourly Dynamics 365 cron pulls `sales_orders` when its entity is on and runs a bounded follow-up (25 orders per workspace, least recently checked first) for open linked orders. With the pull off it follows only orders made here that an ERP accepted.
- **Unverified on a live org:** the `$expand=order_details,transactioncurrencyid` query, the formatted-value annotations, the invoice `_salesorderid_value` filter and the deep link to an invoice. An environment that refuses the expand is read with lines per order. Deliveries are never written (Dataverse Sales has no shipment record; F&O and SAP are SO4).

## SO3 (decided 2026-10-24): Check with ERP, then Send to ERP

Reuse, do not rebuild: `sendDataverseSalesOrder` (`src/lib/middleware/erpOrder.ts`, idempotent through the BPMSquare marker and `connector_links`), the dispatch and Monitor
machinery, `ErpHttp`, the Links/Monitor pages and the SO2 `erp_documents`/refresh. Scope for the Dataverse trial (Sales Premium); SAP is SO4.
- **Check with ERP** (button on the ERP tab and in the send confirmation; **nothing is saved in the ERP**): three read-only checks, each returned as Passed / Warning / Failed with a
  one-line reason and the time it ran, stored on the order (`sales_order_checks`: order, kind `credit|price|stock`, status, message, checked_at, quantity_hash of the lines it
  was run on): **Credit** (the account's `creditonhold` and `creditlimit` against its open ERP orders plus this order); **Price** (each line's unit price against the product's
  list price in the ERP price list; a difference is a Warning, not a failure, since negotiated prices are normal); **Stock** (each line's quantity against the product's
  `quantityonhand` in the ERP, with the ERP's figure shown per line on the Availability tab, labelled **ERP**, which replaces the master-data estimate for that order).
  A customer or product not linked to the ERP gives Warning "not in the ERP yet", never a crash. A check goes stale (chip says "Out of date, check again") when lines,
  quantities or the customer change after it ran (compare `quantity_hash`). Field names are the standard Dataverse ones; every call is tolerant of a missing field and says
  which check could not run and why.
- **Send to ERP** (explicit, separate from the check): disabled with the reason until the order is Submitted-ready (customer linked, at least one line); warns (does not block) when a
  check is Failed, Warning or stale and asks to confirm; calls `sendDataverseSalesOrder` with the order's lines (write-in lines as for quotes), writes the `connector_links` row
  (direction `push`, the ERP order id and number), flips the order to Submitted (status label from the ERP), which locks it through `orderEditable`, writes the transfer log, and
  triggers the SO2 refresh. Second press while linked is a 409 with the ERP number; a failed send leaves the order editable and shows the step that failed (create, find) with Retry.
- **Transfer log:** one row per attempt on the ERP tab (time, who, result, ERP number or the step and message) and the same message in the Monitor (kind `Sales order`, direction out).
- **Permissions and safety:** both actions need the Sales Orders edit permission and the connector; tenant from the session; the order id is verified with `tenant_id`; the demo
  workspace follows the existing demo send rules of the middleware (it already points at the owner's trial, not a customer system).
- **Surfaces (3b/3c):** change log entries ("sent to ERP", "checked with ERP", via the person), assistant action "Check this order with the ERP" as a confirm card (read-only checks) and
  "Send order to ERP" as a confirm card, v1 API read of checks on the order, capability facts regenerated, guide ids on every control, 375 px layout.

### SO3 built (2026-10-24)

- **Where it lives:** `src/lib/salesOrders/erpChecks.ts` (pure comparisons, fingerprint, confirm rule), `erpChecksServer.ts` (run and store), `erpSend.ts` (send, claim, transfer log), `erpState.ts`, `erpContext.ts`; the Dataverse reads are `src/lib/connectors/d365/checks.ts` (GET only). Routes `POST /api/sales-orders/[id]/erp-check` and `/erp-send`; the order view carries `erp_checks`, `erp_transfers`, `erp_send_blocker`, `erp_available`. Migration `0217` / bundle 28.
- **Statuses:** credit failed = on hold or over the limit, warning above 90 percent; price is a Warning for a difference (never Failed); stock Failed when a line asks for more than the ERP has on hand. Unlinked customer or product = Warning; an ERP that cannot be read = Not run with the reason; a free-text line is skipped.
- **Send:** a check that is not a current pass is listed and needs `confirm: true` (409 `needs_confirmation` without it). The order's link is claimed (`pending:<uuid>`) before the ERP call; a failure before the ERP made anything gives it back, so the order stays editable. Status becomes Confirmed with the interim word "Submitted", then the SO2 refresh replaces it with the ERP's own wording.
- **Deferred:** the assistant verbs "Check this order with the ERP" and "Send order to the ERP" (the registry holds creates only; see `DEFERRED_VERBS`). The assistant reads the results through Talk to data (`credit_check`, `price_check`, `stock_check`). Saved mapping documents do not apply to sales orders; the preset sales order maps are used. SAP is SO4.
- **Unverified on a live org:** the Dataverse names `accounts.creditonhold/creditlimit`, `salesorders._customerid_value` with `statecode` 0/1 and `totalamount`, `productpricelevels` (`_pricelevelid_value`, `_productid_value`, `amount`), `products.price` and `products.quantityonhand`, and that the order create succeeds with the lines as built here. Open orders are summed without currency conversion.

## SO4 plan (2026-10-24): SAP both ways, and organisation by value mapping

**What exists:** the SAP S/4HANA connector pulls business partners and products only (`API_BUSINESS_PARTNER`, `API_PRODUCT_SRV`; demo workspace uses the SAP API Business Hub sandbox).
SO2 gave Dynamics orders in and invoices; SO3 gave Check with ERP and Send. SAP has none of these yet. Dynamics F&O deliveries stay untestable (no environment).

**Organisation (owner question 2026-10-24, "can we use value mapping for coverage and org mapping?": yes).** No new org layer and no copy of the ERP tree.
- Two new **value list kinds** on the Mapping tab (the existing two-column table, BPMSquare value | ERP code): **Sales area** (SAP: one combined code `ORG/CHANNEL/DIVISION`, e.g. `1000/10/00`, optional sales group and office as extra segments) and **ERP company** (Dynamics company or business unit, Business Central company).
- Lists are keyed by **coverage** (and by **order type** where an order type needs its own): the order's coverage resolves through `resolveCoverageForAccount` (owner coverage), the connector looks the ERP code up at send and check time. No row = the connector's default (a clear "No sales area for coverage X" warning on the check, never a silent default). Reverse lookup (inbound row marked "In") sets the coverage of an ERP-origin order.
- Optional read of the account's own sales area (SAP `A_CustomerSalesArea`) onto the account so a segment rule can use it (a field in the Account 360 / segment field list); off by default.
- Valid-code pick-lists from the ERP (SAP `A_SalesOrganization`, `A_DistributionChannel`, `A_Division`; Dataverse `businessunits`) as an optional drop-down in the list editor; typing stays possible.
- Settings stays one place: the Mapping tab; Coverage and Order types only show the resulting ERP code as a read-only chip.

**SAP in (SO4a):** orders `API_SALES_ORDER_SRV` (`A_SalesOrder` with `to_Item`), deliveries `API_OUTBOUND_DELIVERY_SRV` (`A_OutbDeliveryHeader`, items), billing `API_BILLING_DOCUMENT_SRV` (`A_BillingDocument`, status paid/open from the accounting status) as `erp_documents` (kinds delivery and invoice, both now written), status spine from overall status (`OverallSDProcessStatus`, delivery and billing sub-statuses), same idempotency, follow-up and webhook path as SO2. A new entity `sales_orders` on the SAP connector, Links row, Resync, Monitor message.
**SAP checks and send (SO4b):** **Check with ERP** through the sales order simulation (`API_SALES_ORDER_SIMULATION_SRV`: price and availability per line, credit as the simulation's own result or the credit exposure read where available), mapped to the same Credit / Price / Stock rows; **Send** as `POST A_SalesOrder` with the sales area from the value list, customer from the link, material from the product link, plant from the product's default, requested date and PO number; the SAP order number is written to the link; transfer log as for Dynamics.
**Dynamics:** the company/business unit value list is read at send; deliveries remain empty until F&O is connected.
**Proof:** the SAP sandbox allows reads; writes are tested against a scripted fake (`fakeS4.ts`) and the real service names are verified from the connected system's `$metadata` at connect time (the connector refuses a send, with the reason, when a required service or field is missing). Never assume a field name that `$metadata` does not list.
**Not in SO4:** SAP credit management (FSCM) beyond what the simulation returns, partial deliveries and returns, pricing condition editing, EWM.

### SO4b built (2026-10-25): SAP S/4HANA both ways

- **Seam, not a copy.** `src/lib/salesOrders/orderConnector.ts` is the interface (`open` -> a session with `check` and `send`, `refresh`, `sendBlocker`, the customer and product link lookups). Dynamics 365 (`connectors/d365/orderConnector.ts`) and SAP (`connectors/sap_s4/orderConnector.ts`) implement it; `erpSend.ts`, `erpChecksServer.ts`, the Refresh route and the webhook call the seam. The shared writers moved to `salesOrders/erpOrderWrite.ts` (`applyOrder`, `mirrorDocuments`) and the follow-up choice to `salesOrders/erpFollowUp.ts`; the Dynamics tests passed unchanged. Which ERP an order goes to: the one that holds its link, else Dataverse, else SAP. A workspace with both connected sends new orders to Dynamics (a per-workspace choice is deferred).
- **In (`sap_s4/orders.ts`, `orderMap.ts`).** Entity `sales_orders` on the SAP connector (off by default; Links row, Resync by number, Monitor "Sales order <number>", hourly cron + follow-up). `A_SalesOrder` with `to_Item` and the items' `to_ScheduleLine` (the expansion falls back to `to_Item` and then to a per-order item read when the system refuses it), incremental on `LastChangeDateTime`, idempotent through `connector_links` and the content hash, customer through the business partner link. Status label = SAP's overall word (A Open, B In process, C Completed, rejected C = Rejected) plus "Delivery open|partly|complete" and "Billing ..." where the system gives them; the spine is open / in progress / completed / cancelled. What SAP can confirm per item (schedule lines) becomes the line's ERP availability (`availability_source = erp`).
- **Documents.** Deliveries: `A_OutbDeliveryItem` filtered on `ReferenceSDDocument = the order`, then `A_OutbDeliveryHeader` -> `erp_documents` kind `delivery` (goods issued = delivered). Billing: `A_BillingDocumentItem` on `SalesDocument` / `ReferenceSDDocument` (the order, and its deliveries), then `A_BillingDocument` -> kind `invoice` (cleared = paid, cancelled). Before reading, the connected system's own `$metadata` is asked whether the linking property exists; if not the refresh says which property of which service is missing and still writes the other kind.
- **Check with ERP = `POST A_SalesOrderSimulation`** (nothing is saved in SAP): price per item (net per unit against the line's net), the quantity ATP confirms (sum of `ConfdOrderQtyByMatlAvailCheck`; "N asked, M confirmed"), credit from `to_Credit.TotalCreditCheckStatus` (A passed, D passed, B failed, C warning, unknown code warning, no result = Not run "SAP credit exposure is not read yet."). No sales area for the coverage = the Warning "No sales area is mapped for this customer's coverage." on all three rows and no call to SAP.
- **Send = `POST A_SalesOrder`** with a deep insert (`SoldToParty`, `SalesOrganization` / `DistributionChannel` / `OrganizationDivision` / `SalesGroup` / `SalesOffice` from `parseSalesArea`, `PurchaseOrderByCustomer`, `RequestedDeliveryDate`, items with `Material` and `RequestedQuantity`). CSRF: one GET of the service root with `x-csrf-token: Fetch`, the token and the session cookies sent back, fetched again once if SAP calls the token expired; a write is never repeated. A free-text line or a product SAP does not know is refused with the line named, before SAP is called. One order is one SAP order: the link is claimed first (as for Dynamics); the order is found again by its marker before create (the ref in `AccountingDocExternalReference` when the system lists it as writable, else the ref is the PO when the customer gave none) and after a create that timed out (the PO match on the customer, created since yesterday; two matches are never adopted). The order type is SAP's standard `OR` (mapping a workspace order type to a SAP type is deferred).
- **No migration.** It reuses 0216 (`erp_documents`, ERP columns) and 0217 (checks, transfers); until those run the Sales orders row says "A database update is needed first".

**Property names: what is verified and what is assumed.** Markers in `orderMap.ts`: [verified-response] seen in a real `A_SalesOrder` response (SAP-samples/s4hana-ext-geo-report-app, `A_SalesOrder('69').json`, a 2017 release): header `SalesOrder, CreationDate, LastChangeDateTime, PurchaseOrderByCustomer, TotalNetAmount, TransactionCurrency, SalesOrderType (OR), RequestedDeliveryDate, SalesOrganization, DistributionChannel, OrganizationDivision, SalesGroup, SalesOffice, SoldToParty, OverallSDProcessStatus, TotalCreditCheckStatus, OverallTotalDeliveryStatus, OverallSDDocumentRejectionSts`; item `SalesOrderItem, Material, RequestedQuantity, RequestedQuantityUnit, NetAmount, SalesOrderItemText, SDProcessStatus, DeliveryStatus, OrderRelatedBillingStatus`; links `to_Item, to_ScheduleLine`; type names `A_SalesOrderType`, `A_SalesOrderItemType`. [verified-simulation] listed in the generated client of `API_SALES_ORDER_SIMULATION_SRV` (ballerinax/sap.s4hana.api_sales_order_simulation_srv 2.1.0): the simulation header (including `AccountingDocExternalReference`), `to_Item`, `to_Credit.TotalCreditCheckStatus`, `to_Pricing.TotalNetAmount`, the item `NetAmount` / `TaxAmount`, the schedule line `ConfirmedDeliveryDate` / `ConfdOrderQtyByMatlAvailCheck` / `RequestedDeliveryDate`. **Assumed from SAP's published documentation (never required, read only when the row or the system's `$metadata` has them):** everything of `API_OUTBOUND_DELIVERY_SRV` and `API_BILLING_DOCUMENT_SRV` (the entity sets, `ReferenceSDDocument`, `SalesDocument`, `OverallGoodsMovementStatus`, `ActualGoodsMovementDate`, `InvoiceClearingStatus`, `BillingDocumentIsCancelled`, `TotalGrossAmount`, `NetDueDate`), `OverallDeliveryStatus` and `OverallOrdReltdBillgStatus` (named in a community post, not seen in a response), the meaning of the credit status letters, the `A_SalesOrderItem` entity set, the expansion path `to_Item/to_ScheduleLine`, that the order's schedule line carries the simulation's property names, that the simulation needs no `SalesOrder` key in the body, that `AccountingDocExternalReference` is writable on `A_SalesOrder` (used only if the system says so), and that the customer number equals the business partner number. The checked-in fixtures (`sap_s4/metadataFixtures.ts`) contain only the [R] and [S] names for the two order services; the delivery and billing fixtures are marked [D].
- **Proof.** `fakeS4.ts` now serves the four services, hands out and checks the CSRF token and cookies, and can time out a create before or after writing it. Not provable without a real SAP system: every real response shape above, SAP's own error texts, whether the deep insert is accepted as an array, units of measure (the item unit is left out so SAP uses the material's), and the size of the real `$metadata` documents.
