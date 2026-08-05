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
