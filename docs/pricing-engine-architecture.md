# PricingEngine — Architecture Specification v1.5

**Codename:** PricingEngine (working title — ships under a product name from day one, see §14.4)
**Author:** Abdul Nandalpad / ServiceSphere UG
**Date:** 2026-09-06
**Status:** v1.5 = as-built baseline + Phase 2 build plan (owner decision 2026-09-06: finish it as a product, option C)
**Supersedes:** v1.4 (2026-08-15)

**Changelog v1.4 → v1.5 — baseline the reality, plan Phase 2 against it**
- Owner decision 2026-09-06, after a review of the three coexisting pricing
  layers (Small Scale Pricing, Products list price, the engine): **finish the
  engine as a product** rather than shrink it to one price list or remove it.
- NEW §16: **as-built baseline** — what is in the repo today, what is
  exercised, what is demo-only, the defects and gaps found in the review.
- NEW §17: **Phase 2 build plan** in eight batches, each gated by the
  bpmsquarecore §10 doctrine (build → demo tenant → owner validates → next),
  ordered by the owner's frame from the 2026-08-16/17 sessions: Execution →
  Analysis → Strategy, in-app first, PaaS second.
- NEW §18: **decisions needed** before batch 2, with the defaults the plan
  assumes.
- §11.2 client #3 is promoted from "later, optional" to **the first Phase 2
  deliverable**: the quote line is where the traces that Analysis needs get
  generated, and where the in-house design partner will actually meet the
  engine.
- Scenario 5 from the brainstorm ("one company running all four methods at
  once") is closed by construction: Price Books (`pricing_area`) already
  hold one method each, and batch 2 routes a quote line to a book by
  product category / document type. No further design needed.

**Changelog v1.3 → v1.4 — in-app consumers are a first-class client**
- §11.2 gains **Client #3: BPMSquare in-app modules.** Standard Quotes, service
  orders / FSM work orders, and WFM pay rules will consume the SAME engine as an
  in-process function call (an internal adapter in `src/lib/pricing/`, outside the
  core), per-tenant feature-flagged — never a fork of the calc logic. Design
  consequence enforced NOW: `document_type` (quote, standard_quote, service_order,
  work_order, wfm_ot, …) is a conventional context attribute and an ordinary
  matching dimension, so one tenant can run different rules per in-app document
  family with zero schema change. Small Scale Pricing remains untouched; in-app
  adoption is opt-in per tenant per module.
- Ontology tables ship with **select-only RLS** (writes via service-role routes with
  role checks) — the WFM lesson applied: pricing rules affect money, and a `for all`
  policy would let any tenant member self-grant discounts through PostgREST,
  bypassing the §7 approval workflow.

**Changelog v1.2 → v1.3**
- NEW §15: SaaS delivery & embedding — three surfaces on one engine (headless API,
  hosted cockpit, signed-token iframe widgets), embed-token contract, CSP
  frame-ancestors per tenant, metering/rate-limiting as one mechanism.

**Changelog v1.1 → v1.2 — REPOSITIONED: standalone Pricing-as-a-Service first**
- **BPMSquare quoting is NO LONGER client #1.** Owner decision 2026-08-15: Vikas-class
  tenants don't use dynamic pricing — they keep the existing static rate list, now
  renamed **"Small Scale Pricing"** in Settings (`/settings/pricing`), which stays
  exactly as it is. The engine is a separate product from day one: Pricing-as-a-Service.
- §11.2 rewritten: client #1 = external consumers via `POST /api/v1/price` (scoped
  keys + webhooks) and the engine's own cockpit UI. BPMSquare quoting becomes an
  *optional, feature-flagged* client later, for larger tenants that outgrow Small
  Scale Pricing — never a forced migration.
- Phase 1 exit criterion #2 (Vikas cost-up through a real BPMSquare quote) replaced:
  the cost-up case is proven through the engine's own API/cockpit with Vikas-shaped
  *sample* data — no live-tenant coupling, no shadow-mode migration needed.
- §3 amendment: cost inputs are resolved by **effective date only** (pricing_date
  within valid_from/to); the ConfigVersion snapshot pins model *structure* (paths,
  kinds), not rates. Replay stays honest because the trace records exact input
  values + validity used.
- §7 amendment: stored pricing contexts are tenant-RLS'd, excluded from any
  cross-tenant analytics, and purged by a tracked retention job (same posture as
  WFM selfie retention).
- §5 amendment: both entry modes expose a `TOTAL_COST` subtotal convention so
  margin-floor guard formulas are mode-independent.

**Changelog v1.0 → v1.1**
- NEW §3: **CostModel** promoted to first-class citizen (cost-up pricing; Vikas copper/salvage case)
- §2.2: waterfall supports two entry modes — `LIST_PRICE` (list-down) or `COST_BUILDUP` (cost-up)
- §5: DSL grammar frozen and versioned (`dsl_version`); custom Pratt parser **decided** (was open §13.2)
- §7: simulation storage **decided** — store full pricing contexts (was open §13.3)
- §11/§12 rewritten: **monolith-first** — engine as pure TS package inside BPMSquare repo; NestJS/Redis/BullMQ moved to a measured Phase-3 extraction milestone
- §11.3: module boundary CI-enforced via lint rule / workspace package
- §13: Phase 1 exit criteria now include the Vikas cost-up case; Redis trigger is a latency measurement, not an org event
- §14: BTP/CAP consciously decided "no for now"; vertical dilemma dissolved (field service = design partner in production)

**Positioning:** AI-native, multi-tenant, client-agnostic pricing *engine*, initially deployed inside BPMSquare, exposed to the world via API. Deterministic calculation core with an AI authoring/advisory layer. Differentiators vs. SAP condition technique and Pricefx: (1) schema-free attribute-based rule matching, (2) first-class cost-up **and** list-down pricing in one ontology, (3) Git-style versioned config with pre-publish simulation replay, (4) natural-language rule authoring with human approval, (5) same-day self-service onboarding.

---

## 1. Design Principles

1. **Deterministic core, advisory AI.** The calculation engine is 100% rule-based, reproducible, explainable. AI proposes rules, prices, and mappings — it never sets a final price. (Flag/propose, never decide — the BPMSquare WFM philosophy.)
2. **Everything is configuration, nothing is code.** No tenant-specific code paths. All pricing logic is data: components, cost models, rules, scales, formulas in a sandboxed DSL.
3. **Explainability is an output, not a log.** Every price returns a full waterfall trace including steps that did *not* apply and why.
4. **Versioned like software.** Draft → diff → simulate → approve → publish. Published versions are immutable and replayable.
5. **Schema-free matching.** Tenants define their own dimension attributes. No fixed condition tables, no migrations to add a dimension.
6. **Client-agnostic in code, pragmatic in deployment.** The core is a pure TypeScript package with zero framework/persistence imports — the platform boundary is honored at the *module* level now, at the *service* level later. Extraction is a repackaging exercise, never a rewrite.
7. **Audit-first.** Append-only logging for config changes, approvals, and every priced document. EU AI Act-ready logging for all AI proposals (input hash, model id, output, human approver, timestamp).

---

## 2. Core Ontology — Price Side

### 2.1 PriceComponent
The atomic unit. Generalization of an SAP condition type (KSCHL).

| Field | Type | Notes |
|---|---|---|
| `component_id` | uuid | |
| `tenant_id` | uuid | |
| `code` | string | e.g. `LIST_PRICE`, `COST_BUILDUP`, `CUST_DISC`, `FREIGHT`, `SURGE`, `MARGIN_MARKUP` |
| `name` | string | Display name |
| `class` | enum | `PRICE`, `COST_BUILDUP`, `MARKUP`, `DISCOUNT`, `SURCHARGE`, `FREIGHT`, `TAX`, `REBATE_ACCRUAL`, `STATISTICAL` |
| `calc_type` | enum | `FIXED_AMOUNT`, `PERCENT`, `PER_UNIT`, `SCALE_TIERED`, `SCALE_GRADUATED`, `FORMULA`, `COST_ROLLUP` |
| `calc_basis` | enum | `GROSS`, `NET_SO_FAR`, `QUANTITY`, `WEIGHT`, `SUBTOTAL_REF`, `COST_REF`, `CUSTOM_METRIC` |
| `sign` | enum | `POSITIVE`, `NEGATIVE`, `BOTH` |
| `rounding_rule` | jsonb | precision, mode (half-up, commercial), charm rules (end-in-99/-95) |
| `currency_behavior` | enum | `DOCUMENT`, `FIXED`, `CONVERTED` |
| `manual_override` | enum | `FORBIDDEN`, `ALLOWED_WITH_REASON`, `FREE` |
| `is_statistical` | bool | Shown in trace, not added to net (cost lines, margin, AI suggestions) |

### 2.2 PricingProcedure (waterfall) — two entry modes

Ordered list of steps. Generalization of SAP Kalkulationsschema, extended with a cost-up entry mode.

**Mode A — list-down (distribution/SaaS):**
```json
{
  "procedure_id": "uuid",
  "version": 14,
  "entry_mode": "LIST_DOWN",
  "steps": [
    {"step": 10,  "component": "LIST_PRICE",  "required": true},
    {"step": 20,  "component": "CUST_DISC",   "requirement": "dsl:ctx.customer.tier != null"},
    {"step": 30,  "component": "PROMO_DISC",  "exclusion_group": "DISCOUNTS_BEST_OF"},
    {"step": 40,  "component": "VOLUME_DISC", "exclusion_group": "DISCOUNTS_BEST_OF"},
    {"step": 50,  "subtotal": "NET_1"},
    {"step": 60,  "component": "SURGE",       "calc_basis_ref": "NET_1"},
    {"step": 70,  "component": "FREIGHT"},
    {"step": 80,  "subtotal": "NET_2"},
    {"step": 90,  "component": "TAX",         "calc_basis_ref": "NET_2"},
    {"step": 100, "subtotal": "FINAL"},
    {"step": 110, "component": "COST",        "statistical": true},
    {"step": 120, "component": "MARGIN",      "statistical": true, "formula": "subtotal('NET_2') - lookup('COST')"}
  ]
}
```

**Mode B — cost-up (field service / job costing / manufacturing quote):**
```json
{
  "procedure_id": "uuid",
  "version": 3,
  "entry_mode": "COST_UP",
  "steps": [
    {"step": 10, "component": "MATERIAL_COST",  "calc_type": "COST_ROLLUP", "cost_model": "COPPER_WORKS"},
    {"step": 20, "component": "LABOUR_COST",    "calc_type": "COST_ROLLUP", "cost_model": "COPPER_WORKS"},
    {"step": 30, "component": "SALVAGE_CREDIT", "calc_type": "COST_ROLLUP", "cost_model": "COPPER_WORKS", "sign": "NEGATIVE"},
    {"step": 40, "subtotal": "TOTAL_COST"},
    {"step": 50, "component": "MARGIN_MARKUP",  "calc_basis_ref": "TOTAL_COST"},
    {"step": 60, "subtotal": "NET_1"},
    {"step": 70, "component": "CUST_DISC"},
    {"step": 80, "subtotal": "NET_2"},
    {"step": 90, "component": "TAX", "calc_basis_ref": "NET_2"},
    {"step": 100, "subtotal": "FINAL"}
  ]
}
```

Shared features across modes: subtotal references, requirement conditions (DSL), exclusion groups (best-of / worst-of / first-match), statistical lines, step-level basis overrides, header-level components with configurable proration basis (net value / quantity / weight).

`entry_mode` is informational (drives UI templates and validation hints); the step model is identical — one engine, two idioms.

### 2.3 PriceRule (condition record, generalized)

| Field | Type | Notes |
|---|---|---|
| `rule_id` | uuid | |
| `component_code` | string | FK to PriceComponent |
| `match_attributes` | jsonb | e.g. `{"customer_tier":"A","region":"DACH","product_group":"SEALS"}` |
| `specificity` | int | Computed via DimensionRegistry weights (§4) |
| `value` | numeric / jsonb | Amount, percent, or scale table |
| `scale` | jsonb | `[{"from":0,"value":100},{"from":1000,"value":92}]` + `scale_basis` |
| `formula` | string | Optional DSL expression (§5) |
| `currency` / `uom` | string | |
| `valid_from` / `valid_to` | date | |
| `config_version` | int | Version this rule belongs to |
| `origin` | enum | `MANUAL`, `IMPORT`, `AI_PROPOSED_APPROVED` |

**Storage:** Postgres (Supabase), `match_attributes` JSONB with GIN index, standard tenant RLS per BPMSquare guardrails.

---

## 3. Core Ontology — Cost Side (NEW in v1.1)

Cost-up pricing is not a statistical afterthought; it is a first-class model. The Vikas case (copper by weight, labour, salvage deduction, then margin) is the canonical example, and BUG-009 (missing copper salvage deduction) is the empirical proof that cost inputs need their own lifecycle.

### 3.1 CostModel

A named, versioned, effective-dated set of cost inputs a tenant maintains independently of price rules.

| Field | Type | Notes |
|---|---|---|
| `cost_model_id` | uuid | |
| `tenant_id` | uuid | |
| `code` | string | e.g. `COPPER_WORKS`, `ELECTRO_STANDARD` |
| `name` | string | |
| `config_version` | int | Versioned with the rest of the config |

### 3.2 CostInput

| Field | Type | Notes |
|---|---|---|
| `input_id` | uuid | |
| `cost_model_code` | string | FK |
| `path` | string | Dot path exposed to DSL, e.g. `material.copper_per_kg`, `labour.electrician_hr`, `salvage.copper_credit_per_kg` |
| `kind` | enum | `MATERIAL`, `LABOUR`, `EQUIPMENT`, `SALVAGE_CREDIT`, `OVERHEAD`, `INDEX` |
| `value` | numeric | |
| `uom` | string | kg, hr, LSM, ton, piece |
| `currency` | string | |
| `valid_from` / `valid_to` | date | Own effective-dating — rates change without touching price rules |
| `source` | enum | `MANUAL`, `IMPORT`, `API_FEED` |

### 3.3 Access from DSL and rollup

- Formulas reference inputs as `ctx.cost.<path>`, resolved for the pricing date:
  `ctx.cost.material.copper_per_kg * ctx.line.weight_kg`
- `COST_ROLLUP` calc_type sums the line's cost items of a given `kind` against the CostModel (quantities come from the document line's `cost_items[]`), so simple cases need no formula at all.
- Salvage credits are ordinary CostInputs with `kind: SALVAGE_CREDIT` and appear as negative rollup lines — visible in the trace, impossible to silently forget (fixes the BUG-009 class of defect structurally).
- CostInputs have their **own import path** (CSV/Excel and API feed) so a tenant can update copper rates weekly without touching pricing config or triggering a full version cycle. Rate updates are logged in the same append-only audit stream. (Whether a rate update requires approval is per-tenant policy: `cost_update_policy: DIRECT | DRAFT_APPROVE`.)
- Index inputs (`kind: INDEX`) carry escalation indices for formula components (see §5 example) — DACH manufacturing escalation clauses land here.

---

## 4. Rule Resolution (Generalized Access Sequence)

1. Tenant defines a **DimensionRegistry**: attributes usable in matching, each with a **specificity weight** (`customer_id: 100`, `product_id: 80`, `customer_tier: 30`, `product_group: 25`, `region: 20`).
2. At pricing time the context is flattened to a key-value map.
3. Candidate rules per component: `match_attributes <@ context` (JSONB containment) AND validity covers the pricing date AND rule belongs to the resolved config version.
4. Winner = highest specificity; tie-break by most recent `valid_from`, then latest `created_at`. Remaining ties → hard `AMBIGUOUS_RULE` error, surfaced in simulation — never silently resolved.
5. Per-component `resolution_strategy`: `MOST_SPECIFIC` (default), `BEST_FOR_CUSTOMER`, `ALL_APPLY` (stacking surcharges).

SAP-grade determinism, zero condition-table maintenance: a new dimension is one registry row — no migration, no consultant.

---

## 5. Formula DSL (sandboxed, grammar-versioned)

**Decided (was v1.0 §13.2): custom Pratt parser to a closed AST.** The grammar is small; owning the parser means owning the evaluation budget completely, and it is testable in the same style as the existing `query.ts` discipline (closed AST, no `eval`, no Groovy, ever).

**Grammar (v1 — frozen):**
- Literals, arithmetic (`+ - * / %`), comparison, boolean logic, ternary
- Functions: `min`, `max`, `round`, `clamp`, `abs`
- Accessors: `ctx.<path>` (document/line/customer/contract/policy), `ctx.cost.<path>` (§3.3)
- Engine hooks: `lookup(component)`, `subtotal(ref)`, `scale(table, basis)`
- Date helpers: `daysBetween`, `pricingDate()`
- Bounded `map`/`sum` over `ctx.line.cost_items` only (no general loops)
- Hard limits: max ops, max AST depth, max string length; deterministic evaluation, no I/O

**Grammar versioning (`dsl_version`):** stored formulas are data with unbounded lifetime — every published ConfigVersion embeds them. Therefore each ConfigVersion carries a `dsl_version` (int, starts at 1). The engine ships evaluators for all historical grammar versions; grammar changes are additive where possible, and a breaking change requires a new `dsl_version` plus an explicit migration tool. One column now; prevents a data-migration nightmare when tenant #2 exists.

Examples:
```
# Cost-up copper line (Vikas)
ctx.cost.material.copper_per_kg * ctx.line.weight_kg
  - ctx.cost.salvage.copper_credit_per_kg * ctx.line.salvage_weight_kg

# Index-based escalation (DACH manufacturing)
lookup('LIST_PRICE') * (ctx.cost.index.steel_q / ctx.contract.steel_base_index)

# Margin floor guard (statistical → flags approval workflow)
subtotal('NET_2') - subtotal('TOTAL_COST') < ctx.policy.min_margin_abs
```

---

## 6. Calculation Core

**Pure, stateless TypeScript library.** Input: `PricingContext` (tenant, config_version or `latest_published`, document header, lines with optional `cost_items[]`, pricing_date, currency). Output: priced document + trace. No Supabase, Next.js, or framework imports (§11.3). Persistence adapters live outside the core and hand it plain data.

Pipeline per line: resolve rules per procedure step → evaluate requirement conditions → compute values (rollups / scales / formulas) → apply exclusion groups → accumulate subtotals → rounding → currency conversion (rate snapshot per document) → header components with proration.

**Trace object (always returned):**
```json
{
  "line": 10,
  "steps": [
    {
      "step": 30, "component": "SALVAGE_CREDIT", "status": "APPLIED",
      "cost_model": "COPPER_WORKS",
      "inputs": [{"path": "salvage.copper_credit_per_kg", "value": 610, "valid_from": "2026-08-01"}],
      "basis": 12.4, "result": -7564.00
    },
    {
      "step": 70, "component": "CUST_DISC", "status": "EXCLUDED",
      "reason": "no matching rule (3 candidates failed validity window)"
    }
  ]
}
```

The trace renders as the interactive waterfall UI — the "why is my price X" answer SAP buries in condition analysis. Cost-rollup steps show the exact rates and validity dates used.

Performance target: p95 < 50 ms single-line, < 300 ms for 100 lines — **achieved with per-request Postgres fetches** (GIN over a few thousand rules is single-digit ms). No Redis in Phases 1–2 (see §12); serverless guardrails prohibit module-level caches.

---

## 7. Versioning, Simulation, Governance

- **ConfigVersion**: immutable snapshot of procedures + components + rules + cost models (+ `dsl_version`). States: `DRAFT` → `IN_SIMULATION` → `PENDING_APPROVAL` → `PUBLISHED` → `SUPERSEDED`. One `PUBLISHED` per tenant per pricing area; history queryable for replay/audit. Effective-dated publishing (future `valid_from`, scheduler activates).
- **Diff view**: rule-level and cost-input-level diff between any two versions — a PR review for pricing.
- **Simulation service**: replay a draft against stored pricing contexts. **Decided (was v1.0 §13.3): full pricing contexts are persisted** as JSONB with a per-tenant retention window (default 180 days). Reconstruction from source documents is rejected — it would couple the engine to every client's data model, the exact disease this engine cures. Output: revenue delta, margin delta, affected-customer distribution, dead rules, `AMBIGUOUS_RULE` hits, margin-floor crossings.
- **Approval**: configurable approvers per pricing area; 4-eyes mandatory when a version contains any `AI_PROPOSED` rule.
- **Margin-floor guardrail — implemented as display-only, on purpose (2026-08-23, Pricing workcenter wizard):** the cost-based method's Setup wizard lets a tenant set a minimum acceptable margin %, and the Sample bill computes the actual margin and flags a breach in red. It does **not** block Go live, and no breach is routed to anyone. That's a deliberate scoping call, not an oversight: routing a margin breach to an approver needs the approval workflow this section already lists under Phase 2 — no state machine, no approver config, no notification path for it exists yet. Faking a hard block (or a routed approval with nothing behind it) would be enforcement the platform can't actually back up, which is worse than an honest warning. When Phase 2's approval workflow ships, this guardrail is the first thing that should wire into it — the same statistical-component pattern generalizes to any config version whose Sample bill / simulation crosses a floor, not just the wizard's cost-based method.

---

## 8. AI Layer (advisory only)

| Capability | Flow | Guardrail |
|---|---|---|
| **NL rule authoring** | "Tier-A customers get extra 3% on orders above €50k until Q4" → LLM compiles to rule JSON + DSL → back-translation shown in plain language → user edits/approves → DRAFT | Schema + DSL sandbox validation before display; origin `AI_PROPOSED`; mandatory human approval; prompt/response logged. Implementation reuses the existing `/ask` compile-to-validated-structure pattern verbatim. |
| **Onboarding mapper** | Upload Excel/CSV price lists or cost sheets → LLM maps columns to ontology (PriceRules *and* CostInputs), infers DimensionRegistry, drafts starter procedure | Preview + row-level validation report; nothing published automatically |
| **Anomaly detection** | Scheduled job scans priced documents: margin outliers, discount stacking, dead rules, expiring rules without successor, stale cost rates (e.g. copper rate unchanged > N days) | Flags only; digest to pricing owner |
| **Price suggestion** | Win/loss + elasticity model (start: logistic regression on quote outcomes) suggests target bands per segment | Rendered as statistical trace component; never auto-applied |
| **Quote drafting** | Ticket/opportunity description → proposed line items incl. cost_items → priced via the normal engine | Human review before send (Schnellschätzung → Verbindliches Angebot pattern) |

Model: Claude Sonnet via API. AI artifacts stored with input hash, model id, output, approver, decision — the EnterprisesHub EU AI Act audit-log pattern reused.

---

## 9. B2B Contract Layer (Phase 3)

- **Agreements**: customer-scoped rule bundles with commitments (min volume/value, prepaid credits, caps).
- **Rebates**: `REBATE_ACCRUAL` statistical components accrue into an event-sourced, append-only ledger (correction-by-reversal — the WFM append-only model). Period-end settlement job emits credit-note proposals.
- **Credits**: prepaid balance ledger; consumption at pricing or billing confirmation (configurable).
- **Escalation clauses**: `INDEX` CostInputs (§3.2) + formula components.

---

## 10. Multi-Tenancy & Onboarding

- **Isolation**: `tenant_id` on every row + Supabase RLS per the existing guardrails; dedicated-schema escape hatch for enterprise tenants later.
- **Onboarding flow (target: same day)**:
  1. Create tenant → pick vertical template — **Field Service (cost-up)**, Manufacturing/Distribution (list-down), SaaS/Usage, Retail — each ships a starter procedure, components, and (where relevant) a CostModel skeleton.
  2. Upload price lists / cost sheets → AI mapper → validation report → import as v1 DRAFT.
  3. Simulate against sample or synthetic documents → publish.
  4. Integrate: REST quote API (scoped API keys) or batch.
- **Usage metering** (SaaS-style tenants): `CUSTOM_METRIC` basis fed by a usage-events endpoint with idempotency keys; graduated/tiered scales handle slab and pack pricing (₹149/₹499/₹999-style packs, token/call metering).

---

## 11. Architecture & Stack (rewritten in v1.1)

### 11.1 Monolith-first, boundary-at-the-module

The engine is built **inside the BPMSquare repo** as a pure TypeScript workspace package (`packages/pricing-core/` or `src/lib/pricing/`). Client-agnosticism is honored at the module boundary now and at the service boundary later. Everything in this spec except a cache layer is already solved in the BPMSquare stack:

| Concern | v1.1 solution (existing stack) | v1.0 proposal (rejected for now) |
|---|---|---|
| DB / matching / RLS | Supabase Postgres 16, JSONB + GIN, tenant RLS | Separate Postgres cluster |
| Calc core | Pure TS package, zero framework imports | NestJS service |
| Jobs (simulation, anomalies, settlement) | Vercel cron + webhooks-dispatcher pattern | BullMQ + Redis |
| Auth (external API) | Scoped API keys (shipped) + user JWT for UI | OAuth2 client-credentials |
| Webhooks | Shipped this week | New build |
| AI authoring | `/ask` compile-to-validated-structure pattern | New build |
| Audit | `change_log` append-only stream | New build |
| Cache | None — per-request fetch (see §12 trigger) | Redis |

### 11.2 Clients, one engine (repositioned in v1.2)

- **Client #1 (Phase 1): the world.** `POST /api/v1/price` behind scoped keys + webhooks, plus the engine's own cockpit UI (rule editor, cost-model editor, trace viewer). This IS the product: Pricing-as-a-Service. Same deployment, no second platform.
- **BPMSquare quoting is NOT a client for now.** Vikas-class tenants keep the static rate list ("Small Scale Pricing", `/settings/pricing`) — simple, rigid, exactly what that size needs. Untouched.
- **Client #2 (later, optional):** a feature-flagged integration where a larger BPMSquare tenant's quoting calls `price()` instead of static rates. Opt-in per tenant, never a forced migration of Small Scale Pricing users.
- **Client #3 (v1.4): BPMSquare in-app modules.** Standard Quotes, service orders / FSM work orders, and WFM pay computations consume the same engine via an in-process adapter (`src/lib/pricing/`, outside the core) — no HTTP hop, no logic fork. `document_type` is an ordinary matching dimension, so per-module rules (e.g. a surcharge only on `service_order`, an OT rate table only on `wfm_ot`) are tenant configuration, not code. Each module's adoption is its own feature flag.

### 11.3 CI-enforced boundary

"Pure TS, no Supabase imports" erodes under deadline pressure. The boundary is enforced mechanically:
- `pricing-core` is a workspace package whose `package.json` has an **empty runtime dependency list**, and
- ESLint `no-restricted-imports` blocks `@supabase/*`, `next/*`, and app-internal paths inside the package, failing CI on violation.

One convenient import must break the build, not the platform thesis.

### 11.4 UI

Next.js + Tailwind (existing app): waterfall trace viewer, rule editor, cost-model editor, version diff, simulation report. These live in the app layer and are *not* part of the portable core.

---

## 12. Extraction Milestone (formerly "the stack")

NestJS / Redis / dedicated infra is not a phase on the calendar — it is a **measured trigger**:

- **Redis / caching trigger:** p95 on `/api/v1/price` exceeds target under real load, or a tenant's hot rule set no longer fits a sane per-request fetch. This could be Vikas at scale or tenant #5 — it is a latency measurement, not an organizational event.
- **Service-extraction trigger:** a signed external design partner whose compliance, isolation, or SLA needs cannot be met inside the monolith (dedicated deploy, data residency, uptime contract).

When triggered: `pricing-core` moves out as-is (the empty-dependency package is the whole point), gets a thin NestJS or plain-Node HTTP shell, its own Postgres if isolation demands it, and OAuth2 client-credentials on the external surface. The simulation UI and trace cockpit stay in the app; only the engine travels.

---

## 13. Build Phases

**Phase 1 — Deterministic MVP (6–8 weeks, reduced from v1.0 by reusing the stack)**
Ontology incl. CostModel (§2–3), rule resolution (§4), DSL parser + `dsl_version` (§5), calc core + trace (§6), cockpit UI (procedures, rules, cost models, trace viewer), `POST /api/v1/price` behind scoped keys, tiered/graduated scales, currency + rounding, CI boundary rule (§11.3). **No coupling to BPMSquare quoting** (v1.2 repositioning — Small Scale Pricing stays as-is).

**Exit criteria (both must pass, via the engine's own API/cockpit):**
1. **SAP-style waterfall:** list price → three discount types with exclusion group → freight → tax → margin, correct trace including EXCLUDED reasons.
2. **Field-service cost-up case (Vikas-shaped sample data):** copper by weight with weekly-updatable rates, labour, **salvage deduction visible as negative trace line** (BUG-009 class structurally impossible), margin markup on total cost — end-to-end through `POST /api/v1/price`.

**Phase 2 — Governance + AI authoring (6–8 weeks) — the moat**
ConfigVersions + diff, pricing-context persistence + simulation replay, approval workflow (4-eyes for AI rules), NL rule authoring via `/ask` pattern, onboarding mapper, anomaly digest, external `POST /api/v1/price` behind scoped keys + webhooks.

**Phase 3 — Enterprise (8–12 weeks, demand-driven)**
Rebates/credits ledger, agreements, index escalation feeds, usage metering, vertical templates, SSO (Azure AD — reuse EnterprisesHub), dedicated-schema tenancy, and — only if triggered per §12 — extraction + Redis.

**Explicit non-goals v1:** tax determination engines (integrate, don't build), billing/invoicing (Stripe/Razorpay), CPQ document generation (ServiceSphere quoting consumes the API instead).

---

## 14. Decisions Log (formerly Open Decisions)

| # | Question (v1.0) | Decision (v1.1) |
|---|---|---|
| 1 | CAP vs. plain NestJS | **Neither, consciously.** Pure TS in the BPMSquare repo now. If an enterprise BTP deal demands it, the pure core ports to CAP Node — scoped as "engine on BTP, cockpit stays where it is." Simulation replay and trace UI do **not** port for free; that cost is accepted and flagged. |
| 2 | CEL vs. custom DSL parser | **Custom Pratt parser**, closed AST, owned evaluation budget, grammar versioned via `dsl_version` (§5). |
| 3 | Simulation storage | **Store full pricing contexts** (JSONB, per-tenant retention, default 180 days). Reconstruction coupling rejected (§7). |
| 4 | First vertical | **Dissolved, not chosen.** Field service is the design partner already in production (BPMSquare/Vikas = Phase-1 exit criterion). Manufacturing-distribution / SAP-displacement is a go-to-market decision deferred until the Phase-2 moat exists. |
| 5 | Entity & name | Entity: open (ServiceSphere UG vs. new entity — tax/liability question, decide before first external contract). **Product name: required from day one** even while living in the BPMSquare repo — the API surface (`/api/v1/price`) and trace UI are what a future standalone customer sees; neither reveals where it is deployed. |

---

## 15. SaaS Delivery & Embedding (NEW in v1.3)

### 15.1 Three surfaces, one engine

1. **Headless API** — `POST /api/v1/price` (+ rules/versions/simulate CRUD). Auth:
   scoped API keys (`objects: ["pricing"]`, read = price calls, write = config).
   Webhooks (`version.published`, `simulation.completed`, `anomaly.flagged`) ride
   the existing dispatcher.
2. **Hosted cockpit** — rule editor, cost-model editor, version diff, simulation
   reports, trace explorer. A pricing-only tenant is an ordinary tenant whose
   feature flags enable only the pricing workcenters, living on the product's own
   domain (one `custom_domain` row; `proxy.ts` hostname resolution unchanged).
3. **Embedded widgets** — purpose-built `/embed/*` routes, signed-token iframes
   (Stripe/Metabase pattern). Never "iframe the app".

### 15.2 Embed views (v1)

- `/embed/trace/:documentId` — read-only interactive waterfall for one priced document.
- `/embed/simulator` — live "what would this cost" widget calling `price()`.
- `/embed/rules/:componentCode` — (later, write-scoped) mini rule editor for partner portals.

### 15.3 Embed-token contract

```
POST /api/v1/embed-tokens        (auth: tenant API key, server-side only)
  body: { view: "trace"|"simulator", resource_id?, ttl_seconds?: <=900, theme?: {...} }
  → { token }                     short-lived JWT bound to tenant + view + resource
```

- The API key never reaches a browser; only the single-resource, short-TTL token does.
- `/embed/*` joins the middleware public-path list exactly like the signed quote-PDF
  links (token IS the auth, verified in the route, `$`-anchored patterns).
- Per-tenant `frame-ancestors` allowlist (registered embed domains in tenant config);
  embed responses emit their own CSP. postMessage bridge (`price_changed`, `resize`,
  `line_clicked`) pinned to the registered origin.
- Theming via token claims (accent, light/dark, locale).
- A JS SDK later wraps the same iframe (DX sugar); raw component library only on demand.

### 15.4 Metering & rate limiting (one mechanism)

Every `price()` call logs `(tenant, key_id, calls, lines, calc_ms)` to a usage table:
simultaneously the billing meter (call/line-based plans — slab pricing priced by the
engine itself) and the per-key rate limiter (fixed-window counter). Ships in Phase 1;
the current v1 API's lack of its own rate limiting is acceptable for CRM keys but not
for a public metered endpoint.

### 15.5 Plans & entitlements

`tenants.plan` gates simulation retention days, embed-domain count, AI-authoring
quota, and call allowances. Enforcement server-side at the same guard that resolves
the key.

---

## 16. As-built baseline (2026-09-06 review)

Read this before touching any pricing code. It is what exists, not what was
planned. Commits: `6de1865` through `7f3056c` (2026-08-15 to 2026-08-25).
Nothing pricing-related has changed since.

### 16.1 Three ways to price a line today

| Layer | Storage | Consumers | Who has it |
|---|---|---|---|
| **Small Scale Pricing** (`/settings/pricing`) | `pricing_items`: category (labour/material/testing/transport), description, unit, rate. No conditions, no validity. | Quote form catalogue picker; work-order → invoice labour line (`api/work-orders/[id]/invoice` takes the first labour item's rate). | Every tenant with quotations. Vikas uses it. |
| **Products** (`/products`) | `products.list_price`, `cost_price`, `tax_percent`, category, sub-category. | Quote form catalogue picker (copies the price onto the line, keeps `product_id` as a link). | Every tenant with the products flag. |
| **PricingEngine** | Ontology tables 0083 (`pricing_config_versions`, `_dimensions`, `_components`, `_procedures`, `_rules`, `_cost_models`, `_cost_inputs`), metering 0084 (`pricing_usage`). | `POST /api/v1/price` (bearer key, `pricing` scope); Pricing workcenter (Today's rates / Setup wizard / History / Advanced cockpit); `POST /api/quotes/price-line` behind `pricing_engine` **and** `pricing_engine_quotes`. | `pricing_engine` on for the demo tenant only (0085). Demo has one DRAFT (cost-based template, zero rules), nothing PUBLISHED. No tenant has ever gone live. |

The three do not know about each other. A rep on the quote form sees
pricing items and products side by side in one catalogue, plus a "Price
with engine" button that works only on product lines, only against the
"default" book, and only after someone has published.

### 16.2 What is built and exercised

- **Core** (`src/lib/pricing-core/`, 1,700 lines): waterfall executor with
  full trace, rule resolution (most-specific-wins, BEST_FOR_CUSTOMER,
  ALL_APPLY, AMBIGUOUS_RULE as a hard error), tiered/graduated scales,
  cost rollup with effective-dated inputs and AMBIGUOUS_COST_INPUT, formula
  DSL (Pratt parser, closed AST, op/depth limits), manual overrides gated by
  `manual_override`, rounding. 44 tests, both Phase 1 exit criteria green,
  boundary test enforces no framework imports. **This part is solid.**
- **Persistence adapter** (`src/lib/pricing/server.ts`): loads a PUBLISHED
  or named version per area, runs `priceDocument`, meters into
  `pricing_usage` best-effort.
- **Config API** (`api/settings/pricing-engine/{config,versions,areas,test-price}`):
  one mutation route for six entity kinds; versions list/create/clone;
  publish with a validation report; discard a draft; test-price any version
  including drafts. Workcenter view/edit/delete grants enforced.
- **Workcenter** (`/pricing`, ~2,300 lines): Price Book picker, "unsaved
  changes / Go live / Discard" invisible versioning, four method templates
  (cost-based, price list, value-based, variant) with rate tables
  conditioned on template dimensions, a Sample bill with a display-only
  margin floor, History with an as-of-date view, and the Advanced cockpit
  with guided forms and a Test & Trace tab.
- **External API**: `POST /api/v1/price` with `trace: full|summary|none`,
  `pricing_date`, `config_version`, `pricing_area`, `procedure`, `currency`.
  Structured 422s for every config problem.

### 16.3 What the spec promised and is NOT built

Phase 2 in full: pricing-context persistence, simulation replay, version
diff, approval workflow (PENDING_APPROVAL and IN_SIMULATION exist only as
CHECK-constraint values), NL rule authoring, onboarding mapper, anomaly
digest, per-key rate limiting, webhook events for pricing, embed tokens and
`/embed/*`, plans/entitlements, a product name. Phase 3 entirely.

### 16.4 Defects and gaps found in the review

1. **No stored pricing contexts.** Every `price()` result is thrown away
   after the response. Simulation, analysis, "show the customer why" on a
   sent quote, and replay are all impossible until this exists. Blocks
   everything else in Phase 2.
2. **Quote-line integration is hard-wired.** `api/quotes/price-line`
   maps `account.type → customer.tier`, `account.state → region`,
   `account.industry → industry`, `product.category/sub_category/name`
   in code. A tenant cannot say "my tier is the custom field `cf_grade`".
   Only the `default` book; no per-line book routing; the product's own
   `list_price` never reaches the engine, so a Price-list book has to
   re-key every price the catalogue already holds.
3. **Cost inputs have no uniqueness.** `pricing_cost_inputs` has no unique
   index on (tenant, model, path, valid_from); the config route inserts
   rather than upserts; the wizard had to grow `missingCostInputMutations`
   to avoid duplicates that trip AMBIGUOUS_COST_INPUT.
4. **Publish is not atomic and emits nothing.** Two updates (supersede,
   then publish); a failure between them leaves no live version. No
   webhook event, no notification.
5. **Metering has no key.** `pricing_usage` lacks `api_key_id`, so per-key
   rate limiting (§15.4) cannot be computed from it.
6. **Currency is ₹ in the UI.** Formatting is hard-coded in the wizard
   and cockpit; the engine itself is currency-agnostic.
7. **History and Today's rates only understand wizard templates.** A
   version built in Advanced renders as "set up in Advanced".
8. **Dimensions are tenant-wide, not per book.** Acceptable (they are a
   vocabulary), but the wizard's `templateMutations` re-upserts weights on
   every resume, so two books with different weights for the same attribute
   fight each other silently.
9. **Test coverage stops at the core.** No route tests; the wizard's
   sync-on-resume logic (which has already had two zero-price bugs) is
   untested.
10. **Standard Quotes, work orders and WFM** (§11.2 client #3) have no
    engine hook at all; work-order invoicing still reads `pricing_items`.

---

## 17. Phase 2 build plan (v1.5)

**Doctrine:** one batch → demo tenant → owner validates → next
(bpmsquarecore §10). Every batch ends with `tsc`, `next build`, tests,
a security pass on anything that writes, and the migration listed as
pending in PROJECT.md's ledger. Sizes are rough: S ≈ 1–2 days, M ≈ 3–5,
L ≈ a week or more of build time before validation.

**Order rationale (owner's frame, 2026-08-16/17):** Execution → Analysis
→ Strategy. Execution (quote lines priced in-app) generates the stored
contexts Analysis needs; Analysis feeds Strategy (AI advisory). Governance
sits between Execution and Analysis because overrides on real quotes are
the first thing that needs approving. PaaS surfaces come last: they are
packaging, and they package what the first six batches produce.

### Batch 1 — Pricing contexts: store every price, replay any price (M)

The foundation. Nothing downstream works without it.

- Migration `pricing_documents`: tenant, area, config_version, procedure,
  pricing_date, `source` (`api` | `quote` | `standard_quote` | `work_order`
  | `test` | `simulation`), `source_id` (quote id etc., nullable),
  `api_key_id`, request context (header + lines) as JSONB, result
  (subtotals, components, net per line) as JSONB, trace as JSONB, calc_ms,
  created_by, created_at. Tenant-scoped SELECT only. GIN on the context.
- `runPrice()` writes one row per call (best-effort like metering, but
  logged loudly on failure). `pricing_usage` gains `api_key_id`.
- Retention: `config.pricing.retention_days` (default 180); a daily
  GitHub Action (the `wfm-hours-alert.yml` pattern, not Vercel cron)
  purges rows older than that. Same posture as WFM selfie retention.
- `POST /api/v1/price` gains `options.replay_of: <document id>`; the
  cockpit's Test & Trace gains "Load a past document".
- A reusable `<PriceTrace>` component (the waterfall as a drawer) so
  batch 2 can mount it on a quote line without re-rendering the cockpit.
- Unique index on `pricing_cost_inputs (tenant_id, cost_model_code, path,
  coalesce(valid_from, '1900-01-01'))`; the config route upserts on it.
  Wizard's duplicate-avoidance stays as belt and braces.
- Publish becomes one RPC (`pricing_publish_version`) so supersede +
  publish are atomic; it writes a `change_log` row with object type
  `pricing_config` (already does) which the existing webhook dispatcher
  turns into `version.published` for any webhook subscribed to that
  object type. No new event bus.

**Exit:** price a document via API, quote form and cockpit; all three
appear in `pricing_documents`; replay one and get the same numbers;
retention job runs on the demo.

**Status 2026-09-06: built, awaiting migration 0111 on both DBs and demo
validation.** Delivered: migration 0111 (table, metering columns, cost-input
natural key, publish RPC); `src/lib/pricing/documents.ts` (row builder +
retention, tested) and the store/replay/list helpers in
`src/lib/pricing/server.ts`; `options.replay_of` and `meta.document_id` on
`POST /api/v1/price`; `replay_of` on the cockpit test-price route; GET
`/api/settings/pricing-engine/documents` and `/[id]`; the cockpit's Test &
Trace tab lists recent documents with Load and Replay; `<PriceTrace>` in
`src/components/pricing/`; the quote-line route stores source `quote` with
the verified quote id; `/api/pricing/cron/retention` +
`.github/workflows/pricing-retention.yml`; `config.pricing.retention_days`.
Not in this batch (deliberately): a settings field for retention (batch 2's
"Where the engine reads from" section is the natural home), and the
webhook event -- publish already writes a `pricing_config` change_log row,
which the dispatcher delivers to any webhook subscribed to that object
type; naming it `pricing.version.published` is batch 7's documentation
job.

### Batch 1½ — One technique at a time, cost-based first (owner, 2026-09-06)

After the review the owner chose to complete **one pricing technique end to
end before the next**, starting with cost-based, so the whole process can
be judged on the demo. The manufacturer's flow ("SAP moving-average cost,
else CCP calculation, else BI confirmed RFQ cost — confirmed beats
calculated — else BI price list, else ask the supplier; then freight and
handling to landed cost, then the rep's margin") is the reference case.
Three steps, each validated on the demo:

1. **Engine and data — built 2026-09-06.** New primitives, all general:
   - **Cost source ladder** on a cost model (`pricing_cost_models.sources`,
     core `CostSourceDef`): ordered tiers, a quality per source (actual >
     confirmed > estimate > list), freshness (`max_age_days` against
     `as_of`), and a DSL requirement per source ("only for suppliers the
     calculator is set up for"). `resolveCost()` returns the winner AND
     every candidate's fate (won / lost / stale / requirement / expired),
     which the trace carries.
   - **Cost candidates on the line** (`CostItem.candidates`): a product's
     own figures (ERP cost from `products.cost_price` dated by
     `cost_price_as_of`; product-scoped cost inputs such as an RFQ reply or
     an imported price-list cost) resolve through the same ladder as the
     model's tenant-wide rates. `CostInputKind` gains `PURCHASE`.
   - **Cost sheets** on products (`products.cost_sheet`, `costSheet.ts`):
     per-unit quantities that scale with the line; a product with no sheet
     is one bought-in part.
   - **Never a silent zero:** a cost quantity with no figure in force is
     `NO_RATE_IN_FORCE` with the paths and what was tried; a required cost
     step with no items is `COST_MISSING`. `isNeedsCost()` in the adapter
     is the NEEDS_RFQ moment for step 2.
   - **Guardrails in the core:** a procedure step can carry
     `guardrail: { kind: MARGIN_FLOOR, cost_subtotal, revenue_subtotal,
     policy }`; the line's `flags[]` reports a breach with the policy.
     Publish validation checks the subtotals exist before the step.
   - **Template:** cost-based is now bought-in + material + labour −
     salvage = TOTAL_COST, + freight + handling = LANDED_COST, margin on
     landed cost, floor, discount, tax; default ladder PRODUCT_COST (30d)
     > RFQ (180d) > PRICE_LIST (365d) > MANUAL.
   - Migration 0113; golden scenarios in
     `src/lib/pricing/costBased.golden.test.ts` (made part with salvage,
     bought-in part through the ladder, stale ERP cost falling to the RFQ
     reply, nothing in force → NEEDS_RFQ).
2. **The quote line:** routing a product line to the cost-based book, cost
   items from the product's sheet × quantity with its candidates, Fetch
   price, the "why" chip, Send RFQ from the line (`pricing_rfqs`, email via
   `resolveOutbound`), RFQ reply entered as a confirmed product-scoped cost
   input, fetch again. Floor policy `block` stops sending.
3. **Setup and demo:** cost sheet on the product form, source ladder and
   freight/handling rows in the wizard, floor policy, demo seed, walk.

Batches 2–8 below stand, but each is now delivered per technique: price
list, value-based and variant follow the same three steps on these rails.

### Batch 2 — Execution: the quote line, done properly (L)

Client #3 becomes real. This is where the design partner meets the engine.

- **Context mapping** (`config.pricing.context_map`): per tenant, which
  BPMSquare field feeds which dimension. `customer.tier ← accounts.type`,
  `region ← accounts.state`, `product.category ← products.category`,
  or any `cf_*` custom field on account, contact or product. Edited in
  Settings → Dynamic Pricing → "Where the engine reads from". Replaces the
  hard-wired mapping in `api/quotes/price-line`.
- **Book routing** (`config.pricing.routing`): ordered rules "product
  category X → book Y", "document type standard_quote → book Z", default
  book last. A quote line goes to the first matching book. Closes
  scenario 5.
- **Catalogue as list price**: the product's `list_price` (and `uom`,
  `tax_percent`, `cost_price`) travels into the line context as
  `line.product.*`. The Price-list template's LIST_PRICE rule set gains a
  default row "use the catalogue price" (formula
  `ctx.line.product.list_price`), so a tenant does not re-key the
  catalogue; conditional rows override it for tiers/regions/volumes.
  Small Scale Pricing items get the same treatment (batch 8).
- **Quote form**: "Price with engine" on every line that has a product or
  a pricing item; the resolved rate lands with a small "why" chip that
  opens `<PriceTrace>`; manual edits after pricing are recorded as a
  `manual` override with a reason when the component's policy says
  `ALLOWED_WITH_REASON`, refused when `FORBIDDEN`. A margin-floor breach
  shows as an amber flag on the line and on the quote header.
- **Standard Quotes** get the identical hook (`document_type:
  standard_quote`); **work-order invoices** price their labour line via
  the engine when the tenant has a book routed for `work_order`, else fall
  back to `pricing_items` as today.
- Every priced line stores `pricing_document_id` on `quote_lines` /
  `standard_quote_lines` (nullable column, one migration), so a sent quote
  can always show the customer why.
- Flags: `pricing_engine_quotes` stays the opt-in for touching real quotes.

**Exit:** on the demo, a quote with three lines from two categories prices
from two books, one line shows a tier discount with its trace, one manual
override with a reason, one margin-floor flag; the PDF is unchanged.

### Batch 3 — Governance: approvals (M)

- Migration `pricing_approvals`: tenant, kind (`version_publish` |
  `line_override` | `margin_floor`), subject (area+version, or
  pricing_document_id + line), requested_by, approver_ids, status
  (`pending` | `approved` | `rejected`), decision_by, decision_at, reason.
  SELECT-only RLS; writes via routes.
- `config.pricing.approvers`: per book, a list of user ids; empty = no
  approval required (today's behaviour). Four-eyes is mandatory when a
  version contains any rule with origin `AI_PROPOSED_APPROVED` (batch 5).
- "Go live" becomes "Submit for approval" when approvers exist; the
  version moves DRAFT → PENDING_APPROVAL; an approver's "Approve" runs the
  publish RPC. Rejection returns it to DRAFT with the reason on the
  banner.
- A line override beyond policy, or a margin-floor breach on a quote,
  raises a `line_override` / `margin_floor` approval; the quote shows
  "awaiting pricing approval" and cannot be sent until it is approved
  (the same "cannot send" pattern invoices use for cancelled state).
- Approvals appear in the Nova inbox and as an email through
  `resolveOutbound()`; a "Deal desk" tab in the Pricing workcenter lists
  what is pending.
- The margin guardrail, deliberately display-only since 2026-08-23, wires
  into this — §7 said it would be the first thing to.

**Exit:** on the demo, a draft with an approver cannot go live without a
second user; an over-discounted quote line blocks sending until approved.

### Batch 4 — Simulation and diff (M)

- **Diff**: `GET /api/settings/pricing-engine/versions/{a}/diff/{b}` and
  a Diff view in History: rules added / removed / changed, components and
  procedure steps changed, cost inputs whose validity moved. Rendered as
  the plain-language sentences `describeCondition()` already produces.
- **Simulation**: replay a DRAFT against the last N stored
  `pricing_documents` of the same book (N from `config.pricing`,
  default 500, synchronous cap 200 with a GitHub Action for larger runs).
  Report: revenue delta, margin delta (where cost is known), affected
  documents by account, dead rules (never matched), AMBIGUOUS_RULE hits,
  margin-floor crossings. Stored in `pricing_simulations` and shown on the
  "unsaved changes" banner as "What would change".
- Version state IN_SIMULATION is used while a run is in flight.

**Exit:** change a tier discount on the demo draft, see "12 quotes would
be ₹41,200 cheaper, 2 cross the margin floor" before going live.

### Batch 5 — Strategy: NL rule authoring and onboarding mapper (L)

- **NL rule authoring**: "Tier-A customers get an extra 3% above 50,000
  until end of December" → one forced tool call (the `nlCompile` pattern:
  the model emits only a validated rule shape — component, match
  attributes restricted to the registered dimensions, value or scale or
  formula, validity) → the rule is back-translated with
  `describeCondition()` and shown → the user accepts → it lands in the
  DRAFT with origin `AI_PROPOSED_APPROVED`, which trips four-eyes on
  publish. Prompt, response, model id and approver are logged
  (`pricing_ai_log`, the EU-AI-Act pattern from §8).
- **Onboarding mapper**: upload a price list or cost sheet (CSV/XLSX
  through the Data Workbench parser) → the model maps columns to
  dimensions, components and cost-input paths → preview with row-level
  validation → import as rules / cost inputs into a DRAFT. Nothing
  publishes automatically.
- The AI dock gains "price this" and "explain this price" over the same
  tools, scoped to the pricing workcenter.

**Exit:** on the demo, three sentences become three rules in a draft;
a 40-row CSV becomes a Price-list book without touching Advanced.

### Batch 6 — Analysis and anomaly digest (M)

- Analytics metrics (the `AnalyticsMetricId` pattern): realised vs list
  (net after overrides / net at rules), discount leakage by rep and by
  account, margin distribution, override count, rules never matched in
  the last 90 days. All from `pricing_documents` joined to quotes and
  their outcomes; scoped like every other metric.
- Talk to data: a `pricing_documents` source in `LIST_SOURCES` (one row
  per priced line with its components) so "average discount by tier last
  quarter" is a question, not a report.
- **Anomaly digest**: a daily GitHub Action flags stale cost rates
  (unchanged > N days), rules expiring within 14 days without a successor,
  dead rules, discount stacking above a threshold; one email per tenant
  to the pricing owner through `resolveOutbound()`, and a card in the
  Pricing workcenter.

**Exit:** the demo dashboard shows leakage by rep; the digest arrives in
the redirect inbox.

### Batch 7 — PaaS surfaces: metering, rate limits, webhooks, embeds (L)

- Per-key rate limiting from `pricing_usage` (fixed window, limits from
  `tenants.plan`), 429 with `Retry-After`; a usage panel in the workcenter.
- `POST /api/v1/pricing/{versions,rules,cost-inputs}` — the config CRUD
  the API guide promised, same validation as the in-app route, `pricing`
  scope with write.
- Webhook events `pricing.version.published`, `pricing.simulation.completed`,
  `pricing.anomaly.flagged` — all `change_log` rows with object type
  `pricing_*`, delivered by the existing dispatcher; documented in the
  API guide.
- Embed tokens (`POST /api/v1/embed-tokens`, ≤ 15 min JWT bound to
  tenant + view + resource) and `/embed/trace/:documentId`,
  `/embed/simulator` with per-tenant `frame-ancestors`; middleware
  public-path entries `$`-anchored like the quote PDF links.
- OpenAPI covers all of it; the product name (§18) appears on the API
  index, the workcenter and the Drive API guide.

**Exit:** an external script prices 200 lines, gets rate-limited on the
201st call in the window, receives `version.published` on its webhook,
and renders a trace in an iframe on a test page.

### Batch 8 — Once and for all: one price origin per tenant (S)

- **Small Scale Pricing → Price Book importer**: one click turns
  `pricing_items` into a "Service rates" book (LIST_PRICE rules keyed on
  `item.code`, one dimension). The Settings page stays for tenants
  without the engine; for engine tenants it shows "managed in Pricing"
  with a link. Vikas is never migrated without the owner's go.
- Currency: the workcenter and cockpit read the tenant currency (the
  same `money()` helper the GCC currency item needs) — no ₹ literals.
- History and Today's rates render any version, wizard-built or not,
  through the generic snapshot view.
- Route tests for config, versions, publish RPC, price-line, approvals.
- Drive docs: a new "BPMSquare — Pricing Guide" and the API guide
  refreshed, in the same piece of work.

**Exit:** the demo has one price origin per line type, no ₹ literals,
tests green, guides current.

### What is explicitly NOT in Phase 2

Phase 3 as written (§9 rebates/credits ledger, agreements, index feeds,
usage metering for SaaS tenants, dedicated-schema tenancy, extraction),
Arabic/RTL, and a JS SDK for the embeds. Each waits for a paying demand.

---

## 18. Decisions (owner, 2026-09-06)

| # | Decision | Decided | Consequence |
|---|---|---|---|
| 1 | Build order | **In-app first**: batches 1–6, then 7. | Stored contexts come from real quotes before any external surface exists. |
| 2 | Small Scale Pricing | **Keep both, permanently.** No importer, no "managed in Pricing" redirect. | Batch 8 drops the importer. The static rate list is a product for small tenants; the engine is a product for tenants that price by rules. The quote form keeps one catalogue; an engine tenant's `pricing_items` are simply lines the engine never touches. Work-order labour keeps reading `pricing_items` unless a book is routed for `work_order`. |
| 3 | Product name | **BPMSquare Pricing.** | Batch 7 applies it to the API index, OpenAPI title, embed views and the Drive guide; the workcenter label stays "Pricing". |
| 4 | Approvals on quotes | **Block sending** until approved. | Batch 3 as written. |
| 5 | Retention of stored contexts | 180 days default, per-tenant setting (assumed, not contested). | Batch 1 as written. |
