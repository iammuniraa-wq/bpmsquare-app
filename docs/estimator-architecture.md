# Project Estimator — MVP architecture v0.1 (2026-10-17)

> **Who this is for.** The engineer (human or model) building the MVP, phase by
> phase, from this document alone. Read first, every time: `bpmsquarecore.md`
> (§1 extension boundary, §3 record identity, §3b new-object checklist — this
> is a new object, so the ENTIRE checklist applies), `MULTI_TENANT_GUARDRAILS.md`,
> `docs/fence-configurator-architecture.md` (the pattern this generalises),
> `docs/ui-restructure-spec.md` (the screen contract: ObjectListPage /
> ObjectRecordPage / ObjectFormPage, kit in `src/components/ui`),
> `docs/d365-connector.md` (the integration this must stay compatible with).
> The owner runs all SQL by hand; code must degrade while a migration is
> pending.

## 0. Why, and what is deliberately not assumed

PCBS (most likely Precast Building System Co., a Saudi precast manufacturer;
the owner's company is implementing Dynamics 365 F&O for them) saw the Big
Blue fence module and wants the same for quoting THEIR customers' precast
work (villas, houses, boundary walls). **Nothing is known about how PCBS
actually quotes** — public information does not exist and the owner does not
want to ask yet. So the MVP is a generic, template-driven estimator with an
**illustrative** precast starter template (placeholder rates and rules,
labelled as such everywhere), built to be shown, then reshaped after the first
conversation. Every PCBS-specific number lives in tenant data (templates and
rates), never in code, so the reshaping needs no deploy.

What their D365 project tracker told us (read 2026-10-17): the client's own
gaps include **WBS Creation, BOM Creation, Delivery Management, Tender & Bid
Management** (not covered) and Pricing & Costing integration, production /
transport / equipment / factory-and-yard overhead costing (partly covered);
nine requirements name AutoCAD/Tekla/Revit/BIM/PLM and others name Excel
upload. The estimator therefore produces **a BOM, a WBS and a cost build-up**,
not just a price, and exports them in a shape D365 can ingest.

## 1. Shape: one standard object, templates per trade

`Estimate` is a standard core object (flag `estimator`, ref `EST-####`),
not a precast-specific one. What differs per trade is the **template**:

- **Template** (tenant data, edited in Settings): named inputs, named rates
  (constants), and an ordered list of rule lines. A template is versioned by
  a `version` integer; an estimate remembers the template id + version it was
  computed with and keeps its own computed lines (snapshot), so editing a
  template never silently re-prices an existing estimate.
- **Rule line**: `code`, `group`, `description`, `uom`, a `qty` formula, an
  optional `waste_pct`, and a cost source: either `product` (SKU of a
  catalogue product; priced by the pricing engine exactly as Fence does) or
  `rate` (a rate name × the qty, for things that are not products — moulds,
  labour, transport, erection, overhead).
- **Formula language**: tiny, safe, no `eval`. Numbers, identifiers (inputs,
  rates, earlier lines as `qty_<code>`, group subtotals as `sub_<group>`),
  `+ - * / ( )`, comparisons, and `ceil floor round(x,n) min max abs if(c,a,b)`.
  Pure TypeScript with a tokenizer + parser + evaluator, fully unit-tested.
  This is the "hybrid" the owner leaned towards: formulas for most rules; a
  coded rule can be added later for what formulas cannot say.
- **Fence is untouched** in the MVP. It stays as it is; it can later become
  template one (migration of fence projects is a separate, later piece).

## 2. Three ways quantities enter

1. **Configurator form** — the template's inputs (floors, built-up area per
   floor, wall perimeter and height, wall thickness, boundary wall length,
   finish level, …) → rules compute every line. For quick proposals.
2. **Element schedule import** — upload CSV/XLSX (element type, mark, count,
   length, width, thickness/height). Rows are matched to the template's
   element types; each row's volume/weight is computed and added as lines.
   This is the path for BIM exports (Revit/Tekla schedules saved as Excel).
   MVP reads a documented column set with a downloadable template file;
   direct IFC/Revit is out of scope.
3. **Manual lines** — add, edit or delete any line by hand; a manual line is
   flagged `source = 'manual'` and survives recompute.

## 3. Data model (migration `0131_estimator.sql`)

All tables: `tenant_id uuid not null references tenants(id)`, RLS enabled with
the standard CRM-shaped tenant-isolation policy in the SAME migration
(`for all`; this is not pay/attendance data), `created_at/updated_at`.

- `estimate_templates` — `id`, `tenant_id`, `name`, `trade` (free text, e.g.
  "precast"), `version int`, `is_active`, `inputs jsonb` (array of
  `{key,label,type: number|select|boolean, default, min, max, options, unit,
  help}`), `rates jsonb` (array of `{key,label,unit,value}`), `rules jsonb`
  (ordered rule lines as above), `quote_granularity` (`group`|`line`),
  `custom_data jsonb`.
- `estimates` — `id`, `tenant_id`, `ref` (EST-####), `name`, `account_id`,
  `contact_id`, `template_id`, `template_version`, `status`
  (`draft|quoted|won|lost`), `params jsonb` (the input values), `currency`,
  `margin_pct numeric`, `totals jsonb` (snapshot: by group and cost
  component, grand total), `standard_quote_id`, `notes`, `custom_data jsonb`,
  `created_by`.
- `estimate_lines` — `id`, `tenant_id`, `estimate_id`, `sort_order`, `code`,
  `group_key`, `description`, `uom`, `qty numeric`, `waste_pct`, `unit_cost`,
  `cost_total`, `product_id` (nullable, tenant-verified), `source`
  (`rule|schedule|manual`), `element_ref text` (mark from an imported
  schedule), `wbs_code text`, `custom_data jsonb`. Child object family: its own
  `id` is the contract for update/delete (§3).
- External ids for Dynamics go through the existing `connector_links`
  (`0129`) — **no D365 columns** on estimates.

## 4. Costing and the quote

Compute order (server, pure functions + one DB-touching assembler):
inputs → rule lines (quantities) → priced lines (product lines via
`priceDocumentLine()`, the same call Standard Quotes and Fence use; rate lines
via template rates) → group subtotals → **cost build-up by component**
(materials, moulds, production labour, factory/yard overhead, transport,
erection, other — a `component` tag on each rule) → margin % → price → VAT
from the tenant's tax settings.

Customer never sees unit costs: the Standard Quote gets **one line per
group** (default) or per line (`quote_granularity = 'line'`), priced at cost +
margin, grouped by section, with optional alternatives (finish levels) using
the existing option mechanism. Conversion reuses the Fence assembler
(`assembleFenceStandardQuote` pattern → a generic `assembleEstimateQuote`),
refuses if any product line is unresolved or unpriced, is idempotent
(409 if `standard_quote_id` exists), verifies account/contact tenant ids.
Lines without a cost can raise an RFQ using the existing RFQ module
(`rfq_line_id` on `estimate_lines`, deferred to phase 2 — note it, don't
build it).

## 5. D365 readiness (design now, push later)

D365 is not reachable in this MVP (no live environment; the connector has
never run against one). What is built:

- Product and customer master already arrive through the connector; template
  rule lines reference products by **SKU**, which is the Dynamics item number
  when the product came from the connector.
- `GET /api/estimates/[id]/export?format=bom` → XLSX/CSV: item number (SKU),
  description, qty, uom, group, wbs_code, element_ref. `format=wbs` → the
  work breakdown (code, parent, name, group, planned cost). Column names are
  documented in `docs/estimator-architecture.md` §5.1 and chosen to map onto
  D365 data-entity import (BOM lines; project WBS tasks) so a consultant can
  load them without re-keying.
- Phase 2 (not now): push a won estimate to D365 as sales order + project
  (+ BOM), through the existing connector's push mechanism and
  `connector_links`, after a live test.

### 5.1 Export columns (BOM)
`item_number, description, quantity, unit, group, wbs_code, element_ref,
unit_cost, line_cost`. (Internal export, admin/estimator roles only; never in
the customer PDF, never in the v1 API — see §7.)

## 6. Screens (follow `docs/ui-restructure-spec.md`)

- **Estimates list** (`/estimates`, Sales & procurement group): ObjectListPage,
  "+ New Estimate" top right, chips by status.
- **New estimate**: ObjectFormPage — name, account, contact, template; then
  inputs form generated from the template (grouped cards), "Calculate".
- **Estimate record** (ObjectRecordPage, tabs in `?tab=`): **Overview**
  (facts, status, totals strip), **Inputs** (editable, Recalculate),
  **BOM** (lines grouped; edit qty/add manual lines; import schedule; export),
  **Costing** (build-up by component and group, margin %, price, VAT),
  **Quote** (the linked Standard Quote or "Create quote"), **Activity**.
  Primary action: Create quote / Open quote; ⋯: Edit, Duplicate, Export BOM,
  Export WBS, Adapt fields, Delete.
- **Settings → Sales → Estimate templates**: list pattern (+ New template,
  ⋯ rows) and a template editor (inputs, rates, rule lines with a formula
  box that validates live and shows an example result). "Duplicate template"
  is how a tenant starts from the starter. Save top right.

## 7. §3b checklist for this object (execute ALL, state skips)

Database (0131, ledger entry "pending on both DBs", degrade on 42P01/42703/
PGRST205); demo seed `scripts/seed-estimator-demo.sql` (idempotent, flips the
flag on for `is_demo` tenants; seeds the **illustrative** precast villa
template — name it "Precast villa (illustrative)" and put the word
"illustrative" in its description — plus one sample estimate); entity types;
`MASTER_REF_TABLES` (`EST`); `PilotObjectType` + `PILOT_OBJECT_TYPES` +
`FIELD_REGISTRY` entry for `estimate`; custom fields (`VALID_OBJECTS`, tab,
PATCH accepts `cf_` data, record page mounts ObjectSections); CRUD routes
(`requireTenantUser()` first, explicit PATCH allowlist, `logChange`);
nav item + `WorkcenterKey` `estimates` + workcenters catalog + feature flag
`estimator` (default off) in `TenantFeatures`, `TenantEditor`,
`NewTenantForm`; `OBJECT_FEATURE` entry; Data Workbench import/export/update
for **estimates** (header fields only — lines come from the estimator, say so
in `DataWorkbenchClient.tsx`); v1 API `estimates` list/get via
`authorizeApi` + `enrichedList`, **excluding every cost field and the lines'
unit_cost/cost_total** (internal, say so in a comment) and add `estimates` to
`EXPLICIT_SCOPE_ONLY`; `UNDOCUMENTED_ENDPOINTS` or `API_ENTITIES`; v1 index,
`SCOPABLE_OBJECTS`, MCP `list_estimates` / `get_estimate` + version bump;
change history + filter entry; global search spec + `SearchObjectType`;
Nova timeline + the three Nova route maps; ⌘K "New estimate"; analytics
metric + dashboard tile + reports metric; cross-object touchpoints (Account
page tab "Estimates", Deal/Standard Quote link, RFQ deferred); docs.

## 8. Phases (each ends: `tsc` + `vitest` clean, build after E2/E3, commit
on `develop`, never push; owner pushes)

- **E1 Engine**: migration `0131`, types, registry/ref/flags/§3b data-layer
  items, the formula engine, template schema + validation, the compute
  pipeline (pure), element-schedule parser, BOM/WBS export builders, unit
  tests for every pure part (including the illustrative template's golden
  numbers).
- **E2 API + surfaces**: routes (estimates CRUD, lines, compute, import
  schedule, quote conversion, exports, templates CRUD), DW routes, v1 + MCP,
  search/Nova/palette/analytics wiring, change history.
- **E3 Screens + seed + docs**: list/new/record pages on the new templates,
  Settings template list + editor, seed SQL, ledger entry in PROJECT.md,
  README note in this doc of what is illustrative.
- **Later (not MVP)**: D365 push, RFQ from lines, IFC/Revit direct import,
  moulds-reuse planning, delivery/erection scheduling, fence → template
  migration, PDF of the BOM for the factory floor.

## 9. Decisions recorded (owner, 2026-10-17)

- Build an MVP now, no questions to PCBS first; reshape after talking to them.
- Generic core object + templates (fence is the pattern, not the base).
- Considering D365 from day one: SKU-keyed lines, BOM/WBS exports, links via
  `connector_links`; the push waits for a live environment.
- Everything PCBS-specific is data (templates/rates), never code.
