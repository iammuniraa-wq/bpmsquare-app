# VeveyCRM — Project Brief

> **Read this first.** This file is the single source of truth for the project so a fresh
> session (human or AI) can pick up exactly where we left off. Everything below is
> *decided* unless it appears under "Open decisions".

Last updated: 2026-08-05

---

## 0. Current state — read this before anything else (updated 2026-08-05)

The prototype era is over: this is a **live multi-tenant SaaS in production**
(Next.js App Router + Supabase, Vercel). `main` = production (demo tenant +
real client **vikas-pioneers**); `develop` = staging. Database migrations are
tracked files in `supabase/migrations/` (through **0061**, ALL applied to
production by the owner via the Supabase SQL editor — the owner runs each new
migration by hand and confirms; never assume one is applied until they say so).

### Working conventions established with the owner (Abdul, sap.rashid@gmail.com)
- **Per-build cadence (standing instruction):** build → commit to the session
  work branch → push → **security review** (subagent identifies, verify pass,
  fix ≥MEDIUM findings before merging) → ff-merge to `develop` → promote to
  `main` only when the owner says so. Every build this far has followed it.
- The owner also commits directly to `develop` mid-session (VIK-x fixes, the
  v1 API expansion, Postman collection). **Rebase onto origin/develop before
  merging, and security-review external commits before they ride to main.**
  Watch for migration-number collisions (an 0058 collision was renumbered
  0059 this way).
- Architecture rules live in `bpmsquarecore.md` (tenant extensions §1,
  record identity §3) and `MULTI_TENANT_GUARDRAILS.md` (checklist + tracked
  debt + audit history). Both are always loaded; keep the debt list current.

### Shipped 2026-07-31 → 2026-08-05 (all in production on main)
1. **Change History** — `change_log` (0050), field-level diffs on every
   mutation path of every core object, Administrator workcenter UI + CSV.
2. **Outbound Emails workcenter** — `email_log` (0051), both send paths.
3. **Quote Lines** as its own Data Workbench object (import/update/export).
4. **Business Roles RBAC Phase 1** (0052) — roles/grants/assignments,
   workcenter-view gating via `requireWorkcenterView()`. **Phase 2 open:**
   can_create/edit/delete + territory scoping are stored but NOT enforced in
   API routes; workcenter grants are page-level only.
5. **Standard Quote** — deliberately independent quote object (0053): own
   tables/routes/UI/print, status pipeline draft→sent→accepted/rejected/
   expired. The legacy Quotation object is Vikas-contaminated and untouched;
   cleanup deferred. Standard Quote has NO Data Workbench object yet.
6. **Standard Quote templates** (0054) — block-based drag-drop builder,
   accent/logo position, per-quote template pick, live preview.
7. **Commercial fields + AI** (0055) — header discount/tax/shipping
   (`standardQuoteTotals.ts` is the single source of truth), per-quote
   intro_text; AI draft-lines / draft-intro / design-template via
   `standardQuoteAI.ts` (needs `ANTHROPIC_API_KEY`; never invents prices).
8. **Gmail reply-threading** (`connectors/gmailReply.ts`) — reuses the Gmail
   App-Password connector for IMAP search + SMTP threaded reply on both
   quote email routes; falls back to Resend. Tenant must connect Gmail in
   Settings → Connectors (Vikas had NOT yet as of last check).
9. **Feature flags** (0056 demo, 0060 vikas-pioneers) — six new TenantFeatures
   keys (`change_history, outbound_email, business_roles, standard_quotes,
   gmail_reply_threading, quote_lines_dw`), enforced page-level
   (`requireFeature`) AND API-level (`tenantHasFeature` — pattern introduced
   this session; older flags are page-level only). Both tenants enabled.
10. **Employees + Business Users** (0057) — employees master data (own
    workcenter under Master data, DW import), SAP-style Business Users screen
    (Administrator): create login from employee, initial password, lock,
    validity window, counted-seat flag, link-existing-login flows.
    `isMembershipActive()` enforced in middleware + `supabase-server.ts`.
11. **Quote date profiles** (0059; owner's parallel 0058 added back-datable
    `quote_date`) — inquiry_date (manual), submitted/sent stamp (first email
    OR first leave-of-initial-status), closed_at (follows outcome/terminal,
    clears on reopen), maintained updated_at; manual overrides via
    `dateProfile.ts` validation; Edit-dates panel on Standard Quote.
12. **v1 API CRUD** (owner-built, reviewed here) — quotations CRUD +
    metadata endpoints over per-tenant bearer keys, `API_V1.md`, Postman
    collection. Two MEDIUMs fixed in review (line inventory_item_id now
    tenant-verified via `verifyQuoteRelations`; PATCH-null discount pricing).
    Two tracked LOWs in MULTI_TENANT_GUARDRAILS.md (hardcoded status list,
    non-atomic line replacement).
13. **Business IDs for master data** (0061) — ACC/CON/AST/SUP/INV-0001
    tenant-scoped sequential refs: backfilled, generated on create + DW
    import (`masterRef.ts`, paginated seq + collision retry), export-only DW
    field, ID shown across lists/details, global-search matchable.
    **Refs are display-only; every mutation keys on UUID `id` (§3).**

### Known open items
- RBAC Phase 2 (API-level grant + territory enforcement).
- Standard Quote: no DW object; no revisions concept; email subject/body not
  tenant-templatable.
- v1 API tracked LOWs (above); no rate limiting on bearer key.
- Legacy Quotation cleanup ("one day").
- Old §8 list below is prototype-era; treat this section as current.

## 1. What we are building

A **vertical SaaS** that combines **CRM + Field Service Management (FSM)** for
**electromechanical repair & service businesses** — companies that repair, rewind and
service **motors, transformers, pumps, generators and panels**, do **AMC contracts**, and
send **technicians into the field**.

- It is **not** a generic CRM and **not** a generic FSM. The wedge is the *combination*,
  built for repair/service shops that get work through **three channels at once**:
  OEM/vendor **referrals**, **AMC contracts**, and **direct customers**.
- **India-first launch, global ambition.** The name and product must not be boxed into
  India or into "motors" only (transformers, pumps, etc. must fit).

### Why this shape (the key insight)
The customer doesn't need "a CRM" — they need **one job engine with three billing paths**.
The quotation is the document the business lives in. Get the object model right and the
"three models" collapse into one system.

---

## 2. Design partner / first customer — Vikas Pioneers

- **Vikas Pioneers India Pvt Ltd** — Hosapete, Karnataka (sister firm: Vikas Electrical Works).
- Site: https://vikaspioneers.com/
- Business: **Repair, rewinding & overhauling of HT/LT & AC induction and DC motors, and
  transformers.** Sells motor spares + HV/LV insulating materials. Workshop **and** onsite
  field service. Holds a **Govt Class-I electrical contractor** licence.
- **Authorized service centre for: Crompton Greaves, Marathon, Rotomotive Power Drives.**
  → these are the real **OEM/vendor partners** (top of the funnel).
- Three revenue channels:
  1. **Vendor/OEM referrals** — OEMs send repair leads (B2B2C).
  2. **AMC contracts** — yearly contracts to service a vendor's end-customers (recurring + SLA).
  3. **Direct customers** — walk-in/B2B repairs, full margin.
- Has **field technicians** who visit customer sites.

Vikas is the **design partner #1** (intended to be a *paying* partner, not a free pilot).

---

## 3. Core data model — LOCKED

**The Account (customer) is the centre.** Every other object carries an `account_id`;
nothing exists without belonging to an account. (If a screen can create an orphan record,
the model is leaking.)

```
Contact ─┐
Site ────┤
Asset ───┤   (motors / transformers — specs + repair history + photos)
Contract ┼──►  ACCOUNT  ◄── the hub, referenced by everything
Lead ────┤              (typed: OEM/vendor · direct customer · end-customer-under-OEM)
Quote ───┤
WorkOrder┤
Invoice ─┘
```

### Two centres (keep them distinct)
- **Account = root of ownership** — most-*referenced* object. Answers "whose is this?"
- **Work Order = root of activity** — most-*referencing* object; the transactional join
  where Account + Asset + wrapper + Technician + Parts + Invoice converge. But it still
  refers *up* to the Account — it is a child, not the root.

### The rule that links everything
Every **Work Order** is authorized by **exactly one commercial wrapper**:
- **Quotation** → billable job → invoice the account.
- **Contract (AMC)** → covered job → no per-job charge (billed to the OEM/contract holder).

The original "three models" (referral / AMC / direct) are **not** three object types —
they are just **account type + which wrapper authorized the job**. (Modelling that property
as a structure was the early mistake; it's fixed.)

### Transaction lifecycle (the spine — the quote is central)
```
Enquiry/Lead → Inspection → Quotation → Approval → Work Order → (field/workshop) → Invoice
```
AMC-triggered jobs skip quoting (already authorized by the contract).

### Object list
Account, Contact, Site, Asset (motor/transformer), Contract (AMC), Lead, Quotation,
Work Order, Invoice, Technician, Case (service ticket), Part/Inventory.

---

## 4. Product structure / IA — LOCKED (modern connected CRM)

Organized by the **customer journey (pillars)**, not a flat module list. The interface
should feel like "follow the customer," not "browse modules."

- **Marketing** — Leads, Partners (OEM referral sources)
- **Sales** — Pipeline, Quotations
- **Service** — Cases, AMC contracts
- **Field Service** — Work orders, Dispatch, Technicians
- **Records** — Accounts, Assets, Invoices
- **Workspace** — Pipeline (home), Dashboard

### UX principles
- **Pipeline/journey board is the home view**: Lead → Quoted → Won → Scheduled →
  In service → Invoiced, colour-coded by pillar; jobs flow left→right across
  Marketing → Sales → Field → Finance.
- **Every record is a connected hub**: an Account shows clickable connected-object chips
  (Contacts, Deals, Quotes, Work orders, Assets, Contract, Invoices) **and a unified
  timeline** where one job visibly travels across the pillars.

---

## 5. Branding

- **Working name: `VeveyCRM` — PLACEHOLDER ONLY. NOT FINAL.**
  - ⚠️ Real risk: it sounds almost identical to **Veeva** (Veeva Systems / "Veeva CRM",
    a ~$35B CRM company) — a same-category collision. Also "Vevey Software Solutions" exists.
    Do **not** ship this name. It is scaffolding until we lock the real one.
- **Logo (name-independent, reusable after rename):** a **"V" monogram** whose two strokes
  converge on a single **amber hub dot** — a deliberate visual echo of the data model
  (everything points to one hub/account). Scales to a favicon.
- **Brand colours:** primary blue `#378ADD`, accent amber `#F6B23C` (hub dot),
  dark sidebar gradient `#152233 → #0e1a28`. Text ink `#1c2733`, muted `#5f6b7a`.

---

## 6. Prototype

- File: **`vikas-service-os-prototype.html`** (in this repo) — a **standalone, self-contained,
  offline** clickable mockup. Open in any browser (no build, no server).
- Contains: login screen → grouped sidebar (Marketing/Sales/Service/Field Service/Records) →
  Pipeline home (funnel + kanban) → Dashboard, Leads, Partners, Quotations (with line-item
  quote detail), Cases, AMC contracts, Work orders (with "Authorized by" wrapper link),
  Dispatch, Technicians, Accounts (connected hub: chips + unified timeline), Assets, Invoices.
- Sample data is modelled on Vikas (Hosapete; OEMs Crompton/Marathon/Rotomotive;
  technicians Ramesh/Suresh/Anil/Farhan; customers Krishna Textiles, Sahyadri Hospital,
  Bharat Forge, Tata Motors, Hosapete Steel).
- Known mockup limits: chips/kanban cards *look* linked but don't deep-navigate yet;
  kanban drag not wired; no persistence.

---

## 7. Naming — status & criteria

**Decision rule for any candidate name (all three must pass):**
1. No collision **in our category** (FSM / CRM / field service). Sharing a word with an
   unrelated product is fine.
2. An acceptable **domain** is free (`.com` ideal; else `.io`/`.app`/`get___.com`).
3. **Trademark** clear in the software class.

**Rejected so far (and why):**
- `ServiceOS` — too generic, unownable/untrademarkable.
- `Yantra` — direct FSM competitor **Yantr.ai** (Tech Mahindra) + India-coded + crowded.
- `Relay` — crowded (Relay.app a16z-backed, Relay Network); no clean domain.
- `SphereIQ` — existing **Sphere IQ™** (SP Plus) + "Sphere"/"…IQ" very crowded; domain gone.
- `Fixit` — essentially generic for "repair"; many in-category apps; untrademarkable.
- Also checked & taken: Servio, Servora, Fieldnova, Maintra (maintra.ai = work orders!),
  Spindle, Mendr, Fettle, Tendara, Korrigo (homophone of **Corrigo**, a JLL FM/work-order SaaS).

**Lesson:** every *literal* fix/repair/service/field word is already an FSM/CRM company.
The final name should likely be an **invented word** (Stripe/Vercel/Twilio style) so a clean
domain + trademark are actually available. Next step is a real **domain + TM check** on 1–2
finalists, then lock.

---

## 8. Open decisions / next steps

- [ ] **Lock the real product name** (run domain + trademark checks; replace VeveyCRM everywhere).
- [ ] **Database schema** — tables + foreign keys around the Account hub (make it buildable).
- [ ] **Tech stack & build plan** — decide and document.
- [ ] **Technician mobile app** screens (offline-capable; field reports, photos, signature).
- [ ] Make prototype **chips/kanban actually clickable** (card → account record).
- [ ] Transformer-specific quote/asset variant (oil testing, not just rewinds).
- [ ] Vendor self-service portal (OEMs submit/track referred jobs) — strong retention hook.
- [ ] Validate the model with 3–5 other repair shops before over-generalizing.

---

## 9. How to work in this repo

```bash
git clone https://github.com/iammuniraa-wq/veveycrm.git
cd veveycrm
# open vikas-service-os-prototype.html in a browser to view the mockup
```

Push changes back to `origin/main` so the next session sees them.

---

## 10. User documentation (Google Drive) — keep it current

A user-facing documentation set lives in Google Drive, folder **"BPMSquare
Documentation"** (https://drive.google.com/drive/folders/1vogZwPOvllisA5enJUBdC_Ea1lUiLsz9):
Sales Cloud Guide, Service Cloud Guide, WFM Guide, Marketing Guide, Admin &
Setup Guide, REST API Integration Guide, and the "How to Use BPMSquare" deck.

**When a change alters user-visible behaviour a guide describes, update the
matching Drive doc in the same piece of work.** The full rule (and the caveat
that the Drive tools can create but not edit a doc's body in place) is in
`bpmsquarecore.md` §9 — that file is always loaded, so the rule is not missed.

---

## 11. Where we left off — 2026-08-15 (read this to resume)

Everything on `develop` was promoted to `main` on this date. State at the
pause point, in priority order for the next session:

**Next up (explicitly on hold, waiting for the owner's go): Pricing Engine
Phase 2.** Phase 1 is complete and live behind the `pricing_engine` feature
flag (spec: `docs/pricing-engine-architecture.md` v1.4 — the source of truth;
engine: `src/lib/pricing-core/`, 44 tests, both Phase-1 exit criteria green;
API: `POST /api/v1/price`; cockpit: Settings → Pricing Engine). Phase 2 scope,
already agreed: pricing-context persistence + simulation replay, config
version diff, approval workflow for publish, NL rule authoring (reuse the
`/ask` forced-tool-call pattern), tenant onboarding mapper, anomaly digest,
per-API-key rate limiting.

**Standing architecture decisions made this week (do not re-litigate):**
- ALL business IDs (account/contact/asset/supplier/inventory refs, quote/
  invoice/PO/case refs, employee codes) are system-generated. Users never
  type or edit an ID; the only user influence is format/number-range config
  in Settings → Number Ranges (one address for all of it; Quote ID format
  lives there now, moved from Entities & Tax). Employee codes were the last
  gap — closed everywhere incl. the WFM surfaces; `src/lib/employeeRef.ts`
  is the single generator, case-insensitively unique (migration 0080).
- The old static pricing in Settings is renamed "Small Scale Pricing" and
  stays as-is for small/rigid tenants (Vikas doesn't use pricing). The
  Pricing Engine is a separate, standalone product surface
  (Pricing-as-a-Service) with BPMSquare in-app modules as ordinary clients.

**Operational ledger — SQL the owner runs manually (never auto-applied):**
Nothing in this repo applies migrations for either environment: there is no
`supabase/config.toml`, no GitHub Action, no Supabase↔GitHub integration.
Pushing to `develop` auto-deploys the **code** to staging via Vercel — that is
the only thing that happens by itself. Every migration is pasted into the
Supabase SQL editor by hand, staging first (when the feature lands on
`develop`), production at promotion time. Don't mistake the automatic code
deploy for an automatic schema change.
- Dev DB **and** main/production DB: migrations through **0091** applied
  (owner confirmed 2026-08-19). 0091 is currently the LAST file — nothing
  is pending on either database.
- Everything shipped after 0091 is deliberately schema-free, so don't go
  looking for a migration that doesn't exist: **Account 360** stores its
  card order and external sources in the existing `tenants.config` JSONB;
  the **feel layer** (confirm dialog + toasts) is client-side only; the
  **Flow Board** derives entirely from existing `change_log` + `quotes`
  rows. Fog of War was the same — it reads `accounts.territory` against
  the tenant's Sales-config picklist.
- Next migration will be **0092**, and the first thing likely to need one
  is the Opportunity object (see the Nova queue's forecast constraint —
  `quotes.opportunity_id` has to land in that same migration).
- (Historical: 0080–0085 were run at the 2026-08-18 promotion; the dev
  tenant's force-enable of `pricing_engine` was direct SQL on dev only —
  do NOT run on main.)

**Update 2026-08-17 — first client tenant provisioned (BIM Infotech).**
WFM-only tenant live at bim.bpmsquare.com (slug `bim`, Small business
plan): flags wfm/business_roles/administration/reports/data_workbench/
change_history; admin alias sap.rashid+bim@gmail.com; users seeded (Abdul
Rasheed admin via Team, Syed Shabbir EMP-0001 supervisor, Aliya Ain
EMP-0002 employee). Remaining before UAT: WFM config (sites/shifts/leave/
holidays) — deliberately left to the client admin + QA. Provisioning
exposed ~10 ungated surfaces (nav ghost parents, dashboard blocks,
analytics widgets, global search, General-settings sections, hardcoded
"VP" avatar + Vikas footer) — all fixed and promoted to main same day.
The whole flow is now codified in **TENANT_PROVISIONING.md** (pointer in
bpmsquarecore.md §2b): follow it 100% for every future client tenant.

**Open items:**
- **Pricing product definition — brainstorm nearly complete (resume
  2026-08-18), NO code written yet, spec doc still at v1.4.** Agreed across
  the 2026-08-16/17 sessions, in order:
  1. **Five-pillar lifecycle** (owner's frame): Strategy (AI advisory) /
     Management (engine — built, badly surfaced) / Execution (quoting,
     deal desk, overrides, margin-floor approvals — where clients live) /
     Analysis (realized-vs-list, leakage, win-loss — aggregated traces) /
     Governance (versions built; approvals+audit pending). Build order:
     Execution → Analysis → Strategy (execution generates the traces
     analysis needs; analysis feeds strategy). Recommended in-app
     execution first (Standard Quote + deal desk), PaaS second.
  2. **Enterprise methods taxonomy** (owner's frame): cost-based ("ERP
     cost simulator" = our COST_UP + cost models; name the screen "Cost
     simulator"), price-list (multi-dimensional by sales org/customer
     group/material group = dimensions + "most specific price wins"),
     value-based (adjustment sentences on value-driver dimensions),
     PLUS variant pricing (configured products; options = line-attribute
     dimensions with ALL_APPLY; combination rules = multi-attribute
     rules). All four coexist per tenant via **Price Books** (=
     pricing_area, already in schema). Manufacturing-first = a starter
     TEMPLATE (pre-registered dimensions in SAP-familiar weight order +
     standard components + two starter books), not engine code.
  3. **Self-explanatory face** (owner verdict: even versions/governance
     too complicated): rate-card metaphor; invisible versioning ("unsaved
     changes" / "Go live" / "Discard", never v7-DRAFT); three doors —
     Today's rates (weekly), Pricing setup (wizard: strategy → numbers →
     adjustment sentences → sample priced like a customer bill), History
     (timeline + as-of-date view); JSON tabs demoted to Advanced.
  4. **Structure decision:** Pricing becomes its OWN workcenter with its
     own Business Role — config areas as separate workcenters, NOT one
     Settings page with tabs. To be designed after scenarios finish.
  Scenario walkthrough (one-by-one, story format with real numbers —
  owner's preferred learning mode): 1 cost-plus ✓, 2 price-list ✓,
  3 value-based ✓, 4 variant ✓; **NEXT: scenario 5 — one company running
  all four at once (the Price Books story), then design the workcenter
  split, then write everything as spec v1.5.**
  Competitive framing agreed: SAP condition technique = mechanical
  benchmark, Pricefx = usability benchmark; our seam = self-service setup
  + customer-showable price explanation at mid-market price.
- Password-reset loop bug (QA, Jira KAN-12/major): code fully traced, three
  candidate mechanisms identified, waiting on QA's repro details.
- **KAN-17 (supervisor couldn't see break records) — resolved by policy,
  root cause open.** Owner decision 2026-08-18: WFM supervisors get full
  tenant-admin parity ("whatever admin can do, supervisor can do; proper
  role distinctions later") — implemented as auto-admin membership on
  supervisor login creation/promotion (commit 62b379f). Static tracing
  found NO code path where supervisor and admin get different break data
  (summary + hub both read via the role-immune admin client; 0063 RLS
  already equates supervisors) — prime suspect is a mis-provisioned QA
  test account (login not linked to a supervisor employee record, so the
  RLS supervisor branch failed). Need from QA: exact screen URL + which
  login was used. MUST be re-root-caused as part of the future
  proper-roles work: the supervisor-only path is currently unreachable
  (all supervisors are admins), so the divergence — if real — is latent,
  not gone.
- Vercel Hobby constraint (hard-learned): crons may fire at most once per
  day; a sub-daily schedule in `vercel.json` fails EVERY deploy's config
  validation silently. Webhooks cron runs daily 20:30 UTC.
- Drive docs: Admin & Setup Guide needs a Number Ranges section on its next
  refresh; owner still to drag How_to_Use_BPMSquare.pptx into the folder.
- Status-schema engine (see `/root/.claude/plans` history / task #27):
  Batch 0 (core tables + statusEngine.ts) shipped; batches 1–7 (per-object
  rollout incl. WFM leave/attendance statuses) not started.

**Update 2026-08-19 — BPMSquare Nova roadmap (the tracked to-do; doctrine
in bpmsquarecore §10 governs how it executes: one pillar → demo tenant →
owner sign-off → next).**
Shipped and validated: Nova shell (3-layer, identity top-right), the
engagement layer (celebrations incl. full-shift punch-out, Silence
Detector + saves, Loss Intelligence + reasons feeding /ask, Fog of War on
Sales-config territories), the ⌘K command palette, and palette-as-search
(the top-bar search on Nova is a button that opens the palette — one
search surface). Everything double-gated: `features.next_experience`
(platform-admin only) + theme `nextgen2`.
Also shipped since: **AI record creation** (paste → drafted account +
contact → dedup check → create, `/api/nova/draft`), **record timeline +
comments + @mentions** (0089), and the **Nova inbox** (0090).

The timeline is now mounted on **all twelve object families** —
accounts, contacts, quotes, standard_quotes, cases, work_orders,
invoices, assets, suppliers, inventory, purchase_orders, employees — via
`<NovaTimelineSlot>` (self-gating, so server pages carry no theme
logic). Three places must agree for a new object: the slot on its detail
page, `OBJECTS` in `api/nova/comments/route.ts`, and `LABEL`/`TABLE` in
`api/nova/inbox/route.ts` (see bpmsquarecore §3b point 7).
**Known exception: `technicians` has no timeline** — nothing writes a
`technicians` objectType to `change_log`, so a timeline there would show
comments against an empty change history. Give technicians `logChange`
coverage first, then add the three entries above.

**Account 360 shipped** (owner's call 2026-08-19, "this will be a game
changer"): a Nova side drawer holding one account's whole picture —
health rating with its own working shown, what-to-do-next suggestions,
then cards for pipeline, revenue, service, people, installed base and
coverage. Opened from the account header or the ⟳ on an accounts list
row (both self-gating, so a non-Nova tenant sees neither, and the list
doesn't even grow the column). Tenants configure it in Settings →
Account 360: hide/reorder built-in cards, and plug in their own external
sources (ERP, enrichment, anything answering JSON over https) with a URL,
an optional auth header and a few JSON paths — no code. The card
contract and the SSRF/credential rules are in bpmsquarecore §10a.
Still open on it: no v1 API or MCP surface for the 360 payload; external
source responses aren't cached (each drawer open re-fetches); web/social
enrichment is a source you configure, not something built in.

The queue, in order:
1. **Feel layer** — undo-toasts replacing window.confirm, optimistic
   saves, skeletons, Realtime presence. Explicitly deferred until after
   Account 360 (owner: "our improvement 86 we will do after account
   360").
2. **Opportunities** — the object Pipeline actually needs. `/pipeline` is
   reserved for the Lead → Quoted → Won → Scheduled → In service →
   Invoiced journey board (§UX principles); the Opportunity that quotes
   are created FROM does not exist yet (no table, no type, no route).
   Until it does, Pipeline stays a placeholder. The Nova **Flow Board**
   (shipped 2026-08-19) is NOT that board — it plots quotes by quote
   status and lives on Quotations behind a List / Flow board toggle. It
   was briefly mounted on /pipeline by mistake and moved the same day.

   **Forecast constraint — owner decision 2026-08-19, decide this BEFORE
   the migration, not after.** Pipeline is a module a client scopes
   separately (the `pipeline` TenantFeatures flag already exists), so
   forecast must be reportable from opportunities and from quotes
   **independently, and combined without double-counting**:
   - The opportunity carries its OWN forecast inputs — expected value,
     probability/stage weighting, expected close date — never inferred
     from a quote. A tenant with the module and no quotes yet still has
     a forecast; a tenant without the module still has the quote one.
   - `quotes.opportunity_id` (nullable, tenant-verified like every other
     foreign id) is what makes the two separable AND combinable. Without
     that column there is no way to tell, later, whether a ₹5L quote and
     a ₹5L opportunity are one deal or two — and no migration can
     reconstruct it. This is the single thing that cannot be added
     retroactively with the data intact.
   - Combined forecast rule: once an opportunity has a live quote, the
     QUOTE's value supersedes the opportunity's estimate for that deal —
     the estimate is what you had before a real number existed. Report
     the two as separate columns (weighted pipeline / open quote value)
     plus a de-duplicated total; never sum all three.
   - Analytics/reports and the v1 API both need the split, not just the
     UI — a client scoping Pipeline will ask for its forecast through
     the API on day one.
3. **Rival Ghost** and **Boss Battle** (approved concepts mockup:
   https://claude.ai/code/artifact/729d72a8-d732-4461-9966-a3421f9e39ab).
4. **Keyboard layer** — g+a style sequences, ? cheat-sheet.
5. **Enterprise-readiness audit** — exit criteria before the flag widens
   beyond demo (dark/light parity, mobile, empty states, performance).
6. **Nova docs + enterprise pitch** — Drive guide chapter + pending API
   doc debt (employees endpoint, loss reasons).
