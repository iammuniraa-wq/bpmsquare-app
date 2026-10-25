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
| Supplier prices | A price older than 6 months is not used; raise at least 3 RFQs to a supplier group, then decide. | Price validity default 180 days (workspace setting). A stale price is shown but never auto-used. Awarding an RFQ needs at least 3 supplier replies unless a reason is recorded (workspace setting, default 3). The choice records who decided and why when it is not the lowest. |
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
