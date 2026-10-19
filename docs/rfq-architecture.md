# RFQ — supplier request for quotation, end to end

> Status: **built 2026-10-15 (phase 1 + in-app email), migration 0128
> pending.** Owner decisions 2026-10-14/15 that changed the proposal below:
> RFQ is a standard object behind its own flag (`rfq`, not `sourcing`), raised
> wherever a cost or price is missing (not only quotes), and the supplier
> conversation -- sending AND receiving -- lives inside the tenant, with the
> mail channel a per-tenant choice (own mailbox or BPMSquare's). Sections 1-9
> are the original analysis; section A is what was actually built.

## A. As built (2026-10-15)

**Object.** `rfqs` (RFQ-####, continues the legacy `pricing_rfqs` numbers),
`rfq_lines` (product optional), `rfq_suppliers` (one per supplier, own reply
link nonce), `rfq_responses` (one price per supplier per line),
`rfq_messages` (the conversation), `rfq_mailbox_state` (poller cursor).
Select-only RLS; all writes in `src/lib/rfq/server.ts` + routes, every query
tenant-filtered. Pure rules (status derivation, lowest price, input
cleaning) in `src/lib/rfq/rules.ts`, tokens in `src/lib/rfq/token.ts`, both
unit-tested (`rfq.test.ts`).

**Where it starts.** RFQ screen (`/rfqs/new`); "Request quotation (N)" on the
shared quote/deal line editor (lines needing a cost or with no rate; each line
remembers its `rfq_line_id` across saves, chip shows "RFQ-0012 · 1/3" then
"Awarded -- re-price"); the engine's Needs-RFQ button (now creates a full RFQ
when the module is on); a request-quotation card on cases, inspection reports,
work orders and standard quotes. Fence projects: deliberately no card -- the
configurator is chromeless and its priced lines land on a Standard Quote,
which has one. Quotations (design partner's object): unchanged UI; its
Needs-RFQ button benefits from the new object when the flag is on.

**Mail channel** (Settings -> RFQ, `config.rfq.mail_mode`):
- *mailbox*: send over SMTP from the tenant's Gmail (App Password) or the new
  **Mail server (SMTP/IMAP)** connector; `/api/rfqs/cron/mailbox` reads new
  inbox mail every 5 minutes (bounded per run, UID cursor per mailbox,
  least-recently-polled first) and files replies by In-Reply-To, then the
  subject tag `[RFQ-0012 · code]`, then sender + ref.
- *platform*: Resend sends; each supplier's reply-to is
  `rfq-<id>-<code>@INBOUND_EMAIL_DOMAIN`; Resend's receiving webhook posts to
  `/api/inbound/email/resend` (Svix-verified), and `/generic` takes any
  relay's signed JSON. The address alone routes the message.
- Both: every send through `resolveOutbound()`; an attached Excel reply sheet
  (hidden line ids) is read straight into prices when it comes back; the
  signed no-login reply page `/rfq-reply/<id>/<token>` (tenant host only,
  nonce-revocable, per-recipient submission cap) takes prices, files and
  questions; WhatsApp is a share of the same link.

**Award.** Per line or all-to-one-supplier; foreign currency asks for the
rate; the award writes one confirmed `pricing_cost_inputs` row (source RFQ)
for a catalog product, so the next Price uses it -- margin is the engine's,
never the RFQ's.

**Surfaces wired (§3b):** flag + workcenter + nav + `OBJECT_FEATURE`; custom
fields; change history; global search; Nova comments/inbox/click-through and
timeline; ⌘K "New RFQ"; Data Workbench export + update (import deliberately
excluded); v1 `GET /api/v1/rfqs[/id]` (explicit scope only); MCP
`list_rfqs`/`get_rfq` (1.8.0); dashboard + reports metric `rfq_open`; demo
seed `scripts/seed-rfq-demo.sql`.

**Added the same day (2026-10-15, "go further"):**
- **Awards -> purchase orders** (0130): one draft PO per awarded supplier,
  at the awarded cost, each PO line remembering its response so nothing is
  ordered twice. Needs `purchasing` + Purchase Orders edit.
- **Supplier suggestions** from the tenant's own RFQ history (won / quoted /
  asked for these products), pre-ticking past winners.
- **"Read prices with AI"** on any supplier reply (PDF, Excel/CSV, JPG/PNG
  or email text): Claude Opus 5.5 with a JSON-schema-constrained answer
  proposes prices per known line id; the buyer's Enter-reply form opens
  prefilled with the AI's notes, nothing is saved until they confirm.
  Supplier content is treated as data, never instructions.
- **RFQ PDF**: rendered once per send (no customer, prices or supplier
  names) and attached to every request email (Settings -> RFQ toggle), plus
  a PDF button for the buyer. The headless browser may load only data: URIs
  and the storage host.

**Preferred supplier on products (0132):** a product carries one preferred
supplier (`products.supplier_id`, set on the product, in Data Workbench by
supplier name, or via the API). The RFQ's current-supplier ranking uses it
first, ahead of past awards and purchase orders. It is internal: never in the
v1 API, `/ask` or MCP.

**Still not built:** several approved suppliers per product (Piece G, a
`product_suppliers` table), a
Microsoft 365 mailbox (OAuth), supplier performance analytics.

## 0. The answer in five lines

1. An RFQ object **already exists** (`pricing_rfqs`, ref `RFQ-####`), but it covers one product and one supplier. It sends plain text, the reply is keyed in by hand, and the quote line never learns what happened.
2. **Yes: make RFQ a first-class sourcing object.** It needs a header with lines, one or many suppliers per RFQ, a reply per supplier per line, and an award per line. The award writes the cost the pricing engine already knows how to use, and the PO is created from the award.
3. **Channel:** email from our server (through `resolveOutbound`) with an RFQ PDF, an Excel reply sheet and a **signed no-login reply link**. WhatsApp is a "copy message" share of the same link. Replies arrive through the link, or the buyer keys them in or uploads them. Inbound-email parsing comes later.
4. **The quote line remembers its RFQ** through a persisted `rfq_line_id` (line contract). The supplier's price is a **cost**. The engine turns it into a sell price on the next Price, and the rep confirms, as everywhere else ("propose, never silently decide").
5. **Nothing is Big Blue-specific in code.** Their defaults live in `tenants.config.rfq`. No `src/extensions/bigblue` is needed for phase 1.

---

## 1. Current state (what is real vs a label)

### 1.1 Where "needs RFQ" comes from
- The cost-based Price Book walks a **source ladder**: ERP cost (30 d), then RFQ reply (180 d), then price list (365 d), then manual (`docs/pricing-engine-architecture.md:674-676`, `src/lib/pricing/wizard.ts:141`). When no rung has a figure in force, the core throws a needs-cost error (`src/lib/pricing-core/calc.ts:435`).
- `priceDocumentLine()` maps that error to `{ ok:false, needs_rfq:true, missing, product, message }` (`src/lib/pricing/quoteLine.ts:110-119`). Both pricing routes pass it through: `api/quotes/price-line` and `api/pricing/price-lines/route.ts:46-47`.
- **Consequence:** only a **catalog product** line priced by a **cost-based** Price Book can ever become "Needs RFQ". A free-text line (an engineered one-off on a drawing) and a catalog-formula line never do.

### 1.2 What the rep sees and can do
- Standard Quotes and deal lines use `src/components/sales/DocumentLinesEditor.tsx`. Quotations use the mirrored `quotations/new/QuoteForm.tsx:901-907`.
- The chip "Needs RFQ" opens an inline form: pick **one** supplier and add an optional message (`DocumentLinesEditor.tsx:523-547`). Send calls `POST /api/pricing/rfqs`. The chip then reads "RFQ sent" or "RFQ draft" (`:471-473`) with the hint "Price again once the reply is entered under Pricing → RFQs" (`:552`).
- **The chip is client state only** (`linePricing`, `:202`, set at `:417-422`). Nothing on the line is saved, so a reload loses it. On top of that, Standard Quote saves delete and re-insert every line with fresh UUIDs (`api/standard-quotes/[id]/route.ts:190`, `resolveLineIdsAndSelection` in `src/lib/pricing/quoteLineFlags.ts:166-169`). No line id is stable enough to link to today.

### 1.3 The record and the send
- Table `pricing_rfqs` (`supabase/migrations/0113_pricing_cost_based.sql:69-104`) has one `product_id` (not null), one `supplier_id`, `quantity`, `uom`, `status` (draft/sent/replied/cancelled), `sent_to`, `message`, and the reply fields (`reply_value`, `reply_currency`, `reply_valid_from/to`, `reply_note`). It also holds `cost_input_id` and back-references `quote_id`, `standard_quote_id` (0114:23-24) and `opportunity_id` (0120:93). RLS is select-only, and writes go through service-role routes (0113:101-104). The ref is `RFQ-####` via `MASTER_REF_TABLES` (`src/lib/masterRef.ts:11,22`).
- `POST /api/pricing/rfqs` (`src/app/api/pricing/rfqs/route.ts:49-140`) verifies product, supplier and quote ids against the tenant, inserts the record and sends immediately.
  - **Bug:** the editor sends `opportunity_id` (`DocumentLinesEditor.tsx:410`), but the route never reads it (`route.ts:61-65`), so deal-line RFQs lose their back-reference.
- `sendRfqEmail()` (`src/lib/pricing/rfqServer.ts:14-68`) works like this:
  - Recipient: the **single** `suppliers.email` (suppliers have no contact persons; `src/lib/types.ts:808-823`).
  - Template: the tenant's `rfq` template, or the default "please quote your best price and lead time" text with product, quantity and ref (`src/lib/emailTemplates.ts:55-58`).
  - Format: **plain text, no PDF, no attachment, no response link**.
  - Routing: through `resolveOutbound()` (good), with `replyTo` = the tenant's `company_info.email` (`:51`). **The supplier's answer therefore lands in the tenant's own mailbox, outside BPMSquare.**
  - Logging: `email_log` kind `rfq`. Those rows are currently rejected until migration 0125 is applied (`PROJECT.md:538-551`, pending on both DBs).

### 1.4 The reply
- Pricing → RFQs (`src/app/(app)/pricing/rfqs/RfqsClient.tsx`) lists the RFQs. Someone with **pricing-workcenter edit** clicks "Enter reply" and types a unit price, currency and validity (`api/pricing/rfqs/[id]/route.ts:84-129`).
- The reply is upserted as a **confirmed, product-scoped `pricing_cost_inputs` row, source `RFQ`** (`:96-107`). The next "Price" on any quote for that product picks it up through the ladder, and the trace says "from supplier RFQ reply, confirmed, as of …" (`src/components/pricing/PriceTrace.tsx:24`).
- **Not done:** the originating quote line is not updated, the rep is not notified ("Price the line again to use it", `RfqsClient.tsx:54`), and suppliers cannot be compared.
- **Latent bug:** two suppliers replying for the same product on the same day collide on the cost-input natural key `(tenant, model, path, source_key=RFQ, product_key, valid_from_key)` (0113:49-50). The second reply silently overwrites the first.

### 1.5 What an RFQ would connect to
| Piece | Today | Gap for RFQ |
|---|---|---|
| Suppliers | `suppliers` (name, type, city, phone, email, gstin, notes, status, custom_data), ref SUP-#### (`types.ts:808`, baseline:663) | No contact persons and one email only. No supplier ↔ product link. |
| Supplier ↔ item | **Not built.** `product_suppliers` is designed as Sales Engine Piece G (`docs/sales-engine-architecture.md:829-852`), with no migration yet | Supplier choice is manual. |
| Products | `products.cost_price` (internal, kept out of v1), `cost_price_as_of`, `cost_sheet` (`types.ts:833-865`) | none |
| Quote lines | Line contract (`sales-engine-architecture.md:79-…`): `product_id`, `pricing_document_id`, server-derived `pricing_flags` | No RFQ reference and no stable id across saves. |
| Purchase orders | `purchase_orders` (supplier, `quote_id` → **quotes only**, status draft/sent/partially_received/received/cancelled) and `purchase_order_lines` (→ `inventory_item_id`, **not product**) (baseline:960-997). Gated on feature `purchasing` (`purchase-orders/page.tsx:51`), which **Big Blue does not have** (`scripts/seed-bigblue-sample.mjs:424-428`). "Sent" is a manual status flip with no PDF or email (`PurchaseOrderActionsPanel.tsx:19-29`). | Needs a product link, a standard-quote link and an RFQ-award link. |
| Email | Resend through `resolveOutbound()`; PDF attachments exist for quotes and invoices (`api/standard-quotes/[id]/email/route.ts:67-73,123`) | No inbound email handling anywhere in `src/`. |
| No-login links | HMAC, timing-safe, optional expiry: `src/lib/quotePublicLink.ts`, `src/lib/campaignInterestLink.ts` (domain-separated payload, same secret). Allow-listed and `$`-anchored in `src/proxy.ts:74-88`. Writes are POST-only so mail scanners can't trigger them (`api/marketing/interest/.../route.ts:5-9`) | An RFQ link needs revocation (nonce) and a host-tenant check. |
| Attachments | Private bucket `quote-attachments` plus spreadsheet → lines (`0119_standard_quote_attachments.sql`, `api/standard-quotes/[id]/attachments/[attId]/lines/route.ts`, `parseSpreadsheetBuffer`/`sheetToLines`) | Reusable for supplier replies. |
| Notifications / events | `record_comments` + Nova inbox exist (0089), gated on Nova. The event bus and approvals (`emitEvent`, Piece C) are **designed, not built**: there is no `src/lib/events/`. | Notify by email for now; a `pricing.rfq_replied` event exists on paper. |
| Scheduled jobs | Vercel crons exist (`vercel.json`, e.g. `/api/pricing/cron/retention`) | Can host reminders. |
| Rate limiting | None for public routes (only AI/marketing internal throttles) | Must be designed in. |

### 1.6 Big Blue
- Slug `bigblue`, **production only**. Flags: accounts, contacts, suppliers, products, standard_quotes, pipeline, pricing_engine(+quotes), reports, data_workbench, administration. **No `purchasing` flag.** Config is QAR, Asia/Qatar and **email_output redirect** to the owner (`seed-bigblue-sample.mjs:424-452`).
- Suppliers are overseas mills and fabricators (Jebel Ali, Hangzhou, Antwerp; `:120-126`), so replies will come in USD/EUR/CNY on EXW/FOB terms. PRD-0011 is seeded stale to trigger NEEDS_RFQ (`:153`). PRD-0013 is a custom engineered bearing "on drawing" (`:155`), exactly the kind of item that is usually free text.
- There is no `src/extensions/bigblue` (only `_base` and `vikas`). Big Blue uses **Standard Quotes**, not Quotations.

---

## 2. Recommendation: a first-class RFQ (sourcing) object

`pricing_rfqs` is a pricing artefact: "ask for one cost figure". Big Blue's need is a procurement process: one customer enquiry produces several items, each asked of several suppliers, compared, awarded, then ordered. That is what SAP (RFQ per vendor under a collective number → quotation → price comparison → info record → PO with reference), Odoo (RFQ with *Alternatives* / Call for Tender → *Compare Product Lines* → split award → PO) and Dynamics 365 (RFQ → vendor replies via the collaboration portal → *Accept* → PO) all model. We take the common core and leave out tendering bureaucracy.

### 2.1 Data model (migration `0128_rfq_sourcing.sql`, next free number)

Every table has `tenant_id uuid not null references tenants(id)`, RLS on, and **select-only** policies for tenant members. Writes go through service-role routes only, the same posture `pricing_rfqs` already has (0113:101). Supplier prices are commercially sensitive and drive cost, so the WFM lesson in the guardrails applies: no `for all` policy.

**`rfqs` — header (ref `RFQ-####`, continues the existing sequence)**
`id, tenant_id, ref, title, status, origin_type ('standard_quote'|'quote'|'opportunity'|'manual'), origin_id uuid null, opportunity_id null, requested_by, buyer_id, respond_by date, required_by date, delivery_terms text (incoterm + destination city — never the customer), currency_hint text, notes_internal text, notes_to_supplier text, custom_data jsonb, created_at, updated_at`.
- Status: `draft → sent → partially_replied → replied → awarded → ordered` (or `closed`, or `cancelled`). Status is derived from children where possible.

**`rfq_lines` — what is asked**
`id, tenant_id, rfq_id, sl_no, product_id null → products, description, spec text, uom, qty, required_by null, status ('open'|'awarded'|'no_award'|'cancelled'), awarded_response_id null, cost_model_code, path (default purchase.unit_cost)`.
- `product_id` is nullable: **free-text engineered items can be RFQ'd too**.

**`rfq_suppliers` — one recipient per supplier (SAP's "one RFQ per vendor", grouped)**
`id, tenant_id, rfq_id, supplier_id → suppliers, email_to text, status ('pending'|'sent'|'viewed'|'replied'|'declined'|'expired'|'cancelled'), token_nonce text, link_expires_at, sent_at, viewed_at, replied_at, reminder_count int, last_reminded_at, quote_ref text (supplier's own quotation no.), currency, incoterm, freight_amount numeric null, payment_terms text, valid_until date, note text, reply_source ('link'|'buyer'|'upload'|'email'), attachment_path text null`.
- Unique on `(tenant_id, rfq_id, supplier_id)`.

**`rfq_responses` — one price per supplier per line**
`id, tenant_id, rfq_supplier_id, rfq_line_id, status ('quoted'|'no_quote'|'alternative'), unit_price numeric(14,4), currency, fx_rate numeric(14,6) default 1 (to tenant currency, set at award), lead_time_days, moq, offered_description text (for an alternative), valid_until, note, submitted_at, is_awarded boolean default false`.
- Unique on `(rfq_supplier_id, rfq_line_id)`. A resubmission updates the row, and each change is `logChange`d so the history survives.

**Line contract addition** (`docs/sales-engine-architecture.md` §3.1): `rfq_line_id uuid null → rfq_lines on delete set null` on `standard_quote_lines`, `opportunity_lines` and `quote_lines`.
- The client carries it across saves exactly like `product_id`. The server **verifies** it resolves to an `rfq_lines` row of this tenant (guardrails: foreign id from body).
- This gives a persisted line marker. The chip is now derived from the RFQ line's status: Needs RFQ (no link), RFQ sent, Replies 2/3, Awarded — re-price.

**Purchase order additions:** `purchase_order_lines.product_id null → products`, `purchase_order_lines.rfq_response_id null`, `purchase_orders.rfq_id null`, `purchase_orders.standard_quote_id null`.

**Backfill and retirement:** the migration copies each `pricing_rfqs` row into rfqs + 1 line + 1 supplier (+ 1 response when replied), **keeping its ref**, so `RFQ-0007` stays `RFQ-0007` and `nextMasterRefSeq('rfqs')` continues the sequence. `pricing_rfqs` is then frozen (read-only, not dropped). While 0128 is pending, the code finds `rfqs` missing (42P01) and keeps using today's `pricing_rfqs` path unchanged.

`custom_data jsonb` is on `rfqs` and `rfq_lines` (user-facing objects). Responses are machine data and don't need it.

### 2.2 Cost, price, margin
- A supplier price is a **cost**. It never becomes the line rate directly.
- **Award** (per line) writes one confirmed product-scoped `pricing_cost_inputs` row, exactly as today's reply does (`api/pricing/rfqs/[id]/route.ts:99-107`). The value is `unit_price × fx_rate`, in tenant currency, `valid_to` = the supplier's validity, and it is linked from the response.
  - Only the **awarded** response writes, which removes the same-day collision in §1.4.
  - When Piece G exists, the award also upserts `product_suppliers` (source `rfq`).
- The rep then clicks Price / Price all. The engine adds freight, handling and margin, applies the floor guardrail, and the trace names the source.
- **Free-text lines** cannot be engine-priced. Their award shows "Awarded cost QAR X from <supplier>" on the line, and the rep types the rate. The cost still goes on the line's details panel so margin is visible to the rep. Phase 2 adds "Save as catalog product" (creates a product with `cost_price` = award, `cost_price_as_of` = today) so the engine can price it from then on.
- Costs, supplier prices, FX and margins are **internal**:
  - never on the customer quote PDF;
  - excluded from every v1 select and `LIST_SOURCES.load()` unless the key is explicitly scoped (`EXPLICIT_SCOPE_ONLY`);
  - never shown to another supplier.

### 2.3 Multi-supplier comparison
The RFQ detail page has a **grid**: rows are lines, columns are suppliers. Each cell shows unit price (original currency + tenant-currency equivalent), lead time, MOQ, validity, and a "no quote" or "alternative" badge.
- Per row, the lowest landed figure is highlighted. "Landed" is unit price × FX, plus that supplier's `freight_amount` spread per line by value. Until Piece F, it is plain unit cost with the Incoterm shown.
- The buyer awards **per line**. A split award across suppliers is allowed, and one click awards all lines to one supplier.
- Award does not require every supplier to have replied. Unawarded responses stay as history.

---

## 3. The flow, step by step

1. **Trigger.** A Standard Quote / deal / quote line comes back NEEDS_RFQ from Price all, or a rep marks any line (including free text) "Request supplier price". Nothing is created automatically. The rep sees a summary ("3 lines need a supplier price") and a button **Create RFQ from these lines**: one RFQ, many lines, origin = this document, `rfq_line_id` written back onto each line.
   - A manual RFQ (no origin) can also be created from the RFQs list for stock or speculative buying.
2. **Choose suppliers** on the RFQ draft:
   - Phase 1: pick manually, filtered by the line's product category. Previous RFQ winners for that product are suggested ("last awarded to Antwerp PTFE, 2026-08").
   - Phase 2: approved suppliers from `product_suppliers` are pre-ticked (Piece G's "RFQ goes to all approved suppliers").
   - Each supplier needs an email. Without one, the supplier gets a WhatsApp share and a buyer-entered reply only.
3. **Set terms:** respond-by date (default `config.rfq.default_response_days`, e.g. 5), required-by, delivery terms (Incoterm + destination city), and a note to suppliers. Attach drawings/specs from the quote's attachments, but **only files the buyer ticks "share with suppliers"**. Customer correspondence stays private by default.
4. **Send** (per supplier, one action for all). Through `resolveOutbound()`, so a demo or redirect tenant goes to the internal inbox. Each email carries:
   - an **RFQ PDF** (tenant letterhead, RFQ ref, lines, terms; no customer, no quote ref, no prices);
   - an **Excel reply sheet** (one row per line, hidden `rfq_line_id` column, blank price/lead-time/validity columns, round-trippable);
   - a **signed reply link**, built with `tenantOrigin(tenant.custom_domain)` and never `PRIMARY_HOST`;
   - `replyTo` = the buyer's (or tenant's) address.

   Sending logs to `email_log` kind `rfq` (needs 0125) and `logChange`, and sets `rfq_suppliers.status = sent`. **WhatsApp:** a "Copy WhatsApp message" / `wa.me/<supplier phone>` button pre-fills text and the same link. There is no WhatsApp API integration and no message is sent by our server.
5. **Supplier replies**, in priority order:
   - **(a) Link form:** the supplier opens the link (no login) and sees only what §4.2 allows. They enter per line: price, or no-quote, or an alternative; plus lead time, MOQ, validity, currency, incoterm and freight. They can attach their own quotation PDF and may revise until `respond_by` + grace. Submission is a POST, so prefetch is safe.
   - **(b) Buyer key-in:** the buyer types the reply into the same grid ("Enter reply for Hangzhou Dowel"). This is the common case when the supplier simply answers the email with a PDF.
   - **(c) Buyer upload:** the buyer uploads the returned Excel sheet, which is matched on `rfq_line_id` and previewed before saving (reuses `parseSpreadsheetBuffer`). Phase 3: upload the supplier's own PDF/Excel and have AI extraction (the DW engine, `src/lib/import/extract.ts`) **propose** values for the buyer to confirm.
   - **(d) Inbound email:** phase 3 (§7).
6. **Notify.** On the first reply and on "all replied", the requester and buyer get an internal email (via `resolveOutbound`). Where Nova is on, they also get a system `record_comments` entry on the RFQ mentioning them, so it shows in the Nova inbox. The quote line chip reads "Replies 2/3".
7. **Reminders** (phase 2): a daily cron `/api/rfq/cron/reminders` re-sends to `sent`/`viewed` suppliers N days before `respond_by` (tenant config, max 2). After the deadline the recipient becomes `expired`, and the link still works through the grace window.
8. **Compare and award** (§2.3). Award writes the cost input (§2.2), sets `rfq_lines.awarded_response_id`, and flips linked document lines to "Awarded — re-price". A draft quote is **not** silently re-rated: the rep presses Price all, which the editor offers. On the next price, the ladder uses the award (RFQ rung, 180 d).
9. **Win → PO** (phase 2, needs `purchasing` on). When the Standard Quote is accepted, or the deal is Won, the RFQ shows **Create purchase orders**: one draft PO per awarded supplier.
   - Lines come from the awarded responses (`product_id`, `rfq_response_id`, qty from the **quote line's current qty**, rate = supplier price in supplier currency).
   - The PO also carries `rfq_id` and `standard_quote_id`, and the RFQ becomes `ordered`. The PO PDF/email is its own follow-up, mirroring the RFQ send.
   - Before PO creation, if any award is past its `valid_until`, the buyer is warned to re-confirm with the supplier.

---

## 4. Security

### 4.1 Signed reply link
- Path: `/rfq-reply/[rfqSupplierId]/[token]` (page, GET renders) and `/api/rfq-reply/[rfqSupplierId]/[token]` (GET data, POST submit, POST upload). Both are added to `src/proxy.ts` public paths, `$`-anchored like the interest link.
- Token = `${expiresAt}.${HMAC_SHA256(secret, "rfq." + rfqSupplierId + "." + token_nonce + "." + expiresAt)}`, base64url, verified with `timingSafeEqual`. This is the `quotePublicLink.ts` shape plus a **nonce** for revocation. Cancel, resend-with-new-link or a supplier being removed rotates `token_nonce`, and every old link dies. The secret is `QUOTE_PUBLIC_LINK_SECRET` with the `rfq.` domain prefix (same pattern as `campaignInterestLink.ts`). Without the secret, the send goes out without a link and the buyer keys replies in.
- The route loads the `rfq_suppliers` row (admin client) and **also checks that `row.tenant_id` equals `resolveHostTenant()`**, so a link only works on that tenant's own domain. Every subsequent query chains `.eq("tenant_id", row.tenant_id)`.
- The submit path writes only `rfq_responses` rows whose `rfq_line_id` belongs to **this** `rfq_id` (ids re-verified server-side, never trusted from the body), and only while the RFQ is `sent`/`partially_replied` and the recipient isn't cancelled.
- Uploads go to the private `quote-attachments` bucket under `{tenant_id}/rfq/{rfq_id}/…`. Allowlist PDF/XLSX/XLS/CSV/JPG/PNG (no SVG), maximum 10 MB, with the extension derived from the validated MIME type (2026-07-25 audit rules).

### 4.2 What a supplier sees
- **Sees:** tenant name and logo, RFQ ref, title, lines (description, spec, qty, uom, required-by), delivery terms (Incoterm + destination city), respond-by date, note to suppliers, files explicitly shared, and its **own** previous submission.
- **Never sees:** customer or account name, quote/deal ref, the sell price, target price, cost history, margin, other suppliers or their prices, internal notes, or the requester's identity beyond the buyer contact. The RFQ PDF and the Excel sheet use the same projection: one `supplierView(rfqSupplierId)` server function is the only thing those three surfaces read.

### 4.3 Abuse and limits
- No rate limiter exists for public routes, so limits are per record:
  - at most 30 submissions per recipient;
  - 200 lines per RFQ;
  - text fields capped;
  - numbers bounded to fit `numeric(14,4)`;
  - uploads at most 5 per recipient.
- The token is unguessable (HMAC), and nothing is enumerable. Recommend a Vercel firewall rate rule on `/api/rfq-reply/*` before the first real supplier (open question for the owner/infra).
- Supplier input is untrusted data. It is rendered escaped in-app and never interpolated into HTML email. Any AI extraction of supplier files treats the content as data, never as instructions.

### 4.4 Tenant isolation and email
- Every in-app route starts with `requireTenantUser()`, uses `tenantId` only from it, and filters every admin-client query by `tenant_id`. Every foreign id (`product_id`, `supplier_id`, `origin_id`, `rfq_line_id`, `standard_quote_id`, `opportunity_id`) is verified before use. That includes fixing the dropped `opportunity_id` (§1.3).
- Every email (to suppliers, reminders, internal notifications) goes through `resolveOutbound()`. Big Blue is on redirect today, so a real supplier receives nothing until the owner switches its email output.

---

## 5. Where it plugs in (bpmsquarecore §3b)

| Surface | Phase | Notes |
|---|---|---|
| DB: 4 tables + line-contract column + PO columns, RLS select-only, custom_data, backfill | 1 (PO columns 2) | `0128_rfq_sourcing.sql`, pending on both DBs in PROJECT.md ledger; degrade on 42P01 |
| Demo seed | 1 | `scripts/seed-rfq-demo.sql` for the `is_demo` tenant. **Big Blue samples go in `seed-bigblue-sample.mjs/.sql` + cleanup, production only** |
| Types, `MASTER_REF_TABLES` (`rfqs: "RFQ"`), `PilotObjectType` + `PILOT_OBJECT_TYPES`, `FIELD_REGISTRY` | 1 | |
| Custom fields (`VALID_OBJECTS`, tab, PATCH `cf_`, `ObjectSections`) | 1 | header only |
| CRUD + screens: `/rfqs` list, `/rfqs/[id]` (grid, send, award), `/rfqs/new`; ROUTES; `requireWorkcenterView` + `requireFeature` | 1 | Pricing → RFQs tab redirects to `/rfqs` |
| Feature flag `sourcing` (TenantFeatures, TenantEditor, DEFAULT_FEATURES off), workcenter `rfqs`, NAV under Purchasing, `OBJECT_FEATURE` entry | 1 | Independent of `pricing_engine` so free-text RFQs work without the engine. Creating from a quote line needs `sourcing` + edit on that document. Reply entry and award need `rfqs` edit |
| Change history (`logChange` + ChangeHistoryClient filter) | 1 | |
| Line editors: persisted chip, "Create RFQ from these lines" | 1 (Standard Quotes + deals) | **Quotations stay on today's flow** (design partner's object, visual parity): column added, UI change deferred until the owner approves |
| Public reply link + RFQ PDF + Excel sheet | 1 | `vercel.json` memory/duration entry for the PDF route like `quotes/**` |
| Email templates: `rfq` category gains `{{reply_link}}`, `{{respond_by}}`, `{{line_table}}` | 1 | Defaults updated; tenant templates keep working |
| Nova timeline slot + comments `OBJECTS` + inbox `LABEL/TABLE` + `ROUTE_FOR`; ⌘K "New RFQ" | 2 | |
| Global search (`SEARCH_SPECS`, `SEARCH_OBJECTS`) | 2 | by ref / title |
| Data Workbench export (with real `id`) + update (by `id`) | 2 | Import deliberately excluded: an RFQ is born from a document or the screen. Comment why in `DataWorkbenchClient.tsx` |
| v1 API `GET /api/v1/rfqs[/id]` + `LIST_SOURCES` + `EXPLICIT_SCOPE_ONLY` (supplier prices are sensitive) + index/ApiKeysPanel/Settings table | 2 | response prices only with explicit scope |
| MCP `list_rfqs`/`get_rfqs`, version bump | 2 | |
| Analytics: open RFQs, avg reply time, % lines awarded; Reports metric | 3 | |
| Inbound email, AI extraction of supplier PDFs | 3 | §7 |
| Docs: Sales Cloud Guide (RFQ from a quote) + Admin guide (sourcing flag, email output) + API guide when v1 lands | each phase | after the owner validates, per memory "docs after testing" |

**Nothing goes in `src/extensions/bigblue`.** Big Blue's specifics are data and config:
- suppliers and categories;
- `config.rfq = { default_response_days, reminder_days, link_grace_days, share_attachments_default, rfq_pdf_terms }`, added to `TenantConfig` in `constants.ts`;
- its email template text.

A bespoke Big Blue RFQ PDF layout, if ever wanted, would be a new extension slot (`types.ts` + `_base` first), not a branch.

---

## 6. Phased build plan

**Phase 1: "Ask several suppliers, get answers in, award, re-price"** (size **L**, ~6–8 working days)
- 0128 (tables, backfill, line-contract column). Degrade path keeps `pricing_rfqs` working.
- RFQ list/detail/new screens, the comparison grid, and award to a cost input. Persisted line marker and "Create RFQ from these lines" on Standard Quotes + deals.
- Free-text lines allowed. Multi-supplier send with PDF + Excel + signed link + WhatsApp copy.
- Public reply page. Buyer key-in, and buyer upload of our own Excel sheet.
- Internal email notification on reply. `sourcing` flag/workcenter/nav/OBJECT_FEATURE, custom fields, change history.
- Fix `opportunity_id` being dropped. Apply 0125 (pending) so RFQ sends are logged.
- Demo seed and a Big Blue seed update.
- Validated on the demo tenant, then Big Blue (still on redirect).

**Phase 2: "Win → order, and keep it running"** (size **M**, ~4–5 days)
- PO columns, Create POs from awards on quote acceptance / deal Won (turns on `purchasing` for Big Blue: owner's call). PO PDF + email to supplier via `resolveOutbound`.
- Reminder cron and expiry. "Save free-text line as catalog product".
- Piece G `product_suppliers` (suggested suppliers, award upsert), if not built separately first.
- Nova timeline/inbox/⌘K, global search, DW export/update, v1 + MCP.

**Phase 3: "Less typing"** (size **M**)
- AI extraction of supplier PDF/Excel quotations into proposed responses (human confirms).
- Inbound email: a per-recipient reply-to address `rfq+<rfqSupplierId>.<sig>@<inbound domain>` via an inbound provider. The payload is signature-verified, attachments go to the private bucket, and extraction proposes values. **Never auto-award.**
- Analytics/report metrics. Split-quantity awards. A supplier performance view (reply rate, lead-time accuracy).

## 7. Risks
- **Line ids churn on save:** the whole link depends on the client re-sending `rfq_line_id`. That needs a test that saving twice keeps the marker, and server verification so a forged id can't attach a foreign RFQ.
- **FX:** suppliers quote USD/EUR/CNY while Big Blue is QAR-only. Phase 1 asks the buyer for the rate at award, which is explicit and auditable but manual. A wrong rate silently mis-costs the quote, so show the converted figure prominently.
- **Supplier adoption of the link:** many Gulf suppliers will just reply to the email with a PDF. Buyer key-in/upload must be first-class, not an afterthought.
- **Public surface:** first write-capable no-login form in the product. It needs a security review (`/security-review`) before Big Blue leaves redirect mode.
- **Email deliverability:** RFQs come from `<slug>@bpmsquare.com` (`rfqServer.ts:45-49`). Overseas suppliers may spam-filter it, so a tenant sending domain may be needed.
- **Production-only tenant:** Big Blue can't be tested on dev. Validate on the demo tenant first, then apply 0128 on production by hand (see memory: production schema drift).
- **Low-severity side finding (separate fix):** `purchase_order_lines.inventory_item_id` is taken from the body without a tenant check (`api/purchase-orders/route.ts:70`, `[id]/lines/route.ts:38`, `[id]/lines/[lineId]/route.ts:29`). The receive RPC filters by tenant (baseline:923-924), so stock can't be moved cross-tenant, but the link itself should be verified per the guardrails.

## 8. Research notes (why this shape)
- **SAP MM:** RFQ (ME41) per vendor, grouped by collective number, then quotation entry (ME47), price comparison (ME49), and the winner saved to the purchasing info record, which feeds later POs (ME21N with reference). We mirror this: rfq_suppliers = per-vendor RFQ, rfqs = collective number, award = info record (cost input / product_suppliers).
- **Odoo 17:** an RFQ is a draft purchase order. "Call for Tender" links alternative RFQs to other vendors, and *Compare Product Lines* allows a per-line split award. A no-login supplier bid portal exists only as a third-party add-on. [Cybrosys: compare RFQ lines](https://www.cybrosys.com/blog/how-to-compare-rfq-lines-for-the-best-price-in-odoo-17-purchase), [Odoo 17 purchase agreements](https://www.cybrosys.com/odoo/odoo-books/v17/purchase/purchase-agreements/), [Competitive tendering app](https://apps.odoo.com/apps/modules/17.0/sc_competitive_tendering).
- **Dynamics 365 SCM:** vendors reply to RFQs in the vendor collaboration portal (meant for vendors without EDI). The buyer Accepts a reply, which becomes an awarded bid, then a PO, then is sent for confirmation. [Microsoft: vendor collaboration](https://learn.microsoft.com/bg-bg/dynamics365/supply-chain/procurement/vendor-collaboration-work-external-vendors), [About RFQs (AX 2012)](https://technet.microsoft.com/en-us/library/gg212988.aspx).
- **NetSuite:** a Request for Quote goes to multiple vendors, who respond in the Vendor Center or the buyer enters responses. Award creates a PO or purchase contract.
- **Small Gulf trading/contracting reality:** email with a PDF or Excel is the norm, and WhatsApp is used for chasing. Suppliers rarely log into portals. Hence the order: signed link (zero-account, works from WhatsApp) + buyer key-in/upload first, inbound parsing later.

## 9. Open questions (only the owner can answer)
1. Approve a **new `sourcing` flag + `rfqs` workcenter** (independent of the pricing engine), or keep RFQs inside the Pricing workcenter as today?
2. Who at Big Blue sends and awards RFQs: the sales rep who owns the quote, or a separate buyer/procurement person?
3. What share of Big Blue's RFQ items are **catalog products vs one-off engineered items**? This decides whether "Save as catalog product" moves into phase 1.
4. **FX:** is buyer-entered rate at award acceptable for phase 1, or do you want a tenant FX table (who maintains it)?
5. May the reply link go out while Big Blue is still on **email redirect**? Real suppliers get nothing until you switch its email output: when?
6. Turn on **`purchasing`** for Big Blue in phase 2 so awards become POs, or do they raise POs in their ERP (export only)?
7. Should a supplier ever see a **target price**, or the other suppliers' *existence* ("you are one of 3")? Default here is no to both.
8. Is a **sending domain** for Big Blue (e.g. `bigblue.com.qa`) available, or do RFQs go from `bigblue@bpmsquare.com`?
9. Quotations (design partner): leave on today's single-supplier flow, or bring them onto RFQ v2 in phase 2?
10. Approve the Vercel firewall rate rule on the public reply path before go-live (infra change outside the repo)?
