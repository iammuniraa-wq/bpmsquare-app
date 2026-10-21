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
**no policy at all (service role only)**, read and written through
`createAdminSupabase()` with a tenant filter; index (tenant_id, created_at desc).
One send per quote: the same migration adds a unique partial index on
`connector_links` for the quote's push row; the dispatcher inserts that row as a
`pending:<uuid>` claim before any ERP call, and an ERP document carries the
quote's id as a `[bpmsquare:<uuid>]` marker, which is what "already in the ERP?"
matches on (never the ref alone). Rules and selections live in
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

## Redesign after the first live test (6), owner 2026-10-21
Owner: Mapping "didn't like it"; What goes out "is too detailed"; "what if the client
wants the Quote created as an Order in the ERP"; "I see too much data that is not
needed"; "be flexible". Rule for the whole page from now on: **a row says what it is and
opens only on demand; never show a field the user did not ask for.**

**Live-verified (Dynamics, 2026-10-21):** a Sales Order is one POST, like a quote:
`salesorders` with `name`, `customerid_account@odata.bind`, `pricelevelid@odata.bind`,
`transactioncurrencyid@odata.bind`, deep insert `order_details` (write-in lines:
`productdescription`, `isproductoverridden: true`, `quantity`, `priceperunit`, no `uomid`),
`Prefer: return=representation` returns `ordernumber` (e.g. `ORD-01000-Q3T6T0`) and
`totalamount`; it is born Active (`statecode 0 / statuscode 1`), no win or close step.

### What goes out: documents, not options
The tab is a short list of **outbound documents**. Today one row: **Quote** (source: Standard
Quote). A row shows only: name, where it goes in one line ("Awarded → Dynamics 365 Quote"),
an on/off switch and a status dot. Click the row and a panel opens: **"What do you want to
send?"** with exactly four things:
1. **Send when**: two ticks, Awarded and Rejected; and **Automatically / Manually**.
2. **Create in the ERP as**: a dropdown of what the connected system offers for this document
   (Dynamics Sales: Quote, Sales Order; F&O: Project, Sales order; Business Central: Project,
   Sales order; SAP and ePROMIS later). The default is per system (Dynamics Quote; ERPs Project).
   Changing it swaps the mapping preset and the rejected behaviour (a Quote is closed as lost; an
   Order or Project sends nothing for rejected, said in one grey line).
3. **Include**: one plain checklist, only the items that make sense for the chosen target
   (customer prices, summary text, drawing link, notes and terms, materials list, project tasks,
   internal costs [off]); greyed items carry a three-word reason. Items map onto the existing
   fence and estimate selections, one list for both sources.
4. **Try it**: "Preview" and "Send a quote now" live inside this panel (the separate "Check a
   quote" card goes). "Send a test quote" is in the row's menu.
Nothing else is visible. "Add document" is a disabled chip for later (Invoice, Purchase order).

**Contract (backend builds, UI consumes; the UI keeps it in `settings/middleware/api.ts`):**
- `GET /api/middleware/documents` returns `{ documents: [{ key:"quote", label:"Quote",
  source:"standard_quote", enabled, summary, target:{key,label}, targets:[{key,label,available,hint}],
  when:{awarded,rejected}, mode:"auto"|"manual", rejectedNote, include:[{key,label,on,allowed,hint}] }] }`.
- `PUT /api/middleware/documents/quote` with any of `{ enabled, target, when, mode, include:{key:boolean} }`
  returns the same document; 422 with `errors[{field,message}]`. The old `/rules` route keeps working
  and reads and writes the same stored data (compat), so nothing already live breaks.
- Stored in `tenants.config.integration_middleware.documents.quote`; the reader migrates the old
  `rules` + `fence` + `estimate` shape on read.
- Targets are adapter capabilities: Dataverse `quote` and `sales_order` (verified above); F&O and
  BC `project` and `sales_order` (sales_order is preset-only and flagged "not verified"); a target
  with no preset reports `available:false` with a hint.
- Set-up tick "What goes out" turns on only after the owner has saved the document panel once
  (store `confirmed_at`), not because the defaults are on.

### Mapping: two columns, one row per field
Top of the tab: a compact selector "Quote → Dynamics Quote" (also lists the inbound entities:
Customers, Contacts, Products, Projects). Under it two sections, **Header data** then **Lines**,
each a plain table with exactly two columns: **BPMSquare field** | **ERP field**. One row per
field. A cell shows the label and, smaller and muted, the technical name
(`Reference · ref`, `Name · name`) and nothing else: no types, no required marks, no hints, no
explanations. The ERP cell is a dropdown fed by the metadata endpoint (label and technical name,
"Not sent" first). Composite standard mappings (for example the name built from ref and customer)
show as one read-only row with a small "Standard" word until edited. Inbound entities use the same
layout (BPMSquare field | ERP source field). One bar at the top appears only when a required ERP
field is unmapped, naming it in plain words; "Reset to standard" is a text link. No cards, no
tips per row (one InfoTip beside the title).
- `GET /api/middleware/mapping?document=<quote|customers|contacts|products|projects>` returns
  `{ document:{key,label,targetLabel}, sections:[{key:"header"|"lines",label,rows:[{id,bpm:{label,name},erp:{label,name}|null,standard:boolean,composite?:string}]}], erpFields:{header:[{label,name}],lines:[{label,name}]}, usingStandard, missingRequired:[string] }`.
- `PUT /api/middleware/mapping` with `{ document, section, rows:[{id, erp:string|null}] }` saves; `POST /api/middleware/mapping/reset` with `{ document }`.
- The stored map stays the existing `field = template` form; the API inverts it per row.

### Fixes in the same round
1. Check permissions must not report a false "no" (it said create and win quotes were not allowed when both work): fix the privilege lookup (application users are checked by their system user and role, not the signed-in person) or return `ok:null` "not checked, use Send a test quote".
2. The id line on a link with no readable number shows the ERP record's own name or its entity ("Opportunity"), never BPMSquare's own ref under the ERP's name.
3. Choosing price list and currency one right after the other must keep both (functional state updates in the Connections form).
4. "What goes out" set-up tick as above.

## Monitor and Resync become ONE list (7), owner 2026-10-21
Owner, comparing with the SAP C4C message monitor: "at the top filters and the data displayed,
and at the top a restart option, nothing else; this is confusing, no separate section of
everything. One big list with all the details and a filter on top, with options to process one
record or multiple records."

- **Tabs become four:** Connections, What goes out, Mapping, **Monitor**. The Resync tab is removed.
- **Monitor is one table.** Filter row on top (status chips All / Failed / Waiting / OK,
  direction, document or entity, date range, search by record or ERP number). Under it one list,
  newest first, with every detail a row has: time, direction, what (document or entity), record,
  ERP number, status, short reason; the "what to do" line is returned in the list (no extra read);
  row click opens the full detail panel. Checkbox on every row and a select-all for the loaded page.
- **One action bar above the list, nothing else:** **Restart** (acts on the ticked rows; with
  nothing ticked and a Failed filter it offers "Restart all failed (n)", capped, confirmed once),
  and a quiet **Send a record** button for sending one thing by hand. No cards, no history
  component, no schedule here.
- **Restart means the same for every row:** an outbound document row re-sends that document
  (idempotent, as today); an inbound run row (a customers/contacts/products pull) re-runs that entity
  (for a failed single record, only that record where the entity allows `ids`). A row that cannot
  be restarted (already OK, skipped by design) shows no checkbox. Results come back per row (done,
  still failing with the reason, already fine) and the list refreshes in place.
- **Where the rest went:** per-entity enable and the automatic schedule (off / hourly / daily) sit
  with the entity in the **Mapping** tab (they are configuration); "Sync now" and "Full resync" for
  an entity are one menu on that entity's header in Mapping; the long run history is the Monitor
  list itself (filter by entity).
- **Contract:** `GET /api/middleware/messages` returns, per item, `restartable:boolean`,
  `fix:string|null`, `erpNumber:string|null`, `entity|document` label and the existing fields;
  `POST /api/middleware/restart` with `{ message_ids: string[] }` or `{ filter: {...same as the
  list query}, limit?: number }` returns `{ results:[{id, outcome:"done"|"failed"|"already_ok"|
  "not_restartable", message}] }`, tenant-verified per id, safe to repeat; the old `retry` route
  keeps working for one id.

## Request and response payload next to Restart (8), owner 2026-10-21
"Next to Restart there is an option to view the request payload and the response payload, at
the same place, when one line is selected."

- **Action bar:** with exactly ONE row ticked, the bar shows **Restart**, **View request** and
  **View response** side by side. With none or several ticked the two view buttons are disabled
  (tooltip "Select one line"). Opening either shows the payload in a panel with a small
  Request / Response switch, pretty-printed, a Copy button, and the HTTP status and duration in
  one line. Admin only; every open writes the change-log entry that the detail view already writes.
- **What is captured (changes the earlier "off by default" rule for these rows only):** for every
  **outbound document send** (Quote, Sales Order, Project...), and for any connector call that
  fails, the request body and the response body are stored with the message, redacted by the
  existing `redactPayload` (tokens, authorization values, secrets, personal data), size-capped
  (truncate with a visible "truncated" note), kept 30 days by the existing prune. For inbound pulls
  and v1 API calls only the existing metadata is stored unless the workspace switches **payload
  capture** on (then request, a response sample and counts). Rows from the old sources (email,
  WhatsApp, RFQ, webhooks) have no payload and the buttons say "No payload recorded".
- **Contract:** `GET /api/middleware/messages/<id>` returns `payload: { request: {method, url,
  body}|null, response: {status, body, durationMs}|null, truncated: boolean }|null` (url is path
  and entity only, never a query string with credentials); list items carry
  `hasPayload: boolean` so the buttons enable without a second read.

## Correction to (7): Monitor is the list, Resync stays as its own tab for DATA (owner 2026-10-21)
Owner: "We have this in Monitor; why not use that one and use Resync for something else?"
So the tabs stay five: Connections, What goes out, Mapping, **Monitor**, **Resync**.
- **Monitor** = the one big list (section 7 and 8): filters on top, every detail in the row,
  tick one or many, **Restart**, and with one row ticked **View request / View response**.
  It is the only place that shows messages, history and failures. Nothing in it duplicates elsewhere.
- **Resync** = move DATA on demand, never messages. One short table, one row per inbound entity
  (Customers, Contacts, Products, Projects): name, last run in one line ("Today 17:29, 6 records"),
  the automatic schedule dropdown (Off / Hourly / Daily), and two buttons **Sync now** and **Full
  resync**. Under the table one quiet block **Send a record** (type, record, Send; replaces the old
  Push to ERP button) and, for a single entity, an optional "Only these records" field (ids or
  numbers) so one or many records can be re-synced without the whole entity. No run history here
  (it is Monitor, filter by entity), no failed list here (it is Monitor), no payloads here.
- **Mapping** keeps only field mapping (and the entity's enable checkbox on its header); the
  schedule and sync buttons are NOT repeated there.
Each thing lives in exactly one place: messages in Monitor, data sync in Resync, field maps in
Mapping, connection in Connections, what to send in What goes out.
