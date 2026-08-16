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
