# AI Report Builder — Architecture Specification v0.2

**Codename:** "Talk to data" (working title)
**Status:** Draft for review — architecture only, nothing built yet
**Date:** 2026-08-24
**Supersedes:** v0.1 (2026-08-24) — v0.1 proposed cutting the object catalog to
7 for a "v1." Owner decision 2026-08-24: **no object ceiling.** Every object in
the system is in scope, permission-filtered per caller, not curated by us in
advance. What v0.1 called "v1 scope" is now a rollout **order**, not a cut —
see §6.

**One-sentence pitch:** a user types a question in plain English, about *any*
object they're allowed to see, and gets a chart or table built from live
tenant data — asking a clarifying question first if the request is genuinely
ambiguous, and always showing what it understood alongside the answer.

---

## 1. What this builds on (do not rebuild these)

Three pieces of existing infrastructure do almost all of the hard work already:

1. **The safe NL→query pattern** (`POST /api/v1/ask`, `src/app/api/v1/ask/route.ts`).
   The model gets a forced tool call (`tool_choice: {type:"tool", name:"query"}`)
   whose schema only allows field paths from a per-object whitelist. It never
   writes SQL and never picks a tenant. The compiled output (filters, sort,
   select, aggregates, group_by) is turned into the *same wire query string* a
   REST caller would send and run through `parseListQuery()` — so a hallucinated
   field name is a 422, never a query.
2. **The query engine's aggregation** (`src/lib/api/query.ts`, `applyListQuery`).
   `group_by=status&aggregate=sum:total` already returns
   `groups: [{key, count, sum_total}, ...]` — computed over the **full filtered
   set, before pagination**. That is already a chart-ready `category → value`
   shape. No new aggregation engine is needed.
3. **The permission-gated in-app assistant pattern** (`src/lib/ai/assistant.ts`).
   Each capability declares the `WorkcenterKey` it reads and is filtered out of
   what the model even sees via `canViewWorkcenter(perms, ...)` before the call
   — the mechanism that makes "the AI only picks data this person is allowed to
   see" true by construction, not by prompt instruction.
4. **`FIELD_REGISTRY`** (`src/lib/fieldRegistry.ts`) — the per-object field
   catalog (key, label, widget type, section) that already exists for every
   `PilotObjectType` (12 objects today) because bpmsquarecore.md §3b requires
   it for *every* object regardless of Report Builder. This is the piece that
   makes "all objects" tractable rather than a wall of hand-written field
   lists — see §3.6.

**What does not exist yet and must be built:** a chart-rendering layer (zero
charting library or chart component exists anywhere in this codebase today),
a routing step that picks the right object(s) out of the *entire* catalog, a
clarify-or-explain interaction layer, field-level PII/sensitivity marking,
and persistence for a generated report.

---

## 2. Pipeline

Two stages, not one. A single tool call with every object's fields mashed
into one enum stops being reliable once "every object" means 25-30 of them —
enum bloat degrades tool-call accuracy, and it's needless: the model doesn't
need to see `wfm_leave_records`' fields to know a question about "our
customers in Bangalore" is about `accounts`.

```
User types a question (Reports → "Ask", or the ⌘K bar)
        │
        ▼
POST /api/reports/ask   { question, conversation_id? }
        │  requireTenantUser() + resolvePermissions()
        ▼
┌─────────────────── STAGE 1: ROUTE ───────────────────┐
│ Catalog = every object's {key, label, one-line        │
│ description}, PRE-FILTERED to workcenters the caller   │
│ can VIEW (never shown to the model otherwise)           │
│                                                          │
│ Claude, forced tool call `route_question`:              │
│   - objects: string[]  (usually 1; >1 only if the       │
│     question is a SINGLE chart spanning fields already   │
│     denormalized onto one object, e.g. quotes+account   │
│     name — never a signal to attempt a real join)       │
│   - status: "ready" | "needs_clarification" | "decline" │
│   - clarifying_question?: string                         │
│   - reason?: string  (why declined)                      │
└──────────────────────────────────────────────────────────┘
        │
        ├─ needs_clarification → return the question to the user,
        │   wait for their reply, retry Stage 1 with it appended
        │   as context (a real back-and-forth, not a dead end)
        │
        ├─ decline → return `reason` verbatim + suggested
        │   rephrasing (§4.8)
        │
        ▼  ready
┌─────────────────── STAGE 2: COMPILE ─────────────────┐
│ Same shape as /api/v1/ask's tool today, scoped to the  │
│ ONE routed object's field whitelist (small, reliable    │
│ enum — unchanged from v0.1):                            │
│   - filters / search / sort / select / aggregates /     │
│     group_by  (validated by parseListQuery(), unchanged) │
│   - chart_type / x / y / title                            │
│   - interpretation: string — REQUIRED, always shown,     │
│     names exactly which field(s)/filter(s) answer the    │
│     question ("Won quotes' total value, by month, last   │
│     12 months") — see §2.3, this is not optional cosmetic │
└────────────────────────────────────────────────────────┘
        │
        ▼
parseListQuery() + applyListQuery()   — UNCHANGED, same validated engine
        │
        ▼
ReportSpec { question, object, compiled_query, chart_type, x, y,
             title, interpretation, data: GroupResult[] | row[] }
        │
        ├─ render immediately (interpretation shown WITH the chart,
        │   not gated behind a confirm step — see §2.3)
        └─ POST /api/reports  → persist spec to `ai_reports`, so
           re-opening it never re-calls the model
```

### 2.1 Chart-type selection — rules, not just model judgement

The tool schema's `chart_type` is advisory; the server **downgrades** it to
the nearest sane option based on the compiled query shape, the same "engine
is truth, model is advisory" discipline the pricing engine's AI layer uses
(`docs/pricing-engine-architecture.md` §8):

| Compiled query shape | Sane chart types | Notes |
|---|---|---|
| `count_only: true` | **stat tile** | one number, big font — not a chart |
| `group_by` + one aggregate, ≤ 8 groups | **bar** or **pie** | pie only if `x` is a genuine category, not an id |
| `group_by` on a `date`-typed field | **line** | time series |
| `group_by`, > 8 groups | **bar only**, capped to top N + "Other" | pie with 30 slices is never legible (dataviz skill) |
| no `group_by`, `select` ≤ 6 columns | **table** | the fallback for anything else |

### 2.2 Why routing is its own stage, and its own risk

Splitting route/compile buys reliability (small per-object enums) at the
cost of a new failure mode: **the router picks the wrong object.** "Show me
our top customers" could mean `accounts` (by relationship) or `quotes`
grouped by account (by revenue) — genuinely ambiguous, and exactly the case
`needs_clarification` exists for (§2.3), not a case to guess through. The
router's system prompt should list, for every candidate object, a one-line
disambiguating description (not just its name) — "accounts: companies and
organizations you sell to" vs "quotes: individual price quotes sent to
customers" — cheap to write once per object, and it's the main lever for
routing accuracy as the catalog grows toward "everything."

### 2.3 The clarify → explain → show contract

This is the actual product requirement, not a nice-to-have: *ask if it's
unclear, show its understanding, then show the data.* Three distinct
outcomes, never conflated:

- **Genuinely ambiguous** (routing can't tell which object, or the compile
  step can't tell which of two plausible fields/filters answers the
  question) → **ask one specific clarifying question**, do not guess and
  do not render a chart yet. "By 'revenue' do you mean quote value or
  invoiced amount?" — offering the real candidate fields/objects as the
  choices, not an open-ended re-ask.
- **Resolvable, but with an assumption made** (the common case — most
  questions aren't literally ambiguous, they just don't spell out every
  filter) → compile AND render immediately, with `interpretation` shown
  as a first-class line under the title, not a footnote: "Won quotes'
  total value, by month, last 12 months." The user corrects by asking a
  follow-up ("no, all quotes, not just won") rather than being blocked
  up front — this is the better UX default (don't gate on confirmation
  for every assumption, only for genuine forks) and it's simpler to build
  (one round-trip, not a mandatory confirm-then-fetch step).
- **Can't be answered at all** from the caller's permitted catalog →
  decline with a specific, actionable reason (§4.8), never a silent wrong
  answer.

---

## 3. New pieces to build

### 3.1 `src/app/api/reports/ask/route.ts` (new)
Session-auth (`requireTenantUser`), runs Stage 1 (route) against the
permission-filtered catalog, then Stage 2 (compile) against the routed
object's whitelist, downgrades chart_type per §2.1, runs the compiled query,
returns a `ReportSpec`. Shares tool-schema-building and query-compiling
helpers with `/api/v1/ask` rather than forking them — the compile step is
the same discipline both places.

### 3.2 `ChartRenderer` component family (new, biggest net-new surface)
No charting library exists in this codebase today. **Decision needed:**
- **Recharts** (or similar React chart lib) — fastest to get bar/line/pie/
  stat/table all working correctly across a growing object catalog. Adds a
  real dependency; needs the dataviz skill's palette validator and
  light/dark tokens layered on top of its theming props, not its defaults.
- **Hand-rolled inline SVG** per the dataviz skill's own mark specs — zero
  new dependency, full design-system control, meaningfully more build time.

Recommendation: Recharts for the first cut, dataviz-skill tokens applied on
top. Re-evaluate only if its styling escape hatches become a real problem.

### 3.3 `ai_reports` table (new) — persistence, per bpmsquarecore.md §3b
```sql
create table ai_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  created_by uuid not null,
  question text not null,
  object text not null,
  chart_type text not null,
  compiled_query jsonb not null,
  title text not null,
  interpretation text not null,
  pinned_to_dashboard boolean not null default false,
  created_at timestamptz not null default now()
);
alter table ai_reports enable row level security;
create policy "ai_reports: tenant isolation" on ai_reports for all
  using (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()))
  with check (tenant_id in (select tenant_id from tenant_users where user_id = auth.uid()));
```
Re-opening a saved report **re-runs `compiled_query` against live data** but
**does not call the model again** — the risky/expensive part (NL
interpretation) happens once, at save time. One subtlety worth stating
explicitly: a saved report's access is re-checked against the *viewer's own*
permissions on re-run, not the creator's — see §4.10.

### 3.4 `LIST_SOURCES` gains a `relatedWorkcenter` and a `sensitiveFields` list
`ListSource` (`src/lib/api/listSources.ts`) needs to know which
`WorkcenterKey` it maps to (for catalog filtering, §1) and which of its
fields are PII/sensitive (for §3.7). Additive, not a breaking change to the
v1 API.

### 3.5 Where it lives
`/reports` already exists (`ReportsClient.tsx`, `METRIC_META`-driven tiles).
Add an **"Ask"** tab there. A saved report with `pinned_to_dashboard` renders
as a Dashboard tile via the existing `renderWidget` switch
(`DashboardLayout.tsx`), the same way `AnalyticsMetricId` widgets do today.

### 3.6 Full-catalog generation — the actual answer to "all objects, all tables"

This is the load-bearing design decision for the owner's requirement. Two
tiers, by how much new work each object needs:

**Tier 1 — free, or nearly free (12 objects, today):** every
`PilotObjectType` in `FIELD_REGISTRY` (account, contact, asset, supplier,
case, work_order, quote, invoice, purchase_order, inventory, employee,
product) already has a full field catalog — `key`, `defaultLabel`, `widget`.
A single adapter function derives a `QueryableField[]` from it automatically
(`widget` → `QueryableType`: text/textarea/email/tel/url → `"string"`
(+`searchable: true`), `number` → `"number"`, `date` → `"date"`, `checkbox`
→ `"boolean"`, `enum`/`select` → `"string"`). Adding one of these 12 to
Report Builder is **wiring, not authoring** — the whitelist already exists,
it just needs a `load()` function, and per bpmsquarecore.md §3b every object
already has a tenant-scoped list-loading path (`src/lib/data/live.ts` or
equivalent) built for its own list page. This tier should ship essentially
all at once, not object-by-object.

**Tier 2 — needs real field-list work (everything currently outside
`FIELD_REGISTRY`'s `PilotObjectType` union):** Standard Quotes, AMC,
Dispatch, Technicians, Marketing (Campaigns, Segments, Leads), Partners,
WFM's several tables (roster, leave, OT sessions, timesheet), and Coverage
(teams/segments/coverages). These need a hand-authored `QueryableField[]`
each — the same shape of work `QUOTE_FIELDS`/`ACCOUNT_FIELDS` already are in
`listSources.ts` today, just not derivable from an existing registry because
these modules don't have a `FIELD_REGISTRY` entry (most were built before
or alongside custom fields, on their own screens). **This is real,
sequenced work, not a design gap** — §6 orders it.

Either tier, the *mechanism* (routing + compile + permission-filtering) is
identical — adding an object never changes the architecture, only the
catalog size.

### 3.7 Field-level sensitivity (new — replaces "just exclude the whole object")
The owner's requirement — "AI should only pick the data he or she is allowed
to see" — is workcenter-level today (§1, item 3) but PII is *field*-level
(MULTI_TENANT_GUARDRAILS.md's existing encrypted-field list: account/contact
phone, email, GSTIN). Object-level gating alone would either block a
salesperson from ever asking about accounts at all, or let them pull every
account's phone number into a table report. Fix: add `sensitive?: boolean`
to `StandardFieldDef` (`fieldRegistry.ts`) — small, additive — defaulting
true for `widget: "email" | "tel"` and settable explicitly elsewhere (e.g.
WFM bank details, employee salary). Report Builder's compile step then
applies one rule uniformly: a `sensitive` field may be **aggregated over**
(count/sum/avg — never exposes one person's value) but never placed in
`select` for a table, regardless of the caller's workcenter access. This is
a report-specific policy layer, not a new access-control system — it
doesn't change what the caller can see on the account/employee record page
itself, only what a generated, exportable report can surface in bulk.

---

## 4. Issues we could face

Ranked by how likely each is to actually bite, not by neatness.

**1. Compound / multi-chart questions.**
"Give me a dashboard of this quarter's sales" implies several charts; one
call answers one chart. **Mitigation:** the router's `decline` reason should
explicitly say "ask me one thing at a time" when it detects a compound ask,
not attempt a wrong single answer. A true multi-report mode (the model
emits an array of report specs) is real, later work — it changes the tool
contract meaningfully, don't fold it into the schema speculatively.

**2. Cross-object questions aren't supported by the query engine at all.**
"Revenue by sales rep" needs quotes joined to users; `LIST_SOURCES` loaders
are single-object (a few already denormalize one hop, e.g. `account.name`
on quotes). **Mitigation:** the model declines anything needing a real join,
with a specific reason naming what's missing. A join-aware query layer (or
a reporting data-mart) is a distinct, larger effort — worth doing *because*
the full-catalog ambition will surface real demand for it, but it doesn't
block shipping single-object reporting across every object first.

**3. Routing accuracy degrades as the catalog grows toward "everything."**
This is new versus v0.1's narrower catalog, and directly caused by the "no
object ceiling" decision: at 25-30 objects, some genuinely overlap in
vocabulary (a "case" could sound like a WFM leave case to a naive router if
WFM ever adds one; "orders" could mean quotes, purchase orders, or work
orders). **Mitigation:** §2.2's per-object disambiguating description is
the main lever; track routing mistakes as a real metric once live (which
questions got mis-routed), not just accuracy in the abstract — this is
exactly the kind of thing that looks fine on 5 test questions and breaks on
the 50th real one.

**4. In-memory aggregation performance at real tenant scale.**
Every `ListSource.load()` pulls **all** tenant rows into memory, then
filters/aggregates in JS. Fine at hundreds/low-thousands of rows per object;
a real risk at tens of thousands, and the full-catalog ambition means this
now applies to WFM tables (roster/punch data can get large fast) too, not
just the original 7. **Mitigation:** measure before optimizing (per
`docs/pricing-engine-architecture.md` §12's "trigger, not a phase"
discipline), but budget for a per-object row cap + "narrow your date range"
prompt as the first real fix if hit, before a DB-level aggregation rewrite.

**5. Unbounded `group_by` cardinality.**
`applyListQuery`'s `groups` array has no cap today. **Fix, not just a UI
decision:** add an optional `group_limit` (top-N by count, bucket the rest
as "Other") to `applyListQuery` itself — any future consumer of `group_by`
has the same exposure, not just this feature.

**6. A wrong-but-plausible-looking chart is worse than an error.**
Directly addressed by §2.3's mandatory, always-visible `interpretation` —
naming exactly which field/filter produced the number, not hidden in a
tooltip. Residual risk: the interpretation itself could be wrong in a way
that still sounds plausible ("won quotes" when the user meant "all quotes")
— this is precisely why §2.3 treats a wrong assumption as *correctable via
follow-up*, not something a confirmation checkbox would have prevented
either (a rushed user clicks "yes, that's right" on a wrong summary too).

**7. Field-level sensitivity is new infrastructure with a real blind spot.**
§3.7's `sensitive` flag needs to be set correctly on every field, including
Tier 2 objects authored by hand (§3.6) — a missed flag on a new field is a
silent PII leak into an exportable table, not a loud failure. **Mitigation:**
default `sensitive: true` for `widget: "email"|"tel"` (safe default, opt-out
not opt-in) and make it part of the same §3b checklist review every new
object/field already goes through — not a separate audit someone has to
remember to run.

**8. The declining/clarifying case needs to feel helpful, not like a dead end.**
**Mitigation:** when declining, surface the queryable objects/fields as
suggested chips, not error text — the router already has this list. When
asking a clarifying question, offer the real candidate answers as choices
("quote value or invoiced amount?"), never an open "please rephrase."

**9. Cost and latency of repeated generation, now across two model calls.**
Splitting route/compile (§2) means **two** model calls per fresh question
instead of one — real latency and cost, worth it for reliability at catalog
scale (§2.2) but should be measured, not assumed acceptable.
**Mitigation:** §3.3's persistence already means a *saved* report never
re-calls the model; only a genuinely new question pays for both stages.

**10. A saved report's access must be re-checked on every view, not just at save time.**
If a report was saved by an admin against `employees` and later opened by a
non-admin (a shared/pinned dashboard tile), the viewer's *current*
permissions — not the creator's — must gate both whether they see it at all
and whether `sensitive` fields in it render. **Mitigation:** `GET` on a
saved report re-runs the same workcenter/sensitivity checks Stage 1/2 would
apply live, every time, never trusting that "it was fine when it was saved."

**11. Dataviz-skill compliance is real, non-trivial work, not a checkbox.**
Colorblind-safe categorical palettes, light/dark tokens, accessible
legends, a table fallback for every chart — applies in full here. Budget
real time, especially if Recharts is chosen (§3.2) — its defaults need to
be overridden, not just wrapped.

---

## 5. Suggested chart types for v1

Stat, bar, line, table. Pie deliberately deferred — bar is strictly safer
at any group count and §2.1's cap logic already favors it; add pie once
there's a concrete case bar genuinely serves worse.

---

## 6. Rollout order (not a scope cut — every object is the target)

Sequencing driven by §3.6's tiers, so the *architecture* supports
everything from day one and the *catalog* fills in fast:

1. **Routing + compile + chart rendering + persistence**, proven end to end
   against a small slice of Tier 1 (e.g. accounts, quotes, cases) — this is
   where the real unknowns are (routing accuracy, chart-type downgrade
   rules, the clarify/explain UX), not the catalog size.
2. **The rest of Tier 1** (asset, supplier, work_order, invoice,
   purchase_order, inventory, employee, product) — mechanical, all at once,
   since the FIELD_REGISTRY-to-`QueryableField[]` adapter is written once in
   step 1. `employee` included from the start, gated correctly by §3.7's
   field sensitivity rather than excluded wholesale.
3. **Tier 2 objects**, each requiring its own field-list authoring: start
   with whichever the partner/first customers actually ask about in the
   demo and early usage (real signal beats a guessed priority order) —
   Standard Quotes and Marketing/Leads are likely early candidates given
   they're core sales-cycle objects.
4. **Cross-object joins** (§4.2) once single-object coverage is broad enough
   that "I can't join" becomes the dominant decline reason in practice, not
   a theoretical gap.
