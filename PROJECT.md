# VeveyCRM — Project Brief

> **Read this first.** This file is the single source of truth for the project so a fresh
> session (human or AI) can pick up exactly where we left off. Everything below is
> *decided* unless it appears under "Open decisions".

Last updated: 2026-08-05

---

## 0. Current state — read this before anything else (updated 2026-08-05)

The prototype era is over: this is a **live multi-tenant SaaS in production**
(Next.js App Router + Supabase, Vercel). `main` = production (demo tenant +
real client **vikas-pioneers**); `develop` = staging.

**Tenants in production (2026-09-06):**

| Tenant | slug | Reached at | Notes |
|---|---|---|---|
| BPMSquare Demo | `demo` | `app.bpmsquare.com` (resolved by `is_demo = true`, not by slug) | Shared sandbox. Was slug `vikas` until 2026-09-06 -- renamed because the shared slug made it look like the client's own workspace. It still shows the Vikas customisations via the extension registry (`demo` and `vikas` both map there); delete that line if it should become plain product. Every `scripts/seed-*-demo.sql` targets it via `is_demo`. |
| Vikas Pioneers | `vikas-pioneers` | `vikas.bpmsquare.com` (custom domain) | Live client. Never the target of a seed. |
| BIM Infotech Pvt Ltd | `bim` | `bim.bpmsquare.com` (custom domain) | Live client, WFM only. |

Before running anything that says "demo", confirm with
`select name, slug, custom_domain, is_demo from tenants;` that exactly one
row is `is_demo` -- the hostname rule above means that row is what the
whole sandbox serves.

Database migrations are
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
  (owner confirmed 2026-08-19).
- 0092_wfm_face_punch.sql — applied to both DBs (owner ran it 2026-08-20):
  face-punch schema (wfm_face_enrollments + wfm_kiosk_devices).
- 0093_kiosk_punch_source.sql — applied to both DBs (owner ran it
  2026-08-20).
- **0094_wfm_rls_pii_narrowing.sql — PENDING on both DBs** (written
  2026-08-20, WFM security audit): narrows the SELECT policy on
  wfm_face_enrollments and wfm_leave_records from tenant-wide to
  own-row-or-supervisor (both were readable by any member via direct
  PostgREST; the app reads them through the service-role client so this
  changes nothing for the app). Safe to run any time.
  The face-punch feature itself still waits on the FACE_AWS_* env vars
  in Vercel (AWS key generation in progress as of 2026-08-20) — until
  they exist, enrollment/kiosk return a clear "not configured" message.
- 0095–0097 (passkeys, bank details, broadcasts/approvals) — **applied to
  both DBs** (owner confirmed "SQL is executed" 2026-08-22).
- **0098_products.sql — PENDING on both DBs** (written 2026-08-22): the
  `products` table (catalog master data, RLS + tenant isolation, PRD-
  refs, custom_data) plus `quote_lines.product_id`. Until it runs, the
  Products module degrades cleanly (empty lists / hidden by the
  `products` feature flag, which no tenant has yet).
- **scripts/seed-products-demo.sql — PENDING, run AFTER 0098 and 0099**
  (dev DB at minimum): seeds 10 elevator-business sample products into
  every `is_demo` tenant, backfills their sub-categories, writes the demo
  category tree into `config.product_categories`, and flips
  `features.products` on. Idempotent — safe to re-run after 0099 even if
  an earlier version already ran.
- **0099_product_subcategory.sql — PENDING on both DBs** (written
  2026-08-22, same session as 0098 — run them together): adds
  `products.sub_category`. Categories are tenant config now
  (`config.product_categories`, Settings → Sales config), OOB depth
  exactly two levels (owner decision 2026-08-22).
- **0100_picklist_codes.sql — PENDING on both DBs** (written 2026-08-22,
  owner decision same day): every picklist value (territory, sales org,
  product category/sub-category) becomes { code, name } — records store
  the stable CODE, screens show the renameable name, integrations match
  on codes. Converts tenants.config AND backfills stored values on
  accounts/contacts/quotes/service_cases (territory, sales_org), products
  (category, sub_category) and business_role_grants.territories, all in
  one transaction, idempotently (re-run safe). The SQL derivation rule
  mirrors deriveCode() in src/lib/picklists.ts — keep in sync. The app
  normalizes legacy plain-string config on read, so code deploys safely
  BEFORE the migration runs; record values only get codes when 0100 runs.
- **0101_coverage.sql — PENDING on both DBs** (written 2026-08-26, owner
  decision same day, full-scope build not phased): the Coverage model —
  `teams`/`team_members`/`segments`/`coverages` tables (SELECT-only RLS;
  every write goes through the admin client behind an app-level
  `role === "admin"` check, since a forged row here can reassign account
  ownership or reroute ERP push — see the migration's own comment for the
  risk reasoning), plus `accounts.owner_user_id` (auto-ownership) and
  `products.available_segment_ids` (availability gating). Until it runs,
  the whole module degrades cleanly behind the `coverage_model` feature
  flag, which no tenant has yet.
- **0102_drop_territory_sales_org.sql — PENDING on both DBs** (written
  2026-08-26, owner decision same day, DESTRUCTIVE): drops
  `territory`/`sales_org` from accounts/contacts/quotes/service_cases, and
  `data_scope`/`territories` from `business_role_grants`. Any value already
  stored in those columns is gone once this runs — back up first if there's
  any chance the values are still wanted. All application code that read or
  wrote these columns was removed in the same piece of work (Sales config's
  Territories/Sales orgs picklist editors, FIELD_REGISTRY entries, Data
  Workbench import/export/update, the v1 quotations API, and the Fog of War
  engagement feature, which existed purely to gamify territory coverage and
  was removed outright rather than left pointing at nothing).
- **scripts/seed-coverage-demo.sql — PENDING, run AFTER 0101** (dev DB at
  minimum): seeds the deck's own worked example (South Pod / Hospital
  Specialists / AMC Service Desk, wired to SOUTH/HOSPITALS/AMC_BASE
  segments) into the `is_demo` tenant and flips `features.coverage_model`
  on. Idempotent.
  **Run order: 0098 → 0099 → 0100 → seed-products-demo.sql.**
- **0103_ai_reports.sql — PENDING on both DBs** (written 2026-08-24, owner
  decision same day, full catalog not a curated v1 — see
  `docs/ai-report-builder-architecture.md` v0.2): the `ai_reports` table —
  saved "talk to data" reports (question, routed object, the COMPILED query
  spec, chart type, title, interpretation). Standard tenant-isolation RLS.
  Stores only the recipe, never model output as fact: re-opening a report
  re-runs `compiled_query` against live data through the existing
  `parseListQuery`/`applyListQuery` engine and re-checks the *viewer's*
  current Business-Role permissions every time, never the creator's at save
  time. Until this runs, saving/pinning a report degrades cleanly (42P01 →
  save fails with a clear error, asking still works and just can't persist)
  behind the `ai_reports` feature flag, which no tenant has yet.
- 0104_wfm_projects.sql — **applied to both DBs** (owner confirmed
  2026-09-04; written 2026-09-03, design approved same day — see
  `WFM_PROJECT_COSTING.md`): WFM Project Costing level 1 (attribution only,
  no money). Adds `wfm_projects` + `wfm_project_sites` (both WFM-convention
  RLS: tenant SELECT only, no write policy — a table driving cost is one
  users have an incentive to forge), plus `project_id` on
  `wfm_roster_assignments` and `wfm_presence_events`. Code promoted to main
  2026-09-04. Gated by `features.wfm_projects` — a SEPARATE flag from `wfm`,
  default off, missing key false — so schema + code being live changes
  nothing for any tenant until the flag is ticked per tenant in
  /admin/tenants. **No tenant has it on yet.**
- 0105_wfm_project_links.sql — **applied to both DBs** (owner confirmed
  2026-09-04): generalises how a job collects hours. 0104 could only link a
  project to SITES; a project is now a standalone record linked to any
  combination of sites, PEOPLE and SHIFTS. Created `wfm_project_links` (three
  nullable FKs with a one-of check, so deleting a site/employee/shift cleans
  up its links automatically), copied every existing row across from
  `wfm_project_sites`, then dropped that table. Dates deliberately left off
  the link -- the project's own start/end bound which punches count, and
  every punch is stamped at punch time, so a link can never re-attribute
  history. The file is idempotent (policy dropped first, copy guarded on the
  old table still existing), so re-running it is a no-op.
- 0106_wfm_push_and_hours_alert.sql — **applied to both DBs, and the VAPID
  keys are set in Vercel** (owner confirmed 2026-09-04): web push to an
  employee's own phone, plus the long-day punch-out reminder that uses it.
  `wfm_push_subscriptions` (no RLS policies at all -- device credentials,
  same as wfm_kiosk_devices) and `wfm_hours_alerts` (one row per employee per
  shift-day; the unique index is what stops a 15-minute cron buzzing the same
  phone repeatedly). Push rather than email because employees sign in by code
  and their account carries a synthetic address at employee.bpmsquare.local,
  which can never receive mail. ~~The 15-minute trigger is a GitHub Actions
  workflow (.github/workflows/wfm-hours-alert.yml), NOT a Vercel cron -- this
  project is on Vercel Hobby...~~ **Moved back to a native Vercel cron
  2026-09-09** once the project was confirmed on Pro (see the "Vercel Hobby
  constraint" entry below) -- also fixed the same day: the alert claimed an
  employee's shift-day as "done" even when zero push actually sent (no
  subscription yet), permanently silencing anyone who hadn't opted in before
  their first long day. Still gated per tenant by
  `config.wfm.long_day_alert.enabled`, and BIM has since switched it on.
- 0107_wfm_project_level_label.sql — **applied to both DBs** (owner confirmed
  2026-09-05). One nullable
  `level_label text` column on `wfm_projects`. A project is broken into parts
  and the parts are NAMED WHERE THEY ARE CREATED — "WBS" on one project,
  "Phase" on the next — rather than by a tenant-wide list of level names
  (which existed for a few hours the same day as `config.wfm.project_levels`
  and is now gone; a workspace does not have one shape). The first part of a
  project chooses the word, later siblings inherit it, and the depth cap is
  `MAX_DEPTH` in `src/lib/wfm/projectTree.ts`, not a setting. Purely
  additive: with the migration pending, every part still works and simply
  reads as "Part".
- **Workspace currency (no migration) — 2026-09-07.** `TenantConfig.currency`
  (`src/lib/currency.ts`; INR when unset, output byte-identical to the old
  inline `₹` helpers, pinned by `currency.test.ts`) replaces 83 files' worth
  of hardcoded rupee formatting: every list, form, dashboard tile, Nova
  text, search subtitle, email variable, assistant prompt and PDF now
  formats through it. Set on the create-tenant form, in /admin/tenants/[id]
  and in Settings → General → Currency (admin, `PUT /api/settings/currency`).
  Print documents receive it as a prop (the (print) layout has no
  TenantProvider). Left as-is on purpose: nav/tab "₹" icon glyphs, the
  lakh/crore parsing shorthand (output switches to K/M for non-Indian
  currencies), date formatting. Owner decision: Big Blue is QAR-only, so the
  seed below sets `config.currency = "QAR"`.
- **scripts/seed-bigblue-sample.sql — applied on production** (owner ran
  it in the SQL editor 2026-09-07; written the same day for the Big Blue
  prospect tenant, slug `bigblue`, created in /admin/tenants/new on
  production). Not a migration. The `.mjs` twin does the same from a shell
  with the production keys. First run hit two things worth knowing: a
  `JOIN ... ON` cannot see a comma-separated FROM alias (fixed with `cross
  join`), and the tenant already held an empty `default` DRAFT Price Book
  from the morning's Catalog + Formula validation, so the seed skipped that
  area and its leftover cost input (`material.rate_per_unit = 10`) had
  shadowed the seed's 2,350 steel index -- the draft was deleted by hand,
  the rate corrected, and the seed re-run (final counts: 27 rules, 2
  published books). Lesson for the seed pattern: a "skip if any version
  exists" guard should look at PUBLISHED versions, not drafts. Seeds, tenant-scoped only: flags, category tree, Asia/Qatar,
  VAT 0, email redirect, company_info; 8 accounts, 10 contacts (no PII), 5
  suppliers, 18 products; two PUBLISHED Price Books (`default` Cost-based
  with floor 12 %/block, `steel_catalog` Catalog + Formula for REBAR and
  DOWEL_BARS, routed via `config.pricing.routing`); 6 deals; 5 Standard
  Quotes SQ-2026-0001…0005 with break offers and an alternative group.
  Idempotent; `--cleanup` removes every sample row and the routing rules
  again (owner decision: the sample data may be deleted once the client is
  confirmed). Verified 2026-09-07 on a throwaway dev tenant (engine priced
  every seeded product through both books; totals matched lineTotals.ts),
  then removed from dev entirely -- the owner wants Big Blue on production
  only. Needs 0120 for the deals (skipped cleanly if pending).
- **0126_wfm_employee_self_service_override.sql — owner reported running it 2026-10-11 (production; dev not confirmed)**
  (written 2026-10-07, KAN-29, BIM: "everyone punches at the kiosk; by
  exception an admin activates remote working for a named person"). Adds
  nullable `employees.self_service_override` (null = follow
  `config.wfm.employee_self_service`, true = may punch from phone, false =
  kiosk only), consulted before the workspace switch in
  `api/wfm/punch/route.ts` (the 403 gate), `lib/wfm/meState.ts` and the face
  enrollment guard. Permanent flag, no expiry (owner decision). Admin-only to
  set (`PATCH /api/wfm/employees/[id]`), change-logged. No RLS change -- the
  0062 admin-only write policies on `employees` already cover the new column.
  Until it runs, every path degrades to pre-KAN-29 behaviour: reads retry
  without the column (42703) and every employee reads as "inherit"; punching
  is unaffected; setting the flag returns a clear 503 naming this migration.
- **0127_wfm_employee_remote_mode.sql — owner reported running it 2026-10-11 (production; dev not confirmed). DORMANT: the Punching dropdown no longer offers Work from home / Site visit (owner, same day), so nothing sets `remote_mode`**
  (written 2026-10-11, KAN-29 part 2, BIM: "two remote options -- work from
  home and site; while allowing mobile punching the supervisor selects which").
  Adds nullable `employees.remote_mode` (`wfh` | `site` | `both`), meaningful
  only with `self_service_override = true`. A person with the override and no
  mode keeps today's behaviour (any punch). With a mode, the phone offers only
  that mode's punches plus breaks and OT, never a plain check in/out, and a
  standing Work from home mode replaces the per-day WFH request. Enforced in
  `api/wfm/punch/route.ts` through `lib/wfm/selfService.ts`; set via
  `PATCH /api/wfm/employees/[id]`, change-logged. Needs the Work from home
  and Site visit workspace switches (`config.wfm.punch_types`) on, which
  default OFF -- saving a mode whose switch is off is refused with a message.
  Until it runs, every path degrades to the 0126 behaviour: reads retry
  without the column, and the PATCH route answers 503 naming this migration.
  Run AFTER 0126. `scripts/` has no seed for it (no demo data needed).
- **Marketing platform M0 (docs/marketing-platform-architecture.md section 12) -- four migrations, ALL PENDING on dev AND production (written 2026-10-19). Run in this order: 0137, 0138, then `npx jiti scripts/backfill-contact-email-hash.ts --dry-run` and again without `--dry-run` (needs FIELD_ENCRYPTION_KEY; idempotent; `--tenant <slug>` to do one), then 0139, 0140.** Every one is additive and the app degrades cleanly (42P01/42703/PGRST204/PGRST205) while it is pending. Nothing here changes a screen for a tenant without `features.marketing_scoring` (platform-admin flag, default off).
  - **0137_domain_event.sql — PENDING** the shared event stream (`domain_event`, select-only RLS, unique `(tenant_id, dedupe_key)`). Written only by `emitEvent()` (`src/lib/events/emit.ts`) from standard-quote send/status, deals, cases, invoices (sent/paid/overdue) and campaign send; a daily cron `/api/events/cron/invoice-overdue` (vercel.json) emits `invoice.overdue`. Until it runs, `emitEvent` swallows the missing table silently.
  - **0138_contacts_email_hash.sql — PENDING** `contacts.email_hash` (blind index: HMAC of the normalised email, key derived from FIELD_ENCRYPTION_KEY, no new env var) and `contacts.do_not_contact`. Set best-effort after each contact write; existing rows by the backfill script above. Never returned by any API.
  - **0139_consent_ledger.sql — PENDING** `consent_events` (append-only), `consent_state`, `suppressions`; all select-only RLS, written by `recordConsent()`/`addSuppression()` only. `canContact()` reads them plus `accounts.marketing_opt_out`; the default is strict "consent required" per jurisdiction until an admin changes it in Settings -> Marketing -> Consent and topics. Run after 0138.
  - **0140_leads_scoring_and_stages.sql — PENDING** lead columns (`contact_id`, `owner_user_id`, `score`, `score_factors`, `scored_at`, `sla_due_at`, `last_activity_at`, `custom_data`, `custom_status_id`) and `'leads'` as a status-engine entity with eight seeded system statuses (the entity_type CHECK on the four 0070 tables is re-created). `leads.status` is untouched. Run after 0070. No demo seed in M0 (the doc schedules `seed-marketing-demo.sql` for M2).
- **Newsletter Studio N0-N1 (docs/newsletter-studio-architecture.md) -- three migrations, ALL PENDING on dev AND production (written 2026-10-20). Run in this order: 0141, 0142, 0143, then `scripts/seed-newsletter-studio-demo.sql` on the demo tenant only.** Every one is additive and the app degrades cleanly (42P01/42703/PGRST204/PGRST205) while it is pending; the studio is behind the platform-admin flag `features.newsletter_studio` (default off, needs `marketing`), so no client tenant sees anything until the owner switches it on in /admin/tenants. Independent of M0 for the tables, but a send needs the M0 consent ledger (0137-0140) to be meaningful: `canContact()` fails closed without it.
  - **0141_newsletters.sql — PENDING** `newsletters` (NWS-####, three faces: design / template / version), `newsletter_languages` (per-language words + per-block review state), `newsletter_versions` (immutable snapshot + rendered HTML per language + the link list; SELECT-ONLY for members). Tenant-isolation RLS in the same file.
  - **0142_newsletter_campaign_send.sql — PENDING** `marketing_campaigns.newsletter_version_id / languages / fallback_language / topic`; `marketing_campaign_recipients.lang / contact_id` and three new skip statuses; `marketing_link_clicks` (select-only RLS, written only by the signed click route). Requires 0141.
  - **0143_preferred_language.sql — PENDING** `contacts.preferred_language` and `accounts.preferred_language` (ISO 639-1, nullable). The contact and account forms show the field only when the column exists.
  - **scripts/seed-newsletter-studio-demo.sql: run AFTER 0141 (and 0142/0143 for the full picture) on the demo tenant (pending)** -- switches `newsletter_studio` on for `is_demo` tenants and adds the sample templates (a festival one and an Eid greeting in English and Arabic) and one sample newsletter; if the demo workspace has chosen no consent rule it lets existing customers be emailed in the Gulf jurisdictions (the product default is strict; this is demo-only and the demo's email is redirected anyway). Idempotent; never touches a client tenant. **A real workspace needs a recorded yes (or an admin's explicit choice in Settings -> Consent and topics, which needs the `marketing_scoring` flag) before a newsletter reaches anyone: until then every recipient is shown as "Skipped (no consent)".**
- **Journeys shell (docs/shells/journeys-shell.md, marketing M3) -- five migrations, ALL PENDING on dev AND production (written 2026-10-20). Run in this order: 0165, 0166, 0167, 0168, 0169, then `scripts/seed-marketing-journeys-demo.sql` on the demo tenant only.** Every one is additive and the app and the runner degrade cleanly (42P01/42703/PGRST204/PGRST205) while they are pending. The whole feature is behind the platform-admin flag `features.journeys` (default off, needs `marketing`; a Send step also needs `newsletter_studio`), so no client tenant sees a menu item, a route or any runner work until the owner switches it on in /admin/tenants. The runner is a new `*/5` cron, `/api/marketing/cron/journeys` (vercel.json; CRON_SECRET; the proxy lets `/api/marketing/cron/` through). It needs 0137 (domain_event) and, for a send, 0139 (consent) and 0141/0142 (newsletter versions and the campaign columns).
  - **0165_journeys.sql — PENDING** `journeys` (JNY-####, status, JSON definition, trigger, entry start). SELECT-ONLY RLS: the server writes.
  - **0166_journey_runs.sql — PENDING** `journey_runs` (unique on journey and subject = enrolled at most once) and `journey_run_steps` (unique on run, step, attempt = a retried tick cannot repeat a step). SELECT-ONLY RLS. Requires 0165.
  - **0167_journey_runner.sql — PENDING** `journey_cursors` (per-workspace keyset on domain_event) and `journey_runner_lock`; RLS on with NO policy (runner only). Requires 0137.
  - **0168_journey_tasks.sql — PENDING** `journey_tasks` (the owner task step; the product had no task object). SELECT-ONLY RLS; marked done through `/api/journeys/tasks/[id]`. Requires 0165, 0166.
  - **0169_journey_campaign_link.sql — PENDING** `marketing_campaigns.journey_id / journey_step_id`: the quiet campaign each send step keeps so it can use the one newsletter send path; the Campaigns list hides them. Requires 0165 and 0142.
  - **scripts/seed-marketing-journeys-demo.sql: run AFTER 0165 (and the Newsletter Studio demo seed plus a kept version) on the demo tenant (pending)** -- flips `journeys` on for `is_demo` tenants and adds one DRAFT "Quote follow-up (sample)" journey. Turns nothing on and writes no runs. Idempotent; never touches a client tenant.
- **WhatsApp marketing shell (docs/shells/whatsapp-shell.md, marketing M6) -- four migrations, ALL PENDING on dev AND production (written 2026-10-20). Run in this order: 0185, 0186, 0187, 0188, then `scripts/seed-marketing-whatsapp-demo.sql` on the demo tenant only.** Additive; the app degrades cleanly (42P01/42703/PGRST204/PGRST205) while they are pending. Behind the platform-admin flag `features.whatsapp_marketing` (default off, needs `marketing`), so no client tenant sees a menu item, a route, a journey step or the webhook until the owner switches it on in /admin/tenants. Needs 0137 (events) and 0139 (consent) first. No provider is chosen: the default is a sandbox that logs and calls nothing outside. The inbound webhook is `/api/inbound/whatsapp/<key>` on the workspace's own domain (signature-verified; the key and secret are shown on Marketing, WhatsApp, Number and messages).
  - **0185_whatsapp_templates.sql — PENDING** `whatsapp_templates` (WAT-####: body with variables, language, category, approval status set by a person in the shell, consent topic). SELECT-ONLY RLS: the approval flag decides what may be sent, so the server writes.
  - **0186_whatsapp_identities.sql — PENDING** `whatsapp_identities` (one per workspace: provider, business number and credentials encrypted, the random webhook key). RLS on with NO policy: only the service-role client reads or writes it.
  - **0187_whatsapp_messages.sql — PENDING** `whatsapp_messages` (every message in or out; body and number encrypted; unique client_ref makes a send idempotent, unique provider id makes a replay a no-op; drives the 24-hour window and the weekly cap). SELECT-ONLY RLS. No foreign key to journeys.
  - **0188_whatsapp_numbers.sql — PENDING** `whatsapp_numbers` (keyed hash of a contact's phone, so an inbound reply can be matched to a person; never shown or exported). RLS on with NO policy.
  - **scripts/seed-marketing-whatsapp-demo.sql: run AFTER 0185 and 0187 (0139 for the opt-ins) on the demo tenant (pending)** -- turns `whatsapp_marketing` and `marketing` on for `is_demo` tenants, adds three SAMPLE templates (two approved, one draft), records a sample WhatsApp opt-in for up to three contacts that have a phone, and a short sample message log. Idempotent; never touches a client tenant. The number itself is one click on the setup page (it is encrypted by the app).
- **Attribution shell, "Revenue by campaign" (docs/shells/attribution-shell.md, marketing M7) -- three migrations, ALL PENDING on dev AND production (written 2026-10-20). Run in this order: 0190, 0191, 0192, then `scripts/seed-marketing-attribution-demo.sql` on the demo tenant only.** Additive; the app and the cron degrade cleanly (42P01/42703/PGRST204/PGRST205) while they are pending. Behind the platform-admin flag `features.marketing_attribution` (default off, needs `marketing`; reads Pipeline deals), so no client tenant sees a menu item, a route or any cron work until the owner switches it on in /admin/tenants. Needs 0137 (events). New 3-hourly cron `/api/marketing/cron/attribution` in vercel.json (CRON_SECRET; the proxy already lets `/api/marketing/cron/` through). It only READS deals, quotes and invoices.
  - **0190_marketing_touches.sql — PENDING** `marketing_touches` (a read model of the event stream: campaign, newsletter, form, journey, WhatsApp template or event touched a company; unique per source event and kind). SELECT-ONLY RLS.
  - **0191_attribution_state.sql — PENDING** `attribution_state` (per-workspace event bookmark, lock, last run). RLS on with NO policy (cron and Refresh only).
  - **0192_attribution_results.sql — PENDING** `attribution_results` (per asset, per model first/last/linear, per mode engaged/all: deals started, open and won value, paid, deals touched). SELECT-ONLY RLS; replaced in place on each run.
  - **scripts/seed-marketing-attribution-demo.sql: run AFTER 0190-0192 (0137 and 0120 for events and deals) on the demo tenant (pending)** -- turns `marketing_attribution`, `marketing` and `pipeline` on for `is_demo` tenants, adds two SAMPLE campaigns, SAMPLE click and form events for the first six accounts and five SAMPLE deals titled "(attribution sample)". Writes no touches or results: press Refresh figures on the page. Idempotent; never touches a client tenant.
- **Marketing events shell (docs/shells/events-shell.md, marketing M8) -- two migrations, BOTH PENDING on dev AND production (written 2026-10-20). Run in this order: 0195, 0196, then `scripts/seed-marketing-events-demo.sql` on the demo tenant only.** Additive; the app degrades cleanly (42P01/42703/PGRST204/PGRST205) while they are pending, including the hook in the Forms submit. Behind the platform-admin flag `features.marketing_events` (default off, needs `marketing` AND `marketing_forms`; the follow-up also needs `journeys`), so no client tenant sees a menu item, a route or a form hook until the owner switches it on in /admin/tenants.
  - **0195_marketing_events.sql — PENDING** `marketing_events` (EVT-####: kind, date, venue or link, capacity, status, the registration form and follow-up journey as plain ids re-checked by the app). Standard tenant-isolation RLS.
  - **0196_event_registrations.sql — PENDING** `event_registrations` (one per person per event; registered, attended, no_show, cancelled; check-in time and who; follow-up stamp). SELECT-ONLY RLS: attendance is a trust claim. Requires 0195.
  - **scripts/seed-marketing-events-demo.sql: run AFTER 0195-0196 on the demo tenant (pending)** -- turns `marketing_events`, `marketing_forms` and `marketing` on for `is_demo` tenants, adds a past SAMPLE exhibition with 8 registrations (5 came, 2 did not, 1 cancelled) and an upcoming SAMPLE site visit with 3. Writes no events and starts no journey. Idempotent; never touches a client tenant.
- **Email health + staff-recorded consent (written 2026-10-20) -- two migrations, BOTH PENDING on dev AND production. Run in this order: 0144, 0145. They need 0137-0143 first.** Both are additive and the app degrades cleanly (42P01/42703/PGRST204/PGRST205): the contact's Email health card and the Consent card say "waiting for a database update", the delivery webhook still records the event stream, and the Consents import reports rows as "waiting for a database update". Email health is behind `newsletter_studio` (needs `marketing`); the Consent card and the Consents import/export are behind `marketing_scoring` (needs `marketing`). Both flags are platform-admin only and default off, so no client tenant sees anything until the owner switches them on. **Needs one new env var on the server: `RESEND_WEBHOOK_SECRET` (see below); without it `/api/webhooks/resend` answers 503 and nothing is recorded.**
  - **0144_email_health.sql — PENDING** `contacts.email_status` (unknown | valid | soft_bounce | bounced | complained | invalid, default unknown) / `email_status_at` / `email_status_reason` (a short plain sentence, never a provider payload); `marketing_campaign_recipients.resend_id / delivery_status / delivery_at` (the recipient `status` is untouched, so "sent" counts do not change). Partial index for the "Email needs attention" list. No RLS change: the columns inherit the existing contacts / recipients policies. The columns are never part of the REST API, MCP, exports or imports (`emailStatusNeverLeaves.test.ts`).
  - **0145_email_provider_events.sql — PENDING** `email_provider_events` (tenant_id, provider_event_id unique): which Resend webhook deliveries are already processed, so a retried delivery changes nothing. SELECT-ONLY RLS for members; written only by `/api/webhooks/resend` on the service-role client.
  - **0146_contacts_created_at.sql — PENDING** `contacts.created_at` added where missing (production already has it untracked; dev lacks it). Guarded no-op on production. Needed by the leads demo seed and the marketing code that picks an account's oldest contact. Run BEFORE the seeds bundle.
  - **Resend webhook (one-time setup, by the owner):** Resend dashboard -> Webhooks -> Add endpoint -> URL `https://<the app host>/api/webhooks/resend` -> tick `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed` -> copy the endpoint's Signing Secret (`whsec_...`) into the server environment as `RESEND_WEBHOOK_SECRET` (Vercel -> Settings -> Environment Variables, then redeploy). Only newsletter sends carry the tag that ties an event to a workspace; other mail (quotes, invoices, plain campaigns) is acknowledged and ignored.
  - No seed script: nothing here needs sample data (the existing newsletter demo seed plus a real send on the demo workspace produces the events; the demo's redirect inbox never marks a real contact).
- **Marketing platform M2 shell, "Leads that score themselves" (docs/shells/leads-shell.md) -- three migrations, ALL PENDING on dev AND production (written 2026-10-20). Run AFTER 0137 and 0140, in this order: 0160, 0161, 0162, then `scripts/seed-marketing-leads-demo.sql` on the demo tenant only.** Each is additive and the app degrades cleanly (42P01/42703/PGRST204/PGRST205) while it is pending. Everything is behind the platform-admin flag `features.marketing_scoring` (already live in M0, default off, needs `marketing` and `leads`); nothing changes for a workspace without it. New cron: `/api/events/cron/score-leads` every 15 minutes (needs `CRON_SECRET`, already set for the other crons).
  - **0160_leads_assignment_and_sla.sql — PENDING** `leads.ready_at`, `leads.assigned_at`, `leads.assignment_reason` (team_lead / round_robin / fallback_admin / unassigned / manual / claimed) and an index on `sla_due_at`. Requires 0140.
  - **0161_teams_assignment_mode.sql — PENDING** `teams.assignment_mode` (`lead` default, or `round_robin`) and `teams.last_assigned_user_id`. Every existing team stays `lead`; `teams` keeps its select-only RLS (written by the admin-only Coverage route and by the server when it assigns a lead).
  - **0162_marketing_scoring_state.sql — PENDING** `marketing_scoring_state` (one row per workspace: how far into `domain_event` the scoring run has read, and when it last visited). RLS enabled with NO policy: service role only. The run still works without it (it looks back an hour each time).
  - **scripts/seed-marketing-leads-demo.sql: run AFTER 0140, 0160 and 0161 on the demo tenant (pending)** -- switches `marketing_scoring` (and `marketing`, `leads`) on for `is_demo` tenants, creates the eight lead stages, adds six sample leads on the first accounts with the events behind their scores (one just ready, one overdue, one engaged, one new, one being worked, one that unsubscribed), and sets the oldest Coverage team to round robin. Idempotent; never touches a client tenant.
- **Buying signals shell (docs/signals-architecture.md, docs/shells/signals-shell.md) -- four migrations, ALL PENDING on dev AND production (written 2026-10-20). Run in this order: 0175, 0176, 0177, 0178 (0179 is deliberately unused), then `scripts/seed-marketing-signals-demo.sql` on the demo tenant only.** All additive; the app degrades cleanly (42P01/42703/PGRST204/PGRST205) while pending. Behind the platform-admin flag `features.buying_signals` (default off, needs `marketing`): with it off there is no menu item, no route and no cron work for the tenant. Every table is SELECT-ONLY for members; only server routes and the cron write.
  - **0175_signal_topics.sql — PENDING** `signal_topics` (tenant-defined subjects a newsletter link can carry; a topic-tagged click scores 6 instead of 3).
  - **0176_account_intent.sql — PENDING** `account_intent`: the one stored row per account (score, stage, factors, top signals, stage_changed_at, not-in-market mark). Every surface reads this row.
  - **0177_account_intent_history.sql — PENDING** `account_intent_history`: one row per account per day with the score, stage and factors; feeds "Did it work?". Run after 0176.
  - **0178_signal_runs.sql — PENDING** `signal_runs`: one row per tenant recompute (rotation, status line, budget).
  - **scripts/seed-marketing-signals-demo.sql: run AFTER 0175-0178 on the demo tenant (pending)** -- switches `buying_signals` on for `is_demo` tenants and adds clearly labelled sample accounts with quotes, a case, a contract and clicks. Idempotent; never touches a client tenant. Then call `/api/signals/cron/rescore` once (or wait for the cron) to fill the list.
- **Forms and the Preference Centre, shell (docs/shells/forms-shell.md) -- three migrations, ALL PENDING on dev AND production (written 2026-10-20). Run in this order: 0170, 0171, 0172, then `scripts/seed-marketing-forms-demo.sql` on the demo tenant only.** Every one is additive and the app degrades cleanly (42P01/42703/PGRST204/PGRST205) while it is pending; Forms are behind the platform-admin flag `features.marketing_forms` (default off, needs `marketing`), so no client tenant sees anything until the owner switches it on in /admin/tenants; with the flag off the public pages and the submit route answer 404. A submit records consent through the M0 ledger, so **0137-0140 (consent ledger, blind index) must be applied first**: without them a form that asks for consent answers "try again later" rather than keeping a half-made record.
  - **0170_forms.sql -- PENDING** `forms` (FRM-####): name, slug (`/f/<slug>` on the tenant's own domain), `public_key` (the credential of the public submit route; the tenant is read from this row, never from a request), fields, consent block, after-submit action. Standard tenant-isolation RLS.
  - **0171_form_submissions.sql -- PENDING** `form_submissions`: the raw answers (personal values encrypted like contacts), kept 180 days (`expires_at`), SELECT-ONLY for members; written by the public route only. Requires 0170.
  - **0172_leads_form_source.sql -- PENDING** `leads.source_form_id` and `'form'` added to the `leads_source_check`. Until it runs, a form submit files the lead as source `direct` with no form link. Requires 0170.
  - **scripts/seed-marketing-forms-demo.sql: run AFTER 0170 (and 0171 for the sample answers) on the demo tenant (pending)** -- switches `marketing_forms` on for `is_demo` tenants and adds two live forms ("Website contact form" at /f/contact-us, "Newsletter sign-up" at /f/newsletter) with three sample answers. Idempotent; never touches a client tenant.
- **Forms thank-you email + double opt-in, and the Leads hand-over (docs/shells/forms-shell.md, docs/shells/leads-shell.md; written 2026-10-21) -- two migrations, BOTH PENDING on dev AND production. Run in this order: 0197, 0198, then `scripts/seed-marketing-handover-demo.sql` on the demo tenant only.** Both are additive and the app degrades cleanly while they are pending (a form that asks for confirmation then records no consent and says so in the log; auto-creating leads does nothing; a lead handed to the rota is filed without the reason). Needs 0139 (consent) and 0140/0160 (leads) first. No new flag: the form settings sit in the form's own JSON, the hand-over settings in `config.marketing.lifecycle`, and the screen is behind `marketing_scoring` like the other Marketing settings.
  - **0197_consent_pending.sql -- PENDING** widens `consent_events.status` to allow `'pending'` (a tick not yet confirmed by email) and adds a partial index for it. `consent_state` keeps its two values on purpose, so `canContact()` can never read a pending answer as a yes. The signed 7-day link in the thank-you email appends the `granted` row.
  - **0198_leads_handover.sql -- PENDING** `leads.source` gains `'inbound'` (a lead the scoring run made by itself; `'form'` is kept in the list so it is safe with or without 0172), `leads.assignment_reason` gains `'fallback_list'`, and a unique index allows at most one open auto-made lead per person.
  - **scripts/seed-marketing-handover-demo.sql: run AFTER 0198 and `seed-marketing-leads-demo.sql` on the demo tenant (pending)** -- turns "make a lead when someone becomes Engaged" and "tell the owner when a lead is overdue" on for `is_demo` tenants (other hand-over settings kept). Idempotent; never touches a client tenant; sends nothing.
- **Security audit 2026-10-21 (docs/security-audit-2026-10-21.md) -- two migrations, BOTH PENDING on dev AND production. Run 0199, then 0200; neither needs a seed.** Both are policy/privilege changes only (no new table), independent of 0197/0198.
  - **0199_rls_credential_tables.sql -- PENDING** drops the member-writable `for all` policies on `api_keys` and `webhooks` (service role only) and makes `tenant_connectors` admin-write / member-read.
  - **0200_tenants_hide_api_key.sql -- PENDING** withdraws table-level SELECT on `tenants` from `anon`/`authenticated` and re-grants every column except `api_key`. After it, any new `tenants` column needs its own `grant select (...)`. Regenerate the legacy tenant API key afterwards for any workspace that had one.
- **Integration middleware (docs/design/integration-middleware.md; written 2026-10-21) -- one migration, PENDING on dev AND production. Run `scripts/run-bundle-10-middleware-2026-10-21.sql` (= 0201, then the demo switch).** Additive; behind the platform-admin flag `integration_middleware` (default off). The app degrades cleanly while it is pending: `/api/middleware/*` answers `{ needsDatabaseUpdate: true, bundle }`, the engine sends nothing and the monitor still reads the older sources.
  - **0201_integration_middleware.sql -- PENDING** `integration_messages` (tenant_id, direction, channel, connector_id, entity, object_type/object_id, ref_label, status ok|failed|pending|skipped|redirected, http_status, error, duration_ms, correlation_id, summary, payload, created_at). RLS enabled and NO policy at all (service role only: the app reads it through `createAdminSupabase()` with a tenant filter, and `src/lib/rlsPolicies.test.ts` fails the build if a policy is added). Indexes (tenant_id, created_at desc), (tenant_id, status, created_at desc), (tenant_id, object_type, object_id). The same file also adds the unique partial index `connector_links_quote_claim_idx` on `connector_links (tenant_id, connector_id, entity, object_id) where direction = 'push' and entity = 'standard_quotes'`, which makes sending one quote to the ERP twice impossible; it is created only if `connector_links` exists, so run bundle 9 (connectors) BEFORE this bundle, or run this bundle again after it.
  - **scripts/seed-middleware-demo.sql: run AFTER 0201 on the demo tenant (pending)** -- switches `integration_middleware` on for `is_demo` tenants only. Idempotent; sends nothing.
  - The ERP connection needs `scripts/run-bundle-9-connectors-2026-10-21.sql` (0049, 0129, 0136 + the tenant_connectors block of 0199) if that database never had the connector tables; the page's schema health names whichever bundle is missing.
- **Webhooks library (docs/design/webhooks-library.md; written 2026-10-21) -- one migration, PENDING on dev AND production. Run `scripts/run-bundle-11-webhooks-2026-10-21.sql` (= 0202, then the demo switch and two sample webhooks), AFTER bundle 10.** Additive; behind the platform-admin flag `webhooks_library` (default off). While pending, `/api/settings/webhooks-library` answers `{ needsDatabaseUpdate: true, bundle }`, the sender records nothing and the cron keeps draining every row as an event.
  - **0202_webhooks_library.sql -- PENDING** extends `webhooks` (kind event|call, object_type, method, headers (sealed values), payload_mode, template, allow_personal_data, timeout_ms, paused_reason, legacy_key, updated_at) and adds `coverages.webhook_id` and `integration_messages.webhook_id`. `webhooks` stays service-role only (NO policy; `rlsPolicies.test.ts` asserts it and that 0202 adds none). It also imports each tenant's `config.integration_push` URL and Coverage endpoints as Call webhooks (idempotent through `legacy_key`; secrets copied as stored; a migrated http:// URL is kept but will not fire until edited to https) and points `config.webhooks_library.record_buttons.accounts` at the imported default. Nothing is added to `tenants`, so no column grant.
  - **scripts/seed-webhooks-demo.sql: run AFTER 0202 on the demo tenant (pending)** -- switches `webhooks_library` on for `is_demo` tenants only and adds two sample webhooks (never contacted: a demo workspace records "redirected"). Idempotent.
- **Mapping engine (docs/design/mapping-engine.md; WP-A backend built 2026-10-22) -- one migration, PENDING on dev AND production. Run `scripts/run-bundle-12-mapping-2026-10-21.sql` (= 0203, then the demo Unit and Currency lists), AFTER bundles 10 and 11.** Additive; no new flag (`integration_middleware`; the AI item also needs `ai_assistant`). While pending, every `/api/middleware/mapping*` and `/value-lists*` answer carries `{ needsDatabaseUpdate: true, bundle }` and dispatch, pull and the webhook sender behave exactly as before.
  - **0203_mapping_engine.sql -- PENDING** creates `integration_mappings` (one MappingDocument per connection and document; status active | previous (last 10) | draft (a fetched field list not yet saved)) and `integration_value_lists` (one list per kind per connection). BOTH are service-role only: RLS on, NO policy (`rlsPolicies.test.ts` asserts it). Adds `webhooks.mapping_id`, `webhooks.response_key_path` and the payload mode `mapping` (only when 0202 has run; run 0203 again if 0202 lands later). Nothing is added to `tenants`.
  - **scripts/seed-mapping-demo.sql: run AFTER 0203 on the demo tenant (pending)** -- sample Unit (with `Box` deliberately empty) and Currency lists for `is_demo` tenants only. Idempotent.
- **Assistant web research, WP4 (docs/design/assistant-smarter.md section 2; built 2026-10-22) -- one migration, PENDING on dev AND production. Run `scripts/run-bundle-14-assistant-actions-2026-10-22.sql` (= 0205, then the demo switch).** Independent of the other bundles. New platform-admin flag `ai_assistant_web` (default off, needs `ai_assistant`); workspace policy `config.ai_assistant.block_external_calls` keeps it off.
  - **0205_assistant_actions.sql -- PENDING** creates `assistant_actions` (the assistant's audit trail: kind web_search today, create/update later; query, source addresses, tokens, who, when; never a field value) -- service-role writes only, members read their own rows, workspace admins read the workspace's -- and adds `change_log.via` (null for the ordinary UI, 'assistant' for a confirm card; used by WP5). While pending the web search still works behind the flag and writes no audit row.
  - **scripts/seed-assistant-web-demo.sql: run AFTER 0205 on the demo tenant (pending)** -- switches `ai_assistant_web` on for `is_demo` tenants that already have `ai_assistant`. Idempotent.
- **Assistant daily briefing (docs/design/assistant-smarter.md section 4, WP7 built 2026-10-22; no AI wording yet) -- one OPTIONAL migration, PENDING on dev AND production. Run `scripts/run-bundle-13-assistant-2026-10-22.sql` (= 0204).** Flag `ai_assistant`; the tile is the Adapt widget `my_briefing`, in no default layout (a platform admin adds it to the demo workspace first). While 0204 is pending the briefing is worked out on every open and not stored (`stored: false`); nothing else changes. The rest of the design doc's "0204" (`assistant_actions`, `change_log.via`) is WP4's and must take the next free number, not 0204.
  - **0204_assistant_briefings.sql -- PENDING** creates `assistant_briefings` (one row per workspace, person and day). RLS: a person reads their own row; NO write policy, the server writes with the service role. No demo seed (the tile reads each user's own records).
- **Security audit 2026-10-22 (docs/security-audit-2026-10-22.md, M2) -- one migration, PENDING on dev AND production. Run `scripts/run-bundle-16-security-2026-10-22.sql` (= 0207); no seed.** Policy change only: `business_roles`, `business_role_grants`, `business_user_roles` lose their member-writable `for all` policy; members keep SELECT, only a workspace admin may write. The role routes already write with the service role after their admin check, so the app behaves the same before and after. (0205 assistant actions and 0206 company analysis are other builders' numbers.)
  - **0207_business_roles_rls.sql -- PENDING.** Guarded by `to_regclass`, idempotent. `src/lib/rlsPolicies.test.ts` fails the build if a member write policy comes back or a route writes these tables with the session client.
- **Security audit 2026-10-22, AI slice (docs/security-audit-2026-10-22-ai.md, M1) -- one migration, PENDING on dev AND production. Run `scripts/run-bundle-17-changelog-2026-10-22.sql` (= 0208); no seed.** Policy change only: `change_log` loses its member INSERT policy (members keep SELECT). `logChange`/`logChangeBatch` now write with the service role, so the app logs changes the same way before and after.
  - **0208_change_log_member_insert.sql -- PENDING.** Guarded by `to_regclass`, idempotent. `src/lib/rlsPolicies.test.ts` fails the build if a member write policy returns or any file other than `changeLog.ts` inserts into `change_log`. (0206 company analysis is another builder's number.)
- **Account-Based Marketing shell A1 (docs/abm-architecture.md, docs/shells/abm-shell.md) -- four migrations, ALL PENDING on dev AND production (written 2026-10-20). Run in this order: 0180, 0181, 0182, 0183, then `scripts/seed-abm-demo.sql` on the demo tenant only.** (The design doc called its migration 0137; that number is the domain event table.) Additive; the app degrades cleanly (42P01/42703/PGRST204/PGRST205) while pending. Behind the platform-admin flag `features.abm` (default off, needs `marketing`), so no client tenant sees anything until switched on in /admin/tenants.
  - **0180_abm_programs.sql — PENDING** `abm_programs` (ABM-####), standard tenant-isolation RLS in the same file.
  - **0181_abm_target_accounts.sql — PENDING** `abm_target_accounts` (a company in one program: tier, progress with source/reason/who, owner, next step, linked deal; unique per tenant+program+account; a Dropped row must carry a reason). Requires 0180.
  - **0182_abm_buying_group_members.sql — PENDING** `abm_buying_group_members` (a person's role in one target, per program; private `notes` never leave the app). Requires 0181.
  - **0183_abm_custom_field_types.sql — PENDING** widens the `object_type` CHECK (NOT VALID) on `custom_fields`, `field_overrides` and `field_rules` to the three ABM objects (and process_study / newsletter, a superset of 0131).
  - **scripts/seed-abm-demo.sql: run AFTER 0183 (and 0137 for the activity behind progress) on the demo tenant (pending)** -- creates 12 clearly labelled SAMPLE Saudi developer/contractor accounts with invented people, two programs, a funnel of 12 > 11 > 7 > 4 > 3 > 1, two buying-group gaps and three sample deals; turns `abm` and `marketing` on for `is_demo` tenants. Idempotent; never touches a client tenant.
- **0152_process_studio.sql — PENDING on both DBs** (written 2026-10-19, Process Design Studio phase 1,
  docs/process-design-studio-architecture.md). `process_studies` (STU-####) plus messages, steps, fit,
  changes, tasks, comments, versions and requests. Every table is SELECT-ONLY for members (no write policy:
  a study carries trust claims -- the reviewed tick, request status, ratings -- so all writes go through
  routes with the service-role client), and `process_studio_can_see()` makes a study private to its creator on
  an `is_demo` workspace (admins of a client workspace see all). Until it runs, the studio list/pages show
  "waiting for a database update" and the flag stays off by default. Independent of 0150/0151.
- **0151_platform_settings.sql — PENDING on both DBs** (written 2026-10-19). Key/value table for
  PLATFORM settings (first use: the address "Talk to us" requests are emailed to, set in /admin/studies; or the
  `PROCESS_STUDIO_NOTIFY_EMAIL` env var). RLS enabled with NO policy: only server code with the service-role
  client reaches it. The one table without `tenant_id`, deliberately. Until it runs, the env var is the only source.
- **0150_ai_usage_log.sql — PENDING on both DBs** (written 2026-10-19). The shared AI meter: one row per
  model call, read by the per-tenant monthly token cap (`src/lib/ai/structured.ts`, default 1,500,000 tokens;
  override on the tenant page in /admin). Members may read their tenant's rows; no write policy (service role only).
  Until it runs the cap is simply not enforced (a missing table reads as zero usage) and AI keeps working.
- **scripts/seed-process-studio-demo.sql: run AFTER 0152 on the demo tenant (pending)** -- switches the
  `process_studio` flag on for `is_demo` tenants and adds the two labelled samples (Al-Khaleej Precast, Hosapete
  Motor Works) owned by the demo workspace's oldest admin. Idempotent; never touches a client tenant.
- **0133_item_types_and_bom.sql — APPLIED on dev AND production (owner, 2026-10-19)** (written 2026-10-19, item types + bill of materials). Adds nullable `products.item_type` (no check constraint: the type list is tenant config) and the `product_bom_lines` table (parent product, component product, qty, uom, scrap %, consumed/used, multi-level, tenant-isolation RLS, component `on delete restrict`). The app screens for it are NOT built yet (decisions pending); the schema is additive and safe to run any time. Run after 0132 (independent otherwise).
- **0132_product_supplier.sql — APPLIED on dev AND production (owner, 2026-10-19)** (written 2026-10-19, preferred supplier on products). Adds nullable `products.supplier_id` (references `suppliers`, `on delete set null`) and an index. Code degrades on 42703 while pending (the Supplier field is hidden/ignored, RFQ "current supplier" falls back to RFQ award and purchase-order history). No demo seed needed. Run any time.
- **0131_estimator.sql — APPLIED on dev AND production (owner, 2026-10-17)** (written 2026-10-17, Project Estimator,
  `docs/estimator-architecture.md`). Creates `estimate_templates`, `estimates`
  and `estimate_lines` (tenant_id + standard "for all" tenant-isolation RLS in the
  same file, EST-#### refs, custom_data) and widens the `custom_fields.object_type`
  check (NOT VALID) to include `estimate`. Also `estimate_templates.geometry` and `estimates.model` (appended, re-runnable; the owner applied the version containing them). Independent of 0128-0130 (any order). No
  demo seed in this entry; see the next one. Until it runs the Estimator module (flag `estimator`, default off) shows
  "waiting for the database update" and nothing else is affected.
- **scripts/seed-estimator-demo.sql: run AFTER 0131 on the demo tenant (pending)**
  (written 2026-10-18, estimator phase E3; generated by
  `scripts/gen-estimator-demo-seed.ts` from the real engine, so its numbers are
  the engine's). Idempotent, demo tenants only (`is_demo = true`): sets
  `features.estimator = true`, adds the template "Precast villa (illustrative)"
  if absent and ONE sample estimate "Sample villa, Riyadh (illustrative)" with
  its computed lines, totals and 3D piece model. Not run by anything automatic;
  the owner runs it by hand. Regenerate with `npx jiti scripts/gen-estimator-demo-seed.ts`
  after any change to the starter or the engine.
  **RE-RUN AFTER E5 (2026-10-18, simplified flow v2):** the starter's group names
  and option labels changed to plain words and the finish option is now offered as
  a quote alternative, so re-running the file refreshes the demo template (inputs,
  rates, rules) AND the demo sample estimate "Sample villa, Riyadh (illustrative)"
  (its lines, totals and model are replaced so the group names match; demo tenants
  only, that one estimate only, nothing else is deleted, and a sample estimate that
  already has a quote is left alone). Safe to run again; no migration involved.
  **RE-RUN AFTER PRODUCTS AND KITS AS ESTIMATE ITEMS (2026-10-19):** the demo template
  now prices from catalogue products and BOM kits (named by SKU) instead of blank rate
  lines, so re-running it refreshes the template and the sample estimate to that, and
  `scripts/seed-estimator-products-demo.sql` must run AFTER it (next entry).
- **scripts/seed-estimator-products-demo.sql: run AFTER 0133 and AFTER seed-estimator-demo.sql on the
  demo tenant (pending)** (written 2026-10-19; generated by
  `scripts/gen-estimator-products-demo-seed.ts` from `src/lib/estimator/demoProducts.ts`,
  the same file the template generator reads). Idempotent, demo tenants only: turns the
  Products module on, adds 21 illustrative Saudi precast products in SAR (slab, wall
  panels, column, beam, stair, parapet, grout, sealant, connection plates, transport and
  crane/erection services, a mould set, kit materials) and three BOM kits with their
  components, writes each kit's rolled-up cost into `cost_price`, and links the sample
  estimate's lines to them. Needs 0133 (item types, `product_bom_lines`). Not run by anything
  automatic; the owner runs it by hand. No migration.
- **0130_rfq_purchase_orders.sql — PENDING on both DBs** (written
  2026-10-15, RFQ awards -> purchase orders). Adds nullable `rfq_id` and
  `standard_quote_id` to `purchase_orders`, `product_id` and
  `rfq_response_id` to `purchase_order_lines` (all `on delete set null`).
  Run AFTER 0128. Until it runs the RFQ page says the update is needed and
  "Create purchase orders" refuses (503) rather than risk ordering a line
  twice. Needs the `purchasing` flag on the tenant to show at all.
- **0129_connector_sync.sql — applied to the dev DB (owner reported 2026-10-15); PENDING on production** (written 2026-10-15,
  Dynamics 365 connector, `docs/d365-connector.md`). Creates
  `connector_links` (BPMSquare record <-> external id, unique per tenant +
  connector + entity + external id) and `connector_sync_runs` (run history,
  counts, incremental watermark); select-only RLS, writes via service-role
  sync code. No seed. Until it runs, the Dynamics 365 screen can save and
  test a connection but every Sync fails with a clear error and the run
  history reads empty. Independent of 0128 (any order). Environment: none
  new for client-secret/certificate/basic logins; "sign in as a user" needs
  `CONNECTOR_OAUTH_STATE_SECRET`. New cron `/api/connectors/cron/dynamics365`
  (hourly, only acts for tenants whose connector schedule is on).
- **0128_rfq.sql — applied to the dev DB (owner reported 2026-10-15, with scripts/seed-rfq-demo.sql); PENDING on production** (written 2026-10-15, owner request
  2026-10-14: "RFQ becomes a standard object scopable with a flag ... the whole
  email communication sending and receiving in the tenant itself"; spec
  `docs/rfq-architecture.md`). Creates `rfqs`, `rfq_lines`, `rfq_suppliers`,
  `rfq_responses`, `rfq_messages` (select-only RLS, writes via service-role
  routes) and `rfq_mailbox_state` (no policy, service-role only); adds
  `rfq_line_id` to `standard_quote_lines`, `opportunity_lines`, `quote_lines`;
  backfills every `pricing_rfqs` row into the new tables keeping its ref;
  widens the `custom_fields.object_type` check (NOT VALID) to the objects the
  app offers custom fields on, plus `rfq`. Run AFTER 0125 (so RFQ email sends
  are logged). Then `scripts/seed-rfq-demo.sql` (demo tenant only: two sample
  RFQs, flips `features.rfq` on). Until it runs: the RFQ module shows "waiting
  for the database update", quote saves strip `rfq_line_id` (tolerant insert),
  and the Needs-RFQ button falls back to the legacy `pricing_rfqs` record.
  Environment for the mail channels: `RFQ_LINK_SECRET` (reply links; falls
  back to `QUOTE_PUBLIC_LINK_SECRET`); platform receiving needs
  `INBOUND_EMAIL_DOMAIN` + `RESEND_INBOUND_WEBHOOK_SECRET` (Resend receiving
  webhook -> `/api/inbound/email/resend`), or `INBOUND_EMAIL_SECRET` for the
  generic signed JSON relay; mailbox mode needs the Gmail or Mail server
  connector. Two new crons in `vercel.json` (`/api/rfqs/cron/mailbox` every
  5 min, `/api/rfqs/cron/reminders` daily).
- **0125_email_log_invoice_rfq_kinds.sql — PENDING on both DBs** (written
  2026-09-21, from the owner's question "recheck if outbound emails are
  logged"). They are -- for four of the six kinds. `email_log.kind` carries a
  CHECK constraint that 0091 left at `('quote','campaign','wfm','auth')`,
  while `EmailLogKind` in TypeScript has since grown `invoice` and `rfq`.
  Because `logEmail()` deliberately never throws (a logging failure must not
  fail a send that may already have gone out), every invoice and supplier-RFQ
  email since those senders shipped has had its log row rejected and the
  rejection swallowed. The SENDS were always fine; only the record is
  missing, and it cannot be backfilled. This widens the constraint to the
  application's own list. Until it runs, invoice/RFQ emails keep sending and
  keep not appearing in Administration → Outbound Emails -- no crash, no
  degradation beyond the missing rows. Shipped alongside the Outbound Emails
  screen's own filter, which was missing the same two entries.
- **0124_wfm_site_approvers_and_employee_alerts.sql — APPLIED to production**
  (written and applied 2026-09-10, BIM client list of the same day. Verified
  after the run: both tables present, RLS on, one policy each, 4 indexes on
  `wfm_site_approvers` and 3 on `wfm_employee_alerts` -- primary key, the
  unique constraint, and the lookup indexes, matching the DDL. Dev DB state
  unverified.) Two tables, each
  with RLS + a tenant-isolation policy in the same file, WFM's select-only
  convention: `wfm_site_approvers` (extra approvers per site, additive to
  `wfm_sites.supervisor_id` -- one named supervisor going on leave used to
  freeze every comp-off/sick-leave/WFH request at their site) and
  `wfm_employee_alerts` (claim rows for the two new push alerts: break
  overrun and the weekly holiday digest). The alert claims are a NEW table
  rather than a `kind` column on `wfm_hours_alerts` deliberately -- that
  table backs the long-day alert BIM already runs in production, and adding
  a column would break it for as long as this migration stayed pending.
  Until 0124 runs, every path degrades to the pre-0124 product: approver
  lookups return empty (so authority resolves exactly as it did through
  `supervisor_id` alone), the Sites screen shows no extra approvers, and
  both new alerts simply never claim, so nothing is sent. Turning the two
  alerts on also needs `break_alert` / `holiday_week_alert` in
  Settings → Workforce → Phone reminders, both default off.
- **0123_wfm_advance_requests_and_clarifications.sql — APPLIED to production**
  (verified 2026-09-10 by querying `pg_class`/`pg_policies`/`pg_indexes`: all
  three tables present, RLS on, one policy each, index counts 4/3/2 as
  written. Applied by hand at some point after 2026-09-09; this ledger still
  said PENDING, which is the drift `production-schema-drift` warns about --
  check the live database, not this file, before assuming. Dev DB state
  unverified.) **No WFH lockout resulted**: the gate this migration activates
  only bites when `config.wfm.punch_types.mobile_work` is on, and BIM has it
  off -- zero WFH requests ever, zero `mobile_work_start` punches in the
  preceding 30 days (checked 2026-09-10).
  (written 2026-09-09, owner request the same day: one "Requests" surface
  for OT/WFH advance notice, plus real back-and-forth clarification threads
  instead of one-shot correction/recheck replies). Two new tables, each with
  RLS + tenant-isolation policy in the same file, same "select-only, writes
  via the admin client" convention every WFM table follows:
  `wfm_advance_requests` (kind `ot`|`wfh`, date range, reason, approve/
  reject -- leave keeps its own separate table since approving it writes a
  real leave record; this one has no side-effect record) and
  `wfm_clarification_threads` + `wfm_clarification_messages` (anchored to a
  punch/correction/OT session via three typed nullable FKs, or 'general').
  **Behavior change once applied: WFH (`mobile_work_start`) is blocked
  without an approved `wfh` row covering today** (`isWfhApprovedForDate`,
  `lib/wfm/advanceRequests.ts`, enforced in `api/wfm/punch/route.ts` and
  mirrored client-side so the dropdown never offers it) -- OT stays exactly
  as it worked before (punch first, `wfm_ot_sessions` approval after; an
  `ot` row here is advance notice only, never a gate). Until this migration
  runs, every read 42P01s cleanly (empty request list, empty conversation
  list). **Corrected 2026-09-10:** `isWfhApprovedForDate` used to return
  false on ANY query error, including the 42P01 raised while this migration
  is pending -- meaning shipping this code to a database without 0123 would
  have taken WFH punching away from every employee who has it today, which
  is a worse outage than the feature merely being absent (§3b: a pending
  migration renders as the feature being off, never as a break). It now
  distinguishes: 42P01/42703 (migration pending) = no gate, the exact
  pre-0123 behaviour; any other error still denies, since an approval that
  could not be verified must not open the gate.
- **0122_fence_projects.sql — applied to both DBs** (owner confirmed
  2026-09-07; written 2026-09-07, Fence Configurator Phase C,
  `docs/fence-configurator-architecture.md` §7). Three tables, each with
  RLS + tenant-isolation policy in the same file: `fence_security_profiles`
  (tenant-authored presets -- NOT a fixed 3-tier enum, owner decision #2),
  `fence_projects` (`ref` via masterRef, `FNC-####`; `custom_data` from day
  one), and `fence_gates` (child object family, own real `id` per
  bpmsquarecore §3). Seed: `scripts/seed-fence-materials-demo.sql` (run
  AFTER 0122; 3 security profiles + 26 `products` rows tagged
  `custom_data.fence_kind` for `src/lib/fence/materials.ts`'s resolver,
  appends `FENCE_PIPES`/`FENCE_FABRIC`/`FENCE_HARDWARE` to the demo
  tenant's existing `product_categories` rather than replacing it -- that
  tenant's elevator categories from `seed-products-demo.sql` must survive;
  flips `features.fence_projects` on for the demo tenant) --
  **run and verified on the demo tenant 2026-09-07**: 3 security_profiles,
  26 fence products, flag true, all 8 pre-existing categories preserved
  plus 3 new ones appended (full verification query confirmed complete).
  `scripts/seed-fence-materials-bigblue.sql` / `-cleanup.sql` (written
  2026-09-07, same content retargeted at `slug = 'bigblue'` instead of
  `is_demo`) exist so the client can see real sample data on their own
  trial tenant, not just an empty screen -- owner's explicit intent is
  this is test data to be removed later, hence the cleanup script; unlike
  `seed-bigblue-sample-cleanup.sql` (which wipes bigblue's whole sandbox)
  the fence cleanup is surgical, deleting only fence_gates/fence_projects/
  fence_security_profiles rows, `FNC-%%`-sku products, and the 3 `FENCE_*`
  category entries -- bigblue's other real data is untouched. **Run and
  verified on production 2026-09-08** (cleanup script written, deliberately
  not run yet -- test data stays until the engagement is done).
  `features.fence_projects` is intentionally ON for both `demo` and
  `bigblue` (owner decision 2026-09-07: "leave it like that let it be in
  demo and bigblue tenants"). New `TenantFeatures.fence_projects` flag,
  default OFF everywhere else (`NewTenantForm.tsx` `DEFAULT_FEATURES`).
  **CRUD API routes + screens + nav entry shipped 2026-09-08**
  (`docs/fence-configurator-architecture.md` §14a): `/api/fence-projects`
  (+`[id]`, +`[id]/quote`), `src/components/fence/FenceConfigurator.tsx`
  (create/edit, outside the `(app)` Shell for a full-screen feel), a
  Shell-wrapped list page, a "Fence Projects" nav entry + workcenter key.
  Deliberately NOT done in this pass, per bpmsquarecore §3b (explicit
  deferral, not an oversight): custom fields, Data Workbench, v1 API, MCP,
  Nova timeline/comments, global search, ⌘K action, analytics/reports,
  change-history filter entry, Drive docs -- walk that list before calling
  the object fully shipped. **AI-drafted intake + side-by-side profile
  comparison shipped 2026-09-08** (`docs/fence-configurator-architecture.md`
  §14b, owner decision -- two of the three original competitive
  differentiators; the third, Won -> Work Order -> crew -> Invoice/AMC,
  stays deferred, blocked on platform gaps unrelated to fence). Intake
  reuses `extractRowsFromDocument` (the Data Workbench/Nova-draft
  extraction engine already in production) via a new
  `POST /api/fence-projects/draft` -- gated on `fence_projects` itself, not
  `next_experience` (a real sold object, not an experimental Nova surface).
  Untested end-to-end (needs `ANTHROPIC_API_KEY` + a live login, neither
  available in this environment). Geometry
  (`src/lib/fence/geometry.ts`) and BOM (`bom.ts`) are pure functions, no
  DB dependency at all -- only `materials.ts`'s `resolveFenceMaterials`
  and any future `fence_projects`/`fence_security_profiles` read need the
  42P01 degrade-cleanly treatment, and only once they're called from a
  route (nothing calls them yet).
- **0121_pricing_area_isolation.sql — applied to both DBs** (owner ran it
  2026-09-06; a syntax fix was needed first -- `UPDATE ... FROM LATERAL`
  cannot reference its own update target in Postgres (42P10), rewritten as
  correlated scalar subqueries with `coalesce(...)`). Verified live after
  applying on the demo DB: Default's Cost-based v2
  (published) and v1 (superseded) both intact, same timestamps; a fresh
  Test & Trace on Default resolved unambiguously to `COST_SIMULATOR` with
  no cross-book bleed. The two throwaway test Price Books
  (`catalog_formula_demo`, `catalog_formula_clean_test`) were removed via
  the app's own "Discard" button, now safe again post-migration, rather
  than the raw SQL cleanup originally drafted here -- both areas confirmed
  gone from the Price Book picker; Default confirmed unaffected throughout.
  Original bug write-up follows, written 2026-09-06, found live while
  building the Catalog + Formula pricing
  technique, `docs/pricing-engine-architecture.md` §19). Real, pre-existing
  bug: `pricing_components`/`pricing_procedures`/`pricing_rules`/
  `pricing_cost_models` (0083) had no `pricing_area` column, only
  `config_version` -- since every fresh Price Book starts at v1, any two
  Price Books at the same version number silently pooled their content
  together at pricing time (reproduced: a new book's cost formula read the
  Default book's OWN superseded-v1 cost rate instead of its own). Worse,
  "Discard" deleted by `config_version` alone too, so discarding one book's
  draft could destroy another book's rows, including published/superseded
  "immutable" history. Migration adds `pricing_area` to all four tables,
  backfills it via an as-of join against `pricing_config_versions.created_at`
  (correct for every tenant; only the demo tenant has ever used more than
  one Price Book), and widens the uniqueness/lookup keys to include it.
  Every query in `src/lib/pricing/server.ts` and
  `api/settings/pricing-engine/{config,versions,versions/[version]}` is
  scoped by it, and reads/non-destructive writes tolerate the migration
  being pending (degrade to the pre-fix behavior, not a crash); the
  "Discard" delete refuses instead of degrading, since silently doing the
  unscoped delete is the dangerous direction. **Cleanup: done** (see the
  note at the top of this entry) -- both throwaway test Price Books were
  removed via Discard once the migration made it safe again; no SQL cleanup
  was needed after all. The real Default book was untouched throughout.
  Confirmed applied on the second database too (re-running it there hit
  `42P07: relation "..._key" already exists` on the constraint step --
  expected, since `add constraint` isn't re-runnable like the `if not
  exists` column/index statements elsewhere in the file; it just confirms
  the first run succeeded). Nothing further pending on either database.
- **0120_opportunities.sql — PENDING on both DBs** (written 2026-09-06,
  Sales Engine Piece B, `docs/sales-engine-architecture.md` §4). Tables
  `opportunities` and `opportunity_lines` (RLS + tenant-isolation policies
  in the same file), `opportunity_id` on `quotes`, `standard_quotes` and
  `pricing_rfqs`, and the `pricing_documents.source` check widened to
  accept `'opportunity'`. Seed: `scripts/seed-opportunities-demo.sql`
  (run AFTER 0120 and the products seed; six demo deals across the
  default stages, flips `features.pipeline` on for the demo tenant).
  Every read tolerates the migration being pending (an error reads as no
  deals; the board renders empty) -- nothing else is affected.
- **0119_standard_quote_attachments.sql — applied to both DBs** (owner
  confirmed 2026-09-06; written
  2026-09-06, owner request the same day,
  `docs/sales-engine-architecture.md` §3.7). New table
  `standard_quote_attachments` (RLS + tenant-isolation policy in the same
  file) and a PRIVATE storage bucket `quote-attachments` -- customer
  communication kept with a Standard Quote, downloads only via a 5-minute
  signed URL, and "Create line items" from an attached .xlsx/.csv
  (Replace / Append / Skip duplicates). Until applied the Attachments
  card lists nothing and an upload fails with the database's message;
  nothing else is affected.
- **0118_quote_pdf_options_product_breaks.sql — applied to both DBs**
  (owner confirmed 2026-09-06; written 2026-09-06, owner decisions the same day,
  `docs/sales-engine-architecture.md` §3.6). Three columns: the product's
  own quantity breaks (`products.qty_breaks jsonb`, kept locally on the
  product page or synced from the ERP -- what the Standard Quote add-line
  panel offers), what the PDF prints for unchosen options and quantities
  (`standard_quotes.print_options jsonb`), and a per-line PDF override
  (`standard_quote_lines.show_on_pdf boolean default true`). Every write
  tolerates the migration being pending (`writeHeaderTolerant` /
  `insertLinesTolerant` strip the missing column and retry; the product
  select falls back to the pre-0118 column list), so until it is applied
  the panel offers no product breaks, the PDF prints as before, and
  nothing is lost except those three settings.
- **0116_sales_line_contract.sql — applied to both DBs** (owner confirmed
  2026-09-06; written 2026-09-06, Sales Engine Piece A,
  `docs/sales-engine-architecture.md` §3.1: the shared document-line
  contract). Lifts Quotations' alternative option-group columns
  (`group_id`/`group_label`/`group_type`, already on `quote_lines` since
  0047) onto `standard_quote_lines`, and adds quantity-break columns
  (`break_of`, `break_qty`, `is_selected`) to both `quote_lines` and
  `standard_quote_lines`. Price all lines, auto re-price, rate override
  and alternative option groups all validated on the demo the same day
  (SQ-2026-0003, since deleted) -- see the architecture doc §3.5 for the
  walk.
- **0117_break_of_no_fk.sql — applied to both DBs** (owner confirmed
  2026-09-06). Quantity breaks, Price all lines/auto re-price/rate
  override on Quotations, and the whole of Sales Engine Piece A validated
  end to end on the demo the same day -- see
  `docs/sales-engine-architecture.md` §3.5 for the walk and one bug found
  and fixed during it (a new break defaulted to charged instead of the
  base quantity). Written 2026-09-06 to drop the foreign key on
  `break_of` (both `quote_lines` and `standard_quote_lines`) and change
  its type from `uuid` to `text` -- 0116 created it as a hard FK, but both
  quote objects delete-and-reinsert every line on every save, so a new
  quantity break and its new parent line are always created in the same
  insert and neither side can know the parent's real row id in advance.
  `src/lib/pricing/quoteLineFlags.ts`'s `resolveLineIdsAndSelection()`
  resolves it application-side instead, exactly like `group_id` already
  does.
- **0115_pricing_cost_input_purchase_kind.sql — applied to both DBs**
  (owner confirmed 2026-09-06; found on the 2026-09-06 demo walk: "Save as confirmed cost" on an RFQ
  reply failed with `pricing_cost_inputs_kind_check` because 0083's check
  never learned the PURCHASE kind 0113 introduced). Widens the check; run
  AFTER 0113. Until applied the reply route answers 503 naming this
  migration, and the Advanced cockpit cannot save a PURCHASE cost input.
- **0114_standard_quotes_pricing.sql — applied to both DBs** (owner
  confirmed 2026-09-06; written
  2026-09-06 after the owner's call that the engine demo runs on Standard
  Quotes, not Quotations — Quotations are Vikas-specific): run AFTER 0113.
  `standard_quote_lines.product_id` / `pricing_document_id` /
  `pricing_flags` (the same three quote_lines got in 0113) and
  `pricing_rfqs.standard_quote_id`. Degrades while pending: the form still
  prices and raises RFQs, but a saved Standard Quote drops the product
  link and the document id (insert retried without the columns), so the
  send gate cannot fire and the detail page shows no flag.
- **0113_pricing_cost_based.sql — applied to both DBs** (owner confirmed
  2026-09-06; seed run on production). (was 0110; written
  2026-09-06, cost-based technique steps 1-3, spec §17; run AFTER 0111,
  then `scripts/seed-pricing-cost-based-demo.sql` on the demo for the
  walk). Also adds `quote_lines.pricing_document_id`/`pricing_flags`, the
  `rfq` email-template category and `pricing_rfqs`.
  Original step-1 description:
  `products.cost_sheet` + `cost_price_as_of`, `pricing_cost_models.sources`
  (the cost source ladder), provenance + `product_id` on
  `pricing_cost_inputs` with the widened natural key, and `pricing_rfqs`
  (select-only RLS). Degrades while pending: the engine prices with the
  legacy "most recent rate wins" behaviour, cost-model saves drop the
  ladder with a warning, cost-input saves drop provenance with a warning,
  and RFQs (step 2) are unavailable.
- **0112_wfm_leave_quota_period.sql — applied to both DBs** (owner
  confirmed 2026-09-06). (written
  2026-09-06, BIM follow-up: "it's days a month, not days a year"):
  `wfm_leave_types.quota_period` (year | month). The quota number stays
  in `wfm_leave_quotas.annual_quota` (historical name); a per-month quota
  is also the month's cap and balances read "left this month" (balance
  now takes the month in view). Numbered 0112 because 0110/0111 belong to
  the parked pricing work. Degrades while pending: every type reads as
  per-year; saving a period returns 503 naming the migration.
- **0109_wfm_leave_type_limits.sql — applied to both DBs** (owner
  confirmed 2026-09-06). (written
  2026-09-06, BIM request): `wfm_leave_types.monthly_limit` (at most N
  days of the type per calendar month, enforced on employee requests AND
  admin entry, counting approved records + pending requests) and
  `paid_days_per_month` (only the first N days of the type in a month are
  paid; the rest count as unpaid on the monthly summary and export).
  Degrades while pending: every read falls back to the 0062 columns and
  the limits simply read as "none"; saving a limit returns 503 with the
  migration named. Companion: `scripts/bim-leave-test-data-cleanup.sql`
  (inspect, then delete the generic types and their test history; owner
  runs it after confirming the counts). Leave types also gained
  deactivate / reactivate / delete-when-unused and inline edit on the
  Settings → Workforce → Leave Types tab, with the Add form at the top.
- **0111_pricing_documents.sql — applied to both DBs** (owner confirmed
  2026-09-06). (was 0109; renumbered
  2026-09-06 because the BIM leave-type limits took 0109; the parked
  pricing/cost-based branch still says 0109 in its messages and is fixed
  when pricing resumes) (written
  2026-09-06, BPMSquare Pricing Phase 2 batch 1, spec §17): the
  `pricing_documents` table (every priced context, result and trace;
  select-only RLS), `pricing_usage.api_key_id`/`document_id`, a natural
  key on `pricing_cost_inputs` (dedupes existing twins, then a unique
  index on tenant + model + path + valid_from), and the
  `pricing_publish_version` RPC that makes publish atomic. Degrades while
  pending: pricing still works and logs "pricing_documents insert failed";
  the cockpit's recent-documents list is empty; cost-input authoring falls
  back to plain insert; **publishing a version returns 503 until the RPC
  exists** -- so apply before anyone goes live on the demo.
- 0108_wfm_project_billing.sql — **applied to both DBs** (owner confirmed
  2026-09-06). `wfm_projects.bill_rate` (the project rung of the rate
  ladder) and `wfm_project_invoices` (which period of which project each
  invoice covers — the double-billing guard; select-only RLS per the WFM
  convention). Degrades while pending: project pages re-read without
  `bill_rate`, and the "Bill hours" card reports the migration as the
  blocker instead of crashing. The month-end auto-draft runs 1st of the
  month, same CRON_SECRET as the hours alert -- a native Vercel cron since
  2026-09-09 (was GitHub Actions; see the "Vercel Hobby constraint" ledger
  entry) -- and is gated per tenant by
  `config.wfm.costing.auto_draft_monthly`, default off. Rates live in
  Settings → Workforce → General → Project billing; nothing bills at a zero
  rate. Design and rules: WFM_PROJECT_COSTING.md §11–12.
- scripts/seed-wfm-projects-demo.sql — **run AFTER 0104/0105/0107, demo
  tenant only, PENDING**. Three projects (two on the demo's first two
  accounts, one standalone) with sub-projects to Level 2, the three lower
  attribution links, three weeks of weekday punches stamped with projects
  (one employee deliberately unassigned), next week's roster assignment,
  and the wfm + wfm_projects flags. Idempotent: fixed ids and natural-key
  guards, so it can be re-run.
- Everything else shipped after 0091 is deliberately schema-free, so don't
  go looking for a migration that doesn't exist: **Account 360** stores its
  card order and external sources in the existing `tenants.config` JSONB;
  the **feel layer** (confirm dialog + toasts) is client-side only; the
  **Flow Board** derives entirely from existing `change_log` + `quotes`
  rows. Fog of War was the same — it reads `accounts.territory` against
  the tenant's Sales-config picklist.
- Next migration will be **0100**; the first thing likely to need one
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
- ~~Vercel Hobby constraint (hard-learned): crons may fire at most once per
  day; a sub-daily schedule in `vercel.json` fails EVERY deploy's config
  validation silently.~~ **No longer applies — confirmed 2026-09-09 the
  project is on Vercel Pro**, which supports up to 100 crons/project at
  per-minute precision (Vercel lifted this platform-wide in Jan 2026). The
  three jobs that were routed around this via GitHub Actions
  (`wfm-hours-alert.yml`, `pricing-retention.yml`, `wfm-project-invoices.yml`)
  moved back into native `vercel.json` crons the same day; those workflow
  files are deleted. Webhooks cron runs daily 20:30 UTC.
- Drive docs: Admin & Setup Guide needs a Number Ranges section on its next
  refresh; owner still to drag How_to_Use_BPMSquare.pptx into the folder.
- Status-schema engine (see `/root/.claude/plans` history / task #27):
  Batch 0 (core tables + statusEngine.ts) shipped; batches 1–7 (per-object
  rollout incl. WFM leave/attendance statuses) not started.

**Update 2026-08-19 — WFM punch location, decided.** The approach is:
prevention, not recovery. Permission priming (the browser prompt is never
fired cold — only from a tap the employee made after reading why), the
"Set up this device" card asking for camera + location before anyone is at
a gate, and prompting the PWA install (on iOS a home-screen app has its
own permission store, which is the clean way past a refusal already stuck
in Safari). All shipped.

**Site QR / kiosk code was proposed and DECLINED by the owner** — a code
at the gate scanned with the camera, proving presence with no location
permission at all. Don't re-propose it; if presence-proof comes up again
the open items are the anti-forgery flags (IP-vs-GPS, impossible travel,
accuracy plausibility), which were accepted in principle but not built.

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

## 12. Client roadmap — captured 2026-08-22 (build list, not yet started)

Owner-provided wishlist from the workcenter-cleanup session. Nothing here is
committed to a date; each item gets its own scoping before build. The nav
reorg that accompanied it (Sales & Procurement, master-data consolidation,
Time Summary rename) shipped same-day.

**Sales**
- Pipeline — functionality update (scope TBD with owner).

**Service**
- AMC contracts, Work orders, Dispatch, Technicians — "update properly"
  (each needs a gap list from the owner).
- Voice assistant (agent) to take calls and create a DRAFT for an internal
  user to validate, or email the concerned person. (Draft-first, human
  validates — same trust model as Nova paste-to-draft.)

**Master data**
- Products — **shipped 2026-08-22** (commit `ba5bcba` + category-config
  follow-up; migrations 0098/0099). Categories are tenant config, OOB two
  levels. Open design decisions captured same-day with the owner:
  - **Sales-area product availability** (client sells product X only in
    country/sales org/territory Y): planned as an assignment on the
    product — `sales_orgs text[]`/`territories text[]` (empty = sold
    everywhere), reusing the existing Sales-config picklists as the
    dimensions; quote form then filters the catalog by the account's
    sales area, and v1 API grows matching filters. SAP analogy: material
    sales-org/distribution-channel views. Not built yet — build when the
    first multi-country tenant needs it.
  - **Multi-ERP distinction** (one CRM tenant, several ERPs behind it):
    planned as an external-system registry in tenant config — each ERP
    connection gets a stable system id (SAP "logical system" analogy);
    synced records carry `external_system` + `external_id` with
    uniqueness per (tenant, system, external id), and outbound documents
    route by a sales-org → ERP mapping. Not built yet — design agreed
    before any ERP sync work starts.
- Activity (appointments, visits).

**Marketing**
- Campaign studio: AI newsletter builder, multi-language, placeholders
  pulling from accounts/contacts.
- Automation / workflows: smart lists feeding campaigns.
- Website-embedded forms to track prospects on client sites/shops.
- Webinar (inbuilt, GoToWebinar-class feature set).
- LinkedIn integration; Hubilo integration; standard CRM integrations
  (Salesforce, SAP, ...).

**Pricing**
- Full-blown pricing, external and internal (extends the pricing-engine
  skeleton already in src/lib — see PricingEngine Phase 1 batch 0).
