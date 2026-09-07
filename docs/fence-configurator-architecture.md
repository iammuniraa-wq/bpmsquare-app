# Fence Configurator — architecture and build spec v1.0 (2026-09-07)

> **Who this is for.** The engineer (human or model) implementing this. It
> captures the competitive research, the concept walkthroughs, and the
> reuse audit behind the decision to build — so nobody re-derives it from
> the conversation that produced it.
>
> **Read first, every time:** `bpmsquarecore.md` §1 (extension boundary),
> §3 (record identity), §3b (new-object checklist — mandatory for
> `fence_projects` and `fence_security_profiles`), §10 (Nova rollout
> doctrine — step by step, demo tenant, owner validates, then the next
> piece); `MULTI_TENANT_GUARDRAILS.md`; `docs/pricing-engine-architecture.md`
> (the engine Phase C hooks into); `docs/sales-engine-architecture.md`
> (the shared document-line contract and `priceDocumentLine()` Phase D
> reuses, and owner decision #3 there — margin-floor breach requires
> approval, and approvals are a **platform service**, not a per-object
> build). PROJECT.md's operational ledger lists every migration; the owner
> applies SQL by hand on both databases — code must degrade cleanly while a
> migration is pending.

---

## 0. Why this exists

Big Blue Fencing (Qatar prospect, tenant slug `bigblue`, seeded on
production — see PROJECT.md) currently quotes fence jobs on
**fencecosting.netlify.app** ("Fence Studio"), a third-party tool. A
logged-in walkthrough (2026-09-07) found:

- Its 3D takeoff configurator and auto-generated bill of materials are
  genuinely good — the reason Big Blue uses it.
- Everything past that is unbuilt or non-functional: 83 of 84 materials
  have no unit cost entered, so every quote in the account prices at
  **QAR 0.00**. The app's own settings label itself "Phase 1 · dashboard &
  3D configurator" — cost engine and quotation export are named but not
  built.
- It is `localStorage`-only: no backend, no roles, no second user, no
  approvals, no API, no CRM around the quote.

BPMSquare already has the half Fence Studio doesn't (multi-tenant backend,
a real cost-buildup pricing engine now wired into Standard Quotes via
`priceDocumentLine()`, roles, change history). The gap — confirmed by
grep, no fence/BOM logic exists anywhere in this repo — is the parametric
takeoff and BOM engine itself. That is what this spec builds.

**The differentiation is not "we also have a 3D screen."** A concept
walkthrough (three iterations, published as Artifacts, not checked in)
tested three real differentiators against Fence Studio's actual behaviour:

1. **AI-drafted intake** — Nova reads a forwarded client email and
   proposes a starting configuration, instead of a rep typing four
   lengths by hand.
2. **Non-destructive comparison** — Fence Studio's own UI copy admits
   "switching security level reloads the template and replaces current
   edits." Ours holds every profile's settings independently and prices
   them side by side.
3. **The record doesn't end at the quote.** Configure → quote → approval
   → won → work order → crew → invoice → AMC is one thread, not a tool
   that stops at an unpriced BOM.

A fourth thing surfaced late and matters for how this is built, not just
demoed: the first concept literally reused Fence Studio's own tier
labels ("Tier 1 — Commercial / Tier 2 — Industrial / Tier 3 — High
Security"). Fixed by replacing the fixed enum with **tenant-authored
security profiles** picked by asset type ("what are you protecting?"),
which is also the architecturally correct answer — see §5.

---

## 1. Owner decisions that shape everything (do not re-open)

| # | Decision | Date |
|---|---|---|
| 1 | Build it. Fence-specific work only where a real gap exists — platform gaps (Work Order creation, WFM crew booking) are scoped separately, not built as fence-only throwaway code | 2026-09-07 |
| 2 | No competitor visualization or vocabulary carries over. Security tiers are tenant-authored profiles picked by asset type, not a fixed 3-tier enum | 2026-09-07 |
| 3 | BOM *quantity* math (post counts, hardware per post) is universal chain-link engineering, not tenant-specific logic — plain TypeScript, not the pricing engine's DSL. The DSL is for *cost/price*, which genuinely varies per tenant | 2026-09-07 |
| 4 | Margin-floor approval is **not** a fence-specific build — it rides on Sales Engine Piece C (rules + approval engine, owner decision #3/#6 in `sales-engine-architecture.md`, design-only as of 2026-09-06). Phase D ships without a bespoke gate; wires into the real one when Piece C lands | 2026-09-07 |
| 5 | Build order **A → B → C → D → E → F → G** (§4). One piece at a time, demoed on `bigblue`, owner validates, then the next (bpmsquarecore §10 rule 2) | 2026-09-07 |

---

## 1b. The UX bar — non-negotiable from Phase C onward

Owner instruction 2026-09-07, while Phase A was landing: ease of use is
the actual point, not a nice-to-have alongside the architecture. Checkable
criteria, not a vibe — every later phase is reviewed against these before
it counts as done, the same way Nova doctrine §10 rule 3 already sets the
enterprise bar for the rest of the product:

1. **Every field recomputes the visible result within one frame.** No
   "Apply" button, no reload, no spinner for a pure calculation. This is
   *why* Phase A (`computeGeometry`) is synchronous and side-effect-free —
   an async or DB-backed geometry function would make this bar impossible
   to hit later, so the constraint starts at the bottom of the stack, not
   the top.
2. **Full-screen, chrome-less.** No dark app sidebar competing with the
   canvas — the `(print)`/`kiosk` route precedent (§2), not a squeezed
   panel inside the standard Shell.
3. **Never "missing unit cost."** Every BOM line resolves to a real
   priced `products` row the moment materials are seeded (Phase C) — the
   single most-repeated criticism of Fence Studio in the walkthrough that
   started this.
4. **Two clicks from intake to a priced quote for the common case** —
   forward the email, confirm the draft, done; the configurator is there
   to *adjust*, not to be the mandatory path.
5. **Real empty and loading states**, never a bare spinner — matches Nova
   doctrine's own "reduced-motion respected, real empty states" bar.

The three concept Artifacts built during scoping (not checked into the
repo — published, clickable walkthroughs) are the validated reference for
what this should feel like: full-bleed canvas, floating minimal panel,
live-reactive plan/3D view, real-time BOM. Phase C/E screens are graded
against that fidelity, not against a generic CRUD form with a save
button.

## 2. Reuse audit — what's real today, verified against code, not docs

| Surface | Status | Where |
|---|---|---|
| Materials/Products catalog + `custom_data` | **Real** | `products` table, Settings → Materials pattern |
| Chrome-less full-screen route | **Real**, 2 precedents | `src/app/(print)/layout.tsx`, `src/app/kiosk/page.tsx` — route-group opt-out, not a per-page flag |
| Pricing engine core (`PriceComponent`, DSL, versioning, cost-buildup) | **Real** | `src/lib/pricing-core/`, Phase 1 complete behind `pricing_engine` flag |
| Engine ↔ Standard Quotes hook | **Real** — corrects `pricing-engine-architecture.md`'s "no engine hook" claim, which predates Sales Engine Piece A | `priceDocumentLine()` in `src/lib/pricing/quoteLine.ts`, called from `StandardQuoteForm.tsx` and `DocumentLinesEditor.tsx`; routes a line to a Price Book via `src/lib/pricing/routing.ts` |
| Opportunity / Pipeline (Sales Engine Piece A+B) | **Real code**, `0120_opportunities.sql` **pending** on both DBs | `src/lib/sales/opportunity.ts`, `/api/opportunities/*` |
| Margin-floor approval gate | **Designed, not built anywhere** | Platform service, Sales Engine Piece C, design-only |
| 3D/canvas rendering library | **Does not exist** | No three.js/react-three-fiber/WebGL dep in `package.json` |
| Work Order creation | **Partial gap** — `PATCH`/`DELETE` and WO→Invoice conversion are real; there is **no `POST /api/work-orders`** and no "New Work Order" UI. Only bulk import creates one today | `src/app/api/work-orders/[id]/route.ts`, `.../[id]/invoice/route.ts` |
| Quote-won → Work Order trigger | **Does not exist** | Nothing found; `sales-engine-architecture.md`'s flow diagram overstates this as "exist today" — only Won→Invoice is real |
| WFM crew/technician scheduling | **Does not exist** | `src/lib/wfm/` is attendance/punch/leave + hours-attribution project tree, no "book technician X on job Y, dates Z" object |
| AMC (`contracts` table) | **Real**, lean header only | `src/app/(app)/amc/`, `listContracts()`; no line items, service history only via `work_orders.auth_kind="contract"` |
| Invoices + WO→Invoice conversion (quote-sourced **and** contract-sourced) | **Real** | `src/app/api/invoices/route.ts`, `src/app/api/work-orders/[id]/invoice/route.ts` |

**Reading this table:** Phases A–E below build on real patterns. Phase F
(Won → Ops) depends on platform capabilities that don't exist for *any*
module yet — building them fence-first would be scope creep on work that
belongs to Work Orders and WFM generally. Phase F is scoped to make that
dependency explicit, not to build around it.

---

## 3. Vocabulary

| Term | Meaning here |
|---|---|
| **Fence project** | New object (`fence_projects`): one configured run — layout, length, gates, chosen security profile, fabric/coating, derived BOM. Becomes a Standard Quote once priced. |
| **Security profile** | New object (`fence_security_profiles`): tenant-authored preset (spacing, embedment, pipe class) picked by asset type, not a fixed tier. Seeded with 3 defaults per tenant, fully editable. |
| **Gate** | Child of a fence project (`fence_gates`) — own type/width, own real `id` per bpmsquarecore §3 (resolved by parent ref only at create time; every mutation after that keys on its own id). |
| **BOM** | The full quantity list (posts by type, fabric area, hardware) — pure function of the project's geometry inputs. No cost in it. |
| **Quote line** | A `products` row + quantity, priced via `priceDocumentLine(tenantId, { productId, quantity, documentType: "standard_quote", sourceId })` — the exact contract Sales Engine Piece A already established. |

## 4. The flow

```
Nova drafts a project from a forwarded email (Phase E-adjacent, see §9)
        │
        ▼
Fence project (draft) ── configure: layout, length, gates, security profile ──▶ BOM (Phase A+B)
        │                                                                         │
        │                                                          resolve BOM lines to products (Phase C)
        ▼                                                                         │
   3D preview (Phase E, chrome-less route)                                        ▼
                                                                     Standard Quote + lines,
                                                                     priced via priceDocumentLine()  (Phase D)
                                                                            │
                                                            margin floor?  │  (Sales Engine Piece C, not built here)
                                                                            ▼
                                                                          Won
                                                                            │
                                                    ── BLOCKED on platform Work Order + WFM crew booking ──
                                                                            ▼
                                                              Work order → Invoice → AMC   (Phase G, mostly reuse)
```

---

## 5. Phase A — geometry core (headless, no DB, no UI)

Pure, unit-tested TypeScript. This is the thing worth getting right before
anything else touches it — every downstream phase (BOM, cost, 3D) reads
its output and nothing else.

**File:** `src/lib/fence/geometry.ts`

```ts
export type FenceLayout = "open_run" | "closed_perimeter";

export interface FenceGateInput { type: "single_swing" | "double_swing" | "sliding"; width_m: number; }

export interface FenceGeometryInput {
  layout: FenceLayout;
  total_length_m: number;
  post_spacing_m: number;      // from the chosen security profile, tenant-editable
  embedment_m: number;         // from the chosen security profile
  straining_spacing_m: number; // default 100, editable
  gates: FenceGateInput[];
  fabric_height_m: number;
}

export interface FenceGeometryResult {
  line_posts: number;
  straining_posts: number;
  corner_posts: number;
  terminal_posts: number;
  gate_posts: number;
  total_posts: number;
  fabric_area_m2: number;
}

export function computeGeometry(input: FenceGeometryInput): FenceGeometryResult { /* ... */ }
```

Formulas are the concept demo's, hardened: total posts from
`length / spacing`; corners = 4 for a closed perimeter, 0 for an open run
(2 terminals instead); straining posts every `straining_spacing_m` minus
corners already counted; gate posts = `gates.length * 2`; fabric area =
`length * height − Σ(gate width) * height`.

**Acceptance:** unit tests (`geometry.test.ts`, vitest) check the formula
is internally consistent and order-of-magnitude correct against the
Fence Studio walkthrough's inputs (500 m closed perimeter, 2 gates: 6 m +
4 m, 980 m² fabric at 2 m height checks out exactly since that's pure
area math). **Not claimed:** an exact match to Fence Studio's own
per-post-type split (165 line / 2 straining / 4 corner) — that number
implies a segment-based placement algorithm (posts filling the run
*between* corner/straining/gate anchors, not a flat subtraction from a
perimeter-wide total) that their app never discloses, and reverse
engineering it byte-for-byte would risk reproducing their exact internal
logic rather than deriving our own — the thing owner decision #2 already
told us to avoid. This module's exact post-count formula is an **open
engineering-review item**: before it feeds a real customer quote, it
needs sign-off from Big Blue's own installation team against actual
CLFMI/ASTM chain-link install practice, not just internal consistency.

## 6. Phase B — hardware BOM rules

**File:** `src/lib/fence/bom.ts`. Pure function of `FenceGeometryResult` +
accessory toggles (truss rods, tension wire, tie wire, barbed wire) →
a flat list of `{ kind, qty, unit }` rows — tension bands, brace bands,
rail ends, carriage bolts, truss sets, tension/tie wire. Same engineering
rules as the concept demo (bands per post from fabric height ÷ 0.3 m
spacing, etc.), now as a real, tested module — this is universal
chain-link engineering (owner decision #3), so it stays plain TypeScript,
not a tenant-configurable formula.

**Acceptance:** golden-case test against the same 500 m/2-gate project.

## 7. Phase C — schema + materials tie-in

First phase that touches the database. Full bpmsquarecore §3b checklist
applies to `fence_projects` and `fence_security_profiles` — walked in
§10 below, not shortcut.

**Tables** (sketch — exact DDL is this phase's first deliverable):

- `fence_security_profiles`: `tenant_id`, `id`, `label`, `blurb`,
  `post_spacing_m`, `embedment_m`, `pipe_class`, `created_at`. Seeded with
  3 defaults per tenant on tenant creation (mirrors §3b's demo-seed
  requirement); tenant can rename/add/delete freely — this is the fix for
  owner decision #2.
- `fence_projects`: `tenant_id`, `id`, `account_id` (nullable), `ref`
  (via `insertWithMasterRef`, prefix e.g. `FNC-####`), `layout`,
  `total_length_m`, `security_profile_id` (fk, tenant-verified per
  guardrails), `fabric_height_m`, `mesh_spec`, `coating`, `status`
  (`draft`/`quoted`/`won`), `standard_quote_id` (fk, set once priced),
  `custom_data jsonb`.
- `fence_gates`: `tenant_id`, `id`, `fence_project_id` (fk), `gate_type`,
  `width_m`. Real UUID per bpmsquarecore §3 — the parent ref only resolves
  the relationship at create time; every later mutation keys on the
  gate's own `id`.

Both new tables: `enable row level security` + tenant-isolation policy in
the *same* migration (guardrails template); code degrades to an empty
list on 42P01 while the migration is pending, per §3b.

**Materials as Products.** Every BOM row (line post, straining post,
fabric, tension band, …) becomes a real `products` row with `custom_data`
carrying fence-specific attributes (pipe diameter, mesh gauge, coating).
Big Blue's 84-item Fence Studio library becomes the seed data — a
`scripts/seed-fence-materials-demo.sql` per §3b's demo-data requirement,
flipping the fence feature flag on for demo tenants.

There is no fixed "BOM" product category anywhere in the codebase, and
none is needed — `products.category`/`sub_category` are plain strings,
and `TenantConfig.product_categories` (`src/lib/constants.ts`) is already
a tenant-defined two-level tree edited in Settings → Sales config; no
tree configured falls back to free-text so a category never blocks a
fresh tenant. The seed script sets `config.product_categories` on the
demo tenant to the real trade taxonomy Fence Studio itself already uses —
**Pipes** (Commercial / Schedule 40 / SS20 / SS40), **Chain-link fabric**,
**Gates & hardware**, **Accessories** (tension band / brace band / post
cap / rail ends / …) — not an invented one.

**Acceptance:** a fence project's BOM resolves every line to a real
`products.id` with a real `list_price`/cost — no line is ever "missing
unit cost" the way 83 of Fence Studio's 84 are today.

## 8. Phase D — quote assembly (reuse, not new integration)

This is the phase the reuse audit changes most. Because Sales Engine
Piece A already ships `priceDocumentLine()` and Standard Quotes already
calls it, this phase is mostly wiring, not new engine work.

**File:** `src/lib/fence/quoteAssembly.ts`, `assembleFenceStandardQuote()`:

1. Creates the Standard Quote header (zeroed, `status: "draft"`) —
   reusing `generateNextStandardQuoteRef`/`writeHeaderTolerant` exactly as
   `/api/standard-quotes`'s own POST route does, including its
   ref-collision retry.
2. For every resolved BOM line, calls
   `priceDocumentLine(tenantId, { productId, quantity, documentType: "standard_quote", sourceId: quoteId })`
   — the identical call `StandardQuoteForm.tsx` makes for every other
   line type. No fork of the pricing logic (bpmsquarecore §1).
3. Inserts priced lines via `derivePricingFlags`/`withPricingColumns`/
   `insertLinesTolerant` — the same three helpers, same order, the real
   route uses — then updates the header's stored subtotal/total.

**Refuses outright, rather than degrading, on two conditions:** any line
still unresolved to a product (materials.ts), or any line the engine
itself couldn't price (a product with no cost source). This is the literal
enforcement of "never missing unit cost" (UX bar §1b.3) — Fence Studio's
tool has no equivalent check anywhere, which is exactly how 83 of its 84
materials went out unpriced.

**Explicitly not built here:** a margin-floor gate. Owner decision #4 —
that's Sales Engine Piece C, a platform service. A fence quote that
breaches the floor behaves exactly like any other Standard Quote does
today (nothing, until Piece C ships) rather than getting a bespoke,
throwaway gate that has to be re-torn-out later.

**Not yet callable from anywhere** — there's no fence_projects CRUD route
yet (Phase E) to invoke it. Can't be usefully unit-tested with vitest
either: every step writes to real tables through `createAdminSupabase()`,
the same boundary `src/lib/pricing/server.ts`'s DB-touching functions sit
behind without `.test.ts` coverage of their own — proven by `tsc`/
`next build` plus manual verification against the demo tenant once
Phase E exists to call it.

**Fixed 2026-09-07, found on re-audit (owner asked "are you sure there's
no mistake" and this is what a line-by-line re-read against
`MULTI_TENANT_GUARDRAILS.md` turned up):** `accountId`/`contactId` were
never verified to belong to the calling tenant before being written onto
the quote header — the exact vulnerability shape the guardrails file
names explicitly (2026-07-21 invoices/quotes fix). Not exploitable yet
(nothing calls this function), but it would have shipped the same gap
into Phase E's route on day one. Fixed: both are now checked with
`.eq("id", x).eq("tenant_id", tenantId).maybeSingle()` before the quote
is created, same pattern `/api/standard-quotes`'s own POST route uses.
`accountId` is also now passed through to `priceDocumentLine()` (it
wasn't before) now that it's verified — lets the pricing engine apply
any account-based routing rules a tenant has configured, same as every
other document type gets.

## 9. Phase E — 3D preview (chrome-less route)

**File:** `src/app/fence-preview/Fence3DView.tsx`. Plain `three` (added as
a real dependency — `package.json`; no `react-three-fiber`, avoiding a
second new dependency for one imperative scene managed through a ref,
same shape the concept artifacts already validated), not
react-three-fiber. Renders the exact same `FenceGeometryResult` the plan
view and BOM already consume — one geometry source, two views, never two
calculations. A Plan/3D toggle sits over the canvas in
`FencePreviewClient.tsx`.

Orbit-drag tracking lives on `window`, not native pointer capture — the
concept artifacts hit a real bug here (canvas reparented by a parent
re-render + pointer capture on the moved node swallowed clicks anywhere
on the page) and this carries the fix forward from day one rather than
reintroducing it.

**Deliberately plain, not polished** (owner instruction 2026-09-07):
no warehouse/site context, no shadows or tone mapping, no Studio/On-site
toggle — that visual work is explicit *beautification*, deferred until
the whole thread is built and seen live on the real `bigblue` tenant.
This phase proves the mechanism (live orbit, live rebuild on every
input), not the final look.

Verified live in-app, not just compiled: switching security profiles
mid-3D-view instantly rebuilt the scene with the new post density
(250→167 posts, visibly sparser spacing), and a click outside the canvas
right after an orbit-drag still registered normally.

## 10. Phase C/D — the §3b checklist, walked explicitly

Per bpmsquarecore §3b, this is the actual task, not optional follow-up.
Applied to `fence_projects` (the primary object; `fence_security_profiles`
and `fence_gates` follow the same shape, abbreviated):

- **DB** — tenant_id + RLS same-migration (§7); `custom_data jsonb`;
  migration numbered next in `supabase/migrations/`, logged in PROJECT.md's
  ledger as pending on both DBs; code degrades on 42P01; demo-seed script
  for the **`is_demo` tenant**, not `bigblue` directly — matches §3b's own
  demo/sample-data convention; `bigblue` gets this once the owner is ready
  to show them the real thing, not while it's still mid-build.
- **Types & registry** — `FenceProject` in `src/lib/types.ts`; `FNC-####`
  in `MASTER_REF_TABLES`; `PilotObjectType` + `PILOT_OBJECT_TYPES` (both,
  not one — §3b names this exact bug from 2026-08-18); `FIELD_REGISTRY`
  entry.
- **Custom fields** — `VALID_OBJECTS`, Settings → Custom Fields tab with
  the fence feature's `featureKey`, PATCH allowlist, `ObjectSections` on
  the detail screen.
- **App CRUD + screens** — `/api/fence-projects` (+ `/[id]`),
  `requireTenantUser()` first, `diffForLog`/`logChange` on every mutation;
  list/detail/create pages; `ROUTES`; nav item with `featureKey` +
  `workcenterKey`; feature flag in `TenantFeatures`, off by default.
- **Data Workbench** — all three modes (import/export/update), matching
  the documented shape exactly (`fetchAllRows` with tenant filter, update
  matches by real `id` never a business key, per §3 of bpmsquarecore).
- **v1 API + MCP** — `LIST_SOURCES` entry, `GET /api/v1/fence-projects`
  (+`/[id]`), feature-flag 404 for tenants without the module,
  `list_fence_projects`/`get_fence_project` in `mcp-server/mcp.json`.
- **Cross-cutting** — Nova timeline/comments (all four wiring points:
  `NovaTimelineSlot`, `api/nova/comments`, `api/nova/inbox`,
  `NovaInbox.tsx`'s `ROUTE_FOR`), global search if reps look fence
  projects up by name/account, ⌘K "New fence project" action.
- **Analytics** — a tile (fence projects won this month, average BOM
  value) once there's enough data to make one meaningful; not blocking
  Phase C/D.
- **Docs** — the Sales Cloud Drive guide gets a fence section once this
  ships to a real (non-demo) tenant, per bpmsquarecore §9.

## 11. Phase F — Won → Ops (explicitly blocked, not built here)

The concept demo's "Won → Work order → Crew → Invoice → AMC" thread
requires two platform capabilities that don't exist for any object today:

1. Real Work Order creation (a `POST /api/work-orders` + UI — currently
   only bulk import creates one) and a generic "record won → create work
   order" trigger.
2. WFM crew/technician scheduling (assign a person to a job on specific
   dates) — WFM today is attendance/leave/hours-attribution only.

Building either as fence-specific work would be scope creep on
capabilities every Service Cloud object needs. **Phase F is: ship Phase
A–E with "Won" as the real finish line**, state that honestly in the
product (no crew-assignment button that does nothing), and open both
platform gaps as their own scoped pieces — outside this spec — when the
owner prioritizes them.

## 12. Phase G — invoice & AMC (reuse, small extension)

Once a fence project is won and (eventually, post-Phase-F) has a work
order: WO→Invoice conversion is real today and already handles
`contract`-sourced (AMC) work orders differently from `quote`-sourced
ones — no new code needed there. The one real extension: `contracts`
(AMC) needs the fence's spec (mesh, coating, length, security profile) in
its own `custom_data` so a future maintenance visit knows what it's
servicing — the `contracts` table doesn't carry line items or service
history today, so this is additive, not a redesign.

## 13. Prove it (bpmsquarecore §3b point 9)

Each phase: `npx tsc --noEmit` and `npx next build` clean before commit.
Phase C's commit message reports the full §10 checklist including every
deliberate skip (Phase F's dependency, Phase G's AMC line-item gap) and
the exact SQL file(s) the owner must run.

---

## 14. Status

- **Phase A — done.** `src/lib/fence/geometry.ts` + `geometry.test.ts` (6
  tests). Wired into a real screen, not just tested headless:
  `src/app/fence-preview/` (outside `(app)`, gated by
  `requireFeature("fence_projects")` — **fixed 2026-09-07**: an earlier
  version bypassed auth entirely via `src/proxy.ts`'s public-path
  allowlist to get past a login redirect while testing, which would have
  made it reachable on any tenant's domain, logged in or not. Caught when
  asked directly whether this was demo-only; it wasn't. Now behaves like
  every other feature-flagged page: no session → redirected to `/login`;
  a session without the flag → redirected to `/`. `features.fence_projects`
  is on for both `demo` and `bigblue` (owner decision 2026-09-07 — bigblue
  gets its own seeded data, not just the flag, so the client sees real
  content rather than an empty screen) — confirmed live in-app, dragging
  length recomputes post count/fabric area/plan view in one frame (UX bar
  §1b criterion 1).
- **Phase B — done.** `src/lib/fence/bom.ts` + `bom.test.ts` (7 tests).
  Wired into the same preview screen (Accessories toggles + a live
  Hardware BOM readout) — flipping barbed wire on produced the correct
  line instantly.
- **Phase C — schema + materials applied and seeded on demo; bigblue
  scripts written, not yet run.** `supabase/migrations/0122_fence_projects.sql`
  (3 tables, RLS + isolation policy each) — **applied to both dev and prod
  DBs**, owner confirmed 2026-09-07; types in `src/lib/types.ts`;
  `FNC-####` in `MASTER_REF_TABLES`; `TenantFeatures.fence_projects`
  (default OFF, `DEFAULT_FEATURES` updated). `src/lib/fence/materials.ts`
  defines the resolution contract (`products.custom_data.fence_kind` +
  `pipe_class`/`mesh_spec`/`coating`) and `buildMaterialRequests` (pure,
  tested — `materials.test.ts`, 4 tests); `resolveFenceMaterials` is the
  DB-touching adapter, not yet called from anywhere.
  `scripts/seed-fence-materials-demo.sql` seeds the **`is_demo`** tenant:
  3 security profiles, 26 tagged `products` rows (PVC coated only — see
  the file header for why), appends `FENCE_PIPES`/`FENCE_FABRIC`/
  `FENCE_HARDWARE` to that tenant's existing `product_categories` without
  clobbering its elevator categories from `seed-products-demo.sql` —
  **run and verified on production 2026-09-07**: 3 security_profiles, 26
  fence_products, flag true, all 8 pre-existing categories preserved plus
  the 3 new ones appended. `scripts/seed-fence-materials-bigblue.sql` /
  `-cleanup.sql` mirror the same content at `slug = 'bigblue'` instead of
  `is_demo`, so Big Blue can see real sample data on their own tenant
  rather than an empty screen (owner decision 2026-09-07 — explicitly
  test data, meant to be removed later, hence the cleanup script); the
  cleanup is surgical (deletes only fence-tagged rows) since bigblue also
  holds the client's real data by the time it runs, unlike
  `seed-bigblue-sample-cleanup.sql`'s whole-sandbox wipe. **Seed run and
  verified on production 2026-09-07/08** for both `demo` and `bigblue`
  (owner decision: keep the flag on for both) — cleanup script written,
  not yet run, deliberately (test data stays until the client engagement
  is done).
- **Phase D — assembly logic written and now wired up.**
  `src/lib/fence/quoteAssembly.ts`'s `assembleFenceStandardQuote()` builds
  the Standard Quote header, prices every line via `priceDocumentLine()`,
  and inserts them through the exact same helpers `/api/standard-quotes`
  uses — refuses outright (not degrade) if any line is unresolved or
  unpriceable. No margin-floor gate (owner decision #4, rides on Sales
  Engine Piece C). Called from `POST /api/fence-projects/[id]/quote`
  (below) — the "Continue to quote" button on a saved project's detail
  screen.
- **Phase E — done.** `src/components/fence/Fence3DView.tsx` (plain
  `three`, new real dependency) + a Plan/3D toggle in
  `FenceConfigurator.tsx`. Deliberately plain, not polished — see §9.
  Verified live (pre-persistence prototype): profile switch mid-3D-view
  rebuilt the scene correctly, no pointer-capture regression on clicks
  elsewhere afterward.
- **Phase F, G — not started** (F is explicitly blocked on platform gaps,
  §11).

## 14a. Fence Projects CRUD + screens (2026-09-08)

The scratch prototype (`src/app/fence-preview/`, outside the app shell,
nothing persisted) is retired. In its place, a real `fence_projects`
object living inside the tenant app:

- **`src/components/fence/FenceConfigurator.tsx`** — the same drag-slider
  configurator UI, now a shared component used in both create and edit
  mode (`project` prop present = edit). Adds an account/contact picker
  (contact list filtered to the chosen account), an editable name field, a
  Save button, and — once saved — a "Continue to quote" button (or a link
  to the quote once one exists). Deliberately kept OUTSIDE the `(app)`
  route group and its `Shell` sidebar chrome (`src/app/fence-projects/new/`,
  `src/app/fence-projects/[id]/`) — the same full-screen treatment the
  owner explicitly praised in Fence Studio ("I like the way it takes full
  screen"); the object's **list** page (`src/app/(app)/fence-projects/`)
  is a normal Shell-wrapped CRM list, matching every other object.
- **Save semantics, stated plainly**: `fence_security_profiles` are a
  shared, tenant-level preset (owner decision #2) — a saved project stores
  *which* profile was picked (`security_profile_id`), not a frozen copy of
  its spacing/embedment/pipe numbers. The configurator's sliders still let
  a rep tune those live for a quick estimate, but Save is disabled while a
  local "custom estimate" profile is active (no Settings screen exists yet
  to author a new real profile) — an explicit, documented v1 limitation,
  not silent data loss. `POST /api/fence-projects/[id]/quote` re-derives
  geometry from the project's own saved inputs plus the profile's
  *current* DB numbers at conversion time.
- **API**: `src/app/api/fence-projects/route.ts` (GET list, POST create —
  `insertWithMasterRef` for the `FNC-####` ref, already registered in
  `masterRef.ts`, then `fence_gates` children referencing the new id, same
  parent+children shape as `purchase_orders`), `[id]/route.ts` (GET/PATCH/
  DELETE — gates PATCH as a full replace-on-save set; DELETE relies on the
  FK's `on delete cascade` for gates), `[id]/quote/route.ts` (POST — the
  Phase D wiring above). `account_id`/`contact_id`/`security_profile_id`
  from the request body are verified tenant-scoped before use, per
  MULTI_TENANT_GUARDRAILS.md.
- **Nav/routes**: `ROUTES.fenceProjects`/`fenceProjectNew`/`fenceProject`,
  a "Fence Projects" entry under Sales & Procurement (next to Standard
  Quotes, since that's what it feeds), a new `fence_projects` workcenter
  key (`src/lib/workcenters.ts`) so Business Roles can grant/deny it like
  any other object.
- **Not yet done, deliberately** (§3b's own checklist -- explicitly
  deferred, not shipped-and-forgotten): custom fields, Data Workbench (all
  three modes), v1 API + MCP, Nova timeline/comments, global search, ⌘K
  palette action, analytics tile/reports metric, the change-history filter
  dropdown entry, and the matching Drive guide update. The object is real
  and usable end-to-end (configure → save → convert to quote) but these
  cross-cutting surfaces haven't been walked yet — do that pass before
  calling the object fully shipped per bpmsquarecore §3b.

## 14b. Two of the three original differentiators (2026-09-08)

Per §0, core parity with Fence Studio's configurator/BOM/costing was
already real by §14a — but the actual reason to build this (not just "we
also have a 3D screen") was three differentiators validated in the concept
walkthroughs (`Fence Configurator Concept` and `Beyond The Takeoff`
Artifacts). Owner decision 2026-09-08: build #1 and #2 now; #3 (Won → Work
Order → crew → Invoice/AMC) stays deferred (blocked on platform Work
Order/WFM-crew gaps that don't exist for any module yet, unrelated to
fence-specific debt) — the thread ends at the Standard Quote for now,
which is also where Phase D's own margin-floor decision already lands (no
bespoke approval gate; rides on Sales Engine Piece C when it exists, owner
decision #4). Nothing further needed there.

**AI-drafted intake** (`src/components/fence/FenceIntake.tsx`,
`src/lib/fence/draft.ts`, `POST /api/fence-projects/draft`) — paste the
client's email, Nova proposes a starting configuration (layout, total
length, which of the tenant's REAL security profiles matches "what's being
protected", and a gate list) before the configurator even opens. Review-
before-use, same as the existing `NovaDraft.tsx`/`/api/nova/draft`
pattern elsewhere in the app, and built by reusing that exact machinery —
**no new LLM plumbing**: `extractRowsFromDocument()`
(`src/lib/import/extract.ts`, the same tool-forced Anthropic-SDK engine
Data Workbench's document import and Nova's paste-to-draft both already
use) fed a hand-built `ObjectSpec` (header: name/layout/total_length_m/
security_profile; line: gate_type/gate_width_m — the same header+lines
shape already used for quote-line extraction). `fence_projects` is
deliberately NOT added to the real `ImportObjectId` union (that would pull
it into `registrySchema.ts`'s `Record<ImportObjectId,...>` maps and
Data Workbench's UI, both still out of scope) — a local `as unknown as
ImportObjectId` cast types the hand-built spec instead, safe because
`extractRowsFromDocument` never branches on `spec.id` at runtime.

One deliberate gating difference from `NovaDraft`: this route checks
`tenantHasFeature(..., "fence_projects")`, **not** `"next_experience"`.
`next_experience` is the Nova-rollout doctrine's "nothing experimental
reaches a client" flag (bpmsquarecore §10 rule 1) — appropriate for Nova's
own still-being-validated surfaces, wrong for a real sold object a tenant
has already been given (gating fence intake behind `next_experience`
would silently hide it from `bigblue`, which almost certainly doesn't have
that flag, defeating the entire point of building this for the client
demo). A tenant with `fence_projects` on has already opted into this
object; that's the correct, narrower gate.

**Side-by-side profile comparison** (`FenceConfigurator.tsx`'s "Compare
against every profile" drawer) — every seeded profile priced against the
SAME layout/length/gates/fabric/mesh/coating/accessories, side by side,
with a "Use this profile" pick button. The "non-destructive" half of this
differentiator was actually already true by construction, not new work:
`profiles` state has always held every profile's own tuned spacing/pipe/
embedment independently (switching `activeId` never touches another
profile's numbers) — Fence Studio's own UI copy admits "switching security
level reloads the template and replaces current edits," which this
never does. What was missing, and is now built, is the presentational
side-by-side view itself.

25/25 tests passing (`npx vitest run src/lib/fence`); `npx tsc --noEmit`
and `npx next build` clean throughout. Not verified live in a browser from
this environment (no login credentials available here, and `ANTHROPIC_API_KEY`
being set is a separate runtime prerequisite for the intake feature
specifically — untested end-to-end) — the owner should click through
paste-intake → draft → configure → save → convert-to-quote on a real
tenant before trusting it fully. `0122_fence_projects.sql` is applied on
both DBs; `seed-fence-materials-demo.sql` and the bigblue equivalent have
both run and are verified on production. Beautification/visual
adjustments remain deferred (owner instruction 2026-09-07) — everything
above is correctness and wiring, not polish.
