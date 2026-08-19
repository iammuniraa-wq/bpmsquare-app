# BPMSquare — Agent Instructions

> **Read this file completely before writing any code.**
> It overrides any default behaviour. Non-compliance breaks production for real customers.

For full product context (data model, roadmap, design partner) see `PROJECT.md`.

---

## 1. CRITICAL: Multi-tenant extension architecture

BPMSquare is a **multi-tenant SaaS**. Every tenant shares the same codebase and database.
**Never add tenant-specific logic to standard product files.**

### The rule — one sentence
> All tenant-specific behaviour lives in `src/extensions/<slug>/`, never in standard components or API routes.

### How it works

```
src/extensions/
  types.ts          ← extension point interface (the "BAdI definitions") — READ THIS FIRST
  registry.ts       ← slug → loader map; the ONLY file touched when adding a new tenant
  _base/index.ts    ← default no-op implementations (all tenants without an extension get this)
  vikas/index.tsx   ← Vikas Pioneers customisations (fields, signature, hooks, layout slots)
  <slug>/index.tsx  ← future tenant — one file, isolated, never touches standard code
```

### Before writing any code, ask yourself:
- Is this behaviour needed by **all tenants**? → standard product file is correct.
- Is this behaviour specific to **one tenant**? → it goes in `src/extensions/<slug>/index.tsx` only.
- Does the standard product need a new hook to support this? → add to `types.ts` + `_base/` first.

### Adding a new tenant with custom logic
1. Create `src/extensions/<slug>/index.tsx` implementing `TenantExtension` (import from `./types`)
2. Add one line to `src/extensions/registry.ts` — that is the only standard file you touch
3. Wire extension slots in the relevant server component via `getExtension(tenant.slug)`

### What is FORBIDDEN
```ts
// ❌ Never do this in standard product files
if (tenant.slug === "vikas") { ... }
if (tenant.name.includes("vikas")) { ... }
if (tenantSlug === "acme") { ... }
```

```ts
// ✅ Correct — extension resolves the right behaviour per tenant
const ext = await getExtension(tenant.slug);
ext.quoteSignatureSlot?.(ctx)
ext.extraCustomFields("asset")
```

---

## 2. Multi-tenancy rules

- Every DB table has `tenant_id`. RLS enforces isolation — never query without it.
- Always use `requireTenantUser()` from `src/lib/supabase-server.ts` at the top of API routes.
- Never use the Supabase service role key on the client side.
- Tenant configuration (feature flags, custom fields, tax, layouts) lives in `tenants.features`
  and `tenants.config` (JSONB). Types are in `src/lib/constants.ts → TenantFeatures / TenantConfig`.
- **Before writing or touching any query, mutation, new table, or cache that deals with
  tenant-scoped data, work through `MULTI_TENANT_GUARDRAILS.md` first.** It's a concrete
  checklist (not prose) written after a 2026-07-21 isolation audit — covers
  `createAdminSupabase()` usage, unverified foreign ids from request bodies, RLS on new
  tables, and cache keys. Tenant identity here is resolved per-request from the hostname,
  not a client-side switch, so getting this wrong is silent until it isn't.

@MULTI_TENANT_GUARDRAILS.md

---

## 2b. Tenant provisioning — follow the runbook, 100%

Whenever the task involves **provisioning a tenant for a new client** —
creating it, scoping its modules, wiring its domain, seeding its users, or
handing it over — **read and follow `TENANT_PROVISIONING.md` before doing
anything.** It is the single source of truth for that flow (owner decision
2026-08-17, written after the first single-module tenant exposed every gap
in the improvised process). Do not re-derive the steps from memory; if the
flow changes, update the runbook in the same piece of work.

---

## 3. Record identity — every record has a real ID

Every record this product creates — standard object or custom, and this
applies to every future object family too, not just the ten current ones —
gets a database-generated UUID (`id` column) the instant it's created. That
ID is the only reference contract that's ever safe to build on:

- **Create (Import)** never needs or accepts a client-supplied `id` — the ID
  doesn't exist yet. Creation resolves relationships by a business key
  instead (a name, a ref, an email) — see `REFERENCE_FIELDS` in
  `src/lib/import/registrySchema.ts` for the established pattern
  (`account_name`, `quote_ref`, ...).
- **Update, Delete, and any other API access** must always key off the real
  `id` — never a business key alone. A name/ref can collide, get renamed, or
  (critically in a multi-tenant system) coincidentally match a *different*
  tenant's differently-owned record; the UUID cannot. This is why Data
  Workbench's Update mode always requires a synthetic "Record ID" column
  (`ID_FIELD` in `DataWorkbenchClient.tsx`) that only an Export ever
  populates — a file for Update must come from a prior Export of real IDs,
  never be hand-typed from a business key.
- Every mutation query pairs the two: `.eq("id", x).eq("tenant_id",
  tenantId)`. The `tenant_id` filter is what stops a cross-tenant id from
  ever matching (see `MULTI_TENANT_GUARDRAILS.md`); matching by `id` rather
  than name/ref is what stops an update from silently landing on the wrong
  record when two records share a similar name.
- This also governs parent/child object families (e.g. Quote Lines, and any
  future one — account team, involved parties, ...): the child's own `id`
  is what its Update/Delete match on. A parent-referencing field like
  `quote_ref` is only ever used to *resolve the relationship at create
  time* — once a child record exists, its own ID is the contract, not the
  parent's ref.

---

## 3b. NEW OBJECT / NEW TABLE — wire every surface, not just the screen

> Owner instruction 2026-08-18, after employee custom fields shipped and were
> found to reach the app but not the API, MCP or half of Data Workbench.
> **Work through this list every single time a new object or a new
> tenant-scoped table is created — and again whenever an existing object
> gains a capability (a custom-data column, a new field family).** An object
> that exists on one surface and is silently absent from the others is a
> defect, not a phase 2. If a point genuinely doesn't apply, say so
> explicitly in the PR/commit rather than leaving it unmentioned.

**1 — Database**
- [ ] `tenant_id uuid not null references tenants(id)` on the table.
- [ ] `enable row level security` **plus** an isolation policy, in the *same*
      tracked migration (`MULTI_TENANT_GUARDRAILS.md` has the template — and
      check the module's own convention first: WFM tables are select-only).
- [ ] `custom_data jsonb` if the object is user-facing at all — retrofitting
      it later means a second migration and a second round of wiring.
- [ ] The migration is a file in `supabase/migrations/`, numbered next, and
      added to PROJECT.md's operational ledger as **pending on both DBs**.
      Nothing auto-applies it (see that ledger); the owner runs it by hand.

**2 — Types & registry**
- [ ] Entity type in `src/lib/types.ts`.
- [ ] `PilotObjectType` **and** the runtime `PILOT_OBJECT_TYPES` array in
      `src/lib/fieldRegistry.ts` — adding one without the other leaves the
      registry entry dead code (exactly the 2026-08-18 employee bug).
- [ ] `FIELD_REGISTRY` entry: sections + every standard field, with
      system-generated ids marked `locked/editable:false/exportOnly`.

**3 — Custom fields**
- [ ] `VALID_OBJECTS` in `src/app/api/settings/custom-fields/route.ts`.
- [ ] Tab in `src/app/(app)/settings/custom-fields/page.tsx`, carrying the
      `featureKey` of the module that owns the object.
- [ ] The object's PATCH route accepts a `cf_`-filtered `custom_data`.
- [ ] The detail screen mounts `ObjectSections` (exclude the keys the page
      hand-renders itself).

**4 — Data Workbench — all three modes, not just import**
- [ ] Import route (`collectCustomData(values)` into the insert).
- [ ] Export route (`/api/export/<object>`), emitting the real `id` column.
- [ ] Update route (`/api/update/<object>`), matching on `id` only — never a
      business key (§3).
- [ ] The spec/template offers the tenant's `cf_` columns. For a static spec
      (users, employees) that means a `build…Spec(fieldConfig)` builder the
      DW page **and** the export/update routes all share — one source, or
      the three drift.
- [ ] Any mode you deliberately exclude is commented with why, in
      `DataWorkbenchClient.tsx`.

**5 — v1 API**
- [ ] `LIST_SOURCES` entry in `src/lib/api/listSources.ts` (field whitelist +
      tenant-scoped `load()`), which also makes it queryable by `/api/v1/ask`.
- [ ] `GET /api/v1/<object>` + `/[id]` routes via `authorizeApi` +
      `enrichedList`.
- [ ] Feature-flag check, so a tenant without the module gets 404, not data.
- [ ] `UNDOCUMENTED_ENDPOINTS` (or a full `EntityDef` in `API_ENTITIES`,
      which earns metadata + OpenAPI automatically).
- [ ] The `/api/v1` index listing, `SCOPABLE_OBJECTS` in `ApiKeysPanel.tsx`,
      and the endpoint table in Settings → General.
- [ ] **Personal or sensitive data → add it to `EXPLICIT_SCOPE_ONLY` in
      `api/v1/_auth.ts`.** Existing keys carry `objects: ["*"]`; without this
      a new endpoint silently widens every key already in the wild.

**6 — MCP** — `list_<object>` / `get_<object>` in `mcp-server/mcp.json`, and
bump its `version`.

**7 — Cross-cutting app surfaces**
- [ ] Feature flag in `TenantFeatures` + the nav/workcenter gate (a tenant
      that didn't buy the module must not see the object anywhere).
- [ ] Change history (`logChange` on create/update/delete).
- [ ] Global search, if the object is something people look up by name.
- [ ] Advanced filtering / saved queries, if it has a list page.
- [ ] **Nova timeline** — `<NovaTimelineSlot objectType="…" objectId={id} />`
      before the closing tag of the detail page (it self-gates on Nova, so
      server pages need no theme logic), **plus** an entry in `OBJECTS` in
      `api/nova/comments/route.ts` (object_type → table) **and** in
      `LABEL`/`TABLE` in `api/nova/inbox/route.ts` so a mention on it can
      be rendered in the inbox. All three, or the object gets comments
      nobody can be notified about.

**8 — Docs** — refresh the matching Drive guide in the same piece of work
(§9), and note in the commit which guide changed.

---

## 4. Do not hallucinate

Before writing ANY code, verify:
- **API routes** — only routes listed in `src/app/api/` exist. Do not invent paths.
- **DB columns** — check `src/lib/types.ts` for the actual column list before referencing a field.
- **Components** — confirm the file exists before importing it.
- **Extension points** — check `src/extensions/types.ts` before calling `ext.someMethod()`.
  If the method doesn't exist there yet, add it to `types.ts` + `_base/` first.

---

## 5. Project structure

```
src/
  app/              ← Next.js App Router pages and API routes
  components/       ← shared UI components (standard product only)
  extensions/       ← tenant extension layer (see section 1)
  lib/
    constants.ts    ← ALL magic strings, types, TenantFeatures, TenantConfig
    types.ts        ← DB entity types (Account, Contact, Asset, Quote, ...)
    tenant.ts       ← getTenant(), requireFeature(), Tenant type
    supabase-server.ts ← requireTenantUser(), createAdminSupabase(), checkAndDeductCredits()
    encryption.ts   ← AES-256-GCM field-level encryption for PII (server-only)
    data/live.ts    ← all Supabase read helpers (always decrypts PII before returning)
  extensions/       ← (see section 1)
```

---

## 6. Styling rules

- No hardcoded hex colours in components. Use CSS variables or the theme tokens defined in
  `src/app/globals.css` and Tailwind config.
- Dark sidebar gradient (all inner pages): `linear-gradient(180deg, #152233 0%, #0e1a28 100%)`
- Brand accent: configurable per tenant via `tenant.accent_color` — never hardcode `#F47C20`.

---

## 7. Security rules

- PII fields (phone, email, GSTIN on accounts; phone, email on contacts) are encrypted at rest
  via `src/lib/encryption.ts`. All writes must go through `encrypt()`, all reads through
  `decryptAccount()` / `decryptContact()`. Never store plaintext PII.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` or `FIELD_ENCRYPTION_KEY` to the client bundle.
- `src/lib/encryption.ts` has `"server-only"` at the top — do not import it from client components.

---

## 8. What NOT to do

- Do not add `console.log` — use `console.error` only for genuine errors.
- Do not hardcode tenant slugs or names in standard product files (see section 1).
- Do not add npm packages without checking if the functionality already exists.
- Do not modify `tenants.config` shape without updating `TenantConfig` in `constants.ts`.
- Do not write comments explaining what code does — only add comments for non-obvious WHY.
- Do not create new API routes that duplicate existing ones.

---

## 9. Documentation maintenance — KEEP THE GOOGLE DRIVE DOCS CURRENT

There is a **user-facing documentation set** in Google Drive, folder
**"BPMSquare Documentation"**
(https://drive.google.com/drive/folders/1vogZwPOvllisA5enJUBdC_Ea1lUiLsz9):

- **BPMSquare — Sales Cloud Guide** — Accounts, Contacts, Quotations, Standard Quotes, Pipeline, Invoices
- **BPMSquare — Service Cloud Guide** — Cases, Inspection Reports, AMC, Work Orders, Dispatch, Technicians, master data
- **BPMSquare — Workforce Management (WFM) Guide** — punch app, roster, leave, overtime, monthly summary + setup
- **BPMSquare — Marketing Guide** — Campaigns, Segmentation, Leads, Partners
- **BPMSquare — Admin & Setup Guide** — tenancy, users/roles, settings, Data Workbench, change history, integrations
- **BPMSquare REST API — Integration Guide** — v1 API: scoped keys, enriched queries, OpenAPI, change feed, webhooks, `/ask`
- **How to Use BPMSquare.pptx** — overview deck

**The rule:** whenever a change ships that alters user-visible behaviour a guide
describes — a new/changed module, field, status flow, WFM/quote/marketing rule,
a new API endpoint or auth change, a settings/permission change — **update the
matching Drive doc in the same piece of work, and note it in the PR/commit.**
Docs drifting from the product is a defect, not a nice-to-have.

Mechanics / caveats when updating these:
- The Drive tools available here can **create** a doc and change its title/parent,
  but **cannot edit a doc's body in place**. To refresh a guide, regenerate its
  HTML and create a new revision, or hand the updated file to the user — do not
  silently let it go stale because in-place edit isn't available.
- The API guide has an always-current machine counterpart: `GET /api/v1/openapi.json`
  (generated from `src/lib/api/openapi.ts`) and the self-describing `GET /api/v1`
  index. When the API changes, those update automatically — the Drive API guide is
  the human-readable snapshot that still needs a manual refresh.
- Each guide carries a "Snapshot &lt;date&gt;" line — bump it when you refresh.

---

## 10. BPMSquare Nova — the Business OS. Rollout doctrine (owner decisions 2026-08-19)

The "2050" experience has a FINAL name: **BPMSquare Nova — the Business
OS** (owner decision 2026-08-19). Nova is the product's Lightning/Fiori —
an AI-first, keyboard-first, collaborative experience layer positioned
beyond "CRM". User-facing labels say Nova; the feature flag stays
`next_experience` and the theme value stays `nextgen2` (code-level names
are frozen so branding never causes churn). The candidate pillars, in intended order:
command palette (⌘K does everything), AI record creation (paste/forward
anything → drafted record, reusing the DW extraction engine), record
timeline + comments + inbox, feel layer (undo-toasts, optimistic saves,
skeletons, presence).

**The three unbreakable rules of this program:**

1. **Nothing experimental can reach an existing client.** Every Next
   Experience surface is gated on `features.next_experience` — a
   **platform-admin-only** flag (set in /admin/tenants, never by a
   workspace admin), default off, missing-key = false. The 3-layer theme
   option only appears in a tenant's Settings when the flag is on, and
   `useIsNextgen3Layer()` requires the flag too, so even a stale stored
   theme value renders as plain nextgen. New Next Experience code must
   hang off this same gate (or a narrower one) — never ungated.

2. **Step by step, confirmed before the next.** One capability at a time:
   build → demo tenant → the owner personally validates → only then the
   next piece. Never ship the whole remodel at once, and never widen the
   flag to a client tenant without the owner's explicit go.

3. **The bar is enterprise.** This will be presented to enterprises — every
   piece must hold a rich, modern, considered feel (SVG-only iconography,
   both color modes, mobile-fit, reduced-motion respected, real empty
   states). If a piece looks like "old CRM", it isn't done.
