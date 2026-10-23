# Sales Order, GCC pack, e-invoicing, shared mailbox, one estimator — plan

> Draft for the owner, 2026-10-23. A brainstorm and plan, nothing built. Every fact below was read from the code by three
> scouting passes (sales/ERP, WFM, estimating/mailbox). Owner rules applied: lean (6c), simple screens (6b), "look first",
> one place per setting, ERP sync configured only on the Integration middleware page, no country branches in code.

## 0. One idea under all six: a Region pack, chosen once

Today nothing knows which country a workspace is in (only marketing consent has a jurisdiction; WFM has a timezone; currency
is per workspace). Items 2, 3 and 4 all need "this is a UAE / KSA / Qatar workspace". So the scoping step gets one new
choice, **Country**, and a **pack** is a typed preset table in code (the same pattern as `PACKAGES` in
`src/lib/admin/tenantStudio.ts` and `JURISDICTION_RULES` in `src/lib/marketing/jurisdictions.ts`).

Applying a pack writes **defaults into the workspace's own config** (never a code branch on country):
currency, timezone, week-off days, holiday calendar rows, leave-type rows, overtime rules, Ramadan rule, punch method,
e-invoicing scheme, consent jurisdiction. Everything stays editable afterwards; the change is logged. Tenant Studio and
the new-tenant form get the Country field; `normalisePlan()` allow-lists it. `config.country` is the one new key.

## 1. Sales Order

**Look first (done).** There is no Sales Order object. "Sales order" exists only as an ERP target of an accepted Standard
Quote (`src/lib/middleware/erpOrder.ts`, D365 only, created ERP-side and never mirrored). Opportunities is the best model for
header + lines + ref + convert flows; Products/Suppliers for the full 3b surface list. Standard Quotes is not 3b-complete,
so it is not the copy source.

**The object.** `sales_orders` + `sales_order_lines`, ref `SO-####`, custom_data, RLS, full 3b checklist (list/detail/create,
v1 API, Data Workbench x3, field registry, change history, search, Nova x4, ⌘K, analytics, MCP). Flag `sales_orders`
(platform-admin, default off). Nav under Sales.

**Two origins, one rule.**
- `origin = bpmsquare`: created from an accepted Standard Quote / Quotation, from an Opportunity, or directly. Editable
  while it is a draft; **locked the moment the ERP accepts it** (a link exists in `connector_links`), not on pressing Send.
- `origin = erp`: replicated in from the ERP. **Read-only here**, always. Status and quantities follow the ERP.
- One server helper `orderEditable(order)` is the only place the rule lives (PATCH, UI and API all call it). The
  ERP-id line already exists (`ExternalRecordSlot`); the read-only badge sits beside it. The same `origin` convention is
  then reusable for invoices and POs later.

**Statuses match D365.** Dataverse sales order states: Active (New, Pending), Submitted (In progress), Fulfilled
(Partial, Complete), Invoiced, Canceled. The code today only knows Active (verified live); the full status/state-code table
must be **verified against the trial org before building** (one read call per state). BPMSquare adds only `Draft` in front
(before it exists in the ERP). Statuses are stored as the ERP's label + a spine (open / in progress / completed / cancelled)
so the status engine (`0070`) still works; its four entity-type CHECKs get widened with the new object.

**ERP checks, API and webhooks only.** Each check is a call the connector makes, never a screen the ERP user must visit:
credit/blocked customer, price from the customer's price list (already built for quotes), tax, payment terms, and **ATP**
(per line: available qty and promise date). Each runs from a "Check with ERP" action and automatically before Send; results
are kept on the order as chips (Passed / Warning / Failed) with the reason; a hard failure blocks Send (a per-workspace
choice, default block). Without an ERP connector, ATP falls back to local stock minus open orders (`qty_on_hand` only today;
no reservation exists), clearly labelled "local stock, not ERP". ERP is the source of truth when connected.

**Replication in.** New entity `sales_orders` in the D365 and SAP entity lists (pull with watermark, status updates flow in,
including for orders we sent), plus an inbound webhook endpoint per workspace (the WhatsApp `webhook_key` pattern) so the ERP
can push status changes in near real time. Sync config lives only on the Integration middleware page (Links, Mapping, Resync
rows get the new entity); the order screen shows only the ERP id line and status.

**Phases.** SO1 object, local flow, lock rule, statuses. SO2 D365 inbound replication + status back. SO3 ERP checks
(credit, price, ATP) + send. SO4 SAP both ways (SAP has no push today).

## 2. WFM for GCC (and item 3: camera instead of phone)

**What is already fine.** Hours engine, roster, shifts (cross-midnight), leave, corrections, OT approval, monthly summary,
CA export and project billing do not depend on a phone. Week-off days, holidays, leave types, a flat OT rate, timezone and
GCC currencies are configurable.

**Phone-only today:** geofence, selfie, consent, push, login/passkey, remote/WFH punches, and **overtime** (only an `ot_in` /
`ot_out` pair). There is no way to say "no device at all".

**Camera mode** (`punch_method: phone | kiosk | camera`, new config key, handled in the workforce settings route and its
coverage test). In camera mode the phone surfaces are hidden, supervisors keep every tool.

- **Ingest.** One key-authenticated batch route (new `source = camera`, token per camera bound to a site, the kiosk-token
  pattern). Each event: vendor event id (idempotent), camera id, direction, time, confidence, person reference, optional image.
  Those four extra facts go in `flags` first (no new columns until proven).
- **Identity.** The vision system does the recognising and sends the **employee code** we already generate (unique per
  workspace), so no biometrics need to be matched by us for this mode. If the vendor sends only video, we need a face
  service in the GCC region instead (see privacy).
- **A reducer between camera and punches.** Cameras produce noisy sightings; the human-punch rules (409 on illegal order)
  would reject them. A small pure function collapses duplicates inside N minutes, takes first-entry and last-exit per shift
  day, queues unknown persons and missing exits for a supervisor, then writes ordinary `check_in` / `check_out` events
  through the existing project-attribution step. Late or out-of-order delivery is safe because the reducer, not the punch
  route, orders them.
- **Overtime and breaks without punches.** OT is derived (hours beyond the shift's standard day, weekend/holiday) as
  *candidates* the supervisor approves, the approval flow that exists. Breaks use a fixed deduction rule per shift because
  there are no break doors.
- **Statutory rules as data, per pack:** OT multipliers and bands (125 % / 150 %, night band, weekend and holiday premium),
  Ramadan reduced hours by date range, daily and weekly caps, midday-sun ban window (confirm each country's dates before
  building), holiday calendars with adjustable Eid dates, statutory leave types (annual, sick tiers, Hajj, marriage,
  bereavement, maternity), end-of-service calculation as a report, **WPS / SIF (UAE) and Mudad (KSA) as export templates**
  (the summary export is already template-driven), document expiry (Iqama / Emirates ID / passport / visa) with alerts,
  nationality, sponsor, IBAN, the six GCC timezones.
- **Privacy.** Consent text is India-only today and face matching defaults to an India region. Per-country consent wording,
  camera-image retention and where face data lives need a decision before a GCC go-live.

**Phases.** W1 pack framework + Country in Studio. W2 camera ingest + reducer + camera-mode UI. W3 rules engine (OT bands,
Ramadan, caps, auto-break). W4 WPS/Mudad, document expiry, leave and holiday seeds, IBAN. W5 privacy, Arabic/RTL (deferred
until a paying GCC workspace asks, as already noted).

## 3. E-invoicing for GCC (the owner wrote "FATCA"; read as ZATCA, see decisions)

Invoices have no tax breakdown, no tax-registration numbers and no e-invoice fields today. Design:
- Invoice gains per-line tax code and rate, totals by rate, seller and buyer tax id (TRN / VAT number), and an
  **E-invoice status chip** (Not required / Prepared / Cleared / Reported / Rejected) with the document id, QR and a link to
  the signed XML. All filled by the provider, never typed.
- A new connector kind **e-invoicing provider** in the Integration middleware: a certified solution provider's API for KSA
  (ZATCA Phase 2 clearance and reporting) and an accredited Peppol access point for the UAE. Flow: invoice sent → submitted
  through the connector → provider's webhook returns status, QR and clearance → stored and the invoice locks (changes go by
  credit note). **We do not build the cryptographic signing ourselves** (also the standing advice in `GCC_READINESS.md`).
- The pack chooses the scheme (`ksa_zatca`, `uae_peppol`, none for other countries); the invoice screen only shows the chip
  when a scheme is on.

**ERP touch points to put in the middleware (one entity row each, nothing new on the objects).** Built: customers,
contacts, suppliers, products, awarded quote to ERP quote/order/project. Missing, in priority order: sales orders in + status;
price lists; stock / ATP; invoices out and status/payments back; payments in; purchase orders both ways; tax codes and
sales-org / business-unit mapping; delivery/shipment; credit memo; work orders out; SAP push; employees. Stage-2 ERP-id
surfaces (list column, search by ERP id, v1 `external`) are still unbuilt and are part of this.

## 4. One shared mailbox per client

Nothing stores non-RFQ inbound mail today; it is dropped. Plan, reusing what exists:
- **Table** `inbound_emails` (tenant, message id unique, from/to/subject/body, attachments, status new / handled / spam,
  assigned to, linked object type and id, read time), cloned from `rfq_messages`; read-only member policy, writes by the
  service role; untrusted body is rendered escaped and never used as instructions; body encrypted like WhatsApp text.
- **Intake, two ways, same table:** (1) a per-workspace forwarding address (alias like the WhatsApp `webhook_key`) through
  the existing Resend inbound route, the client forwards or auto-forwards; (2) polling the client's own mailbox with the
  existing mail-server connector and IMAP code (read-only, 5-minute cron). Start with (1).
- **Screen:** an Inbox (list, thread, assign, mark handled) and one **Create from this email** menu: Estimate (any
  template), Case, Lead, Quote, Account/Contact. Each opens the existing New screen prefilled by the existing AI intake and
  stores `source_email_id` on the created record. Replying from the inbox goes out through the same connector, threaded.

**Phases.** M1 alias, table, Inbox. M2 Create-from-email. M3 IMAP intake. M4 reply and threading.

## 5. One estimator instead of fence + estimates + tiles

**What the scout found.** The Estimator is already the superset: template data, stored BOM lines, formula rules, products and
kits, margin and VAT, quote assembly, simulation, schedule import, ERP export, v1 API and Data Workbench. The Fence
configurator is a hard-coded form with a BOM computed live and never stored, a second quote assembler, a second AI intake and
a screen outside the app shell, in front of a real prospect (Big Blue). The estimator doc already calls fence "template one".
The only genuine differences are the BOM source and the preview renderer, and the estimator already has the hook for both
(**geometry modules**).

**Design.** One feature, one nav item (**Estimates**), one flag. A *template* chooses the variant:
- `chainlink_fence` module (the current geometry and BOM rules move in as code, still universal engineering, not tenant-edited),
- `precast_villa` (exists),
- `tiles_floor` (new).
The scoping step picks which template pack a workspace starts with; labels come from the template ("Project", not "Villa").
One quote assembler, one intake, one set of §3b surfaces; fence's missing surfaces (search, ⌘K, v1, Data Workbench, Nova,
analytics) arrive for free. Existing fence projects migrate to estimates with their FNC refs kept as aliases; the old routes
redirect.

**Tiles.** New geometry module: room (rectangle first, polygon later), tile size and pattern (grid, brick, diagonal), cuts
and waste %, a tile catalogue from Products with an image and size (products have no image field yet), three.js floor with
textures reusing the existing viewer, and an optional customer share link (the signed quote-link pattern). Greenfield:
no room, tile or texture code exists.

**Phases.** E1 shared shell, flag and assembler, no behaviour change. E2 fence becomes a template and data migrates (plan
with Big Blue first; the post-count formula still needs engineering sign-off). E3 tiles module. E4 customer preview link.

## 6. Order of work

1. **Foundations (first, small):** Region pack + Country in Studio; the origin / editable / locked convention and the status
   engine widening; the `inbound_emails` table. Everything else leans on these.
2. **Estimator harmonisation** (E1 then E2) in parallel with the **Inbox** (M1, M2): they meet at "create an estimate from an
   email" and unblock the tiles client.
3. **Sales Order** SO1 to SO3, with the D365 status table verified first.
4. **WFM GCC** W1 to W4, once the camera vendor contract is known.
5. **E-invoicing** after Sales Order SO1 and the invoice tax fields, with the provider chosen.
6. Tiles (E3, E4) as soon as E2 lands.

## 7. Decisions needed from the owner

1. "FATCA" on GCC invoices: confirm it means ZATCA (KSA) and the UAE Peppol scheme. FATCA itself is US tax reporting.
2. E-invoicing: buy not build (certified provider connector). Which provider, or recommend one in a short comparison?
3. Camera: who supplies the CCTV vision system, and what does it send (events with a person id, or only video)? This fixes the
   ingest contract.
4. Under camera mode: is derived overtime with supervisor approval acceptable, and are fixed auto-breaks acceptable?
5. Sales order: ERP-origin fully read-only (including notes and attachments), locked when the ERP accepts it. Agree? And for
   ATP with no ERP: local stock fallback acceptable?
6. Fence: may Big Blue's live fence data migrate into the estimate model, and when?
7. Mailbox: start with the forwarding address (recommended) and add IMAP later?
8. Tiles client: where does the tile catalogue and its pictures come from?
9. Which countries first: UAE and KSA (per `GCC_READINESS.md`), then Qatar for Big Blue?

Docs to refresh after these ship and the owner validates: Sales Cloud, WFM, Admin & Setup, Marketing and API guides.
