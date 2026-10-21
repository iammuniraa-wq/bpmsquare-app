# Integration middleware: quote awarded or rejected goes to the ERP

Spec 2026-10-21. Supersedes the "fence project won" push and absorbs
`docs/design/message-monitor.md`. Owner decisions, verbatim intent:

1. A fence project is not a deal. A user turns it into a deal or a **Quote**;
   the Quote is the useful object. When the Quote is **awarded or rejected**
   (not "won / lost") it syncs to the ERP: **Dynamics 365 Sales (Dataverse) =
   Quote**; **Finance and Operations and Business Central = Project**.
2. Field mapping stays configurable. All integration work lives on **one
   separate page, the Integration middleware**: configuration, mapping,
   monitoring, resync.
3. The user chooses **what goes out for fence projects** (selection in that page).
4. Show the **readable Dynamics id, never the GUID**.
5. Everything else in `dynamics365-sales-trial-setup.md` "Topics needing
   enhancement" (items 6 to 16) is in scope as proposed.

## Gating (nobody existing sees anything)
New platform-admin flag `integration_middleware` (TenantFeatures, TenantEditor,
NewTenantForm default off, on for demo tenants via `scripts/seed-middleware-demo.sql`).
Vikas and BIM are untouched: no flag, no behaviour change, no new query on their
paths. Scope is **Standard Quotes only** (Quotations belong to a live client).

## Verified against the live Dynamics trial (2026-10-21)
- Quote needs `name`, `customerid_account@odata.bind`, **`pricelevelid@odata.bind`
  (price list is required)** and `transactioncurrencyid@odata.bind`.
- Lines go in the same POST as `quote_details` (deep insert). Write-in lines:
  `productdescription`, `isproductoverridden: true`, `quantity`, `priceperunit`.
  **A write-in line must NOT carry `uomid`** (error: cannot set both).
- `Prefer: return=representation` returns **`quotenumber`** (e.g.
  `QUO-01002-D1M7V2`) = the readable id, and `totalamount` (sum checked).
- New quote is `statecode 0 / statuscode 1` (Draft).
- Awarded: `PATCH quotes(id) {statecode:1,statuscode:2}` then `POST WinQuote
  {QuoteClose:{subject, "quoteid@odata.bind":"/quotes(id)"}, Status:4}`
  gives `statecode 2 / statuscode 4` (Won).
- Rejected: same activate, then `POST CloseQuote {QuoteClose:{...}, Status:5}`
  gives `statecode 3 / statuscode 5` (Lost).
- Opportunity has no readable number column. Account `accountnumber` may be
  empty. Product has `productnumber`.
- Price lists: `GET pricelevels?$select=name,pricelevelid,statecode`.

## Vocabulary
Integration events and screens say **awarded / rejected**. Mapping from the
Standard Quote status: `accepted` = awarded, `rejected` = rejected. Core status
values are not renamed (owner to confirm if the Standard Quote labels should
change too). Domain events `quote.awarded`, `quote.rejected` are added next to
`quote.status_changed`.

## The page: Settings, Integrations, Integration middleware
Five tabs (`useUrlTab`), explanations behind the InfoTip, no paragraphs
(bpmsquarecore 6b), checked at 375 px.
1. **Connections**: each connector's state, secret expiry warning (field
   `secret_expires_on`, warn at 30 days), Dynamics price list and currency
   pickers (listed live), "Check permissions" (probes read accounts, contacts,
   products and create-quote and says what is missing), schema health (tables
   the module needs and whether the database has them, naming the SQL bundle).
2. **What goes out**: one card per rule. Rule "Quote awarded" and "Quote
   rejected", each on/off and **automatic or manual**. Target is chosen by the
   connected product: Dataverse = Quote; F&O and BC = Project (rejected sends
   nothing for them and says so). **Fence selection** card: which fence data
   leaves with the quote: design summary in the description, quantity lines
   (posts, fabric, gates...), security profile, drawing link, notes and terms.
   "Preview payload" shows the exact body; "Send now" for one quote.
3. **Mapping**: header, line and project field maps with a preset per product
   (Dataverse, F&O, BC), same `field = template` language as today, plus inbound
   entity maps moved here (the connector screen keeps connection only and links
   here). Unknown placeholders and bad field names are rejected on save.
4. **Monitor**: every message in and out, newest first. Columns: time,
   direction, channel (email, WhatsApp, webhook, connector, API), counterpart,
   summary, status, record link, duration. Filters. Side panel with headers,
   error and, for admins, the body; metadata only unless payload capture is
   switched on (off by default, 30 days). Reads existing sources
   (`email_log`, `rfq_messages`, `whatsapp_messages`, `webhook_deliveries`,
   `connector_sync_runs`) plus the new `integration_messages` table.
5. **Resync**: failed outbound items with the ERP's own message and a Retry
   button (idempotent through `connector_links`); "Send again" for an awarded
   quote; full resync for inbound entities; shows what is running.

## Data
Migration `0201_integration_middleware.sql` (owner applies by hand; code degrades
while pending, a missing table (42P01 / PGRST205) shows "database update needed",
never a crash): `integration_messages` (tenant_id, direction in/out, channel,
connector_id, entity, object_type, object_id, ref label, status
ok|failed|pending|skipped|redirected, http_status, error, duration_ms,
correlation_id, summary jsonb, payload jsonb null, created_at), RLS enabled,
**select for admins of the tenant only, no member write policy**, service-role
writes; index (tenant_id, created_at desc). Rules and selections live in
`tenants.config.integration_middleware` (no secrets there). Mapping stays in the
connector config. Listed in PROJECT.md ledger as pending on both DBs, with
`scripts/seed-middleware-demo.sql` (run after it).

## Readable id on every synced record
Shared `ExternalRecordLine` on account, contact, product and Standard Quote
pages: "Dynamics 365 · QUO-01002 · Open in Dynamics". Shows `external_key` (the
readable number) else the record's own name; the GUID only in a tooltip. Deep
link built from the environment URL. Push stores `external_key` from the
response (`quotenumber`, `ProjectID`, BC job number). The BPMSquare ref
(SQ-xxxx) is written into the ERP document in a visible field (name prefix or
mapped field).

## Rules that apply
bpmsquarecore sections 1 to 9 and MULTI_TENANT_GUARDRAILS.md: `requireTenantUser()`
first, every admin-client query `.eq("tenant_id", tenantId)`, foreign ids verified,
tenant-typed URLs through `fetchPublic`, secrets never logged or returned,
payload capture redacts tokens and personal data, outbound mail rules untouched,
demo workspaces show "redirected". The quote dispatch runs after the user's save
and must never fail or slow it: failure is recorded as a message and retried
from the Resync tab. Tests for every pure function; `npx tsc --noEmit` and
`npx next build` clean; no push; Drive guides only after the owner validates.

## Easy to use (owner, 2026-10-21: "build middleware easy to use")
This is acceptance, not polish. A sales admin with no integration background
must go from "connected" to "first awarded quote visible in the ERP" without
reading a guide or touching a field map.
1. **Set-up guide at the top of the page**, five ticks with live status, each
   opening the right tab: connected, price list and currency picked, what goes
   out chosen, a **test quote sent**, first real quote seen. Hidden once all
   are ticked (a small "Set-up complete" chip remains).
2. **Works with zero mapping.** Every product ships a preset; the Mapping tab
   is for changes, opens read-only on the preset, and says "Using the standard
   mapping" until someone edits it. "Reset to standard" always available.
3. **Pick, don't type.** Price list, currency, project type and similar come
   from live pick-lists read from the ERP, never a pasted GUID. Placeholders in
   a map are chosen from a list of the fields BPMSquare offers.
4. **Test without risk.** "Send a test quote" builds a clearly named sample
   (prefix ZZ, never deleted by the product) and shows the result with its
   readable number and an Open in Dynamics link. "Preview payload" shows what
   would be sent, in words first (customer, 2 lines, total) and the raw body
   behind a toggle.
5. **Plain-language failures.** Every failure shows what happened, why, and the
   one thing to do ("This customer is not in Dynamics yet: Sync customers, then
   Retry"), with the ERP's raw message behind a "Details" toggle. Retry is one
   click and safe to repeat.
6. **One vocabulary:** Awarded, Rejected, Sent to Dynamics, Failed, Waiting.
   No GUIDs, status codes or entity-set names in any heading, chip or button.
7. **Defaults that do the sensible thing:** automatic on awarded, rejected
   closes the Dynamics quote, the fence selection starts with summary and
   quantity lines ticked.
8. Mobile (375 px) and keyboard checked; empty states say the next step.

## Added by the owner, same day
**A. Metadata as part of mapping.** The Mapping tab fetches the ERP's own field
list and offers it as the pick-list for every target field: Dataverse
`EntityDefinitions(LogicalName='quote')/Attributes` (logical name, display
name, type, required level, valid for create), F&O OData `$metadata` entity
types, BC OData `$metadata`. Each row shows display name, technical name, type
and a "required" mark; required target fields not yet mapped are flagged
before save; the map editor suggests matches by name ("Suggest mapping"). A
"Refresh fields" button re-fetches (cached per connector for a few minutes,
admin-only, tenant-scoped, through `fetchPublic`). Backend contract:
`GET /api/middleware/metadata?entity=<quote|quote_line|account|contact|product|project|...>`
returns `{ fields: [{ name, label, type, required, creatable }], fetchedAt }`.
BPMSquare-side sources are a fixed list the UI already knows.

**B. Sync lives in the middleware page, not on the connector screen.** Preview,
Sync now, Full resync, the automatic-sync schedule (per entity: off / hourly /
daily), the result lines and Recent runs all move to the middleware page
(Mapping tab for preview and map per entity, Resync tab for run, schedule and
history). The connector screen keeps only what a connector is: product, login
type, environment, ids, secret, Test connection, Disconnect, and one clear
"Manage sync in Integration middleware" link. Existing routes keep working;
this is a move of the controls, not of the engine. Reusable pieces
(`D365Preview`, `D365Runs`, `SyncRow`) are standalone components under
`src/components/connectors/` so both screens can mount them during the move.

## Added by the owner, same day (2)
**C. One page, every connector, the same five tabs.** Connectors beyond Dynamics
365 (SAP, ePROMIS, and any later one) get exactly the same tabs on the
Integration middleware page: Connections, What goes out, Mapping, Monitor,
Resync. A **connector switcher** sits at the top (chips: Dynamics 365, SAP,
ePROMIS, "Add connector"); everything below it is the same screens driven by
the selected connector's adapter. Design: `docs/design/erp-connectors-sap-epromis.md`.
Consequence for the UI agent: no screen may hard-code Dynamics words; labels,
presets, pick-lists, the document a rule creates ("Quote" or "Project") and the
metadata all come from the adapter's description.

## Added by the owner, same day (3): the connected system's id on every object
"In the other objects like account, quote, purchase order, project etc. we also
need the external ID of the connected system." The id is the **readable** one
(quote number, customer account, project id, PO number), never the GUID, for
whichever connector the record is linked to (Dynamics, SAP, ePROMIS, later ones).

**Stage 1 (with the readable-id builder, now):** the `ExternalRecordLine` mounts
on the detail page of every object that can carry a link: accounts, contacts,
products, suppliers, inventory items, Standard Quotes, Quotations (renders only
when a link exists, so live clients see nothing), deals (opportunities),
estimates, fence projects, RFQs, purchase orders, invoices, work orders, cases,
projects (workforce), employees. Where no sync exists yet (purchase orders,
invoices, work orders) the line simply does not render until a link exists.
`connector_links.object_type` already carries the BPMSquare table; the helper
maps table to label and ERP entity.

**Stage 2 (next, after owner validation of stage 1):**
1. List pages: an optional "ERP id" column (off by default, per-user column picker).
2. Global search finds a record by its ERP id (`SEARCH_SPECS` in
   `src/lib/data/live.ts` plus `globalSearch.ts`).
3. Data Workbench: export gains `external_system` and `external_id` columns;
   Update and import accept them and match by them when present (the real `id`
   stays the contract, bpmsquarecore section 3). Per ERP plan phase 1.
4. v1 API: a read-only `external` object on every enriched record
   (`[{system, id, key, link}]`) and `?external_id=` filter; `EXPLICIT_SCOPE_ONLY`
   and the field whitelist rules apply.
5. Nova timeline and the assistant read it ("what is this quote's number in Dynamics?").
6. Push stores the key it gets back for every object type, so the line is never empty after a send.

## Added by the owner, same day (4): estimates go out like fence projects
"Also add the same for estimates, it is similar to fence projects." An estimate
already creates a Standard Quote (`estimates.standard_quote_id`) and already has
the internal BOM and WBS builders (`src/lib/estimator/exports.ts`:
`buildBomRows`, `buildWbsRows`, ERP profiles generic / dynamics365 / sap). So the
awarded or rejected Standard Quote that came from an estimate follows the same
rule, and the **What goes out** tab gets an **Estimates** card next to the
**Fence projects** card, with the same easy-to-use rules.

Selection (what leaves with the awarded quote), defaults in brackets:
- Estimate summary in the description: floors, area, finish, risk note [on]
- Quote lines, customer prices [on]
- Bill of materials, quantities per item from the product catalogue [on for Project targets]
- Project tasks (WBS) and casting schedule [on for Project targets]
- **Internal cost breakdown** (materials, production, transport, erection,
  overhead, margin) [OFF]. Internal, never in a customer-facing document.

Target decides what is allowed: a **Quote** target (Dynamics Sales) carries
prices only, so BOM, WBS and cost options are disabled there with the hint "A
Dynamics quote carries prices only; these go to Project targets (SAP, F&O,
ePROMIS)". A **Project** target (F&O, BC, SAP, ePROMIS) receives the project
header plus WBS tasks and BOM lines shaped by the adapter's profile (reuse the
existing profile builders, do not duplicate them). The quote's source (fence
project, estimate or neither) is detected from the links already stored; the
Estimates card applies only when the quote came from an estimate. "Preview
payload" and "Send now" work the same. The ERP id shows on the estimate page
(stage 1 list in section 3 already includes estimates).

## Added by the owner, same day (5): one place for everything about sync
"Keep it in one place, all related to sync, don't keep it in connectors or the
object itself." Rule for every future change: **anything that configures, runs,
maps, monitors, retries or schedules a sync lives on the Integration middleware
page and nowhere else.**

What that means, concretely (all behind the `integration_middleware` flag; with
the flag off nothing changes, so live clients keep today's screens):
- **ERP connection settings move into the Connections tab** (product or system,
  login type, URL, ids, secret, Test connection, Disconnect). The same connection
  form is reused as a component. `Settings, Integrations, Connectors` keeps the
  non-sync connectors (Slack, Gmail, Calendar, mail server, iCal) and, for
  Dynamics, SAP and ePROMIS, shows one card "Managed in Integration middleware"
  that opens the page. `/settings/connectors/dynamics365` redirects to
  `/settings/middleware?connector=dynamics365`.
- **Objects carry facts only:** the read-only ERP id line and nothing else. No
  Send, Push, Retry, Sync or settings on any record. The existing **Push to ERP**
  button on an account (`AccountPushButton.tsx`) is hidden when the flag is on;
  its job moves to the Resync tab as "Send a record" (pick object type and record,
  Send). Standard Quote pages get no "Send to ERP" button either: "Send now"
  lives in What goes out and in Resync.
- **Other lanes appear in the same page:** Connections shows "Other lanes" cards
  for Webhooks and ERP push (`/settings/push`), API keys (`/settings/developer`)
  and Data Workbench files, first as links, later with their forms embedded.
  Settings, Integrations, with the flag on, lists "Integration middleware" first.
- **Search for it in one place:** the settings search and Cmd+K "Integrations"
  both land on the middleware page.
