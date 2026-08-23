# PricingEngine — Architecture Specification v1.4

**Codename:** PricingEngine (working title — ships under a product name from day one, see §14.4)
**Author:** Abdul Nandalpad / ServiceSphere UG
**Date:** 2026-08-15
**Status:** Draft for review
**Supersedes:** v1.2 (2026-08-15)

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
