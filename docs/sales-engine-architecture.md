# BPMSquare Sales Engine — architecture and build spec v1.0 (2026-09-06)

> **Who this is for.** The engineer (human or model) who implements the
> plan in `docs/sales-engine-plan.md`. That file is the *why* and the
> sequence; this file is the *what* and the *how*: tables, columns, routes,
> components, events, acceptance tests. It is written so that each piece
> can be built without re-deriving the design from the conversation that
> produced it.
>
> **Read first, every time:** `bpmsquarecore.md` (§3b "new object" checklist
> is mandatory for the Opportunity), `MULTI_TENANT_GUARDRAILS.md`,
> `docs/pricing-engine-architecture.md` §11–§17 (the pricing engine this
> plan hangs off), and the validation record
> `docs/BPMSquare_Pricing_CostBased_Walkthrough.docx` (what the demo looks
> like today). PROJECT.md's operational ledger lists every migration;
> **the owner applies SQL by hand on both databases** — code must degrade
> cleanly while a migration is pending (42P01 / 42703 read as "not yet",
> never crash).

---

## 0. Owner decisions that shape everything (do not re-open)

| # | Decision | Date |
|---|---|---|
| 1 | Finish the pricing engine as a product; one technique at a time, cost-based first (done); Small Scale Pricing stays a separate product forever | 2026-09-06 |
| 2 | The engine demo runs on **Standard Quotes**; **Quotations are the design partner's object** — change them only where this spec says (shared line contract, versioning rule, `opportunity_id`) and with visual parity | 2026-09-06 |
| 3 | A quote that breaches the margin floor under policy Block **cannot be sent until approved** | 2026-09-06 |
| 4 | **The line rate is pre-tax** (engine net minus TAX-class components, "NET_2"); the quote header applies tax once (built) | 2026-09-06 |
| 5 | **Lead is optional before an Opportunity; Opportunity is optional before a Quote.** Nothing auto-creates a deal. "Create deal from this quote" and "Link to deal" are actions | 2026-09-06 |
| 6 | Rules layer and approval engine are **platform services** used by sales, pricing and WFM — not per-object builds; pricing spec batch 3 folds in | 2026-09-06 |
| 7 | Win rating is an **explainable rubric**; AI may rewrite the sentence, never the number (same doctrine as Account 360) | 2026-08-19 / 2026-09-06 |

Build order: **A → B → C → D → E → F → G → H → I** (§13). Each piece is
built on `develop`, demoed on the production demo workspace, validated by
the owner, then the next starts (bpmsquarecore §10 rule 2 applies to all
of this: step by step, confirmed before the next).

## 1. Vocabulary

| Term | Meaning here |
|---|---|
| **Lead** | Existing object (`leads`): an expression of interest. Optional. |
| **Opportunity / Deal** | New object (`opportunities`): a pursuit with a customer, the lines being pursued, engine prices, people, stage, win rating. The Pipeline board shows deals. |
| **Quote** | Either existing quote object: **Quotation** (`quotes`, design-partner-shaped, option groups, revisions) or **Standard Quote** (`standard_quotes`, generic). A quote *may* belong to a deal. |
| **Document line** | The shared line shape (§3) used by opportunity lines, standard quote lines and quotation lines. |
| **Price Book / area** | A pricing configuration (`pricing_area`) the router sends a line to. |
| **Pricing document** | The stored context + result of one engine call (`pricing_documents`); a line remembers the one that priced it. |
| **Event** | A named thing that happened to an object (`quote.sent`). The rules layer consumes events. |
| **Rule** | `when <event> [if <condition>] then <actions>` — tenant configuration. |
| **Approval** | A chain of steps someone must decide before an object may proceed. |

## 2. The flow

```
                     ┌────────────────────────────────────────────────────┐
  Lead ──(convert)──▶│ Opportunity (deal)                                 │
   optional          │  lines ── Price all ── engine ── pricing_documents  │
                     │  stage · probability (rubric) · team · deal room   │
                     │  approvals · rules · win tab                       │
                     └───────┬──────────────────────────▲─────────────────┘
                             │ convert (copy + re-price) │ link / create deal
                             ▼                           │
                   Quote v1 ──revise──▶ Quote v2 ──▶ … (Quotation or Standard Quote)
                     │ lines (same contract) · Price all · flags · approvals
                     │ sent ──▶ public link: opened · accepted · change requested
                     ▼
                   Won ──▶ Work order ──▶ Invoice   (exist today)
```

Pricing is the same call everywhere: `priceDocumentLine()` in
`src/lib/pricing/quoteLine.ts` with `documentType` one of
`opportunity | quote | standard_quote | work_order`; the Price Book router
(`src/lib/pricing/routing.ts`) can send each document type to its own
book.

## 3. Piece A — the shared document line, Price all, alternatives, quantity breaks

### 3.1 Line contract

Every line table converges on this column set (names as in `quote_lines`
today; add what is missing, never rename what exists):

| Column | Type | Note |
|---|---|---|
| `id`, `tenant_id`, `<parent>_id` | uuid | parent = `opportunity_id` / `standard_quote_id` / `quote_id` |
| `sl_no` | text | display order label |
| `product_id` | uuid null → products | tenant-verified on write (`verifiedProductIds`, `quoteLineFlags.ts`) |
| `description`, `uom` | text | |
| `qty`, `rate`, `discount_pct`, `amount` | numeric | `rate` is **pre-tax** per unit |
| `pricing_document_id` | uuid null → pricing_documents | set by the client from the price call, **verified server-side** (`derivePricingFlags`) |
| `pricing_flags` | jsonb null | **server-derived** from the document, never trusted from the client |
| `group_id`, `group_label`, `group_type` | text | `group_type ∈ {additive, alternative}`; Quotations have this, Standard Quotes need it (0116) |
| `break_of` | uuid null → same table | this row is a quantity break of that line (§3.4) |
| `break_qty` | numeric null | the break's quantity band start ("from 10") |
| `is_selected` | boolean default true | for alternative groups and breaks: only selected rows count in totals |
| `custom_data` | jsonb | |

**Migration 0116 `sales_line_contract.sql`:** add the missing columns to
`standard_quote_lines` (`group_id`, `group_label`, `group_type`,
`break_of`, `break_qty`, `is_selected`) and to `quote_lines` (`break_of`,
`break_qty`, `is_selected`). `opportunity_lines` is created with the full
set in 0117. RLS unchanged (each table keeps its existing policy).

Server-side total computation (`src/lib/sales/lineTotals.ts`, new, pure,
unit-tested): sum of `amount` over rows where `is_selected` and, for an
alternative group, only the selected group's rows; break rows are never
summed unless selected (then the parent line is not). Both quote objects
and the opportunity call this one function; the client mirrors it for
display only.

### 3.2 Price all lines

- **Route:** `POST /api/pricing/price-lines` (new) — body
  `{ document_type, document_id?, account_id?, lines: [{ line_key, product_id, quantity }] }`.
  Auth: `requireTenantUser` + `canEditWorkcenter(perms, <workcenter of document_type>)`.
  For each line with a `product_id`, call `priceDocumentLine()` (parallel,
  `Promise.allSettled`, cap 20 concurrent). Response:
  `{ results: [{ line_key, ok, unit_rate, net, gross, tax_amount, tax_pct, document_id, flags, trace, cost_sources }
              | { line_key, ok:false, needs_rfq:true, product, missing, message, cost_model }
              | { line_key, ok:false, error }] }`.
  One HTTP call, N pricing documents (each stored; usage metered per call
  as today — `runPrice` already meters).
- **Forms** (`StandardQuoteForm.tsx` first, then `QuoteForm.tsx`): a
  **"Price all lines"** button in the lines header, disabled while any
  line is pricing. On response: fill every rate, set `pricing_document_id`,
  set header tax from the first `tax_pct` when the header is 0, show a
  summary strip: "12 priced · 2 need a supplier reply · 1 failed", with the
  NEEDS_RFQ lines listed and their Send RFQ opened inline (existing flow).
- **Auto re-price:** when a line that has a `pricing_document_id` changes
  `product_id` or `qty`, clear the document id and flags and re-price that
  line automatically (debounced 600 ms). A manual edit of `rate` on a priced
  line clears `pricing_document_id` (the rate is now the rep's; flags
  cannot apply) and shows "rate overridden" — batch 3 of the pricing spec
  turns that into a `line_override` approval later.

### 3.3 Alternatives (option groups) on Standard Quotes

Lift the Quotations model as-is: a group row with `group_type =
"alternative"` and `group_label` ("Option A: 8P lift", "Option B: 13P
lift"); child lines carry the `group_id`; exactly one alternative group per
quote is `is_selected` (Quotations store this as
`quotes.selected_option_id` — Standard Quotes use `is_selected` on the
group's lines instead; do **not** add a second header column). Print/PDF
shows all options with the selected one totalled. The customer's choice on
the public page (§7) flips `is_selected`.

### 3.4 Quantity breaks

Two halves, both needed:

1. **Engine:** the cost-based template exposes volume tiers on
   `MARGIN_MARKUP` and `CUST_DISC` (`editableComponents[].tiered = true`
   with `TierEditor`, already built for the price-list template; the core's
   `ScaleTable` applies to `calc_basis QUANTITY`). A tier row is a rule
   with `scale.entries[{from, value}]`.
2. **Document:** a line can have break rows: `break_of = parent line id`,
   `break_qty = 10`, `qty` = the quantity the break is priced at, `rate`
   from its own engine call (`priceDocumentLine` with that quantity — the
   engine's tiers do the rest). The form shows "Add quantity break" under a
   priced line; the PDF prints a break table ("1–9: 22,365 · 10–49: 21,200
   · 50+: 20,100"); only the selected break (or the parent) counts in the
   total. Acceptance of a break on the public page selects it.

### 3.5 Status (2026-09-06)

**Built, awaiting migration 0116 + demo validation:** the line contract
migration (0116), `src/lib/sales/lineTotals.ts` (pure, 18 unit tests),
`POST /api/pricing/price-lines` (§3.2), and on `StandardQuoteForm.tsx`:
Price all lines, auto re-price on product/qty change to an already-priced
line, and rate-override detection (editing the rate by hand on a priced
line clears its `pricing_document_id` and shows "Rate overridden — no
longer tracked by the engine"). **Not yet built:** alternatives (§3.3) and
quantity breaks (§3.4) have no UI on either quote object yet — the schema
and `lineTotals.ts` are ready for them. Quotations (`QuoteForm.tsx`) has
not been touched at all in this slice; Price all lines there is next.

### 3.5b Acceptance (demo)

- SQ-2026-0002: "Price all lines" prices three lines in one click; changing
  qty on line 1 re-prices it without a click; editing the rate by hand
  shows "rate overridden" and drops the flag.
- A Standard Quote with two alternative groups totals only the selected
  one; PDF shows both.
- Line 1 with breaks at 10 and 50 prints a break table; the engine's
  margin tiers (25% / 22% / 20%) show in the why trace as
  "rule for everyone, band from 10".

## 4. Piece B — Opportunity (the Pipeline object)

Follow bpmsquarecore §3b **completely**; Products (`ba5bcba`) is the
reference implementation. Feature flag `features.pipeline` already exists
(default off) and the `pipeline` workcenter key exists; the nav item
"Pipeline" exists and points at the placeholder page.

### 4.1 Tables — migration 0117 `opportunities.sql`

```sql
create table opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  ref text,                                   -- OPP-0001 via insertWithMasterRef
  account_id uuid not null references accounts(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  source text,                                -- lead | campaign | direct | referral | other
  source_campaign_id uuid references campaigns(id) on delete set null,
  title text not null,
  description text,
  stage text not null,                        -- from config.opportunity_stages
  outcome text not null default 'open',       -- QUOTE_OUTCOMES: open|won|lost|dropped
  loss_reason text, loss_note text,           -- LOSS_REASONS vocabulary
  expected_close date,
  amount numeric(14,2) not null default 0,    -- see 4.4
  currency text,
  probability int,                            -- 0..100, rubric unless overridden
  probability_override int, probability_override_reason text,
  owner_id uuid references auth.users(id) on delete set null,
  team jsonb not null default '[]',           -- [{user_id, role:'owner'|'sales'|'technical'|'knows_customer'}]
  competitor text,
  approval_status text,                       -- null|pending|approved|rejected (piece C)
  custom_data jsonb,
  created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  closed_at timestamptz
);
create table opportunity_lines ( …the §3.1 contract with opportunity_id… );
-- RLS: standard tenant-isolation policy (for all) on both -- this is a CRM object,
-- not attendance/pricing; writes go through the API with requireTenantUser.
alter table quotes           add column opportunity_id uuid references opportunities(id) on delete set null;
alter table standard_quotes  add column opportunity_id uuid references opportunities(id) on delete set null;
alter table pricing_rfqs     add column opportunity_id uuid references opportunities(id) on delete set null;
-- indexes: (tenant_id, stage), (tenant_id, account_id), (tenant_id, owner_id), quotes/standard_quotes (tenant_id, opportunity_id)
```

`config.opportunity_stages: OpportunityStageDef[]` mirrors
`QuoteStatusDef` (`value, label, color, is_initial, is_closed,
probability_hint?`). Default: Qualify 20 → Propose 50 → Negotiate 75 →
Won 100 (closed, outcome won) → Lost 0 (closed, outcome lost). A closed
stage requires a decided outcome, exactly as quotes enforce.

### 4.2 Types and registry

`Opportunity`, `OpportunityLine`, `OpportunityStageDef` in `types.ts` /
`constants.ts`; `MASTER_REF_TABLES.opportunities = "OPP"`;
`PilotObjectType` + `PILOT_OBJECT_TYPES` + `FIELD_REGISTRY.opportunity`
(sections: Deal, Customer, Forecast, Ownership; `ref`, `amount`,
`probability` locked/export-only); `VALID_OBJECTS` in custom fields; DW
`ImportObjectId "opportunity"` with import (create by `account_name`),
export (real `id`), update (by `id`); v1 `LIST_SOURCES.opportunities` +
`GET /api/v1/opportunities[/id]` (exclude nothing sensitive, but
`probability_override_reason` and `team` are internal → keep out of v1
selects with a comment); MCP `list_opportunities` / `get_opportunity`;
change history filter entry; global search spec (title, ref, account
name); Nova: `OBJECTS.opportunities` in `api/nova/comments/route.ts`,
`LABEL`/`TABLE` in `api/nova/inbox/route.ts`, `ROUTE_FOR` in
`NovaInbox.tsx`, `<NovaTimelineSlot objectType="opportunities">` on the
detail page; ⌘K "New deal"; analytics metric `opportunities_open_value`
(sum amount × probability / 100 for open deals) + dashboard tile + report
metric; `DEFAULT_FEATURES.pipeline` stays off; `TenantEditor` FEATURES
already lists pipeline (verify).

### 4.3 Routes

| Route | Method | Note |
|---|---|---|
| `/api/opportunities` | GET, POST | list with filters (stage, owner, account, close month); POST inserts via `insertWithMasterRef`, verifies `account_id`/`contact_id`/`lead_id` belong to the tenant, sets initial stage, `logChange` |
| `/api/opportunities/[id]` | GET, PATCH, DELETE | PATCH allowlist: title, description, stage, outcome, loss_reason, loss_note, expected_close, currency, probability_override(+reason), owner_id, team, competitor, contact_id, custom_data (`cf_` filtered). Stage change → emit `opportunity.stage_changed` (piece C) |
| `/api/opportunities/[id]/lines` | PUT | replace lines (same tolerant insert pattern as quotes: `verifiedProductIds`, `derivePricingFlags`, `withPricingColumns`, `insertLinesTolerant("opportunity_lines")`); recompute `amount` |
| `/api/opportunities/[id]/convert` | POST | body `{ to: "standard_quote" \| "quotation", template_id? }` → creates the quote with `opportunity_id`, copies lines (**re-priced on the quote date** by calling `priceDocumentLine` per product line; lines without a product copy as-is), stage → Propose if earlier, returns the quote id |
| `/api/leads/[id]/convert` | POST | creates an opportunity from a lead (title from lead, source `lead`, `lead_id`), lead status → `won`?? **No** — add `converted` to `LeadStatus` and set it |
| `/api/quotes/[id]` and `/api/standard-quotes/[id]` PATCH | | accept `opportunity_id` (tenant-verified) — "Link to deal"; `POST /api/standard-quotes/[id]/create-deal` and the quotation twin create a deal from the quote (title = account + quote ref, lines copied *without* re-pricing, quote linked) |
| `/api/pricing/price-lines` | POST | §3.2, `document_type: "opportunity"` supported |

`pricing_rfqs.opportunity_id` is set when Send RFQ starts from a deal line.

### 4.4 Amount and probability

- `amount` = total of the **latest non-superseded quote** linked to the
  deal (pre-tax subtotal, so deals compare like for like), else the
  opportunity lines' total (`lineTotals.ts`). Recomputed on line save, on
  quote save/revise, on link/unlink. Stored, not computed on read, so the
  board and analytics are cheap.
- `probability` = `probability_override` if set, else the win rubric (§8)
  — computed on read for the detail page and on write for the stored
  column (refresh on any of: lines saved, quote linked/sent/opened, stage
  changed, nightly cron `api/sales/cron/refresh-probability` so
  time-based factors age).

### 4.5 Pages

- `/pipeline` — the **board**: one column per stage (from config),
  cards: title, account, amount, probability chip, owner avatar, days in
  stage, flag if any linked quote is blocked/pending approval. Drag to
  change stage (PATCH; a closed stage prompts for outcome + loss reason).
  Header: total open value, weighted value, filters (owner, account, close
  month), list/board toggle. Nova look (SVG icons, both colour modes,
  mobile: columns stack).
- `/pipeline/new`, `/pipeline/[id]` (detail: header + tabs **Lines ·
  Quotes · Win this deal · Approvals · Activity**), reusing the quote line
  editor component extracted from `StandardQuoteForm.tsx` (`
  src/components/sales/DocumentLinesEditor.tsx` — the one editor for all
  three objects, props: parent type/id, account, pricing on/off, groups
  on/off, breaks on/off).
- Quote detail pages get a "Deal" row (link) and the two actions.
- `ROUTES.pipelineNew`, `ROUTES.pipelineDetail(id)`.

### 4.6 Demo seed

`scripts/seed-opportunities-demo.sql` (idempotent, `is_demo` tenants
only, flips `features.pipeline` on): six deals across stages for the demo
accounts, one linked to SQ-2026-0002, one from a lead, one lost with a
reason.

### 4.7 Acceptance

Create a deal from the board → add PRD-0007/0008/0009 lines → Price all →
convert to Standard Quote → quote shows the deal, deal shows the quote,
amount follows the quote; a standalone Standard Quote → Create deal →
linked; drag to Won asks for outcome; Data Workbench export/import/update,
v1 `GET /api/v1/opportunities`, MCP `list_opportunities`, change history,
global search, Nova comment + inbox click-through all work; tenant without
`features.pipeline` sees nothing (nav, API 404, search).

## 5. Piece C — platform services: rules layer and approval engine

### 5.1 Events

`src/lib/events/emit.ts`: `emitEvent(tenantId, { name, object_type,
object_id, actor_id, payload })`. Called by routes **after** the write
succeeds. Catalogue (extend as needed; every name is a string constant in
`src/lib/events/catalog.ts`):

| Event | Emitted by |
|---|---|
| `opportunity.created`, `opportunity.stage_changed`, `opportunity.updated`, `opportunity.closed` | opportunity routes |
| `quote.created`, `quote.updated`, `quote.priced`, `quote.sent`, `quote.revised`, `quote.status_changed`, `quote.outcome_changed` | both quote objects (`object_type` = `quote` \| `standard_quote`) |
| `quote.opened`, `quote.accepted`, `quote.change_requested` | public link routes (§7) |
| `pricing.version_published`, `pricing.rfq_replied` | pricing routes |
| `approval.requested`, `approval.step_decided`, `approval.completed` | approval engine |
| `wfm.leave_requested`, `wfm.ot_requested` | later; the mechanism is generic |

Payload = the object's row (post-write) plus `changes` (`diffForLog`
output) and, for quotes, `pricing: { blocked_lines, min_margin_pct,
subtotal, total }`.

### 5.2 Rules — migration 0118 `automation_rules.sql`

```sql
create table automation_rules (
  id uuid pk, tenant_id uuid not null → tenants,
  name text not null, enabled boolean default true,
  event text not null,                       -- catalogue name
  object_type text,                          -- optional narrowing
  condition text,                            -- pricing DSL expression over payload, null = always
  actions jsonb not null,                    -- [{type, ...params}] see 5.3
  run_order int default 100,
  created_by uuid, created_at, updated_at
);
create table automation_runs (               -- append-only audit
  id uuid pk, tenant_id uuid not null, rule_id uuid, event text, object_type text, object_id uuid,
  matched boolean, actions_run jsonb, error text, ms int, created_at
);
-- RLS: select for tenant members; NO write policy (writes via admin client in routes), same as pricing tables.
```

**Execution** (`src/lib/events/engine.ts`): synchronous, inside the
request that emitted the event, after the write, best-effort (a rule
failure is logged in `automation_runs.error`, never fails the user's
save). Load enabled rules for (tenant, event) — request-cached. Evaluate
`condition` with the pricing DSL evaluator (`src/lib/pricing-core/dsl`,
hooks: `pricingDate` = `tenantToday`) over `flattenContext(payload)`. Run
actions in order. **Loop guard:** actions run with `depth = 1`; events
emitted by actions are delivered with `depth + 1` and the engine ignores
events at depth > 2; a rule id fires at most once per request.

### 5.3 Actions (fixed registry, `src/lib/events/actions.ts`)

| type | params | effect |
|---|---|---|
| `set_field` | `field, value` (value may be a DSL expression) | PATCH through the object's own server helper (allowlisted fields only) |
| `set_stage` / `set_status` | `value` | same |
| `start_approval` | `policy_id` | §5.4 |
| `notify` | `to: {user_id \| role_id \| owner \| team \| email}, subject, body` (templated `{{payload.x}}`) | in-app: a `record_comments` row of kind `system` on the object (renders in the Nova timeline and inbox); email through `resolveOutbound` |
| `create_task` | `assignee, title, due_in_days` | a `record_comments` row of kind `task` with `due_at`, `done_at` (add these two columns in 0118) |
| `add_comment` | `body` | `record_comments` kind `system` |
| `create_revision` | — | quote revise (§7) |
| `webhook` | `url` (must pass `assertSafeSourceUrl`), payload | reuse the integration-push signing |

No scripting, no arbitrary SQL, no loops.

### 5.4 Approvals — same migration 0118

```sql
create table approval_policies (
  id uuid pk, tenant_id, name, enabled,
  object_type text not null,                 -- opportunity | quote | standard_quote | pricing_version | wfm_leave …
  trigger_event text not null,               -- usually *.updated / quote.priced / quote.sent-attempt
  condition text,                            -- DSL; e.g. "pricing.min_margin_pct < 15 or total > 1000000"
  steps jsonb not null,                      -- [{ step:1, approver: {kind:'role', role_id} | {kind:'user', user_id} | {kind:'owner_manager'}, due_hours:24, label:'Pricing manager' }]
  on_reject text default 'block',            -- block | warn
  run_order int
);
create table approvals (
  id uuid pk, tenant_id, policy_id, object_type, object_id,
  status text not null default 'pending',    -- pending | approved | rejected | cancelled
  current_step int default 1,
  requested_by uuid, requested_at, decided_at,
  context jsonb                               -- snapshot: what was asked (lines, margins, total) so the decision is explainable later
);
create table approval_steps (
  id uuid pk, tenant_id, approval_id, step int, label text,
  approver_kind text, approver_ref uuid,      -- role_id or user_id
  status text default 'waiting',              -- waiting | pending | approved | rejected | skipped
  decided_by uuid, decided_at, comment text, due_at
);
-- RLS select-only for members; writes via admin client.
-- `approval_status` column added to quotes, standard_quotes, opportunities (0117 already has it for opportunities).
```

**Engine** (`src/lib/approvals/engine.ts`):
- `startApproval(tenantId, policy, object, actorId)`: one open approval
  per (object, policy) — re-triggering while pending is a no-op;
  re-triggering after approval **re-opens** only if `context` changed
  materially (lines/total/margin hash differs). Sets
  `<object>.approval_status = 'pending'`, resolves step 1's approvers
  (role → `business_user_roles` members of that role; user → that user;
  `owner_manager` → the tenant admin until employees carry a manager),
  notifies them (inbox + email via `resolveOutbound`), emits
  `approval.requested`.
- `decide(approvalId, stepId, userId, approve|reject, comment)`: only a
  resolved approver of the *current* step (or a tenant admin, logged as
  override) may decide; approve advances to the next step or completes;
  reject completes as rejected; every decision → `approval_steps` +
  `logChange` + event. Completion sets `<object>.approval_status`.
- **Send gate** (both quote email routes, and later "Mark as sent"): if
  any line has a `block` flag **and** `approval_status !== 'approved'` →
  409 with the reason; if `approval_status === 'pending'` → 409 "awaiting
  approval by <step label>". Approved quotes send even with flags (the
  flag stays visible). Editing lines after approval resets
  `approval_status` to null (the hash changed) — the rule re-triggers.
- Default policy seeded for the demo: "Margin below floor → Pricing
  manager (role) → Sales head (role)"; a second: "Total above 10,00,000 →
  Sales head".

**UI**
- Settings → **Automation** (rules) and Settings → **Approvals**
  (policies): list + editor; condition is a text field with the DSL and a
  "test against a recent document" button (reuse the pricing DSL sandbox
  route pattern: `POST /api/settings/automation/test`).
- **Approvals tab** on the quote and the opportunity: the chain (steps,
  who, due, decided when, comment), "Request approval" when a policy
  matches but nothing is pending, Approve / Reject for the current
  approver.
- **Approver inbox:** Nova inbox gains a section "Waiting for you"
  (`api/nova/inbox` lists pending `approval_steps` for the user's roles),
  each row deep-links to the object's Approvals tab.
- Board cards and quote lists show a small "Pending approval" chip.

### 5.5 Acceptance

Policy "margin < floor → Pricing manager → Sales head": on SQ-2026-0002
Price all → the send gate says "awaiting approval by Pricing manager"; the
pricing manager approves from the inbox → step 2 pending; sales head
approves → Email to customer sends; editing a line resets to pending. A
rule "quote.sent → create_task owner 'Follow up' due 7 days" creates the
task on the timeline. `automation_runs` shows every firing.

## 6. Piece D — versioning and the customer's answer

### 6.1 Rule

Once a quote's status is `sent` (Quotations: `status = sent` or
`sent_at` set; Standard Quotes: `sent_at`), the **Edit** action becomes
**Revise**. Revise = create a new row (`revision + 1`, copies header, lines
*with* `pricing_document_id`/flags, groups, breaks, `opportunity_id`),
marks the old row `superseded_by = new.id` (read-only everywhere: the
PATCH routes refuse with 409 when `superseded_by` is set), then the new
quote is re-priced on save (Price all runs automatically on the first
open of the revision; the old version keeps its documents). Emits
`quote.revised`. Quotations already have `revision`, `superseded_by`,
`quote_revisions`; **Standard Quotes gain `revision int default 1`,
`superseded_by uuid`, `revised_from uuid`** (migration 0116). Deal
`amount` follows the latest version.

### 6.2 Public link

Quotations have a signed public print link (`src/lib/quotePublicLink.ts`,
`signQuotePublicToken` / `verifyQuotePublicToken`, timing-safe). Extend
the same module to Standard Quotes (`signPublicToken(objectType, id)`).
Public page adds **Accept** and **Ask for a change** (a text box). Both
POST to `/api/public/quotes/[type]/[id]/[token]/respond` (no login; token
verified; rate-limited by token; the body is untrusted text — store, never
render as HTML). Effects: `quote.opened` (first GET per day), `quote.accepted`
(outcome → won, status per tenant config's closed status, deal → Won),
`quote.change_requested` (comment on the timeline with the text, notify
owner; a default rule may `create_revision`). Selecting an alternative or
a break on the page sets `is_selected` before accept.

### 6.3 Acceptance

Send SQ-2026-0002 (demo redirect inbox) → Edit is now Revise → revise →
v2 opens re-priced, v1 read-only with its old documents → customer link:
Ask for a change → timeline shows it, owner notified, rule opens v3.

## 7. Piece E/H — "Win this deal" tab

Mounted on the opportunity and on both quote detail pages (a quote with no
deal computes from its own account and lines). Server component
`src/lib/sales/win/*.ts`, one function per card, each returning `{ score?,
lines: string[], data }` so the UI never computes.

### 7.1 Win rating (rubric; `rating.ts`, pure, unit-tested)

| Factor | Signal | Points |
|---|---|---|
| History | this account's decided quotes in 24 months: win rate × recency | 0–25 |
| Price position | this quote's per-line price vs the account's last paid price for the same product (avg % delta) | −15..+15 |
| Band position | vs other customers, same tier & region, same product, 12 months (from `pricing_documents` context + result) | −10..+10 |
| Margin health | any block flag −15; any warn flag −5; none +5 | −15..+5 |
| Engagement | link opened +10; opened ≥2 times +5; not opened after 5 days −10 | −10..+15 |
| Momentum | days since last activity (comment, edit, email): ≤3 +5, 4–10 0, >10 −10 | −10..+5 |
| Relationship | open cases > 2 −5; active AMC +5; account age > 2 y +5 | −5..+10 |
| Stage prior | from `opportunity_stages[].probability_hint` | base |

Score = clamp(base + Σ, 0, 100). Each factor emits a one-line reason with
its number; the card shows the score, the three biggest reasons for and
against. `probability_override` shows as "Rep says 80% — <reason>" beside
it, never replaces the working.

### 7.2 Price position (`pricePosition.ts`)

Per product line: last price this account paid (won quote lines, 24
months), band for the same product across accounts with the same
`accounts.type` and `accounts.state` (p25/median/p75 of pre-tax rates
from `pricing_documents.result` joined to context attributes), and this
line's position ("top of band", "below median"). Needs an index on
`pricing_documents (tenant_id, created_at)` and the context's
`product.id` — add a generated column `product_id` on `pricing_documents`
from the first line's `product.id` (0118) so the query is not a JSON scan.

### 7.3 Who knows the customer (`people.ts`)

From existing data: quote `created_by` on won quotes for the account,
`service_cases.assigned_to` on closed cases, account owner (custom field
or `created_by`), last email sender (`quote_emails` / campaign sends if
present). Output ranked list with why. Button "Ask" → opens a Nova comment
on the object with `@user` pre-filled (mentions already route to the
inbox).

### 7.4 Customer signals (`signals.ts`)

`quote_link_events` (0118): `object_type, object_id, kind
(opened|accepted|change_requested|option_selected), at, ip_hash,
user_agent`. Written by the public routes (§6.2). Card: timeline of
signals.

### 7.5 Later cards (piece H)

Usually bought together / missing (won quote lines co-occurrence per
account and per tier); follow-up nudges (rules layer `create_task` with
defaults seeded per tenant: sent + 7 days not opened); deal room
checklist (a `record_comments` kind `task` list with templates per stage);
market brief (AI; `api/nova/market-intel` exists — extend with a per-deal
prompt, sourced, dated, cached 24 h, clearly labelled); objection playbook
(tenant-authored answers in `config.sales.objections[]`, AI picks by
product/category).

### 7.6 Acceptance

On SQ-2026-0002's deal: rating shows a number and its reasons; price
position shows "no history" for the demo account until seed data adds two
won quotes; who-knows lists the demo admin; after the public link is
opened the signal appears and the rating moves.

## 8. Piece F — freight and additional costs

### 8.1 Model

`config.pricing.freight`:
```ts
{ default_incoterm: "EXW"|"FOB"|"CIF"|"DAP"|"DDP", zones: [{ code, label, states: string[] }] }
```
Table `freight_rates` (0119): `tenant_id, leg (inbound|outbound), basis
(pct_of_cost|per_unit|per_kg|per_shipment), zone_from, zone_to, rate,
currency, min_charge, valid_from, valid_to, supplier_id?` (inbound rates
may be per supplier). Product gains `weight_kg numeric`, `volume_m3
numeric` (0119); account gains `incoterm text` and `freight_zone text`
(derived from state via zones when null); supplier gains `freight_zone`.

### 8.2 Engine integration

- **Inbound** stays before LANDED_COST: the adapter (`costSheet.ts`)
  injects a cost item `freight.inbound` (kind `FREIGHT`, new
  `CostInputKind`; widen the 0083 check the way 0115 did) whose candidate
  value is computed from the matching `freight_rates` row × basis
  (weight × qty, units, shipment, or % of the resolved purchase cost —
  the % case is a `FORMULA` component instead). Source code `RATE_CARD`,
  quality `list`, `as_of = valid_from`, so the ladder, trace and staleness
  all apply unchanged. The existing FREIGHT percent rule stays as the
  fallback when no rate card row matches.
- **Outbound**: new component `FREIGHT_OUT` (class FREIGHT, after NET_2,
  before TAX, own subtotal `NET_3`), `calc_type FORMULA`:
  `line.freight_out_amount` — the adapter computes it from the rate card
  (warehouse zone → customer zone) and puts it in the line attributes;
  a rule condition on `incoterm` (`in ('DAP','DDP')`) applies it, else
  the step is skipped and the trace says "EXW — customer pays freight".
  The quote header's `shipping_amount` becomes read-only when the engine
  priced outbound freight (sum of `FREIGHT_OUT` across lines) and is
  printed as one line.
- **Additional costs** (packing, insurance, duties, certification) are
  `SURCHARGE` components with the same rate-card mechanism (`kind`
  column on `freight_rates` → rename the table `cost_rate_cards` if
  built together).
- Pricing setup: a "Freight" step with the zones, default Incoterm, and a
  rate-card grid; Today's rates summarises it in words.

### 8.3 Acceptance

PRD-0009 with weight 12 kg, inbound rate Pune→Bengaluru 40/kg: trace shows
"freight.inbound 480 · from rate card, list, as of …"; account DDP →
FREIGHT_OUT appears and the header shipping is read-only; account EXW →
step skipped with the reason.

## 9. Piece G — multi-supplier

Table `product_suppliers` (0120): `tenant_id, product_id, supplier_id,
preferred boolean, cost numeric, currency, uom, lead_time_days, moq,
valid_from, valid_to, as_of, source (manual|rfq|import), notes, unique
(tenant_id, product_id, supplier_id)`. RLS standard.

- `productCostCandidates()` adds one candidate per row on
  `purchase.unit_cost` with `source_code SUPPLIER`, quality `confirmed`,
  plus `supplier_id`, `preferred`. `CostCandidate` and `CostConsidered`
  gain those two fields; `resolveCost()` tie-break **within a tier**:
  preferred first, then lowest value, then most recent `valid_from`
  (replace the AMBIGUOUS error for equal `valid_from` with this order
  when suppliers differ; keep it when the same supplier has two rows).
  Trace line: "92,500 × 1 · from Meridian Door Systems (preferred),
  confirmed, as of …; Anand 89,000 not preferred".
- RFQ: `POST /api/pricing/rfqs` accepts `supplier_ids[]` → one
  `pricing_rfqs` row per supplier, one email each; the RFQs tab groups
  them by product; a reply upserts the `product_suppliers` row (and the
  cost input as today).
- Product page: "Suppliers" card (list, preferred toggle, add); supplier
  page: "Products supplied".
- Ladder in Pricing setup shows rung 2 as "Supplier price (preferred, then
  lowest)".

## 10. Cross-cutting

- **Permissions:** opportunities under workcenter `pipeline`
  (view/create/edit/delete grants already exist in the catalog); rules
  and approval policies are admin-only settings; deciding an approval
  needs membership of the step's role (not a workcenter grant).
- **Feature flags:** `pipeline` (exists), `sales_automation` (new: rules +
  approvals UI; the engines run only when on), `sales_win_tab` (new),
  `pricing_engine` (exists) for freight/multi-supplier. All default off,
  rows in `TenantEditor` FEATURES and `DEFAULT_FEATURES`.
- **Emails:** every outbound mail through `resolveOutbound()`; links via
  `tenantOrigin()` / `buildAbsoluteUrl()`; never `PRIMARY_HOST`.
- **Dates:** "today" for any tenant-facing rule is `tenantToday()`
  (`src/lib/tenantClock.ts`), never the server's UTC date.
- **Change log:** `logChange` on every mutation of every new table.
- **Docs:** the Sales Cloud Guide (Drive) gains Deals, Price all,
  alternatives/breaks, versioning, approvals; the Admin & Setup Guide gains
  Automation and Approvals; the API guide gains `/api/v1/opportunities`.
  Refresh in the same piece of work (bpmsquarecore §9).
- **Tests:** pure modules get unit tests (`lineTotals`, `rating`, rule
  condition evaluation, approval step resolution, freight basis maths,
  supplier tie-break); route-level behaviour is proven on the demo walk
  with screenshots, appended to a `docs/BPMSquare_Sales_Engine_Walkthrough.docx`
  per piece (same method as the pricing walkthrough).
- **Migrations:** 0116 line contract + SQ versioning · 0117 opportunities
  · 0118 automation + approvals + link events + pricing_documents.product_id
  · 0119 freight · 0120 product_suppliers. Each listed in PROJECT.md's
  ledger as pending on both DBs with its seed; code degrades while pending.

## 11. What NOT to do

- Do not make a deal mandatory anywhere (decision 5).
- Do not touch Quotations' layout or flow beyond: `opportunity_id`,
  breaks columns, the Revise-when-sent rule, the "before tax" label,
  Price all. The design partner uses it daily (memory: client familiarity).
- Do not put tenant-specific logic in standard files; extensions live in
  `src/extensions/<slug>/`.
- Do not compute the win rating with AI, and do not store AI text as a
  fact.
- Do not build approvals inside the quote routes; they call the engine.
- Do not add a second alternative-selection mechanism on Quotations
  (`selected_option_id` stays).
- Do not let the rules engine run actions that emit events at depth > 2.
- Do not add npm packages for any of this; everything needed exists.

## 12. Definition of done per piece

tsc and `next build` clean; unit tests green; migration file(s) +
PROJECT.md ledger entry + seed; §3b checklist items listed in the commit
with every deliberate skip; demo walk with screenshots appended to the
walkthrough doc; Drive guide refreshed or explicitly deferred in the
commit; owner validates on the demo before the next piece starts.

## 13. Sequence

| # | Piece | Migrations | Section |
|---|---|---|---|
| A | Line contract, Price all, alternatives, breaks (Standard Quotes first, then Quotations) | 0116 | §3 |
| B | Opportunity + Pipeline board + convert + lead conversion | 0117 | §4 |
| C | Rules layer + approval engine + Approvals tab + inbox | 0118 | §5 |
| D | Versioning rule + public Accept / Ask for a change | (0116, 0118) | §6 |
| E | Win tab cards 7.1–7.4 | (0118) | §7 |
| F | Freight model | 0119 | §8 |
| G | Multi-supplier | 0120 | §9 |
| H | Win tab 7.5 | — | §7.5 |
| I | Price-list, value-based, variant techniques; pricing batches 4–8 | per pricing spec | — |

## 14. Open decisions (owner)

1. Default opportunity stages and their probability hints (proposed:
   Qualify 20, Propose 50, Negotiate 75, Won, Lost).
2. Two or three approval policies for the demo (proposed in §5.4).
3. Freight: legs, bases and zones the first real tenant needs (§8).
4. Whether `owner_manager` approvers need a manager field on employees
   now, or the tenant-admin fallback is enough for the demo.
