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
