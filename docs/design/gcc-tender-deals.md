# GCC tender deals and the Deal Room — design (2026-10-25)

Owner: "like it, go ahead", plus "a deal room where you bring people within your company or the client and discuss the bid
instead of email ping-pong. It should not impact the standard flow, this is the GCC edition of deals."
First user: KAMCO (possible client; bids on Aramco and other tenders, runs projects in ePROMIS). Brainstorm page and owner
answers: memory `kamco-prospect`. Nothing here changes a standard deal.

## 0. Rule that governs everything: the standard flow does not move

- Flag `gcc_tender` (platform-admin only, default off, missing = false) turns on the whole edition. Sub-flag `deal_room` (also
  platform-admin, default off) turns on the Deal Room inside it. A workspace without them sees no change anywhere.
- No column is added to `opportunities`. A tender is an ordinary deal plus one row in a side table. No row = standard deal.
- Standard stages (`config.opportunity_stages`) and the standard board are untouched. Tender deals use their own stage list
  and their own board tab.
- Every new code path starts with the flag check and degrades silently when a table is missing (42P01 / PGRST205).

## 1. What is already there (checked 2026-10-25)

| Need | Already built | Where |
|---|---|---|
| Deal | `opportunities` (0120), lines, stages in `config.opportunity_stages`, Pipeline board, detail page, owner/team, loss reasons, competitor | `src/app/(app)/pipeline`, `src/app/api/opportunities`, `src/lib/constants.ts` |
| Types as data | Sales order types (numbering, statuses, fields, PDF design) | `docs/design/sales-order.md`, migration 0212, `src/app/api/sales-order-types` |
| Email in | Inbox: channels, create-from-email, default action. Creates quote, project (Workforce), case, estimate, lead. **Not a deal.** | `src/lib/inbox/{types,creators,convert}.ts` |
| Estimate, BOM, cost | Estimates (templates, BOM, WBS, cost build-up, Excel/PDF/drawing read, send as ERP project) | `src/lib/estimator`, `docs/estimator-architecture.md` |
| Supplier RFQ | RFQ (0128), RFQ to purchase order (0130), several suppliers per product (0132), reply route | `src/app/api/rfqs`, `src/app/api/rfq-reply` |
| Comments | Record comments with mentions, timeline, inbox (`record_comments`, service-role writes since 0211) | `src/app/api/nova/comments` |
| No-login access | Signed stateless links for quote and sales-order PDFs | `src/lib/salesOrderPublicLink.ts`, `quotePublicLink.ts` |
| Sending mail | `resolveOutbound` (demo safeguard), email log | `src/lib/emailOutput.ts` |
| ERP handover | Integration middleware with a Project target and an ePROMIS adapter (REST, built from their API docs, none yet) | `docs/design/integration-middleware.md`, `erp-connectors-sap-epromis.md` |

Not there: tender fields, tender stages, a deal created from an email, a place for the client to take part, supplier reply
comparison, project with budget, subcontract packages.

## 2. Ground rules for a new object (bpmsquarecore 3c), one line each

1. Simple: a tender is a deal with a "Tender" tab; five fields to start (number, issuer, portal, closing date, source).
2. Ease: Inbox "Create deal" in one tap; same words as the standard deal.
3. Not crowded: explanations behind the InfoTip; no running text.
4. Collapsible: tender tab sections remember their state; room lists page.
5. Pricing choice: not applicable to tender fields; estimates keep their own pricing.
6. Documents: the bid PDF is the existing quote/estimate PDF; the room shares files, it does not print.
7. Flow: born from an email (Inbox), a lead, or by hand; `source_*` is the existing deal source plus `tender_source_email`.
8. AI: Assistant read access and Talk to data through `LIST_SOURCES` entries for tenders and room questions; create-card
   deferred with a stated reason in `src/lib/actions/registry.ts`; room summary is a later AI step.
9. ERP: nothing new at slice 1 (deal has no ERP counterpart); handover is slice 7.
10. Change log: tender create/update/decision logged with `logChange`.
11. Types per object: Tender is the first deal type. The mechanism is data (`deal_types`), so a workspace can add another
    (for example "Framework call-off") without code.
12. Visual: record page opens with closing-date countdown, bid decision, stage, value and open questions; mock-up in section 6.

## 3. Slice 1 — Tender deal type (build now)

### Data (migration 0220, next free number; check the folder at build time)
- `deal_types`: `id, tenant_id, code, name, stages jsonb` (OpportunityStageDef[]), `active`, `sort`, timestamps. Seeded with one
  row, code `tender`, by the flag-on path (idempotent). RLS standard tenant isolation; the table is configuration, written by
  admins through an API route only (follow 0199: members read, writes service-role/admin route).
- `opportunity_tenders` (1:1 on `opportunity_id`, primary key): `tenant_id, opportunity_id, deal_type_id, tender_no, issuer_name,
  issuer_account_id (nullable, verified same-tenant), portal text (ariba|email|excel|other), closing_at timestamptz,
  bid_bond_amount numeric(14,2), bid_bond_currency, bid_bond_expiry date, addenda_count int default 0,
  decision text (null|go|no_go), decision_reason text, decided_by uuid, decided_at, source_email_id uuid, custom_data jsonb,
  reminders_sent jsonb default '[]', timestamps`. RLS standard. Unique (tenant_id, tender_no) where tender_no is not null.
- Default tender stages: Received, Bid/No-bid, Estimating, Submitted, Clarifications, Awarded (closed, won), Lost (closed, lost),
  No-bid (closed, dropped). Tenant-editable later; fixed in code for slice 1 as `DEFAULT_TENDER_STAGES`.
- The 12 surfaces of 3b that apply: feature flag in `TenantFeatures` + TenantEditor + NewTenantForm; `OBJECT_FEATURE` entry for
  any new object key (`opportunity_tender`); change-history filter entry; `LIST_SOURCES` entry (tenders); Nova timeline already
  on the deal; custom fields via `custom_data` is exposed in Settings -> Custom fields as object `tender` only if cheap, else
  deferred and said so. Deliberate skips are listed in the commit.

### Behaviour
- Pipeline page gets a second tab **Tenders** when `gcc_tender` is on (`useUrlTab`). The standard tab and standard board filter
  OUT deals that have a tender row, so the two boards never mix.
- New tender: a form with the five start fields plus account; creates the deal and the side row in one API call
  (`POST /api/opportunities/tender` or a `tender` block on the existing create; builder chooses, standard POST must behave
  exactly as before when the block is absent).
- Stage changes on a tender deal validate against the tender stages, not `config.opportunity_stages`. A closed tender stage
  sets the same outcome fields the standard closed stage sets (won / lost / dropped) so reports and win/loss keep working.
- Tender tab on the deal page: fields, bid/no-bid decision (go or no-go, reason required for no-go, who and when), bond block,
  addenda count, closing-date countdown chip (amber under 7 days, red under 2 days or past).
- Inbox: add `deal` to the create types, shown only when the flag is on. The creator calls the deal create route in-process,
  like the others, with `tender_source_email`. Channel default action may be `deal`.
- Closing-date reminders: at 7, 3 and 1 day before and on the day, to owner and team, through `resolveOutbound` and the email
  log, recorded in `reminders_sent` so none repeats. Use the existing cron mechanism (`api/rfqs/cron` and
  `.github/workflows` are the pattern). Plus a "Closing soon" list on the Tenders tab.
- AI: no new AI call in slice 1.

### Done when
Standard Pipeline unchanged with the flag off (test proves the standard create and board code paths are byte-for-byte the
same behaviour); with the flag on, a tender can be created by hand and from an Inbox email, moves through tender stages,
shows the countdown, records a go/no-go, and a reminder is produced once per threshold. Checked at 375 px and on PC.

## 4. Slice 2 — Deal Room

A room belongs to one tender deal. It replaces e-mail ping-pong for bid questions. Internal colleagues and people at the client
(or a partner) take part in one place. Gated by `deal_room` inside `gcc_tender`. A deal without a room looks exactly as before.

### Two channels, never mixed
- **Team** channel: internal members only. Pricing, margin and strategy live here.
- **Client** channel: internal members and guests. This is the only channel a guest can ever read or write.
- A message belongs to exactly one channel, chosen when posting, shown by a clear label and colour. The composer opens on Team
  by default; posting to Client asks for no extra confirmation but is visibly different. Moving a message between channels is
  not allowed (post again). This is the main safeguard against leaking internal content.

### What a room holds
- Messages (plain text with links, @mentions of members), threaded one level.
- Files (private storage, signed short-lived URLs, type allowlist, size cap, no SVG/HTML). A file is posted in one channel.
- **Questions** (the clarification log): a message can be marked a question with owner, due date, status open/answered. The
  deal's Tender tab shows the open count. This is slice 4's clarification log, delivered here.
- **Decisions**: a pinned one-line entry ("Agreed to bid with alternative cladding"), kept in order.
- Member list with role chip (internal / client / partner) and last seen.

### Who can join
- Internal: any workspace user who can open the deal, added by the owner or team (or by themself if on the team).
- Guests: invited by email by an internal member. The invite sends a link signed with `QUOTE_PUBLIC_LINK_SECRET` (label
  `deal_room`), bound to the guest row id. Opening it asks for a six-digit code emailed to the same address (so a forwarded link
  alone is not enough), then sets an httpOnly, SameSite=Lax, path-scoped session cookie of 12 hours. Guest rows are revocable
  at once (`revoked_at`); verification reads the row every time, unlike the stateless quote links.
- Guests never get a BPMSquare login, never see the deal, the estimate, prices, other rooms or other tenants, and use only
  the room routes below.

### Data (migration 0221)
`deal_rooms` (one per opportunity, unique), `deal_room_members` (internal user_id or guest email, role, invited_by, revoked_at,
last_seen_at), `deal_room_messages` (channel, body, parent_id, author_member_id, question fields, pinned decision flag,
created_at, deleted_at; append-only, delete is a soft delete shown as "removed"), `deal_room_files`, `deal_room_guest_sessions`
(code hash, attempts, expires_at). All have `tenant_id`, RLS enabled with **no member write policy** (service-role routes
only; members keep SELECT where it is useful for the internal app, guests have no database access at all).

### Routes
Internal (session, `requireTenantUser`, flag and deal access checked, explicit tenant filters):
`/api/deal-rooms/[opportunityId]` (get/create), `/members`, `/messages`, `/files`, `/questions/[id]`.
Guest (own auth, never `requireTenantUser`): `/api/room/[token]/{verify,session,messages,files}` and the page `/room/[token]`.
The guest page and routes are added to the public path list in middleware with `$`-anchored regexes. Every guest route resolves
room and tenant from the verified guest row, never from the request body, and filters `channel = 'client'` in the query itself.

### Live feel without realtime
Poll every 10 s while the tab is visible (cursor by created_at), back off when hidden. Unread counts per member. No websocket
in v1, so there is no channel-subscription leak surface.

### Notifications
New message in a room emails the other members at most once per 15 minutes per member (digest), through `resolveOutbound` and
the email log, with a link to the room. The email says who wrote and shows the first 120 characters of a Client-channel
message only; Team messages notify internal members only. No reply-by-email in v1 (later, through the Inbox).

### Security checklist (must be tests)
- A guest session cannot read a Team message, a Team file, another room, the deal, or any API outside `/api/room/*`.
- A guest cannot post to Team; the channel for guest posts is forced server-side to client.
- Guest A cannot use guest B's cookie in another room (cookie is bound to the member id and room id and checked against the row).
- Revoked guest and expired code fail closed. Code attempts limited per guest row (5) and per IP is not relied on.
- Message bodies render as plain text (no HTML), links get `rel="noopener noreferrer"`. File names sanitised.
- Cross-tenant: internal routes prove the opportunity belongs to the tenant before any room query; guest tokens carry no tenant.
- Demo workspace: invites go through `resolveOutbound` so a demo room can never email a real customer.

### Visual
Room opens as a tab on the tender deal (and a full-page view at `/pipeline/[id]/room` on phones). Left: members and open
questions; centre: channel switch (Team | Client) over the thread; right on PC: files and decisions. One column under 900 px.
The Client channel header carries a persistent line "Guests can see this channel" so the person posting always knows.

### Done when
The security checklist passes as tests; a guest can join from an emailed link and exchange messages and files with an internal
member; Team content is invisible to the guest by test and by hand; the standard deal page with the flag off is unchanged.

## 5. Later slices (unchanged from the brainstorm, renumbered)

3. Client Excel BOQ read keeping their layout, priced Excel written back in their layout; Ariba answer sheet; supplier RFQ
   comparison feeding the estimate line with a validity date.
4. Bid rounds (a saved version per submission with what changed), "log a call" entry, winning price and hit-rate by client.
   (The clarification log comes from the room.)
5. Project, budget lines by cost type, baseline lock and revisions; created from a won tender; link to a Workforce project later.
6. Subcontract packages, RFQs to partners, subcontract orders.
7. Handover to ePROMIS through the API (Excel export as a stand-in until their documentation arrives).

## 6. Mock-up, tender record page (slice 1)

```
SAR 4.8M   Closes in 5 days (Thu 30 Oct, 12:00)   Stage: Estimating   Decision: Go (A. Nasser, 21 Oct)
-------------------------------------------------------------------------------------------------
[Tender]  Estimate  Quotes  RFQs  Room  Timeline
 Tender no. ARB-4400123   Issuer: Saudi Aramco   Portal: Ariba   Bond: SAR 96,000 (expires 30 Jan)   Addenda: 2
 Open questions: 3        Closing soon list on the Tenders tab: 4 tenders in the next 14 days
```

## 7. Decisions taken by default (change on request)

- Tender is a deal type on the Pipeline, not a new object. Room guests use emailed code plus link, not accounts.
- Two channels, no moving of messages. Polling, not realtime. No reply-by-email in v1.
- Bid/no-bid is a recorded decision with reason in slice 1; the approval engine can drive it later.
- The room is for tender deals first; it can be offered on standard deals later by a workspace switch, not now.

## 8. Slice 1 as built (2026-10-25)

Sections 0 to 3 of this document are the spec, section 4 (Deal Room) is not built. What exists, and where it differs from the text above:

- **Migration `0220_tender_deals.sql`** (bundle 31, PENDING on both databases): `deal_types`, `opportunity_tenders` (primary key `opportunity_id`, unique `(tenant_id, tender_no)`), each with RLS and a tenant SELECT policy only (every write is a service-role route; the spec's "standard tenant isolation" was tightened so a member cannot forge a decision or clear the reminders). It also widens four Inbox CHECK lists (`default_action`, `linked_object_type`, `record_files.object_type`, `record_sources.object_type`) and `email_log.kind` (+`tender`), each guarded to run only where the table exists. **No column on `opportunities`.**
- **Flags** `gcc_tender` (needs `pipeline`) and `deal_room` (declared only, nothing reads it) in `TenantFeatures`, the tenant editor and the new-tenant form; platform-admin only, default off.
- **Stages**: `DEFAULT_TENDER_STAGES` in `constants.ts`. Stage values differ from the standard list on purpose (`bid_lost`, not `lost`). `PATCH /api/opportunities/[id]` picks the list with `stagesForDeal`; with the flag off it asks nothing of the database (`tenderForDeal`). `refreshOpportunityDerived` falls back to the tender list only when the stored stage is not in the list it was given.
- **API**: `POST /api/opportunities/tender` (a separate route, so the standard `POST /api/opportunities` is untouched), `GET/PATCH /api/opportunities/[id]/tender` (allow-list `parseTenderFields`), `POST /api/opportunities/[id]/tender/decision` (who and when from the session and the server clock). A deal and its tender row are made together; a failed second insert takes the deal back out.
- **Screens**: Pipeline gets Deals | Tenders tabs (`useUrlTab`) only with the flag on; a "Closing soon" section and the same board with the tender stages; `/pipeline/new/tender`; a Tender tab on the deal page (details, decision, bond, each collapsible and remembered), the closing chip and decision in the header strip. Explanations are in `src/lib/tender/tips.ts`.
- **Inbox**: `deal` is the sixth create type, listed only with the flag; the creator calls the tender route in-process with `tender_source_email`, portal `email`. A channel may prefer it.
- **Reminders**: `GET /api/tenders/cron/reminders`, daily at 04:30 UTC in `vercel.json` (this repository has no `.github/workflows`; scheduled jobs are Vercel crons). Thresholds 7, 3, 1 and 0 days, claimed with a compare-and-set before sending. Reminders stop once the bid is submitted (stage after Estimating), the tender is closed, or the decision is no-go.
- **Deliberately not in slice 1**: the `deal_types` admin route and a workspace-editable stage list; a demo seed; an API-key panel entry for the `tenders` scope (the scope exists and is explicit-only); a Data Workbench object for tenders; analytics tiles; a v1 endpoint; a dedicated search object (a tender is found as the Deal it is); the assistant create card (deferred with a reason in `src/lib/actions/registry.ts`); the "Open questions" figure of the mock-up (comes with the Deal Room).

## 9. What the ePROMIS masters tell us (owner screenshots, 2026-10-25; read from screens only, not confirmed with KAMCO)

Three screens: Resource Master (two views) and Cost Code.

- **Two separate classifications, not one.** *Resource* says what is spent: the eight levels 11 Material, 21 Asset, 31 Man Power,
  32 Hiring Man Power, 41 Sub Contractor, 51 Other Direct Cost, 91 Revenue, 92 On Account - Other Billed. *Cost code* says
  where in the work it is spent. A budget line therefore carries both: a resource and a cost code.
- **Cost Code is the CSI MasterFormat tree.** Division 00 "Procurement and Contracting" opens to 0010 Solicitation, 0020
  Instructions for Procurement, 0040 Procurement Forms, 0041 Bid Forms, 0051 Notice of Award and so on. Each node has code, name,
  a Division Code (links to Division Setup), Status (Active) and an "Est. Ref #". A "Related Head" button links nodes.
- **Material resources use the same classification below level 11.** Codes such as 1105 Metals, 1106 Wood, Plastics, 1107
  Thermal and Moisture, 1108 Openings, 1109 Finishes, 1133 Utilities, 1146 Water and Wastewater, then items beneath
  (Slotted Channel Framing, Cold-Formed Metal, Decorative Metal ...). Level 11 is the MasterFormat division number in front of
  the section number.
- **Fields on a resource:** Code, Name, "Link to inventory" (the material is a stock item), "Budget Validation" (the system
  checks spending against budget for this resource), Sales Stock Revenue Account, Sales Non-Stock Revenue Account, Purchaser Code
  and Purchaser Name.

### Consequences for the design (slices 3 to 7)

1. **Budget line = resource + cost code + amount**, with quantity and unit where the resource is a material. Both lists are
   *pulled from ePROMIS* through the connector (read-only reference lists, refreshed on demand), not typed in BPMSquare, so
   every code on a project is valid in ePROMIS when the handover arrives. This is the "valid-code pick lists from the ERP"
   item already queued for the ERP connectors.
2. **Cost types shown to the user** are the resource levels (Material, Asset, Man Power, Hiring Man Power, Sub Contractor,
   Other Direct Cost). Revenue (91) and On Account (92) are the income side of the project, not cost types.
3. **Estimate lines map in:** an estimate BOM line gets its resource from the item type and its cost code by mapping a product
   category to a MasterFormat node (value mapping, same mechanism as sales area). The first import of a client's BOQ Excel will
   usually already carry a MasterFormat code; keep it as given.
4. **Budget Validation is a project rule, not our decision:** a resource flagged for validation blocks or warns when committed
   cost (PO, subcontract) would exceed its budget. Build the warning in slice 5 using the flag read from ePROMIS.
5. **Tender stages map to ePROMIS "Project Tender Status"** by value mapping once KAMCO's status list is known (not in the
   screenshots yet).
6. **Still unknown, asked of the owner:** the Project Tender Status values, a tender entry form, a project budget screen, the WBS
   Master screen, and whether Cost Code and Resource Master are exposed in their API.

## 10. Owner answers from the KAMCO questions (2026-10-25) — these override earlier sections

| Topic | Owner answer | Effect on the design |
|---|---|---|
| ePROMIS API | Exists and covers tenders, projects, budgets, Resource Master and Cost Code. The owner saw it. | Masters are pulled through the connector. Still needed: the API documentation and a sandbox login (owner to obtain). |
| Tender statuses | Our own, not copied from ePROMIS. | Section 9 item 5 is dropped: no status mapping. Stages stay as built. |
| When ePROMIS gets the project | After the bid is awarded. | Handover = "create project and budget in ePROMIS" at award. Nothing goes to ePROMIS before. |
| Intake | Mostly client Excel, sometimes Ariba forms. | Slice 3 BOQ Excel in and out comes first; Ariba answer sheet second. |
| Deal Room guests | KAMCO internal people only for now; clients later if they ask. | **Slice 2 is internal only.** No guest links, codes, guest routes or public middleware paths. Messages keep a `channel` column (only `team` used) so a Client channel can be added later without a migration. Section 4's guest design is parked, not deleted. |
| Tender fields | As per the standard flow. | Slice 1 fields stay. No more fields added now. |
| Bid / no-bid | Needs manager approval. Not done in any system today. | New slice 1b (below). |
| Bid bond | Track whether it has been released. | Add bond status and release date (slice 1b). |
| Bid rounds | Not a fixed number. | Versions unlimited; no cap anywhere. |
| Pricing sources | BOQ, BOM and past projects, all three. | Slice 3 prices a line from any of the three and shows which source set the price. Past projects = our awarded tenders and projects, and later ePROMIS history through the API. |
| Supplier prices | A price older than 6 months is not used; raise at least 3 RFQs to a supplier group, then decide. | Price validity default 180 days (workspace setting). A stale price is shown but never auto-used. **No minimum number of suppliers (owner, 2026-10-25): an RFQ goes to any number of suppliers.** The choice records who decided and why when it is not the lowest. |
| Award and project | "You decide what is best." | Decision below. |
| Reporting | Later, but it must be full. | Slice 8. Every fact reporting needs is captured from slice 1 on (see below). |

### Decision: how the award becomes a project (mine, change on request)
1. **Awarded** (the closed won tender stage) offers "Create project". BPMSquare creates a Project from the won estimate: budget lines
   by resource and cost code, baseline locked, each later change a revision with a reason.
2. A **manager approves the baseline** before it leaves (same approval mechanism as bid/no-bid).
3. On approval BPMSquare **creates the project and budget in ePROMIS through the API** and stores the ePROMIS id (the standard
   ERP id line, shown on the record only). From then on ePROMIS runs execution: purchasing, subcontract orders, claims.
4. BPMSquare keeps the baseline and **reads committed and actual cost back** from ePROMIS (read-only) so variance, margin
   forecast and reporting stay in one place. If the API cannot give actuals, reporting shows baseline only and says so.
5. **Subcontract packages (slice 6) are planning only here**: scope, budget, RFQ to at least 3 subcontractors, recorded
   choice. The subcontract order itself is made in ePROMIS.

### Slice 1b — bid/no-bid approval and bond release (build next, small)
- A team member **proposes** go or no-go with a reason. A **manager approves or rejects** with a comment. Approvers are a list
  chosen in Settings (default: workspace admins); the proposer cannot approve their own proposal (setting
  `tender.allow_self_approval`, default off, so a one-admin workspace can switch it on).
- The stage cannot leave Bid/No-bid for Estimating without an approved **go**, and cannot go to No-bid without an approved
  **no-go**; both enforced on the server, not only in the form. Rejection returns the deal to Bid/No-bid with the comment.
- Approver gets an email (`resolveOutbound`, email log) and an entry in the Nova inbox; the proposer is told the outcome.
- Bond: status `held` / `released`, release date, and who released it; "bond expiring" chip uses expiry as before; a released
  bond stops the expiry warning.
- Every decision is stored as an event row, not only as the latest state, so reporting can see the history.

### Facts captured from now on, for the full reporting later (slice 8)
Stage changes with timestamp and person (change log already has them; tender reads must not depend on diffing text), each go/no-go
proposal and decision with reasons, bid versions with total at each submission, RFQ sent/reply/award timestamps and the number of
quotes compared, price source per estimate line (BOQ, BOM, past project, supplier RFQ), bond status changes, closing date changes,
win/loss reason and winning price. Slice 8 reports: funnel and hit rate by client, consultant and tender type, bid cost and time,
closing calendar, bond exposure, price variance bid vs award vs actual, margin forecast vs actual, supplier response and price
history, approval turnaround.

### Revised slice order
1 Tender deal type (built). **1b** approval and bond release. **2** Deal Room, internal only. **3** BOQ Excel in and priced Excel out,
Ariba answer sheet, price validity and 3-quote RFQ comparison, past-project price source. **4** Bid versions, log a call, outcome facts.
**5** Pull ePROMIS masters, Project and budget, baseline approval, create in ePROMIS at award, read back actuals. **6** Subcontract
packages (planning). **7** Ariba/other portal helpers and anything left. **8** Full reporting.

## 11. Slice 1b as built (2026-10-25): bid / no-bid approval and bond release

Section 10 is the spec. What exists, and where it differs from the text:

- **Migration `0221_tender_approval_and_bond.sql`** (bundle 32, PENDING on both databases): `approval_requests` (generic: `object_type`, `object_id`, `kind`, `proposed_value`, `reason`, `requested_by`, `status`, `decided_by`, `decided_at`, `decision_comment`) with a tenant SELECT policy only, and `bond_status` / `bond_released_at` / `bond_released_by` on `opportunity_tenders`. One row per proposal, so **the rows are the event history** (no second events table): a rejected or withdrawn proposal stays, a new proposal is a new row. A partial unique index allows one pending proposal per record and kind. Not an engine: slice 5 reuses the table with another `kind`.
- **Rules** are pure (`src/lib/tender/approval.ts`, `bond.ts`); the server side is `approvalServer.ts`, notifications `notify.ts` (the mailer and member lookup moved out of `reminders.ts` so the closing reminders and the approval mail share one sender).
- **Who decides:** `config.tender.approvers` (user ids, Settings > Tenders, admin-only API `/api/settings/tender`, ids checked against `tenant_users`), default every workspace admin. A chosen person who left counts for nothing; if none of the chosen remain, the admins decide again. The proposer cannot decide their own proposal unless `config.tender.allow_self_approval`. A proposal is refused up front when nobody else could approve it. One approval by any one approver settles the proposal (compare-and-set on `status = pending`).
- **Flow:** `POST /api/opportunities/[id]/tender/approval` proposes (go or no-go, **reason required for both**); `PATCH .../approval/[requestId]` approves, rejects (comment required) or withdraws. Approval writes the decision, reason, approver and time onto the tender row, so every existing reader (`tenderIsLive`, reminders, Talk to data) keeps working; the stage does **not** move by itself, the Tender tab offers "Move to Estimating / No-bid". Rejection returns a Received deal to Bid/No-bid. Proposals are possible only while the deal is in Received or Bid/No-bid; to reverse a go later, move the deal back and propose again.
- **Stage guard** in `PATCH /api/opportunities/[id]` (only for a deal with a tender row, so a standard deal never reaches it): into No-bid needs the standing decision to be an approved no-go; from a stage before the bid (Received, Bid/No-bid, No-bid) into Estimating or later needs an approved go. The standing decision is the latest approved proposal. Until 0221 is applied the guard stays at its slice-1 behaviour (a deliberate degrade, otherwise every tender would be locked behind a screen that cannot work).
- **Slice-1 decisions** stay readable and are shown as "Recorded before approval was required". They do **not** unlock a stage. The old `POST .../tender/decision` route is deleted.
- **Notifications:** approvers get an e-mail (`resolveOutbound`, `email_log` kind `tender`) and an entry in the Nova inbox; the proposer gets the outcome the same way. The inbox entry is a system comment on the deal that mentions the person (the inbox already is "a comment that mentions you"), so no second notification table; it also shows on the deal's Activity. The inbox is a Nova surface; a workspace without it still gets the e-mail.
- **Bond:** `POST .../tender/bond { action: "release" }` (confirmation in the UI); who and when from the session. A released bond clears the expiry chip (amber inside 30 days, red once expired) and the "Bid bond" line that closing reminders now carry while the bond is held.
- **Logged** (`logChange`, object `opportunity_tenders`): proposal, approval, rejection, withdrawal, bond release, and the approver settings. Reads and the reminder job degrade on 42P01 / 42703 / PGRST205.
- **Deliberately not done:** the bond fields in the Talk to data source; a separate approvals inbox screen; delegation or several-approver thresholds ("two approvals" is not a rule here: one approver is enough).

## 12. Slice 2 as built (2026-10-25): the internal Deal Room

Section 4 as changed by section 10 is the spec: **internal only**, so sections 4's guest links, codes, guest tables, guest routes and public middleware paths do not exist and are not built. What exists:

- **Migration `0222_deal_room.sql`** (bundle 32, PENDING on both databases): `deal_rooms` (unique per deal), `deal_room_members` (also holds `last_seen_at`, `last_read_at`, `last_digest_at`, so unread and the digest need no extra table), `deal_room_messages`, `deal_room_files`, each with a tenant SELECT policy only (every write is a service-role route, 0199 lesson), and the private bucket `deal-room-files`. `channel` is `text not null default 'team' check (channel = 'team')`: a client channel later means widening one check, not migrating the table. No column on `opportunities`.
- **One gate** (`openRoomRequest`, `src/lib/tender/roomServer.ts`): flags `gcc_tender` + `deal_room` + `pipeline`, the caller's view of the Pipeline workcenter, and a tender deal of THIS workspace (matched by id AND tenant). Any miss is the same 404. The workspace always comes from the session. Anyone who passes can read and post; membership only decides who is followed (unread, digest), and posting makes you a member.
- **Routes** `/api/deal-rooms/[opportunityId]` (GET header / POST open), `/messages` (GET latest, `before`, or `since`; POST JSON or multipart with up to 5 files), `/messages/[messageId]` (PATCH answer / reopen / remove), `/members` (POST add by name, DELETE leave or remove), `/read`, `/files/[fileId]` (303 to a 60-second signed link). Daily digest: `GET /api/tenders/cron/room-digest` every 15 minutes.
- **Messages** are plain text (the screen puts text in text nodes and http(s) links in anchors with `rel="noopener noreferrer"`; nothing is rendered as HTML), threaded one level (a reply to a reply goes under the root), append-only: no edit; delete is soft (`deleted_at` / `deleted_by`), the row stays, the text, files and mentions are never sent to a screen again ("Message removed"), and it is logged under change-history object `deal_rooms`. Author, room, channel, time and mentions are the server's; mentions are read from the `@name` in the text and only members of the room count.
- **Questions** are messages with an owner (a member of this workspace), a due date and open / answered; the owner, the author or an admin answers or reopens. **Decisions** are one pinned line (200 characters), kept in order, no files. The Tender tab shows the open count beside the closing date and opens the room on the questions; the Room tab and the Tenders list show the unread count.
- **Files** reuse the Inbox's byte-sniffing allow-list (`sniffAttachment`: PDF, Word, Excel, DXF, DWG, CSV, text, PNG, JPEG; SVG and HTML are refused whatever the name says) and name sanitiser, 15 MB each. `record_files` was not reused: it is typed to the email-to-record copy (a fixed list of object types, `source` defaults to `email`) and has no link to a message; the room has its own `deal_room_files` and its own bucket.
- **Live feel:** the screen polls every 10 s while visible, does not poll while hidden (checks again at 60 s), doubles the wait after each failure up to 2 minutes; the cursor is the server time of the last answer minus 2 s, the server returns rows created OR changed (answered, removed) after it, and the client de-duplicates by id. `last_seen_at` is written at most once a minute.
- **Notifications:** a mention or an assigned question puts an entry in the Nova inbox (a system comment on the deal that mentions the person, the same mechanism as the approval note), at once. The e-mail digest is one per member with unread messages from others, at most one per 15 minutes, claimed with a compare-and-set before it goes, through `resolveOutbound` and `email_log`; removed messages and decisions are never quoted.
- **Screens:** a Room tab on the tender deal (PC: members and open questions on the left, thread and composer in the middle, decisions and files on the right; every side panel is a collapsible section), one column under 900 px. On a phone the tab is a card with a button to `/pipeline/[id]/room`, the same room as a page of its own. Explanations sit behind the "i" (`tips.ts`, held to the limit by test).
- **Deliberately not done:** Talk to data (`LIST_SOURCES`) for open questions (it needs a new explicit API scope and a v1 route for little gain; revisit with slice 8 reporting); a header "Questions" fact on the deal; reply-by-email; removing or editing a message's files after posting; an AI room summary. Not verified in a browser from this environment (the tenant is resolved from the hostname); the layout is checked by render tests and the CSS grid rules only, so 375 px and PC need an eye on develop.

## 13. Slice 3b as built (2026-10-26): RFQ reply comparison and the recorded award

Section 10 ("Pricing sources", "Supplier prices") is the spec, with the owner's later change: **an RFQ goes to any number of suppliers, including one; there is no minimum anywhere.** This section is self-contained; the tender BOQ and line pricing of slice 3a are described in their own section. What exists, and where it differs from the text above:

- **What was already there.** RFQ (0128) already supports `origin_type = 'opportunity'`, a deal's RFQ card on the Related tab, a per-line "Request quotation", `suggest-suppliers` (history chips and the current supplier, by product), a Compare & award tab with a lowest-price highlight, a per-line award with an exchange rate, "Award all", and RFQ to purchase order (0130). This slice extends those; it does not add a second comparison or a second award path.
- **Migration `0224_rfq_awards.sql`** (bundle 34, PENDING on both databases): `rfq_line_awards` and `product_suppliers`, each with a tenant SELECT policy only (every write is a service-role route). No column is added to any existing table, `opportunity_lines` included. `rfq_line_awards` holds one row per decision: `chosen_by`, `chosen_at`, `reason`, `not_lowest`, the awarded landed price and the benchmark it was held against, `superseded_at/by`, and `applied_to_deal_at/by/rate`. A partial unique index allows one standing award per line; a changed award supersedes the old row, so the history stays. A check forbids `not_lowest` without a reason. **`product_suppliers` did not exist** (0132 only added `products.supplier_id`; the table was designed as Sales Engine Piece G and never built), so this migration creates it in the slim shape of that design: one row per (tenant, product, supplier) with cost, quoted price and currency, lead time, MOQ, validity, `as_of`, `source` (`manual`, `rfq`, `import`) and a `preferred` flag an award never touches. The pricing engine does not read it yet; the cost input an award writes is still what the engine uses.
- **Rules are pure** (`src/lib/rfq/comparison.ts`): validity (a stated `valid_until` is valid through that day; without one an answer is stale after `config.rfq.price_valid_days`, default 180, Settings > RFQ), the lowest valid landed price per line, the decision "not the lowest" (dearer than the lowest valid, or itself expired or stale while another answer is valid; ties are not "not lowest"; when nothing on the line is valid the cheapest is the benchmark), coverage ("covers N of M lines"), supplier totals, the chase date (the reminder job writes the day before and the day after the reply-by date, up to the workspace limit), and the age of an answer. The screen and the route use the same functions; the route re-checks everything.
- **Comparison** (`src/components/rfq/RfqCompare.tsx`, the Compare & award tab): one row per line, one column per supplier; unit price (with the landed price for a foreign quote and a hint when no exchange rate has been typed), lead time, MOQ, validity or "Expired"/"Stale", notes, "Answered 6 d ago". Blue marks the lowest valid price, amber an expired or stale answer, green the award. Column header: status, "Covers N of M lines" and the total of the quoted lines, or "Waiting" with the next reminder date (or "Overdue since ...: chase now"). The table scrolls in its own container; the item column sticks only above 900 px; controls are 44 px under 900 px. Explanations sit behind the "i" (`src/lib/rfq/tips.ts`, held to the limit by test).
- **Award** (`POST /api/rfqs/[id]/award`, extended; same shape plus `reason` and `replace`): every check runs before the first change (line and answer belong to this RFQ and workspace, the supplier is still on it, the answer is a real quote); 409 `already_awarded` when the line has an award and `replace` was not sent; 409 `on_purchase_order` when the standing award is already on a purchase order; 422 `reason_required` when a chosen answer is not the lowest valid price (one reason covers every such line of an "Award all"); 503 while 0224 is pending, with nothing changed. The standing award is superseded by compare-and-set and the new row inserted before the existing `awardLine` runs, so two people awarding the same line at once cannot both win (the loser gets the 409, the first award is untouched). `awardLine`, the cost input, the line status and the header status machinery are unchanged; so is the purchase order conversion, which reads the same awarded responses. A catalog line also upserts `product_suppliers` (source `rfq`, as of today, validity from the answer). The reason is also written to the change history of the RFQ.
- **Use these prices on the deal lines** (`POST /api/rfqs/[id]/apply-to-deal`): for an RFQ raised from a deal, sets the rate of each deal line whose `rfq_line_id` has a standing award to the awarded landed price (rounded to 2 places), by calling the deal's own line save (`PUT /api/opportunities/[id]/lines`) in-process, so the deal's line rules, amount and total apply unchanged; needs edit on the Pipeline. **Deviation from the brief:** the deal line has no note or source column and none was to be added, so the "source label" is the RFQ chip the line already carries, the change-history entry on the deal ("line 3 rate (supplier RFQ RFQ-0012)", from, to) and `applied_*` on the award. The price is the supplier's cost entered as the rate; the person adds their margin on the deal, and the dialog and the "i" say so.
- **Request supplier prices** on a tender deal's Lines tab (`TenderLinesRfq`; only with `gcc_tender` and `rfq`, so a standard deal is unchanged): opens the ordinary RFQ form with the saved lines (unpriced ones ticked, lines already on an RFQ named and unticked), the client's item number carried as "Item no. X" in the line's specification, and a vendors / subcontractors filter on the supplier list (`SupplierType`; "both" shows under either). Disabled with a hint while the lines have unsaved edits.
- **3b list.** Done: `OBJECT_FEATURE` entries for `rfq_line_awards` (rfq) and `product_suppliers` (products); change history (the award and its reason under the RFQ, the applied rates under the deal); capability text for `rfq` and `gcc_tender` and regenerated facts; InfoTips; `data-guide` ids on every control; degradation on 42P01 / 42703 / PGRST205; bundle 34 and the ledger line. **Deliberately not done:** `supplier-stats` stays on the supplier page (calling it per row of a long picker is one request per supplier; the picker reuses `suggest-suppliers`); a Data Workbench, v1, MCP or Talk to data surface for awards and `product_suppliers` (internal buying decisions and costs, in-app only, as the RFQ already is for cost); analytics tiles; a product page "Suppliers" card; an engine rung that reads `product_suppliers`; split-quantity awards; the demo seed. The screens are verified by server render and by the style rules the render test reads; **375 px and PC need an eye on develop**, as for slice 2.

## 14. Slice 3a as built (2026-10-26): the client's BOQ in, a priced Excel out, line price sources

Section 10 (slice 3) is the spec. What exists, and where it differs from the text:

- **Migration `0223_tender_boq.sql`** (bundle 33, PENDING on both databases; needs bundle 31, not 32): `tender_boq_sources` (the original workbook kept in the private bucket `tender-boq-files`, sheet, header row, header texts, column map, the rate/amount columns the priced file writes to, the client's total row; one row per upload, `is_current` marks the live one) and `tender_boq_lines` (row number, item number, cost code, what the file said, the file's own rate, `price_source` / `price_source_ref` / `price_as_of`, `stale_accepted`, internal `unit_cost` and `markup_pct`, `removed_in_revision`). Tenant SELECT policy only; every write is a service-role route. **No column on `opportunities` or `opportunity_lines`**: the BOQ rows are ordinary `opportunity_lines` (the client's item number in `sl_no`, `product_id` where one matches), and the side table holds what the contract has no place for. The bucket is new (not `deal-room-files`) so the BOQ does not depend on the Deal Room migration; it reuses the room's mechanism (private, service-role only, bytes judged by `sniffAttachment`, `safeFileName`).
- **Reading the sheet** (`src/lib/tender/boq/parse.ts`, pure; `workbook.ts` turns an exceljs sheet into a grid, merged ranges keep their text in the top-left cell so a merged title never reads as headers). AI-free: the header row is the one carrying the most known column names (exact names score above looser matches; currency suffixes and brackets are ignored; bilingual headers work), columns map from those names, section headings, blank rows, sub-totals and the grand total are skipped and listed. "Total station survey" is an item, not a total. The client's own total row is remembered. One sheet per upload (the first that reads as the biggest BOQ, or the one the person picks); up to 2,000 lines, 15 MB.
- **Fix the mapping:** `POST .../boq/preview` reads the file and writes nothing; the panel lets a person pick the sheet, the header row and the column of each field (Description and Quantity required, each column once). The choice is stored with the upload (`header_labels` + `column_map`) and reused on the next upload when the header texts still match.
- **Re-upload** matches by key: the item number, else description + unit; repeats get #2, #3. The diff (added, changed, unchanged, removed, kept) is shown before anything is written. A line gone from the file is deleted only when unpriced; a priced one is kept and flagged "no longer in the latest file". The deal line follows the file only where the FILE changed since the last upload, so a person's edit of a line survives. The Lines editor saves by delete and re-insert (new ids, sequence numbers), which cleared the link between a BOQ row and its deal line; the link is restored on the next BOQ screen load (item number + description, then description + unit, then description). **Standard route touched once:** `PUT /api/opportunities/[id]/lines` now answers 409 when the deal already has more than 200 lines (it keeps at most 200 and would have deleted the rest); a standard deal never has that many.
- **Price sources** (`sources.ts`, read once for a whole set of lines in batches of 100 ids): the client's own rate (a line the file already priced is set at upload), **BOM** (the roll-up of a product's consumed BOM lines when every component has a cost, or a line of a live estimate for the product), **past project** (a line of an AWARDED tender of this workspace with the same cost code, product or description; selling rates), **supplier** (answered RFQ lines for the product, newest first, and the product's own cost price with its `cost_price_as_of`). A product is found by its link, then SKU = cost code, then exact name. **Changed from the brief:** there is no `product_suppliers` table (0132 adds one preferred `supplier_id` on `products`), so the supplier price is the answered RFQ responses plus `products.cost_price`.
- **Validity rule** (`price.ts`, pure): supplier and past-project prices older than `config.tender.price_validity_days` (default 180, Settings > Tenders, same screen as the approvers, one place) are shown "stale, N days old" and are never applied automatically; a price with no date counts as stale. A person may choose one knowingly (a confirmation; `stale_accepted` is stored). **Price all lines** prices only lines without a rate, supplier fresh then BOM then past project fresh, and lists every line it left with the reason. BOM and the client's rate do not expire (the owner's rule names supplier and past-project prices).
- **Cost and markup:** supplier and BOM figures are costs; the rate is cost plus a markup % entered next to Price all and the picker (default 0, with a visible warning that it sells at cost). `unit_cost` and `markup_pct` stay on the BOQ row, shown on the screen only; the priced file and the answer sheet are given a rate and an amount and nothing else (a test reads the writers and the files). A price never comes from the request except a typed manual rate: the server finds the offered price itself and a made-up supplier label is refused.
- **Priced Excel out:** the ORIGINAL workbook is loaded and the unit rate and amount are written into the saved columns on the saved rows; formats, merges, widths, other sheets and the client's own formulas are kept (an amount cell with a formula keeps it and gets the new result; a total cell with a formula keeps it, a typed or empty one gets a SUM; the file recalculates on open). Unpriced lines are listed in a warning before the download and left blank. **Changed from the brief:** a file with no rate/amount column gets them after the last used column (headed "Unit rate" and "Amount", styled like the quantity header), not beside the quantity column, because inserting columns would shift the client's formulas and merged cells; the screen says so. Charts and drawings in the client's file are not carried over by the library.
- **Ariba answer sheet:** `GET .../boq/export?kind=answer` gives a clean .xlsx (item, description, unit, quantity, rate, amount, notes; notes = cost code, or "Not priced") with a total; no portal automation.
- **Screens:** a BOQ tab on the tender deal (Client's BOQ, Lines and prices, Download; each collapsible and remembered; lines are wrapping cards, no table, so phone and PC share one layout; every control is 44 px tall; explanations in `tips.ts` behind the "i"). View-only users see lines and can download but not upload or price.
- **Wiring (3b):** `OBJECT_FEATURE` for both tables (`gcc_tender`), capability document and regenerated facts, the settings menu text, change history (the existing "Deals: Tender details" filter: BOQ upload, rate and price-all entries), ledger and bundle 33. **Skipped, on purpose:** Talk to data (`LIST_SOURCES`; it needs a new explicit API scope and a v1 route for little gain, same call as the room), Data Workbench for BOQ lines, analytics tiles, a demo seed, multi-sheet BOQs in one upload, pricing a BOQ line through the pricing engine (`priceDocumentLine`), and the supplier-comparison choice (slice 3b).
- **Not verified in a browser** from this environment (the tenant is resolved from the hostname); the screen is checked by render tests, the routes by tests against an in-memory database, and the Excel round trip by tests that write and re-read a messy client-style workbook.

**Live-test fixes (2026-10-26).** (1) The BOQ tab is split into Upload / Prices / Download (`?boq=`, opens on Prices once a BOQ exists; the unpriced warning heads Download). (2) After any BOQ action that changes lines the page refreshes and remounts the Lines editor; the lines PUT takes the optional `base_version` (`linesVersion`) and answers 409 `lines_changed` for a deal with a BOQ when it is stale; a save from the editor re-points each BOQ row at the new line, so links, prices and order survive. (3) Lines are shown in the file's row order (`boqOrderedLines`); other deals sort item numbers numerically. (4) The client's unit stays on the BOQ row and in the answer sheet; the editor keeps a unit outside `UOM_OPTIONS` as its own option and maps obvious synonyms (`src/lib/sales/uom.ts`). (5) Releasing the bond asks inline first (`BondRelease`).

**Live-test fixes, round 2 (2026-10-26).** (1) A tender deal's Lines tab has its actions in one toolbar ABOVE the table: Lines total, one "Request supplier prices (N)" button (N = unpriced lines; the editor's own "Request quotation" is hidden for a tender with the RFQ module, the per-line chips stay) and Save lines; Convert to Standard Quote is only the deal header's primary button. On a phone a Save bar sticks above the tab bar once the toolbar has scrolled away and there are unsaved edits. A standard deal's tab is byte-identical to before. (2) **Match to products** on the BOQ Prices tab (`boq/match`, `match.ts` scorer, `matchServer.ts`): a "N lines without a product" chip opens each unlinked line with up to 3 ranked products (SKU = cost code 100, SKU in the description 85, else word overlap 45-90, +5 same unit; strong >= 75, a different size caps at possible); accept one, search another, or leave as free text; "Accept N strong matches" links only unambiguous strong ones, chosen by the server. Only `product_id` is written to the deal line, tenant-verified, checked against the lines fingerprint (409 `lines_changed`); the fingerprint now includes `product_id` so the Lines editor cannot save over a link. Name, SKU and unit only are shown; never a cost. No migration.

## 15. Slice 4 (bid versions, calls, outcome) and slice 5a (contract project and budget) — design, 2026-10-26

Owner: "go ahead with next steps". Decisions are mine unless marked; change on request. ePROMIS API documentation is not in hand, so
5a is complete inside BPMSquare and fills its lists from files; the push to ePROMIS and the read-back of actuals are slice 5b.

### Slice 4 — migration 0225, bundle 35, flag `gcc_tender`
1. **Bid versions** (new deal tab "Bids"). "Submit bid" on a tender deal in Estimating or Clarifications saves an append-only snapshot
   `tender_bid_versions`: `version_no` (1, 2, 3 ... no cap), `submitted_at/by`, `currency`, `total`, `lines jsonb` (item no, description,
   unit, qty, rate, amount, product ref, price source; never cost or markup), `note`, `revision_reason` (required from version 2),
   and moves the deal to Submitted. "Revise bid" returns the deal to Estimating and the next submit makes the next version. Compare any
   two versions: lines added, removed, changed (rate and qty), total delta in amount and percent. A version cannot be edited or deleted.
2. **Log a call** (button on the deal's Activity tab and in the Room header): `deal_activities` (`kind` call|meeting|site_visit|note,
   `occurred_at`, `with_whom`, `summary`, `outcome`, `next_step`, `next_step_due`, `logged_by`). Shown newest first on the Activity tab
   beside the change history; a next step with a due date shows in "Closing soon"-style chip on the Tender tab when overdue.
3. **Outcome facts** on `opportunity_tenders` (add columns): `award_value`, `winning_bidder`, `award_date`, `outcome_note`. The Tender tab
   shows an "Outcome" section when the stage is Awarded, Lost or No-bid; for Lost, the existing `loss_reason` and `competitor` are shown there
   too and required. Our final submitted total is shown beside the winning price with the difference.
4. Wiring: `OBJECT_FEATURE`, change history for submit and calls, capability doc, LIST_SOURCES only if cheap (say what is skipped).

### Slice 5a — migration 0226, bundle 36, new flag `contract_projects` (platform admin, default off, needs `gcc_tender`)
Object name in the UI: **Contract projects** (ref `CPR-0001`); the existing Workforce "Projects" stay untouched.
Ground rules 3c: (1) simple: create from a won tender in one click, grid edits only cost type, cost code and amounts; (2) one tab pattern
(`useUrlTab`); (3) explanations behind InfoTip; (4) sections collapse and remember state; (5) no pricing choice (budget is cost);
(6) PDF/Excel of the budget; sending is the handover; (7) born from a won tender (`source_opportunity_id`, unique) or by hand;
(8) AI: Talk to data source, Assistant read access; create card deferred with a stated reason; (9) ERP: entity row "Contract project"
in the Integration middleware (Links, Mapping) prepared, push is 5b; ERP id line only; (10) `logChange` on everything, "via approval"
shown; (11) types: none now (one project type), the mechanism is not needed; (12) record page opens with a visual (see mock-up).

**Tables.** `contract_projects` (ref, name, account_id, source_opportunity_id, status draft|baseline_pending|active|closed, contract_value,
currency, planned_start, planned_end, manager_id, erp_system, erp_id, custom_data); `project_budget_revisions` (project_id, rev_no,
status draft|pending|approved|superseded, justification_code, justification_text, created_by, approved_by, approved_at, locked_at, total);
`project_budget_lines` (revision_id, project_id, line_no, resource_code, cost_code, wbs, description, qty, unit, unit_cost, amount,
cost_known boolean, source_ref, reserve boolean, committed numeric null, actual numeric null — the last two read-only, filled by 5b);
`erp_masters` (kind resource|cost_code|justification|reserve_type|division|job_location, code, name, parent_code, flags jsonb with
`link_to_inventory`, `budget_validation`, `revenue_side`, source manual|file|epromis, active) — one generic table. Also two columns on
`tender_boq_lines`: `cost_rate`, `markup_pct`, written when a line is priced from a cost source (never exported, never shown to the client).
All tables: tenant_id, RLS on, tenant SELECT policy only, writes through service-role routes.

**Masters now.** Seed the eight resource levels the owner showed (11 Material, 21 Asset, 31 Man Power, 32 Hiring Man Power, 41 Sub Contractor,
51 Other Direct Cost; 91 Revenue and 92 On Account marked `revenue_side`) and a small justification list (client variation, scope change,
price change, error correction, other). Cost codes, resources below level 11, reserve types and divisions come by **file import** (CSV/XLSX
with code, name, parent) on Settings > Contract projects, one place only; later the same table is refreshed from ePROMIS (5b).

**Create from a won tender.** Action "Create contract project" on an Awarded tender (also in the header menu). Copies the deal's lines into
budget revision 0: resource defaults to Material (11), cost code from the BOQ's own code column when it exists in `erp_masters` (else left
for the user, flagged), unit cost = BOQ `cost_rate` when known, else the rate less a default margin (workspace setting, default 15 percent)
and `cost_known = false` shown as "estimated". Contract value = the awarded value if recorded else the final bid total.

**Baseline.** Revision 0 is edited freely while draft. "Ask for approval" uses `approval_requests` kind `project_baseline` (same approvers as
the bid decision, self-approval rule applies). Approval sets status approved, locks the revision, makes the project active. Every later
change is a new draft revision copied from the approved one, needs a justification (code from the list plus a note), and the same approval.
Superseded revisions stay readable; the grid can show any revision and a diff against the baseline.

**Pages.** `/contract-projects` list (status chips, contract value, budget, margin), detail with tabs: **Overview** (visual: contract value
vs budget as a bar, planned margin percent, budget by cost type as stacked bar, revision and approval state, a "needs attention" strip for
unknown costs and unmapped cost codes), **Budget** (grid grouped by resource type with subtotals, cost code picker from masters, reserve
lines, add/remove lines while draft), **Revisions** (list, diff, justification), **Handover** (Excel export of project header, budget by
line with resource and cost code, and BOM, as the stand-in; a disabled "Send to ePROMIS" button says it needs the connection), **Activity**.
Phones: one column, grid scrolls inside its container, primary action in the sticky bar.

**Not in 5a (said plainly):** ePROMIS push and read-back (5b), subcontract packages (slice 6), committed and actual values (5b), progress
claims, Data Workbench and v1 API for the new object unless cheap (list every skip in the commit), Drive guides.


## 16. Slice 4 as built (2026-10-26): bid versions, log a call, outcome facts

Section 15 (slice 4) is the spec. What exists, and where it differs from the text:

- **Migration `0225_tender_bids.sql`** (bundle 35, PENDING on both databases; needs bundle 31, not 32 to 34): `tender_bid_versions` and `deal_activities`, each with a tenant SELECT policy only (every write is a service-role route), plus four columns on `opportunity_tenders` (`award_value`, `winning_bidder`, `award_date`, `outcome_note`). A bid version is append-only: the application only inserts, `unique (opportunity_id, version_no)` settles two people submitting at once, there is no cap, and a trigger refuses an UPDATE as a second line of defence. `line_count` is stored beside the lines so the list never has to load them. Reads fall back column by column while the migration is pending (`TENDER_COLUMNS` tries all columns, then without 0225's, then without 0221's).
- **One gate** (`openTenderDealRequest`, `src/lib/tender/dealAccess.ts`): flags `gcc_tender` + `pipeline` are read BEFORE any table, then the Pipeline view (edit for a write) and a tender deal of THIS workspace. A standard deal, another workspace's deal and a workspace without the flag are the same 404 and touch none of the new tables (tests prove it).
- **Bids tab** (tender deals only). Submit bid (`POST .../tender/bids`) works from Estimating or Clarifications: it builds the snapshot from the deal lines in the client's file order (`boqOrderedLines`) through a whitelist (`bids/rules.ts`: item no, wording, unit, qty, rate, amount, product SKU, price-source LABEL), so a cost, markup or pricing flag cannot ride along (a test feeds rows that hold them); only lines that count toward the deal total are kept (a non-chosen alternative and a quantity break are not). From version 2 a reason of 3 to 1000 characters is required (422 `reason_required`, nothing written). The deal then moves to Submitted by calling the deal's OWN stage PATCH in-process, after asking the same `stageGuard` first, so a refusal cannot leave a version behind. If the move fails after the version is saved, the answer says so (`stage_moved: false`) and the screen tells the person. Revise bid is the same stage PATCH back to Estimating (no new route). Compare (`GET .../bids/compare?from=&to=`) matches lines by key (item number, else wording + unit), so a reordered file shows nothing changed; it reports lines added, removed and changed (qty, rate, unit, wording), the total in both versions, the change in amount and in percent of the older total.
- **Log a call** (`/api/opportunities/[id]/tender/calls`, `.../[callId]`): kind call / meeting / site visit / note, when, with whom, what was discussed (required), outcome, next step with an optional due date (a due date needs a step). Limits: summary 2000, with whom 200, outcome 500, next step 300 characters, no entry dated more than 24 hours ahead, 1000 entries per deal. The logger and the workspace are the session's. Anyone who may edit the deal can tick a next step done; editing or removing the entry is for its author and workspace admins. The dialog is the shared side panel (bottom sheet on a phone) on the Activity tab's "Calls and visits" section (newest first, five and "Show all") and as a button in the Room header (also on the room page). A next step past its date shows a red chip on that list and a "N overdue next steps" chip on the Tender tab that opens the Activity tab.
- **Outcome** (`PATCH .../tender/outcome`, Tender tab section "Outcome: awarded / lost / no-bid"): only when the tender is Awarded, Lost or No-bid, and only the fields of that stage are taken. Lost requires the loss reason and who won; "Won by" is saved as `winning_bidder` AND as the deal's `competitor` (one field, one meaning, so the two cannot disagree). The move to Lost in the deal's stage PATCH also asks for the competitor (on the body or already on the deal) for a tender deal only, and the close dialog shows a "Who won" box for a tender. Our last submitted total (the latest bid version) is shown beside the winning / awarded price with the difference and a one-line percent of that price.
- **Change history:** submit, calls (logged, edited, ticked, removed) and outcome facts are logged as `opportunity_tenders` entries, so they appear on the deal's Activity tab through the existing extra change-log type and in the existing "Deals: Tender details" filter; the loss reason and competitor are logged under `opportunities`.
- **3b list.** Done: `OBJECT_FEATURE` for both tables (`gcc_tender`); capability text and regenerated facts; InfoTips in `tips.ts` held by test; `data-guide` ids on every control (test); degradation on 42P01 / 42703 / PGRST205 with a visible "needs a database update" note; bundle 35 and the ledger line; 375 px / PC render tests (44 px targets, no fixed widths, paged lists, one column from the shared `.fg2` rule). **Skipped on purpose:** Talk to data / v1 API / MCP for the new tables (same call as the room and the BOQ: a new explicit API scope and routes for little gain before slice 8 reporting; the outcome columns are therefore not in the `tenders` source either), global search, analytics tiles and reports (slice 8), a demo seed, Drive guides, an email on submit. **Deliberately not done:** a PDF or Excel export of a version (the priced BOQ download is the document of record until a version needs one), restoring a version into the lines, a version-to-version cost comparison (versions never hold cost).
- **Not verified in a browser** from this environment (the tenant is resolved from the hostname); the routes are proved against an in-memory database and the screens by render tests.

## 17. Slice 5a as built (2026-10-26): contract projects with budget, revisions and baseline approval

Section 15 is the spec. What exists, and where it differs from the text:

- **Migration `0226_contract_projects.sql`** (bundle 36, PENDING on both databases; needs 0120, and 0221 for approvals): `erp_masters`, `contract_projects` (unique per tender), `project_budget_revisions` (partial unique indexes: one open and one approved revision per project), `project_budget_lines` (with a stable `line_key` that copies keep, which is what a revision diff matches on). Each: RLS and a tenant SELECT policy only; every write is a service-role route. **No column on any existing table.** The brief's two cost columns on `tender_boq_lines` are not added: 0223 already has `unit_cost` (the internal cost a supplier / BOM rate was built from) and `markup_pct`, written by the cost source in `priceOneLine` / `priceAllLines`, and a test (and the 3a test) proves neither the priced file nor the answer sheet carries them. The project reads them.
- **Flag `contract_projects`** (platform admin, default off, needs `gcc_tender`): `TenantFeatures`, tenant editor, new-tenant form, `moduleDependencies`, nav item "Contract Projects" under Sales (workcenter `contract_projects`), `ROUTES`, `OBJECT_FEATURE`. Every route starts with `openProjectRequest()`: flag, tender edition, workcenter view (and edit / admin where the route writes); any miss on the module is a plain 404 and the new tables are not queried (tested).
- **Starter lists (owner's change, same day).** The owner did not have KAMCO's lists, so a workspace begins with defaults, source `default`: the eight resource levels (91 and 92 flagged revenue-side, not cost types) plus material sub-groups under 11 that mirror the divisions (1103 Concrete, 1105 Metals ... 1133 Utilities), the 35 MasterFormat divisions and five sections as cost codes (parents set), and the justification reasons. Seeded by the application the first time the module is opened, only for a list with no row at all, with ignore-duplicates, so an edit is never overwritten. A CSV or Excel import on **Settings > Contract projects** replaces or extends them, matched on list + code (new codes added, existing ones take the file's name, parent and flags and become source `file`); parents may come later in the file or already be stored, an unknown parent is dropped with a note, duplicates / loops / over-long values are refused and listed; `preview=1` writes nothing. An entry is switched off, never deleted. The screen is one table with a row per list and a side panel; the default margin (`config.contract_projects.default_margin_pct`, 15) sits under it.
- **Create from a won tender** (`POST /api/contract-projects { opportunity_id }`, the "Create contract project" strip and menu item on an awarded deal): copies the selected deal lines (not quantity-break rows) into revision 0. Resource Material; cost code from the BOQ row only if the workspace's list holds it (otherwise blank, flagged, and the line says so); unit cost the BOQ row's recorded cost when there is one, else the rate less the default margin, `cost_known = false`, shown "estimated". Contract value = `opportunity_tenders.award_value` if that column exists (slice 4) and is set, else the deal amount. One project per tender: a pre-check answers 409 `already_exists` with the project id, the unique index is the backstop.
- **Baseline and revisions.** Revision 0 is edited freely while draft (`PUT .../budget`, which replaces the lines: new rows first, then the old ones removed, so a failed save leaves the old budget). "Ask for approval" (`POST .../approval`) writes an `approval_requests` row, kind `project_baseline`, `proposed_value` the revision id; the people who decide are the tender approvers (Settings > Tenders), the asker cannot decide unless `allow_self_approval`; it is refused when the revision has no lines, a line has no resource, a later revision has no reason, or nobody else could approve. The revision locks at once (`pending`); approving supersedes the previous approved revision, sets approver, time and `locked_at`, and makes the project active; rejecting (comment required) or withdrawing returns it to draft. A later change is a new draft copy of the approved revision (`POST .../revisions`) with a reason from the list (Other needs a note), one open revision at a time; the Revisions tab compares any revision with the one before it (or the approved one, for a draft). The bid / no-bid approval code is untouched; the project reuses its pure functions through `contractProjects/approval.ts`.
- **Screens:** `/contract-projects` list, `/contract-projects/new`, record page with Overview (contract value, budget, planned margin, lines; budget against contract value; cost-type stacked bar; approval; needs-attention list; details), Budget (grouped by resource type, groups collapse and remember, grid scrolls inside its own container, cost-code search), Revisions, Handover (Excel with the project, the budget by line with resource and cost code names, and the material list; "Send to ePROMIS" disabled with an "i"), Activity (change history and the Nova timeline). Tabs are the shared URL tabs; explanations are in `src/lib/contractProjects/tips.ts`, held to the limit by test; `data-guide` ids on the controls.
- **Wiring (3b):** change history (`contract_projects`, and the filter entry), global search, "New Contract Project" in the palette, Nova comments / inbox / timeline (all four places), Talk to data (`LIST_SOURCES.contract_projects`: header fields and totals only, explicit-scope-only like tenders; the change feed maps it to the same scope), capability document and regenerated facts, settings menu entry, ledger line and bundle 36, create card deferred with a reason in `src/lib/actions/registry.ts`.
- **Deliberately not done:** ePROMIS push and read-back (5b; the Integration middleware has no ePROMIS entity registry yet, only D365 entities, so no entity row was added; the project shows its ERP id from its own `erp_system` / `erp_id` columns); the middleware entity row, Data Workbench (import / export / update), v1 API endpoints and MCP tools (the budget is internal cost; the only API surface is the header-and-totals Talk to data source); analytics tile and Reports metric; custom fields (`custom_data` exists on the table, but the field registry, Settings tab and `ObjectSections` are not wired); advanced filtering on the list; a demo seed (a project is made from a won tender, and the starter lists seed themselves); deleting a project once a baseline was sent (close it instead). **Not verified in a browser** from this environment (the tenant is resolved from the hostname): the screens are checked by server render tests and the source's layout rules, so 375 px and PC need an eye on develop.

## 18. Estimates inside the tender flow (slice 3c) — design, 2026-10-26

Owner: sales spends most of its time finding cost; they do everything in Estimates (pipes, precast, fence); give them all the templates we have and let them append what is missing; **both** unit-rate build-ups and whole-scope estimates; and the flow is
**Tender deal → BOQ → Estimates → RFQ → priced BOQ → bid → contract project budget.**

**What exists (checked):** estimates (0131) with templates, BOM, WBS, cost build-up, material catalogue (0213), Read the email, drawing intake, link to a Standard Quote (`standard_quote_id`). **Gaps:** an estimate has no link to a deal (no `opportunity_id`); a BOQ line can only reuse the cost of the same product from an old estimate (`sources.ts` "estimates" map); RFQ origin types do not include estimate; the contract project budget guesses cost (bid rate less 15 percent, all Material).

### Data (migration 0227, bundle 37, flag `gcc_tender`)
- `estimates.opportunity_id` (nullable, same tenant, index), shown on the estimate page as "Tender: OPP-0011".
- `tender_boq_estimate_links` (`tenant_id, boq_line_id, estimate_id, output` = `total` | `line:<estimate_line_id>` | `wbs:<id>`, `basis` per_unit | total, `share_pct` default 100, `applied_cost`, `applied_at`, `created_by`): which estimate output prices which BOQ line. Many BOQ lines may point at one estimate; one line may have several links (shares add up).
- Price source `estimate` added to the BOQ price sources (cost goes to `unit_cost`, markup rule as for other cost sources, never exported).
- `rfqs.origin_type` gains `estimate` (check constraint widened, guarded); RFQ lines remember `estimate_line_id`.
- A change to an estimate after a BOQ line was priced from it marks the link `stale` (computed by comparing the estimate's `updated_at` with `applied_at`), shown as "Estimate changed, re-price".

### Two ways to price from an estimate
1. **Unit-rate build-up (per BOQ item):** from a BOQ line, "Build up this rate" opens the estimator on a chosen template with quantity and unit prefilled from the line; the estimate's total cost divided by that quantity is the cost per unit, written to the line with source `estimate`. Saved estimates become reusable rate build-ups (the "past project" source can read them next time).
2. **Whole-scope estimate (many BOQ lines):** an estimate for a scope (a precast building, a pipeline run) is created on the deal (Estimates section, template or Read the email or drawing), then "Allocate to BOQ" maps estimate outputs to BOQ lines like Match to products does: by cost code or description with suggestions, or by share of the BOQ amount or quantity; unallocated cost is shown so nothing is lost.

### Screens
- Deal tab **Estimates** (tender deals only): list of the deal's estimates with template, status, cost, price, last change, and "New estimate" (template picker including the starter set below).
- BOQ > Prices: each line gets "Price from estimate" (pick estimate and output, shows cost per unit) and "Build up this rate"; lines show the estimate chip and the stale flag.
- **Missing costs → RFQ:** on the estimate and in BOQ > Prices, "Raise RFQ for missing costs" collects estimate lines with no cost or a cost older than `config.rfq.price_valid_days`, opens the RFQ composer prefilled (any number of suppliers, no minimum), and on award writes the awarded cost into the estimate line (source RFQ, as-of date) and recalculates every linked BOQ line (marking them for review, never silently changing a submitted bid).
- **Rate sheets:** "Import rate sheet" (Excel/CSV) on Settings > Estimate templates updates the material catalogue rates with an as-of date and supplier/source note; rows that do not match are listed for the user to map or add.

### Templates: give all, append the rest
Ship editable starters beside fence, tiles, cabin and precast villa: **pipes and fittings** (steel, GRP, HDPE: supply, trench, bed, lay, joint, test, backfill, per metre), **precast elements** (boundary wall panel, slab, hollow-core, column and beam), **civil basics** (excavation, concrete with formwork and rebar, blockwork). Rates are illustrative placeholders and are marked so in the catalogue until a rate sheet is imported. Users add missing templates and catalogue items themselves in the existing editor; later (not now): build a template from one of their own Excel costing sheets with AI.

### Budget after award
The contract project (5a) takes its budget lines from the estimate lines linked to the BOQ, split by resource (material, labour, equipment, subcontract, other) with the BOQ's cost codes and the estimate's real unit costs (`cost_known` true), scaled to the BOQ quantities and shares. BOQ lines without an estimate keep today's rule. Slice 5a code reads the links when they exist.

### Order of work (two builders in parallel)
3c-1: migration 0227, links, Estimates tab, price-from-estimate and build-up, allocate, RFQ from estimate and write-back, stale flag, budget from estimates. 3c-2: starter templates (pipes, precast elements, civil), rate-sheet import, catalogue as-of dates. Both behind `gcc_tender`; standard estimates and quotes unchanged.


## 20. Slice 3c-2 as built (2026-10-26): starter templates for pipes, precast elements and civil basics, and the rate-sheet import

Self-contained. Owner brief (section 18, "Templates: give all, append the rest" and "Rate sheets"). This slice is useful to **any workspace with the existing `estimator` flag**; nothing here reads `gcc_tender`. Existing estimates, templates, quotes, the fence parity test and the other starters are untouched.

**What is already there (checked 2026-10-26):** the estimator with locked starters (fence, precast villa, tiles, porta cabin), "Copy to customise", the element-schedule import (a rule with an `element_type` takes its quantity from schedule rows), product-priced rules (`cost: { kind: "product", sku | match }`, priced from `products.cost_price` through the pricing engine), `products.cost_price_as_of` (0113), the BOQ reader's tolerant header detection and name matcher (`src/lib/tender/boq`), `config.rfq.price_valid_days`, and Settings > Estimate templates. No migration was needed.

### The five starters (all locked, all named "... (illustrative)", description begins ILLUSTRATIVE)
| Template | Inputs | Cost lines (group names carry the MasterFormat code where it is certain) |
|---|---|---|
| Pipes and fittings | material (steel, GRP, HDPE), diameter (DN 100, 200, 300, 400, 600), length, fittings, valves, trench depth, soil (sand, clay, rock), surface (natural, gravel, asphalt) | 31 23 16 Excavation (excavator, breaker in rock); 31 23 23 Bedding and backfill (bedding, backfill and compaction, surplus spoil carted); 33 11 00 Pipe, fittings and valves (pipe, fittings, valves, joints, delivery); 33 11 00 Laying, jointing and testing (gang, plant, jointing labour, hydrostatic test per section); Surface reinstatement; Overhead |
| Precast elements | count and sizes for boundary wall panels, solid slabs, hollow-core planks (depth), columns, beams; concrete grade; distance to site | Boundary wall panels (concrete); 03 41 00 Precast structural concrete (slabs, planks, columns, beams); Reinforcement, moulds and casting (steel by kg per m3 of each family, moulds, casting labour); Transport and erection (loads by weight and distance, loading, crane days, crew days); Overhead. An element schedule (the existing import) replaces the form's quantities and flows into every downstream line |
| Excavation and backfill | volume, soil, volume put back, imported fill, distance to tip | 31 23 16 Excavation; 31 23 23 Fill and compaction; Disposal of surplus; Overhead |
| Reinforced concrete | concrete m3, grade, pumped, **reinforcement kg per m3**, formwork m2 per m3 | 03 11 00 Concrete forming and accessories; 03 21 00 Reinforcing steel; 03 30 00 Cast-in-place concrete; Overhead |
| Blockwork and plaster | wall area, openings, block thickness, plaster faces and thickness | 04 22 00 Concrete unit masonry; 09 24 00 Cement plastering; Overhead |

Civil basics are three small templates, not one with a work-type switch: a form shows only what the work needs, a BOQ line opens the matching template, and each prints its own lines on a quote. Units are Gulf-market (m, m2, m3, kg, nr, h, day, load). Cost per metre is total cost / length (the tests assert it); the template format has no "output" concept, and the per-unit figure is what slice 3c-1's "Build up this rate" computes for every template, so no new readout was invented here. The MasterFormat code rides in the **group name** because the template format has no cost-code field; the WBS and the quote show it. WBS numbers (1, 1.1, ...) come from the engine as for every template. No geometry module exists for these trades, so there is **no 3D preview** (none was built).

### Illustrative rates, and why they live in the catalogue
The materials of every starter (pipe, fittings, joints, valves, bedding, reinstatement, ready-mix, hollow-core planks, reinforcement, formwork, blocks, mortar, plaster, fill) are **catalogue items**: `products` rows, 72 of them, found by SKU or by tags in `custom_data` through the chosen options (the way the fence picks its posts). Each is marked illustrative three ways: the name ends " (illustrative)" (the estimate line shows the product name), `custom_data.illustrative = true` with `cost_source = "Illustrative placeholder"`, and no `cost_price_as_of` (an undated cost reads as stale to the BOQ price sources). Labour, plant, haulage, moulds, crane and crew, overhead and tests are **template rates** (so the BOM export stays the physical items, as it does for the villa), changed by "Copy to customise". The pure source of the list is `src/lib/estimator/starterCatalogue.ts`; the items sit beside the templates that use them (`starterTemplatesPipes|Precast|Civil.ts`), and a test prices every combination of every select so no choice leaves a line without its item.

**Getting them into a workspace:** `scripts/run-bundle-38-starter-templates-pipes-precast-civil-2026-10-26.sql` (generated by `npx jiti scripts/gen-estimate-seeds.ts`, the same generator and the same locked-refresh and "TARGET" shape as bundles 24 and 26) adds the five locked templates and the 72 items for demo tenants with the estimator on; an item is added only where the workspace has no product with that SKU, so an item that was edited or repriced is never overwritten. For one other workspace, Settings > Estimate templates > "Add the pipework, precast and civil starters" calls `POST /api/estimate-templates/from-starter` once per missing starter, which now also adds the starter's items (bulk insert with the next PRD references, one change-history entry per product). Needs 0131, 0213 and 0098; no new migration.

### Rate-sheet import (Settings > Estimate templates > Import rate sheet; one place)
- **Who and where:** administrators only, estimator module only (`estimatorAccess("edit")` plus a role check; a member gets 403, a workspace without the module 404). Routes: `POST /api/estimate-templates/rate-sheet/preview` (reads, writes nothing), `POST /api/estimate-templates/rate-sheet` (apply), `GET /api/estimate-templates/rate-sheet` (a CSV with the SKU and name of every starter item this workspace has and a blank rate, for a supplier to fill in).
- **File:** .xlsx or .csv only (the extension and the first bytes must agree: a zip for Excel, no NUL bytes for CSV; .xls, .pdf, .svg and anything else are 415), at most 5 MB, 2,000 items, 30 columns, 6,000 sheet rows; texts are capped. Columns are found the BOQ reader's way (the header row is the one carrying the most known names, in any order; the cell helpers are the BOQ reader's own): item name, SKU, unit, rate, currency, supplier, as-of date, source note. A date may be ISO, day-first, with a month name, or an Excel serial.
- **Matching:** the BOQ matcher (`createMatcher`): SKU exact, SKU in the name, word overlap; a name equal to the product's once "(illustrative)" is ignored is exact too. Exact and unambiguous close matches are applied by default; a possible match or none waits for a choice (map to an existing item, add as a new catalogue item, skip). A different unit (after Sqm = m2, Nos = nr style synonyms) stops the default; another currency than the workspace's, a repeat of an earlier row, and two rows for one item are not applied.
- **Staleness:** a row's date, else the "Prices as of" date (default today; a date in the future is refused), older than `config.rfq.price_valid_days` (default 180) is **imported and shown stale** ("stale, 298 days old"), in the preview and in the result. The BOQ price sources already read `cost_price_as_of`, so an imported rate reaches them with no further wiring.
- **What it writes:** `products.cost_price`, `cost_price_as_of`; `custom_data.cost_source` (the row's note, else "Rate sheet <file>"), `cost_supplier`, `rate_sheet` (file, row, date); the **previous rate is kept** in `custom_data.previous_cost` (price, date, source, supplier) because the catalogue has no price-history table, plus a `change_log` entry per product listing every field that moved; an item that was illustrative loses the mark, the " (illustrative)" name suffix and the placeholder description. Updates are `.eq("id").eq("tenant_id")`; every read is tenant-scoped; a product id from the request that is not this workspace's is refused on its row. The server reads the file again at apply time and takes only a row number, an action and a product id from the browser (no price, no match). Unit, name and tags of an edited item are never changed.
- **Screen:** a side panel (a bottom sheet on a phone). Step 1 file, "Prices as of", the starter list link; step 2 four groups (Need a choice, Ready, Not applied, All) with a card per item (match chip, stale chip, what is in the catalogue now, one select: Skip / Update <item> / Add as a new item), 25 at a time with "show more", "Add every unmatched item as new"; step 3 a one-line result and every row that was not done. A pill on the page counts catalogue items still illustrative. Explanations are in `src/lib/estimator/rateSheet/tips.ts` (two sentences, 160 characters, held by test) behind the shared InfoTip; `data-guide` ids are `rate.sheet.*`.

### Deliberately not done
No "cost per metre" readout in the estimate screen (see above); no first-class cost-code field on a rule (the code is in the group name); no 3D (no geometry module for these trades); labour, plant and haulage rates are template rates, not rate-sheet items; supplier names are stored as text, not linked to Suppliers; no currency conversion (a row in another currency is not applied); no mapping panel to fix the columns by hand (a sheet with no recognisable header says what it needs); "add as new" items carry no tags, so a starter only prices from them after a copy of the template is pointed at them; no analytics tile, no v1 API or MCP change (the catalogue is the Products object, unchanged); the Drive guides are not refreshed (waits for the owner to validate).

### Tests
`starterTemplatesGcc.test.ts` (validity, illustrative marks, every choice priced, hand-checked figures for each template with the arithmetic beside them, the element schedule, BOM and WBS, seed determinism and the committed seed and bundle), `starterCatalogueServer.test.ts` (install: only missing SKUs, tenant-scoped, never overwrites), `rateSheet/rateSheet.test.ts` (header and date reading, row rules, limits, file kinds, matching, stale detection, every write), `api/estimate-templates/rateSheet.routes.test.ts` (roles, file types and sizes, tenant isolation with the same SKU in two workspaces, a foreign product id, choices that cannot be read, Excel with a date cell, the starter list), `rateSheet.render.test.ts` (the three steps, no explanations printed, 44 px, wrapping, bottom sheet under 780 px). **Not verified in a browser** from this environment (the tenant is resolved from the hostname): the panel is checked by server render and the source's layout rules, so 375 px and PC need an eye on develop; the SQL was not run.

## 19. Slice 3c-1 as built (2026-10-26): estimates inside the tender flow

Section 18 is the spec. This section is self-contained: what exists, the rules that decide the numbers, and where it differs from the text. Not done here (slice 3c-2, built in parallel): the starter templates (pipes, precast elements, civil) and the rate-sheet import.

**Flow it delivers:** Tender deal → BOQ → Estimates → RFQ → priced BOQ → bid → contract project budget.

### Data (migration `0227_estimates_in_tender.sql`, bundle 37, PENDING on both databases)
- Needs 0131 (estimator), 0128 (RFQ) and 0223 (bundle 33, the tender BOQ); it stops with a plain message if one is missing. Idempotent.
- `estimates.opportunity_id` (nullable, `on delete set null`, partial index). Same workspace by construction: the only writer is `POST /api/estimates`, which has just looked the deal up in the caller's workspace; every read joins through `tenant_id`, so a stray value naming another workspace's deal resolves to nothing. (`estimates` keeps its old `for all` RLS policy because the estimator is edited directly by its users; the new column does not widen what a member could already do to a row.)
- `tender_boq_estimate_links`: `tenant_id`, `opportunity_id`, `boq_line_id` (the stable `tender_boq_lines.id`, which survives the Lines editor's delete-and-reinsert), `estimate_id`, `output`, `basis`, `share_pct`, `applied_cost`, `applied_at`, `estimate_updated_at`, `needs_review`, `review_note`. One link per (BOQ line, estimate, output). RLS on, **tenant SELECT policy only**; every write is a service-role route that has checked the workspace, the deal, the caller's right and every id. In `OBJECT_FEATURE` as `gcc_tender`.
- `rfqs.origin_type` gains `estimate` and `rfq_lines.estimate_line_id` is added. `tender_boq_lines.price_source` gains `estimate`. Both old check constraints are found by what they check (`pg_get_constraintdef ilike`), not by their generated names, then replaced.
- **Changed from the brief, because it was necessary:** `estimate_updated_at` (the estimate's `updated_at` when the figures were applied) is stored beside `applied_at`. "Stale" is then a plain comparison of two values the database gave, with no clock between them, instead of comparing the estimate's time with the time the app wrote the link. `opportunity_id` on the link row is added for listing a deal's links without a join. `needs_review` / `review_note` carry the "re-priced by an award, check it" mark.

### The numbers (all in `src/lib/tender/estimates/rules.ts`, pure, tested)
- An **output** is `total` (the sum of the estimate's line costs), `line:<estimate line id>` or `wbs:<code>` (a group such as `2`, or a line such as `2.3`; `wbs:2` includes `2.1` and `2.2`, never `20.1`). A **link** names an output, a **basis** and a **share**.
- Basis `total`: cost per BOQ unit = output cost × share ÷ BOQ quantity. Basis `per_unit` (a single estimate line only): cost ÷ the line's quantity × share (waste included, because the estimate's line cost includes it). A BOQ line's cost per unit is the **sum** of its links; its rate is that cost plus the BOQ row's markup (the existing `rateFor` rule, default 0, the markup box beside Price all); the cost goes to `tender_boq_lines.unit_cost` and the source is `estimate`.
- **Never trust the client's cost.** A request names the BOQ line, the estimate, the output, the basis and the share. Everything else is read again on the server from the estimate as it is now. A cost, rate, source or tenant in the body is ignored (tested).
- **Never more than 100 percent.** The `total`-basis links on one output of one estimate add up to at most 100 percent (checked in hundredths). A request that would break it is refused whole (409 `over_allocated`) before the first row is written. A `per_unit` link borrows a rate and takes nothing out of the pool. **Unallocated** cost (what no BOQ line has been given) is shown by Allocate to BOQ; nothing is lost.
- **Stale** ("Estimate changed, re-price"): the estimate was saved after the figures were applied, **or** the BOQ quantity moved (a revised file) so the same cost now works out to another cost per unit. A build-up not yet used is **waiting**, not stale. A bid that is already in (the deal is past Estimating) is never re-priced by itself: only a person's Re-price, with a confirmation, changes the rate; the submitted bid version is append-only and is never touched.
- **Missing costs:** an estimate line with a quantity and no unit cost, or a cost confirmed longer ago than `config.rfq.price_valid_days` (180 by default, 30 to 730; Settings > RFQ). Age comes from the award that wrote the cost, else the product's cost date, else when the line was last saved. Labour and factory overhead are never aged (they are the company's own figures) but are listed when they have no cost. A quoted estimate is locked and has nothing to raise.

### Two ways to price from an estimate
1. **Unit-rate build-up.** BOQ > Prices > "Build up this rate": pick a template; the **ordinary** `POST /api/estimates` makes the estimate (name from the BOQ line, the quantity prefilled into the one number input whose unit matches the BOQ unit or that is named like a quantity, otherwise nothing is guessed, the BOQ wording in the notes, `opportunity_id` set) and a waiting link (`total`, 100 percent) is kept. The person works in the existing estimator; on the estimate page the tender strip says "Built for BOQ item 1.3 · 120 m" with "Price the line from this estimate", and BOQ > Prices shows "Build-up in progress" with "Use its total". Either runs the same re-price: total ÷ quantity.
2. **Whole-scope estimate.** The Estimates tab (and the estimator, with `?opportunity=`) makes the estimate for the tender. BOQ > Prices > "Allocate to BOQ" proposes either **match** (each BOQ line takes the estimate line that reads like it, using the same scorer as Match to products; lines that took one estimate line share its cost by amount or quantity) or **spread** (one part of the estimate over the lines, by amount or quantity). Shares always add up to exactly 100 (largest remainder). The person unticks rows or edits shares; the unallocated cost is recomputed live; "Apply" asks for confirmation and writes in one step.
- **Price from estimate** (single line): pick an estimate of the deal and a part (total, a WBS group or an estimate line), the basis and the share; the picker shows the cost per unit each part would give before anything is saved.

### Missing costs to RFQ, and the award coming back
- "Raise RFQ for missing costs" (Estimates tab, BOQ > Prices, and the estimate page) opens the **ordinary** RFQ form, origin `estimate`, with one line per missing estimate line (wording, unit, quantity only; a supplier never sees the estimate, the deal or our cost). **Any number of suppliers, none to many; no minimum.**
- `createRfq` checks the origin in the caller's workspace: the tender edition on, the estimate in this workspace **and** made for a tender deal, every claimed line a line of **that** estimate. Anything else is the same 404/422 as before. A line remembers its estimate line in `rfq_lines.estimate_line_id` (the estimate line is not stamped: it has no `rfq_line_id` column).
- **On award** (`awardWithDecision`, slice 3b's code, extended by one guarded call and not forked): for an RFQ whose origin is an estimate, `writeAwardedCostToEstimate` writes the awarded cost per unit (tenant currency, after FX, the same figure the cost input gets) into the estimate line: a computed line keeps it as an `override` (so a recalculation keeps it) with `cost_meta` `{ unit_cost, as_of, source: "rfq", ref: "RFQ-0004 · Supplier" }`, a hand-added line keeps `cost_meta` on the line. The meta counts only while the line still has that exact cost, so a later hand edit does not keep an old date. The estimate is re-totalled with the estimator's own `refreshTotals`; a **quoted** estimate is left alone (the award stands, the answer says why). The BOQ lines priced from the estimate are then re-priced and marked `needs_review` with the RFQ and supplier in the note ("RFQ-0004 was awarded to Gulf Pipes"); if the bid is already in, only the mark is set and the rate is not changed. The award's answer carries an `estimate` block (`written`, `repriced`, `flagged`, `locked`) and a failure there never undoes the award.

### Budget after award
`mapTenderToBudget` takes an optional `estimates` map (deal line → links). For a BOQ line with usable links it emits the estimate's own cost lines instead of one guessed line: **quantity × share, the estimate line's cost per unit including waste**, so the lines add up to the cost × share; a `per_unit` link is one line of the BOQ quantity at the estimate line's cost per unit. Each line has the BOQ line's cost code (when it is in the workspace's list, as before), `wbs` = the BOQ item number, `cost_known` true when the estimate line has a cost (false, "no cost in the estimate yet", when it has none), and a `source_ref` naming the estimate (and "estimate changed since it priced the BOQ" when stale). A BOQ line with no link, or whose link cannot be read (estimate of another deal or workspace, part gone, 0227 pending), keeps the existing rule. Existing contract projects are not touched; `POST /api/contract-projects` now also answers `from_estimate` and `estimate_warnings`.

| Estimate line category | Resource level (erp_masters) |
|---|---|
| Materials | 11 Material |
| Moulds and formwork | 21 Asset |
| Production labour | 31 Man Power |
| Erection | 41 Sub Contractor |
| Transport, factory and yard overhead, other, and a line with no category | 51 Other Direct Cost |

A person changes a line's resource on the Budget tab; this is only where it starts. (32 Hiring Man Power, 91 and 92 are not produced.)

### Screens and routes
- **Deal tab "Estimates"** (tender deals only, flag `gcc_tender`, estimator module, Estimates view): the deal's estimates with template, status, cost, price, last change, BOQ lines priced from each, "Estimate changed, re-price", "N costs missing" with the RFQ button; "New estimate" opens `/estimates/new?template=…&opportunity=…` (the template cards keep the deal) and the first save attaches the deal. `/pipeline/[id]?tab=estimates|boq` opens on that tab.
- **Estimate page strip:** "Tender: OPP-0011" with a way back, the waiting build-ups, "Estimate changed, re-price N BOQ lines", award notes, and the missing-costs RFQ button. Drawn only for an estimate with a tender deal in a workspace with the edition.
- **BOQ > Prices:** per line the estimate chip(s), "Price from estimate", "Build up this rate", Re-price / Use its total / Mark reviewed / Unlink; above the lines "Re-price N lines (estimate changed)", "N estimate costs missing" and "Allocate to BOQ". Unlinking the last link keeps the rate and makes it a manual rate.
- Routes (all through `openEstimatesRequest`: flags first, Pipeline view/edit, a tender deal of this workspace, the estimator module, the Estimates view; any miss is a 404 that reads no new table): `GET /api/opportunities/[id]/tender/estimates` (the tab), `GET/POST …/estimates/links`, `PATCH/DELETE …/estimates/links/[linkId]`, `POST …/estimates/build`, `GET …/estimates/allocate`, `POST …/estimates/reprice`, `GET …/estimates/missing`. They live under `tender/`, not `boq/`, because the BOQ routes are gated by the BOQ gate alone and these also need the estimator. Changed standard routes: `POST /api/estimates` (optional `opportunity_id`, verified, 404 for anything that is not a tender deal of the workspace), `createRfq` (origin `estimate`), `awardWithDecision` (the guarded call). The estimate PATCH, lines, calculate and quote routes are untouched (a test reads them).
- Texts behind the "i" are in `src/lib/tender/estimates/tips.ts` (held to two sentences / 160 characters by test); `data-guide` ids on every control; one column under 900 px from the shared rule, 44 px targets, lists paged ("Show all").

### 3b list (what was and was not wired)
Done: `OBJECT_FEATURE`, bundle 37 and its ledger line, capability text and regenerated facts, change history (the price, the source and unlink are `opportunity_tenders` entries on the deal; the estimate's cost write-back and "Tender deal" are `estimates` entries), InfoTips, guide ids, degradation on 42P01 / 42703 / PGRST205 (every screen says "needs a database update (migration 0227)"). **Deliberately not done:** Data Workbench, v1 API, MCP and Talk to data for the links (internal cost), analytics, global search, a demo seed, Drive guides, an email on award; an "attach an existing estimate to a deal" action (an estimate is made for the deal from the Estimates tab); showing the estimate's RFQs on the estimate page's Related card; deleting an estimate removes its links (the BOQ keeps the rate, shown as the Tender estimate source with no link). **Not verified in a browser** from this environment (the tenant is resolved from the hostname): the screens are checked by server render tests and the routes against an in-memory database, so 375 px and PC need an eye on develop.

### Fix after live test (2026-10-26): a build-up must be made for the line's quantity
**What happened.** BOQ line "1.1 Supply and lay 600x600 white porcelain floor tiles", 120 m2, template Floor tiles. The template has no input in m2 (a room length and a room width in metres), so nothing was prefilled and the estimate stayed at its 17.5 m2 default (cost 1,905.60). "Price the line from this estimate" divided that cost by 120 and wrote 15.88 per m2 where about 109 was right. Nobody was told.

**Chosen for "was it prefilled": derived, nothing stored, no migration.** The estimate's own inputs (`estimates.params`, with the template's defaults for any input not set) are read against the BOQ line's quantity and unit every time (`quantityChecks` in `server.ts`; rules in `rules.ts`: `measuredQuantity`, `quantityCheck`). This also catches a person who changes the quantity afterwards, which a flag stored at build time would not. The result is `matches` (within 1 percent), `mismatch` (both numbers known and further apart than 1 percent) or `unknown` (cannot be told: no input in the unit, ambiguous, template gone). It applies only to a **rate build-up**: the whole estimate, 100 percent, drawn on by one BOQ line (`isRateBuildUp`). A part, a share or an estimate spread over several lines does not depend on one line's quantity this way.

**The rule.** A build-up that has not been used yet (a waiting link) is not priced unless it is `matches`, or a person has confirmed. The server enforces it: `POST …/estimates/reprice` answers **409** `{ code: "quantity_unconfirmed", error, lines }` until the body carries `confirm_quantity: true`, and nothing is written before. The confirmation is logged on the deal ("Estimate quantity confirmed for …", from the estimate's quantity or "not known", to the line's). An RFQ award and Unlink never price an unconfirmed build-up silently: the line is reported and keeps its rate. "Price from estimate" (Links) is unchanged, because the person picks the part and sees the cost per unit before saving. A rate already in use is not blocked on a later Re-price (it was priced once with the person's knowledge) but shows the mismatch note.

**What the person sees.** On the estimate page strip and under the BOQ line, in amber and not behind an i: "The quantity was not filled in automatically. Make this estimate for 120 m2, then confirm." For a known mismatch: "This estimate is for 17.5 m2, the BOQ line is 120 m2. Make this estimate for 120 m2, then confirm." The buttons (Price the line from this estimate, Use its total, Re-price N lines) open the existing confirmation dialog ("Is this estimate for 120 m2?" / "Yes, it is for 120 m2") before sending. A screen that did not know is asked by the 409 and repeats the call (`src/components/tender/quantityGuard.ts`).

**Floor area prefill.** When the BOQ unit is an area (m2, m², sqm, sq m), the template has no input in that unit and no quantity-named input, but has exactly one room length and one room width in metres (cut-out, tile, door, border, height and thickness inputs are never the plan), the estimate is made for a rectangle of exactly that area: width 10 m (then 8, 6, 5, 4, 3, 2, 1) clamped into its range, length = quantity ÷ width, taken only when both lie inside their ranges, otherwise nothing is filled. A template that starts L-shaped is left alone. 120 m2 gives 12 × 10. Units are compared in one spelling (`canonUnit`), and a length-named input is no longer filled with an area. It is generic: no template name or tenant appears in it.

**Tests.** `estimates.test.ts` (the rules, including that no starter template is ever filled outside its ranges), `tender.estimates.routes.test.ts` (409 without confirmation, ok with it, prefilled path unaffected, bulk, award, gate), `Estimates.render.test.ts` (the warning on the strip and the BOQ line, 44 px targets, no fixed widths: one markup at 375 px and on PC), `quantityGuard.test.ts` (the dialog and the 409 retry).

## 22. Competitors as built (2026-10-27): who we expect to bid against, company insights, and "Who won" as a pick

Owner redesign: a competitor was one free-text box (`opportunities.competitor`) plus "Won by" / "Who won" typed in the Outcome section and the close dialog. A tender deal now has a **Competitors** tab and "Who won" picks from it.

**What is already there (checked first, rule 6c).** The `competitor` text field on every deal (kept as is on standard deals), `opportunity_tenders.winning_bidder` (0225) and the Outcome section, the close dialog's "Who won", the stage guard "Say who won", the company analysis service (`analyseCompany`, `AnalysisCardView`, cache, daily limit, monthly allowance), the shared `SidePanel`, `StatStrip` / `StatTile`, `InfoTip`. Nothing was rebuilt: the tab reuses them.

**Data (migration `0229_opportunity_competitors.sql`, bundle 40, flag `gcc_tender`, PENDING).** `opportunity_competitors`: name, website, country, `expected_price` (`lower` / `similar` / `higher`, read from our side: "Below us" means they are expected to quote less), strengths, note, `is_winner`, `sort`. A partial unique index allows one winner per deal and a unique index on (deal, lower(name)) allows a name once per deal, so "Someone else" can find or add a row safely. Tenant SELECT policy only; every write is a service-role route.

**Routes (all `requireTenantUser` then the tender gate: flag `gcc_tender` + `pipeline`, view for GET, edit for the rest; a standard deal, another workspace's deal and another workspace's competitor are the same 404).**
- `GET / POST /api/opportunities/[id]/competitors`, `PATCH / DELETE .../[competitorId]`: explicit field allow-list, length limits (name 200, website 300, country 80, strengths 1000, note 2000), website normalised to `https://host/path` (anything else 422), at most 30 per deal, `logChange` on every mutation under `opportunity_competitors` (the Activity tab and the change-history filter "Deals: Competitors").
- Marking a winner clears the others and writes the name to `opportunity_tenders.winning_bidder` and `opportunities.competitor`, so every older screen keeps working; clearing or removing the winner clears both only if they still hold that name. A renamed winner is renamed on the deal too.
- `POST .../[competitorId]/insights { refresh? }` runs `analyseCompany` for the **stored** competitor (name, website domain, country), never for anything in the request, with the person's press as the consent to web research. The service's cache (a fresh saved card is returned at once, free), hourly refresh limit, daily limit and monthly allowance all apply. The answer is the same `DockAnalysis` the dock draws, rendered with the existing `AnalysisCardView`. Flag off or no Accounts view: 403 with the plain reason; `GET` tells the tab whether to offer the button (hidden when not).

**Screen.** A tab "Competitors" after Room, tender deals only. A strip (Competitors, Expect to be cheaper, Winner), then cards (one column on a phone, a grid on a desktop; six, then "Show all"). "+ Add competitor" opens the shared side panel (bottom sheet on a phone); Edit; the "..." menu holds "Mark as winner" and "Remove" (with a confirm). **Company insights** on each card runs only when pressed; **Analyse all** (two or more) asks first and states how many analyses it will run. Explanations sit behind an "i" (`competitors/tips.ts`, held to the InfoTip limit). Colours come from tones only.

**Who won.** The close dialog (Lost) and the Outcome section's "Won by" are one shared picker, `WhoWonPicker`: this deal's competitors plus "Someone else...". It is the old text box until the deal has a competitor, so a lost tender can always be closed. The stage move to Lost and the Outcome save record the winner by name on the server (`recordWinnerByName`): the deal's competitor of that name is marked, or one is added and marked. The "Say who won" guard accepts a typed name or a competitor already marked as the winner. A header save on a deal that is not Lost never adds a winner.

**3b list (a child record of a deal).** Wired: database with RLS and a pending-safe read (42P01 / 42703 / PGRST205 give a plain "needs a database update" note), `OBJECT_FEATURE` (`opportunity_competitors` to `gcc_tender`), change log and its filter, the v1 change feed (scope `tenders`, never the wildcard), the deal's Activity tab, the capability text, the ledger and bundle 40. Skipped on purpose: Data Workbench, the v1 list API, MCP, global search, analytics tiles, ⌘K and the Nova timeline (all belong to the deal, not to the competitor), custom fields, a master record of competitors across deals, ERP.

**Not verified here.** No browser was available: the screens are covered by server-render tests at the markup level (44 px targets, no fixed widths, one grid that falls to a column), not by looking at them at 375 px.

**Tests.** `competitors.test.ts` (the rules, the explanations, the migration and the bundle, the wiring), `tender.competitors.routes.test.ts` (gate, allow-list, duplicates, one winner and where it is written, who won by name, pending, insights), `Competitors.render.test.ts` (cards, strip, panel, picker, insights, tabs).

## 21. Redesign step 1 as built (2026-10-27): the tender deal opens on one Overview

Owner-approved "Deal to Project" redesign, step 1 of the tender deal page. Only the tender deal changes (flag `gcc_tender`); a standard deal keeps its Overview and gets no Tender tab, no marker and no new wording. BoqTab, EstimatesTab, RFQ, the Lines editor and contract projects were not touched, and nothing was built for the Competitors tab (another builder).

**What is already there (checked):** the old Tender tab (`TenderTab`) with Tender details, Bid decision and Bid bond sections, the `TenderStatStrip`, the "From email" fold (`SourceEmailSlot`), `BidDecision` (propose, approve, reject, withdraw, history), `SidePanel` (drawer, bottom sheet under 780 px), `SettingsSection` (collapsible, remembers its state), `StatTile`/`tone.ts`. All reused; `TenderTab.tsx` is replaced by `TenderOverview.tsx`.

### Tabs and header
- Tab order: Overview, Room, BOQ, Estimates, Lines, Bids, Quotes, Related, Activity. There is no Tender tab; `?tab=tender` (or a saved state saying "tender") opens Overview. Tabs stay state, not `?tab=` (the Lines editor keeps unsaved edits across tab switches).
- Header on every tab, in this order: title, ref, account, Stage select, **Bid decision marker**, **Bid end date** countdown chip (with the date under it), **Bid guarantee** state chip ("None recorded" when there is none). The subtitle says "bid ends", not "close by".
- The marker (`BidDecisionMarker`, rules in `lib/tender/decisionMarker.ts`): Pending (neutral, no proposal), Awaiting approval (warn, a proposal exists), Go / No-go (good / bad, the approved decision). Tapping it opens `BidDecision` in the shared `SidePanel` (a right drawer on a desktop, a bottom sheet on a phone) and closes it after a save. A decision saved before approval existed still reads Go / No-go and the panel says it was recorded before approval.

### The Overview (top to bottom; two columns from about 900 px, one below)
1. The stat strip (`TenderStatStrip`: Bid end date, Bid decision, Bid guarantee, Open work), kept on the Overview only, with the new words. The coloured top edge of a tile is the shared `StatTile`'s own and is being removed there; this redesign adds none.
2. **What the client asked for** (left column): title, tender number, issuer, issuer account (with a link "Open <account>"), portal, Bid end date, contact, owner, source, description, team, one Save (tender fields to `/tender`, deal fields to the deal route). Dropped from the old forms for a tender: Expected close (it follows the Bid end date on the server), Probability override and its reason (the stage sets it), and the free-text Competitor (column and the "Who won" step are unchanged; a Competitors tab is being built elsewhere).
3. **Documents** (right column): the source email first (`SourceEmailSlot bare`: from, subject, date, what they asked, open email), the files copied from it, then **Change requests** (the old addenda counter, column `addenda_count`; it has its own Save when changed).
4. **Open work**: open Deal Room questions (opens the Room), overdue next steps (opens Activity), and lines without a price (counted from the saved lines already on the page, no new query).
5. **Bid guarantee**: State (Requested, Issued, Submitted; a select for people who can edit the deal), amount, currency, valid until, Release guarantee (the same deliberate inline confirm), the chip, and who released it and when.
6. The Outcome block, in closed stages only, full width underneath.

Phones: the blocks are `SettingsSection`s that remember how they were left. "What the client asked for" and "Open work" start open, Documents and Bid guarantee start closed (the new `defaultOpenNarrow`, applied after mount only when nothing was remembered). Tap targets are 44 px, the grid is `repeat(auto-fit, minmax(min(100%, 440px), 1fr))` so nothing scrolls sideways, and when a tab is selected the strip scrolls it into view and, on a phone, brings the strip to the top so the new content is what is seen.

### Renames (labels only; every column is unchanged)
Addenda -> Change requests. Bid bond -> Bid guarantee (chip "Guarantee: Issued", button "Release guarantee", reminder line "Bid guarantee: ..."). Closing date / Closing / Close by / Closes in -> Bid end date / Bid ends in ("Bid ends tomorrow", "Bid ended 3 days ago") on the deal, the create form, the board ("Bid ends"), "Bids ending soon", the reminder email ("Bid ends in 3 days: ...") and the tips. Standard deals keep "Close by" and "Expected close".

### Bid guarantee states (migration `0228_bid_guarantee_states.sql`, bundle 39, PENDING)
Check on `bond_status` widened to requested, issued, submitted, held, released; `held` stays as the legacy value and reads "Issued"; new rows default to `requested`. Changed with `POST .../tender/bond { action: "set_status", status }` (edit access to the Pipeline; Released only through the confirmed release; a released guarantee stays released; logged as "Requested -> Issued"). Before the migration runs every row is `held`, so Issued is a quiet success and Requested / Submitted answer "needs a database update (migration 0228)"; Release keeps working.

### Rules
1. An approved go from Received or Bid/No-bid moves the deal to Estimating, an approved no-go to No-bid (closed, dropped, loss reason "other", the no-go reason as the note), by calling the deal's own stage route (`PATCH /api/opportunities/[id]`, same as Submit bid does), so the stage guard, closing and outcome rules, the change log and the events all run. A refusal never undoes the approval; the response carries `stage_moved` / `stage_error` and the proposer's e-mail says where the deal went. A rejection behaves as before. The manual "Move to Estimating / No-bid" buttons are gone.
2. Submit bid and Revise bid **warn, never block**: a confirm dialog lists, only if they apply, lines without a price, prices older than the workspace's validity (`config.tender.price_validity_days`), no approved go, and a bid guarantee not yet marked Submitted (when one is recorded). The BOQ's own totals are asked for when the deal has a BOQ; otherwise the saved lines tell the unpriced count. "Go on" always continues. No server change.
3. One date: `closing_at` stays the column; every tender surface calls it Bid end date.

### Not verified here
No browser was available to this builder. Checked by server render tests at both widths' markup (44 px targets, the auto-fit grid, narrow defaults, no literal colours) and by reading the code; the real 375 px and PC look, the drawer and the scroll-into-view are for the owner's eyes.

### Tests
`src/app/(app)/pipeline/[id]/tenderOverview.render.test.ts` (tabs, header, blocks, phone checks, warnings wiring, new words), `tenders.render.test.ts` (the marker and its panel), `src/lib/tender/approval.test.ts` (states, marker, auto stage, warnings), `src/app/api/opportunities/tender.approval.routes.test.ts` (the auto move), `tender.guarantee.routes.test.ts` (set_status, before and after 0228), `src/lib/tender/guaranteeStates.test.ts` (the SQL, the bundle, the ledger).

## 23. After award as built (2026-10-27): the bid's cost, variations, invoicing milestones, and the project's links back

Owner decisions of the Deal to Project redesign (memory note `tender-redesign-2026-10-27`), back-end first. Only tender deals and contract projects change (flags `gcc_tender`, `contract_projects`); a standard deal and every workspace without the flags are untouched. The BOQ table, the Costing tab, `OpportunityDetailClient`, `BoqTab*` and `Estimates*` were not touched (other builders).

### What is already there (checked)
Bid versions (`tender_bid_versions`, append-only, `lines` by whitelist, never a cost: section 16); the contract project with budget revisions and the baseline approval (section 17, `approval.ts`, `approvalServer.ts`, the Revisions route); the cost the budget has always read from the BOQ row (`unit_cost`, `markup_pct`) and the estimates that priced it (section 19, `mapTenderToBudget`); `approval_requests` and the tender approvers (0221); the invoices object and its create route (refs, e-invoice VAT lines, change history); `insertWithMasterRef`. All reused. Nothing was duplicated: variations use the bid decision's approvers and rules, a variation's budget revision is started by the same function the Revisions route now calls, and a milestone's invoice is made by the existing `/api/invoices` route.

### 1. The cost of a bid version (migration `0230_bid_version_cost_snapshot.sql`, bundle 41)
- **A table, not a column.** `tender_bid_version_costs` (one row per version, unique per deal and version, an UPDATE refused by a trigger) has RLS **on and no policy at all**. The brief said "in `tender_bid_versions`", but that table carries a tenant SELECT policy and a policy cannot hide a column, so a cost column there would be readable by any member through PostgREST with their own session token (the 2026-10-21 audit lesson, 0200). `tender_bid_versions` is unchanged. This is the one place the build differs from the brief; say if the column is preferred.
- **What is stored.** At Submit bid, per bid line (same order and keys as the version's lines): the recorded cost per unit and the row markup from the BOQ row, the cost code as the client wrote it, and the **budget lines that cost becomes**, worked out by the existing `mapTenderToBudget` (recorded BOQ cost, else the estimates that priced the row, else the rate less the workspace's default margin marked estimated). So the project starts from exactly what the bid assumed, estimate-priced rows included. `bids/costSnapshot.ts` (pure) builds, parses and prices it; `bids/costServer.ts` is the only code that touches the table.
- **Submit.** The version is inserted as before; the cost is then saved. If 0230 is not applied the bid **still goes in** and the answer carries `cost_snapshot: "pending"` (`saved` / `pending` / `failed`). The Bids tab does not show it (not my file); the answer is there when the owner wants it shown.
- **Never exported.** Only `costServer.ts` names the table; only the bid route, the project creation and the project's origin loader import it. A test walks `src` and fails if any print page, v1 route, `LIST_SOURCES`, BOQ export, answer sheet or Standard Quote conversion mentions it, and proves the version row, the versions list and the compare answer contain no cost, markup or margin.
- **The project starts from the winning version.** `loadTenderSource` takes the **last** version submitted. With a stored cost, the baseline's lines are the snapshot's budget lines (cost codes checked against the workspace's CURRENT list: kept, or dropped and listed as before). Without one (a version submitted before this, 0230 pending, or no version at all) it falls back to the current BOQ exactly as before. Either way **revision 0's `justification_text` is the budget note**: "Started from bid version 2 (submitted 2026-10-12): the cost recorded when the bid went in." / "Started from the current BOQ: bid version 3 was submitted before bid costs were stored." / "... no bid version was submitted for this tender." It shows on the Revisions tab; the create answer carries `cost_source` and `budget_note`.
- **Bid against budget** (Overview card): the bid's cost, the budget now (the approved revision, else the one being worked on), the difference in amount and percent with a word ("Over the bid" / "Under the bid") as well as a colour, and the margin at the bid against the planned margin now. For a version without a stored cost it says so.

### 2. Variations (migration `0231_contract_project_variations.sql`)
- `contract_project_variations`: ref **VAR-####** (`MASTER_REF_TABLES`), title, description, **amount** (change in contract value, signed), **cost_amount** (internal, signed), change request (free text), status draft / submitted / approved / rejected, submitted by/at, decided by/at, note, and the budget revision an approval opened. Tenant SELECT policy only; every write is a service-role route.
- **Flow.** Draft (edit, remove) -> **Send for approval** (an `approval_requests` row, kind `project_variation`, object = the variation, so several can wait at once; the tender approvers; the sender cannot approve their own unless the workspace allows it; refused when nobody else could) -> **Approve** or **Reject** (a comment is required to reject; the claim is a compare-and-set on `pending`, so two people cannot both decide) -> a rejected one goes back to draft when edited and can be sent again; the sender can **Withdraw**. A note goes to the approvers and back to the sender (inbox and e-mail through `resolveOutbound`, as the baseline approval does).
- **Approval changes the contract value** by `amount`, once, with a compare-and-set on the value read (a lost race retries, a negative result is refused). The project's `contract_value` therefore **is the revised value**; the original is the revised value less the approved variations and is not stored twice (a hand edit of the value after variations shifts that derived original; it is shown, not hidden).
- **It opens a budget revision** through `startDraftRevision` (`revisionStart.ts`, extracted from the Revisions route, which now calls it, behaviour unchanged): only when the cost changes, the project has an **approved baseline** and **no revision is already open**. Reason `client_variation` (else `other`, with the variation in the note); a cost **increase** adds one placeholder line ("VAR-0003: title", resource 51 when the list has it) for the team to split; a cost **decrease** adds no line (a budget line cannot be negative) and the revision note says to lower the matching lines. The screen says in one sentence what happened ("Budget revision 2 was opened for the cost", "A budget revision is already open: add the cost there", "The baseline is not approved yet, so put the cost into the baseline").
- **Screen:** Variations tab on the project: three tiles (approved variations with their cost, revised contract value with the original, waiting for approval), one table, `+ Add variation` in the shared side panel (a bottom sheet on a phone), whose buttons follow the variation's state and the person's rights.

### 3. Invoicing milestones (migration `0232_contract_project_milestones.sql`)
- `contract_project_milestones`: title, due date, **percent of the (revised) contract value** or a **fixed amount**, status planned / ready / invoiced / paid, `invoice_id` (a unique partial index: one invoice per milestone), order, note. Tenant SELECT policy only.
- **Percent milestones should total at most 100%: a warning, never a block**, printed in plain sight (not behind an "i"); the same warning when the schedule passes the contract value. A percent is worked out from the contract value **as it stands**, so an approved variation moves what is still to be billed.
- **Create invoice** (`POST .../milestones/[id]/invoice`) calls the existing `/api/invoices` route in-process (the project's customer verified against the workspace, one line for the milestone, due on its due date, notes naming the project and milestone), so refs, e-invoice VAT lines and the invoice change history are the invoices object's own. The milestone is **claimed first** (planned/ready -> invoiced, compare-and-set), so a double click or two people cannot make two invoices, and the claim is released if the invoice fails. The link back is the invoice's `custom_data` (`source_contract_project_id`, `source_contract_project_milestone_id`) and its notes; the milestone holds `invoice_id` and shows the invoice reference as a link. A paid invoice reads the milestone as paid; a cancelled one reads it as ready again and another invoice can be made. The amount is locked once an invoice exists; status can be moved by hand between planned and ready, and from invoiced to paid.
- **Screen:** Invoicing tab: three tiles (contracted, invoiced, still to invoice), one table, `+ Add milestone` in the side panel. "Create invoice" is offered only with edit rights, the Invoices module on, a customer on the project and an open project.

### 4. The project's links back
The Overview card **Came from** (read-only links): the tender, the winning bid version (number, date, price) opening the deal's Bids tab, the current BOQ file opening its BOQ tab, and the estimates that priced the BOQ (from `tender_boq_estimate_links`). It replaces the old "Tender" row in Details (no duplicate). Everything is read from the project's own `source_opportunity_id`, tenant-scoped, and a missing table just leaves a line blank. The links use `?tab=bids` and `?tab=boq`; if the tab ids are renamed by the deal-page work, update `ProjectOriginCards.tsx`.

### 3b list (what was and was not wired)
Done: database (RLS, tenant SELECT only or no policy, pending-safe reads), `OBJECT_FEATURE` for the three tables, `VAR` ref in `MASTER_REF_TABLES`, change history (every event is logged on the project, so it shows on the project's Activity tab and under the existing "Contract projects" filter; no separate filter entry because the variations and milestones are children of the project), capability text and regenerated facts, InfoTips held to the limit by test, `data-guide` ids, bundle 41 and the ledger. **Skipped on purpose:** Data Workbench, v1 API and MCP (the cost and the budget are internal; a variation and a milestone are project children, same call as the budget lines), `LIST_SOURCES` (so also no Talk to data), global search, analytics tile and Reports metric, command palette, Nova timeline entries of their own (the project's timeline carries the notes), custom fields, a demo seed, Drive guides (wait for the owner's validation). **Not in scope and not built:** RFQ award to purchase orders, the ePROMIS handover, a PDF of a variation or of the billing schedule, sending a variation to the client.

### Not verified here
No browser was available to this builder, and the tenant is resolved from the hostname, so nothing was looked at at 375 px or on a PC. The screens are covered by server-render tests at the markup level (the table scrolls inside its own container, 44 px targets, the shared side panel, no literal colours, no explanation printed). The routes are proved against an in-memory database. The in-process call to the invoices route is mocked in the tests; the real invoice (including the e-invoice VAT line for a Saudi workspace) needs one live try on develop after bundle 41. Migrations 0230 to 0232 were not run against a real database from here.

### Tests
`src/lib/tender/bids/costSnapshot.test.ts` (the snapshot, the budget it gives, the note, bid against budget, and **the cost never leaves the building**), `src/app/api/opportunities/tender.bidCost.routes.test.ts` (submit keeps the cost, a later version, pending 0230, no cost in any read of the versions), `src/app/api/contract-projects/afterAward.routes.test.ts` (the budget source and its fallbacks, origin and bid against budget, variations end to end, milestones and the invoice, the gate, other workspaces, pending migrations), `src/lib/contractProjects/afterAward.test.ts` (the pure rules, the migrations, the bundle, the ledger, the wiring), `src/components/contractProjects/afterAward.render.test.ts` (both tabs, the panels, the cards, the page).
