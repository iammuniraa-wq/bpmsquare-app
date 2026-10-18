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

## 5. ERP readiness (design now, push later) — ERP-agnostic

The ERP is whatever the tenant uses (Dynamics 365, SAP, Epicor/Epromis, none),
so nothing in the estimator is named after one ERP (owner decision
2026-10-17). Dynamics is the first case because PCBS is implementing it, but
the estimator only knows "an ERP". No ERP is reachable in this MVP (the
Dynamics connector has never run against a live environment). What is built:

- Product and customer master arrive through whichever connector the tenant
  has; template rule lines reference products by **SKU**, which is the ERP's
  item number when the product came from a connector.
- `GET /api/estimates/[id]/export?format=bom&profile=generic` → XLSX/CSV;
  `format=wbs` → the work breakdown (code, parent, name, group, planned
  cost). An **ERP export profile** is a named column mapping
  (`{key,label,columns:[{header,field}]}`): `generic` (default, §5.1),
  `dynamics365` and `sap` ship as best-effort starting mappings, each labelled
  "confirm with your ERP consultant". A tenant setting later picks its
  default profile; adding Epicor or any other ERP is one more profile, no
  engine change.
- Phase 2 (not now): push a won estimate to the tenant's ERP as sales order +
  project (+ BOM) through that ERP's connector and `connector_links`, after
  a live test.

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
  **Status: built 2026-10-17, see section 11.**
- **E2 API + surfaces**: routes (estimates CRUD, lines, compute, import
  schedule, quote conversion, exports, templates CRUD), DW routes, v1 + MCP,
  search/Nova/palette/analytics wiring, change history.
  **Status: built 2026-10-17, see section 12.**
- **E3 Screens + seed + docs**: list/new/record pages on the new templates,
  Settings template list + editor, seed SQL, ledger entry in PROJECT.md,
  README note in this doc of what is illustrative.
  **Status: built 2026-10-18, see section 13.**
- **E4 Simulation** (section 10), after E3.
- **Later (not MVP)**: ERP push, RFQ from lines, IFC/Revit direct import,
  moulds-reuse planning, delivery/erection scheduling, fence → template
  migration, PDF of the BOM for the factory floor.

## 9. Decisions recorded (owner, 2026-10-17)

- Build an MVP now, no questions to PCBS first; reshape after talking to them.
- Generic core object + templates (fence is the pattern, not the base).
- ERP-ready from day one but ERP-agnostic: SKU-keyed lines, BOM/WBS exports
  with selectable ERP profiles (generic, Dynamics 365, SAP), links via
  `connector_links`; the push waits for a live environment.
- The studio has two top-level modes: **Estimate** (inputs, BOM, costing,
  quote, import, export) and **Simulation** (section 10).
- Everything PCBS-specific is data (templates/rates), never code.

## 10. Simulation mode (owner, 2026-10-17) — phase E4

A second top-level tab in the studio, beside **Estimate**, that actually
simulates the job instead of only listing it. Three parts, all computed from
the estimate's own lines and the template's rates:

1. **3D assembly and erection sequence (4D).** A parametric 3D model of the
   building built from the computed elements (panels, slabs, beams, stairs,
   boundary wall), placed by the template's layout rules, with a play/scrub
   control that erects it in sequence (foundation → ground-floor walls →
   slab → next floor → roof → boundary wall). Uses three.js, already a
   dependency (`src/components/fence/Fence3DView.tsx` is the pattern).
   Colour by element type or by erection day.
2. **Schedule simulation.** Production days from mould capacity and casting
   cycles, truck loads by weight and size, crane productivity (pieces per
   day) → a simple Gantt (production, transport, erection) and a total
   duration. Capacity assumptions are template rates, editable.
3. **What-if and risk.** Sliders on the main drivers (rebar price, concrete
   price, labour rate, transport cost, productivity, margin) with live price
   change, plus a **Monte Carlo** run (e.g. 2,000 draws, triangular
   distributions around each driver's low/likely/high, set in the template)
   showing the price distribution (P10/P50/P90), the chance of falling below
   a target margin, and a tornado chart of which drivers matter most. Runs in
   the browser; deterministic seed so a result can be reproduced.

**AI is optional and bounded.** The simulation numbers are computed, never
asked of a model. An external model (Claude API, `claude-opus-5-5`,
structured output as `src/lib/fence/draft.ts` does) is used only to
(a) **read a brief, email or drawing/PDF and propose the inputs** (a draft the
user reviews — same pattern as Fence intake and the RFQ reply reader), and
(b) **review an estimate and list risks or missing items** in words. Both are
suggestions saved only on user confirmation; both degrade to "AI not
configured" without breaking the studio. No customer or price data is sent
unless the user triggers the action, and the call goes through the existing
server-side AI helper pattern (never from the browser).

### 10.1 The 3D model is exact, not a sketch (owner, 2026-10-17)

- **One source of truth.** A pure `layout(inputs)` function defines the
  building as a list of real **pieces** (external wall panels with their
  window and door openings, internal walls, hollow-core planks, beams,
  columns, stair flights, parapet and boundary-wall panels), each with a mark
  (EW-07), size, position, erection step and concrete volume. The **BOM is
  summed from these pieces** and the 3D view draws exactly these pieces, so
  the piece count and quantities on screen equal the BOM. Click a piece to
  see mark, size, weight and cost; an explode-floors slider and a play/step
  control (4D erection order) support inspection.
- **Real projects use the client's own model.** For a real job the exact design
  is the client's BIM model. Phase E4+ supports uploading **glTF** (three.js
  loads it natively) and, if the owner approves the dependency, **IFC**
  (web-ifc, MIT licence; a new package, so it needs an explicit go), matching
  each piece to a BOM line by mark. Until then the generated model is the
  stand-in, and the UI says so.
- **Photo-style renders are an optional illustration, never the source of
  truth.** An external image-generation model (the Claude API does not
  generate images, so this is a separate provider the tenant connects, with
  its own key held server-side like other connector secrets) can turn a
  capture of the 3D model into a realistic picture for the customer. It is
  labelled "illustration", sizes and quantities always come from the model,
  and it is off unless a provider is configured.

### 10.2 How the exact model fits the template engine (decision, 2026-10-17)

The mock-up (`docs/estimator-reference/`, open `studio-mockup.html`; the JS
files are the reference logic, NOT production code) defines the building as
pieces in a coded `layout()`. Production reconciles this with the formula
engine (§1) as the "hybrid":

- A template names a **geometry module** (`geometry: "precast_villa"`), a
  coded, tested, pure function `inputs -> pieces[]` in
  `src/lib/estimator/geometry/`. Piece = `{id, code, kind, step, floor, pos,
  rot, dims, op?, vol, area?}` exactly as in the reference. Geometry modules
  are the only coded, trade-specific thing; adding a trade means adding a
  module, never touching the engine. A template with no geometry module is
  formula-only (no 3D).
- The compute pipeline exposes piece totals to the formula engine as
  identifiers: `vol_<code>`, `n_<code>`, `area_<code>`, `vol_total`,
  `weight_total` (via the template's density rate). Rule lines then price
  the pieces (concrete and steel per m³, moulds, labour, overhead, insulation
  from `area_EW`, lifting inserts from `vol_total`, transport loads from
  `weight_total`, erection) with rates and formulas, all tenant data.
- Estimate lines for piece-backed BOM lines are stored with their piece
  marks; the stored `estimate_lines.element_ref` lists the marks (or a range)
  so the viewer can highlight a BOM line's pieces and the BIM-upload path can
  match by mark. A snapshot of the pieces is stored on the estimate
  (`estimates.model jsonb`, added to 0131 if not yet applied anywhere; the
  owner has applied nothing for it yet) so an old estimate keeps showing the
  model it was priced with.
- The viewer is `src/components/estimator/BuildingViewer.tsx` (three.js,
  already a dependency), a client component fed the pieces; the production
  version must dispose geometry/renderer on unmount, respect
  `prefers-reduced-motion` (no auto-play, no drop animation), read theme
  colours from CSS variables, and work with touch (rotate/zoom/tap-to-pick).

## 11. E1 as built (2026-10-17) — status: E1 built

Pure engine under `src/lib/estimator/` (no I/O, all unit-tested; `tsc` and
`vitest` clean):

| File | What it is |
|---|---|
| `types.ts` | template jsonb shapes, cost components, `groupSlug()` |
| `formula.ts` | tokenizer, parser, evaluator (no `eval`); limits: 1000 chars, 500 nodes, depth 40, 10 000 steps; divide-by-zero and overflow are errors |
| `template.ts` | hand validation (no schema library in the repo), forward-reference/cycle checks, `resolveParams()` |
| `geometry/` | `types.ts` (Piece exactly as 10.2), `precastVilla.ts` (port of the reference `layout()`, named constants, degenerate-input handling, 5000-piece cap), `index.ts` (registry `getGeometry`, `pieceScope`, `markRange`) |
| `compute.ts` | `computeEstimate(template, params, {margin_pct, vat_pct, unit_costs, schedule})` and `summariseLines()` |
| `schedule.ts` | CSV/XLSX element-schedule parser, template workbook/CSV builders |
| `exports.ts` | BOM/WBS rows, `ErpExportProfile` (`generic` default, `dynamics365`, `sap`), CSV/XLSX writers |
| `starterTemplates.ts` | "Precast villa (illustrative)" |

Conventions the later phases rely on:

- **Rounding**: quantities 3 dp, money 2 dp, unit costs 4 dp, half away from
  zero. `qty_<code>` reads the rounded net quantity. Cost is charged on the
  GROSS quantity (net + waste). A zero-quantity rule produces no line.
- **Margin is a markup on cost** (`price = cost × (1 + margin%)`); VAT is on
  the price.
- **Select inputs read as the chosen option's number** in formulas (the
  starter's finish level is a price multiplier: 1, 1.08, 1.18).
- **Two-pass pricing**: product-priced rules come back `needs_price: true`
  with their `sku`; E2 prices them via `priceDocumentLine()` and calls
  `computeEstimate` again with `unit_costs` (keyed by rule code), which also
  lets `sub_<group>` formulas (overhead) see the real figures.
- **Geometry**: a template's `geometry` key (column `estimate_templates.geometry`)
  names a module; its pieces put `vol_<code>`, `n_<code>`, `area_<code>` (code
  upper-case, e.g. `vol_EW`) and `vol_total`, `n_total`, `area_total`,
  `weight_total` into the formula scope. `compute` returns the `model` for
  `estimates.model`. A rule's `element_ref` is the mark range of the piece
  families its qty formula reads (`EW-01..EW-40`); building-wide lines carry
  none. Schedule quantities replace a rule's own formula only; they do not
  change piece totals.
- **BOM export** (spec 5.1 columns) lists physical items (a SKU, or component
  materials/moulds); labour, transport, erection and overhead are WBS tasks
  (`include: "all"` lists everything). `quantity` is the gross quantity. WBS
  codes are numbered by group order (`1`, `1.1`, `1.2`, `2`, ...).
- **Starter vs the mock-up**: the reference villa prices to 174 256.59 cost /
  236 466.20 incl. margin 18 % and VAT 15 %, against the mock-up's 174 256.34 /
  236 465.86. The cents are per-line rounding. The starter's `wastage_pct`
  rate is 0 to match the mock-up; set it to price waste.

Deviations from the spec text: `estimate_lines.component` was added (a manual
line needs a cost bucket); `estimate_templates.geometry` and `estimates.model`
were appended to 0131 for 10.2; an ERP profile holds `columns: { bom, wbs }`
because the two exports have different fields; the starter's groups
gained "Production" and "Insulation and fixings" so the overhead base matches
the mock-up.

## 12. E2 as built (2026-10-17) — status: E1 and E2 built

API, server core and every non-screen surface of the §3b checklist. No screens
(E3), no seed (E3), no simulation (E4). No new SQL: 0131 as applied is enough.
`tsc`, `vitest` and `next build` clean.

### 12.1 Code map

| File | What it is |
|---|---|
| `server.ts` (server-only) | access guard `estimatorAccess(view\|create\|edit\|delete)` (module flag, then the Estimates workcenter); loaders that degrade on 42P01/42703/PGRST205 (`{missing:true}` / 503 `pending_migration`); `priceProductRules`, `computeAndPrice` (the two passes); `recomputeEstimate`, `refreshTotals`; `assembleEstimateQuote`; template list/insert helpers |
| `quoteLines.ts` | pure: cost lines -> customer quote lines (group or line), alternatives tagging, `quoteBlockers` |
| `overrides.ts` | pure: line-edit validation and re-applying hand edits after a recalculation |
| `lines.ts` | pure: stored row <-> computed line <-> export/quote/summary inputs |
| `requests.ts` | pure: body/query parsing for the routes (allowlists, ranges, list paging) |
| `editorCheck.ts` | pure: `checkTemplate` (all issues + example with the defaults) and `checkFormula` for the editor |
| `apiRows.ts` | the customer-safe estimate shape for v1 / `/ask` / reports |

### 12.2 Routes

All call `estimatorAccess()` first (`requireTenantUser()` inside), chain
`.eq("tenant_id")`, verify foreign ids, log changes. Not owning the module = 404.

| Route | Methods | Needs | Notes |
|---|---|---|---|
| `/api/estimates` | GET, POST | view / create | GET: `q status account_id template_id sort dir page page_size`. POST computes on create; inputs that do not compute create nothing (422 + issues) |
| `/api/estimates/[id]` | GET, PATCH, DELETE | view / edit / delete | GET = estimate (totals, model), lines, template, `template_outdated`, account, contact, quote. PATCH allowlist: name, account_id, contact_id, notes, margin_pct, status (draft\|won\|lost), params, custom_data (`cf_`). margin/params/account recalculate first |
| `/api/estimates/[id]/calculate` | POST | edit | `{reprice?}`; replaces computed lines, keeps manual lines and hand edits |
| `/api/estimates/[id]/lines` | POST | edit | manual line; with a product and no cost, priced like a rule line |
| `/api/estimates/[id]/lines/[lid]` | PATCH, DELETE | edit | PATCH qty, unit_cost, description, uom, waste_pct, component, wbs_code. DELETE: manual lines only |
| `/api/estimates/[id]/schedule` | POST, DELETE | view (preview) / edit (apply) | `?mode=preview\|apply[&skip_errors=1]`, multipart `file` or JSON `{filename,csv\|base64}`; 5 MB / 2000 rows. DELETE clears the schedule |
| `/api/estimates/schedule-template` | GET | view | `?template_id=\|estimate_id=&format=xlsx\|csv` |
| `/api/estimates/[id]/quote` | POST | edit + create on Standard Quotes | 201 / 409 already quoted / 422 unresolved or unpriced |
| `/api/estimates/[id]/export` | GET | view | `?format=bom\|wbs&type=csv\|xlsx&profile=&include=items\|all`; 400 on unknown values; internal (carries costs) |
| `/api/estimate-templates` | GET, POST | view / edit | POST returns every validation issue |
| `/api/estimate-templates/[id]` | GET, PATCH, DELETE | view / edit | PATCH validates the merged template; bumps `version` on content changes; optional `expected_version`. DELETE 409 while estimates use it (deactivate instead) |
| `/api/estimate-templates/[id]/duplicate` | POST | edit | "<name> (copy)" |
| `/api/estimate-templates/from-starter` | GET, POST | view / edit | copies the illustrative starter into the workspace as an ordinary template; idempotent by name |
| `/api/estimate-templates/validate` | POST | edit | template (+ optional `formula`) -> issues, warnings, example from the defaults |
| `/api/import\|export\|update/estimates` | POST | create / view / edit | Data Workbench, header fields only |
| `/api/v1/estimates`, `/[id]` | GET | key scoped to `estimates` | customer-safe fields only |

### 12.3 Decisions and deviations from the spec text

- **Two-pass pricing.** Pass 1 quantities; each `needs_price` rule's SKU is
  resolved to a product in the tenant (active first, then oldest), priced with
  `priceDocumentLine()` at the rule's gross quantity; pass 2 with `unit_costs`
  (so `sub_<group>` overhead sees real figures). **Addition:** when the engine
  has no price (no price book, no cost on file, or it is not configured) the
  product's own `cost_price` is the internal cost; recorded per rule in
  `totals.pricing` (`engine` / `product_cost`). A SKU that matches no product
  is listed in `totals.unresolved`, a product with neither price in
  `totals.unpriced`; both block the quote. **Caveat for the owner:** the
  engine's pre-tax unit rate is a SELL price, so a price book with its own
  markup stacks under the estimator's margin; use cost-based areas or
  `cost_price` for estimating. Every priced line also writes a
  `pricing_documents` row and a `pricing_usage` meter row (as Standard Quotes
  do), so a recalculation with N product rules is N metered calls; a
  margin-only change reuses the stored unit costs and prices nothing.
- **Persistence.** New computed lines are inserted before the old ones are
  deleted, so a failure leaves the estimate as it was. Manual lines are kept
  and renumbered after the computed ones. Each line carries a snapshot in
  `custom_data`: `group` (display name), `sku`, and for schedule rows
  `label` / `schedule_qty` (so a recompute rebuilds the schedule).
  `estimates.totals` also carries `unpriced`, `unresolved`, `pricing`,
  `warnings`.
- **Hand edits to computed lines** (PATCH on a rule/schedule line) are stored
  as `custom_data.override` and re-applied by rule code and position on every
  recalculation, so changing an input does not silently undo them. They adjust
  that line and the totals only; other rules' formulas still read the computed
  `qty_<code>`. A computed line cannot be deleted (it would come back): set
  its quantity to 0. An override whose line disappears is dropped with a
  warning in `totals.warnings`.
- **A quoted estimate is locked**: with a `standard_quote_id`, params, margin,
  account, lines, schedule and calculate answer 409 (name, notes, status,
  custom fields still edit). To revise, make a new estimate.
- **Quote assembly** (`assembleEstimateQuote`): refuses unresolved/unpriced
  lines; one line per group (or per line when `quote_granularity = line`),
  `qty 1`, `uom lot`, `rate = amount` = cost + margin, rounded so the lines add
  up to the estimate's price to the cent (a Standard Quote line holds
  `numeric(12,2)` rates, so a true quantity x rate could not add up; at line
  granularity the quantity is in the description). Header `tax_pct` is the
  tenant's `config.tax.rate` (0 when unset), so VAT is the quote's. Nothing
  cost-related is written to a quote line (tested). Idempotent: a conditional
  update claims the estimate (`standard_quote_id is null`); a lost race deletes
  its quote and answers 409.
- **Finish-level alternatives**: a template select input with
  `quote_alternatives: true` (new optional flag, kept by `validateTemplate`)
  quotes every option as an alternative group; the estimate's own choice is
  selected. Other options are recomputed with the chosen option's stored unit
  costs. No flagged input = no alternatives, and the response says so.
- **Template versions**: `version` bumps when inputs, rates, rules, geometry or
  `quote_granularity` change, not on name/description/trade/active toggles.
  Recalculating an estimate uses the current template and stores its version.
- **Estimate list** is new: the suppliers route the spec points to does no
  search or paging, so `GET /api/estimates` implements them (server side,
  exact count).
- **Data Workbench**: import makes a draft by template NAME and does not
  compute (a file of hundreds of rows would be hundreds of metered pricing
  runs); the new estimate has no lines until opened and calculated. Update
  refuses `margin_pct` (it recalculates) and `quoted`.
- **v1**: `estimates` is explicit-scope only. The price is read through
  `totals->price` / `totals->price_incl_vat` json paths, so the rest of
  `totals` never leaves the database; no lines, params or model. Exposed as
  `quoted_total` (before VAT) and `quoted_total_incl_vat`.
- **Ref collisions**: `insertWithMasterRef` only retries on indexes named
  `*_tenant_ref_uniq`; `estimates_tenant_ref_key` does not match, so
  `insertEstimate` retries on any 23505 itself (0131 is applied; not edited).
  The same latent gap exists for products, opportunities and fence projects.
- **Extra routes** beyond the brief: `DELETE .../schedule`, `GET
  .../from-starter` (the "start from" list).

### 12.4 What E3 must do

- Pages (`/estimates`, `/estimates/new`, `/estimates/[id]`; `ROUTES` exist) on
  `ObjectListPage` / `ObjectFormPage` / `ObjectRecordPage`; read through
  `loadEstimateBundle` / `listEstimates` / `listTemplates` (server.ts) or the
  routes; show "waiting for the database update" when `missing`.
- Inputs form generated from `template.inputs` (sections), Calculate, BOM tab
  (edit qty / unit cost -> PATCH line, add manual line, schedule upload with
  preview, exports with the ERP profile picker), Costing tab (`totals`), Quote
  tab (`/quote`, show `unresolved` / `unpriced` / `warnings`), Activity, and
  `<NovaTimelineSlot objectType="estimates" objectId={id} />`, `ObjectSections`
  for `cf_` fields (exclude the hand-rendered keys), account page tab via
  `estimatesForAccount(accountId)` (`@/lib/data`).
- Settings -> Sales -> Estimate templates: list (`/api/estimate-templates`),
  "Start from" (`from-starter`), editor using `/validate` for live issues, the
  example result and per-formula values; include a `quote_alternatives` toggle
  on select inputs.
- `scripts/seed-estimator-demo.sql` (demo tenants: flag on, the illustrative
  template, one sample estimate), ledger entry in PROJECT.md, and the Drive
  guide refresh after the owner has validated it. The illustrative starter is
  fully rate-priced (it has no product rules), so the demo needs no products
  unless a template adds product rules.

## 13. E3 as built (2026-10-18) — status: E1, E2 and E3 built, E4 next

Screens, template editor and demo seed. No new SQL, no new npm packages, no
API changes. `tsc`, `vitest` and `next build` clean. **Not verified in a
browser** (a tenant login is needed): everything below is checked at code
level only, see 13.4.

### 13.1 Screens and URLs

| URL | What | Files |
|---|---|---|
| `/estimates` | List: `ObjectListPage`, "+ New Estimate", search (name, ID), status chips with counts, sortable ID / name / status / created, pager, phone cards, "waiting for the database update" state when 0131 is missing | `estimates/page.tsx` |
| `/estimates/new` | `ObjectFormPage`: name, template, account (type to narrow) + contact, the **inputs form generated from the template** (cards by `section`; number / choice / yes-no; min, max, unit, help), margin, notes, custom fields (`CreateExtraFields`). "Calculate and save" posts `/api/estimates`; API issues land under the field. No template: empty state with "Start from the precast villa starter". `?from=<id>` prefills from another estimate (Duplicate); `?account_id=` preselects the account | `estimates/new/*`, `components/estimator/InputsForm.tsx`, `AccountPicker.tsx` |
| `/estimates/[id]` | `ObjectRecordPage`, tabs in `?tab=`: **Overview** (details card with inline edit and status, `ObjectSections` for `cf_` fields), **Inputs** (same generated form, Recalculate; locked once quoted), **BOM** (lines by group, edit qty / unit cost, add and delete manual lines, source and "edited by hand" badges, Import schedule with preview and row errors, export bar with ERP layout), **Costing** (stacked component bar, margin, price, VAT, blockers), **Quote** (what the customer will see, or the linked quote), **Activity** (`RecordActivity`, which mounts `NovaTimelineSlot objectType="estimates"`). Primary action: Create quote / Open quote. The ⋯ menu: Edit, Duplicate, Export BOM / WBS (Excel, generic layout), Export options, Adapt fields (admins), Delete (undo window) | `estimates/[id]/*` |
| `/accounts/[id]?tab=estimates` | Account tab (`RelatedList`, customer-facing figures only via `estimatesForAccount`), shown only when the `estimator` flag is on | `accounts/[id]/page.tsx` |
| `/settings/estimate-templates` | Settings > Sales list (`RecordRows`): + New template (a minimal valid one), row menu Edit / Duplicate / Deactivate / Delete (409 text from the API when in use), "Add the precast villa starter" | `settings/estimate-templates/*` |
| `/settings/estimate-templates/[id]` | Editor, Save top right, tabs Details / Inputs / Rates / Rules / Check (13.2) | `settings/estimate-templates/[id]/*`, `components/estimator/templateDraft.ts`, `useTemplateCheck.ts`, `EditorRow.tsx` |

The nav item (Sales & procurement, `estimator` flag, `estimates` workcenter)
and the Settings menu item (admin only, same flag and workcenter) are gated
exactly like the module.

### 13.2 Template editor

- The working copy keeps numbers as typed text (`templateDraft.ts`, unit-tested
  to round-trip the starter into a template with zero validation issues) and
  only becomes the template shape for a check or a save.
- Every change (after 600 ms) posts `/api/estimate-templates/validate`. The
  **Check** tab lists every issue by path, warnings, the worked example with the
  default inputs (cost by group; product lines unpriced) and the names a
  formula may use: inputs, rates, `qty_<code>`, `sub_<group>`, and the geometry
  module's `vol_/n_/area_<CODE>` plus `vol_total`, `n_total`, `area_total`,
  `weight_total`. Issue counts show on the Inputs / Rates / Rules tabs and
  under the row they belong to.
- The quantity formula box checks live once focused: errors with position,
  unknown names, and the value with the default inputs. (A waste % formula is
  validated by the template check, not by the box.)
- Geometry module: select from the registry; shows its piece families, the
  inputs it reads and which required ones the template is missing.
- Select inputs have an options editor and the `quote_alternatives` toggle.
- Rules: ordered, move up / down, cost from a rate (dropdown of the template's
  rates) or from a product SKU, component, optional element type.
- Save sends `expected_version`; a stale save is the API's 409. API issues on
  save are shown on the Check tab. Rows stack on a phone (`fg2`, `fg3`).

### 13.3 Demo seed

`scripts/seed-estimator-demo.sql` is **generated** by
`scripts/gen-estimator-demo-seed.ts` (`npx jiti scripts/gen-estimator-demo-seed.ts`)
by running the real `computeEstimate` on the starter with its default inputs,
margin 18 % and VAT 15 %: 16 lines, 137 pieces, cost 174 256.59, total incl.
VAT 236 466.20 (the E1 golden numbers). Idempotent, demo tenants only
(`is_demo = true`); sets `features.estimator`, adds the template and one sample
estimate with its lines, totals and model. Run AFTER 0131, by hand; ledger entry
in `PROJECT.md`. Regenerate whenever the starter or the engine changes.

### 13.4 Deviations and things not verified

- **List sorting**: ID, name, status and created are sortable (what
  `listEstimates` sorts in the database); account, template and price are not,
  and the per-column search boxes are off (`ObjectListPage` got an optional
  `columnSearch` prop, default on, so no other list changes) because the filter
  runs in the database.
- **Account picker**: a type-to-narrow box over the select, from the page's own
  tenant-scoped query (the same approach as the Standard Quote form), not a
  server-side search.
- **Export profile**: chosen on the BOM tab; there is no tenant default setting
  yet, so the menu shortcuts use the generic layout. No "can see estimates but
  not costs" role split exists, so none was invented; costs appear only on
  internal screens (BOM, Costing, exports), never on the quote, the v1 API or
  the account tab.
- **Quote preview** on the Quote tab uses the same builder as the conversion
  (`buildQuoteLines`) on the stored lines; alternatives are described, not
  listed.
- **Not verified in a browser**: all of it. The owner should look at desktop and
  375 px, light and dark, in particular: the BOM table (it scrolls sideways on a
  phone rather than turning into cards), the schedule import preview, the
  generated inputs form, the stacked cost bar colours, the editor's Rules tab
  on a phone, and the menu export links (they download through the API).
- The Drive guide refresh waits for the owner's validation (standing rule).

### 13.5 What E4 (Simulation) must do

- A second top-level mode on the estimate record (a **Simulation** tab or
  switch beside the existing tabs; Estimate mode stays untouched), fed by
  `estimate.model` (the stored pieces) and the template's rates.
- `src/components/estimator/BuildingViewer.tsx` (three.js, pattern
  `fence/Fence3DView.tsx`): draw exactly the stored pieces, click a piece for
  mark / size / weight / cost, explode-floors slider, erection-step play and
  scrub, colour by family or by day; dispose geometry and renderer on unmount;
  honour `prefers-reduced-motion`; theme colours from CSS variables; touch.
  Highlight a BOM line's pieces from its `element_ref` range.
- Schedule simulation (production days from mould capacity and casting cycles,
  truck loads by weight, crane productivity) with the capacity assumptions as
  template rates (new rates, edited in the existing Rates editor), as a Gantt.
- What-if sliders and Monte Carlo (deterministic seed; P10 / P50 / P90, chance
  of missing a target margin, tornado chart) with low / likely / high per driver
  stored on the template (the editor needs a place to set them, e.g. an
  optional range on rates).
- Optional AI, server side only and bounded: read a brief or drawing and propose
  inputs; review an estimate for risks. Both are drafts saved on confirmation
  and degrade to "AI not configured".
- glTF upload to replace the generated model (IFC only after an explicit go on
  the dependency). No SQL is needed unless the model upload stores files.
