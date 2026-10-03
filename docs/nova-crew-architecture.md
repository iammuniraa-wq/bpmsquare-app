# BPMSquare Nova Crew — architecture v1.0 (2026-09-11)

> **Who this is for.** The engineer (human or model) implementing the AI
> Workforce module described in `BPMSquare_AIWorkforce_Requirements.md`
> (Abdul Nandalpad, 2026-09-11 draft). That file is the *why* and the
> agent roster; this file is the *what* and *how*, grounded against what
> actually exists in the codebase today rather than the requirements
> doc's assumptions — several of which (an outbox/event bus, a
> pricing-engine audit pattern to "reuse") are not built yet.
>
> **Read first, every time:** `bpmsquarecore.md` §1 (extension
> architecture), §3b (new-object checklist), §10 (Nova rollout doctrine —
> this module lives *inside* that doctrine, not beside it),
> `MULTI_TENANT_GUARDRAILS.md`, `docs/pricing-engine-architecture.md`
> (the monolith-first-with-a-boundary precedent this plan copies exactly),
> `docs/sales-engine-architecture.md` (the sibling initiative this plan
> shares its event-bus and approval-gate foundation with).

---

## 0. Owner decisions that shape everything (do not re-open)

| # | Decision | Date |
|---|---|---|
| 1 | Name: **Nova Crew**. Not "AI Workforce" — that collides with the existing Workforce Management (WFM) module (human attendance/roster), which is a live, contract-facing module. Nova Crew is positioned as the **execution layer behind Nova**, not a competing AI surface — Nova's own candidate pillars already include "AI record creation," which is what the Estimator/Growth agents do. | 2026-09-11 |
| 2 | **Clean boundary, BPMSquare-only for v1** — mirror the pricing-core precedent exactly (framework-free core module, lint-enforced boundary). No external multi-tenant SaaS auth/billing work now. Package extraction stays a deferred, measured-trigger decision, same as pricing-core. | 2026-09-11 |
| 3 | **The event/outbox mechanism is a shared platform primitive**, built once, before either Nova Crew's runtime or the Sales Engine's rules layer consumes it — not two divergent event systems. This is now a cross-initiative dependency; see §4 Piece A. | 2026-09-11 |
| 4 | **Nova Crew inherits the Nova rollout doctrine in full** (bpmsquarecore §10): gated on `features.next_experience`, platform-admin-only, default off, step-by-step with owner validation before widening. It does **not** get its own separate feature flag that could accidentally reach a client tenant sooner than Nova itself. See §7 for what this means for the Phase 1 exit criterion. | 2026-09-11 |
| 5 | **Determinism boundary is absolute** (inherited from requirements doc NFR-04, same doctrine as Account 360's rating and the Sales Engine's win rating): an agent never computes a price, a payroll-relevant attendance number, or any other number a human is told to act on. It calls the domain engine and reports the result. AI may rewrite explanation text, never the number. | 2026-09-11 (requirements doc) |

---

## 1. Vocabulary

| Term | Meaning here |
|---|---|
| **Agent** | A named, tenant-facing role (Estimator, Dispatcher, Ops, Insights, Growth) with a fixed module scope and an allow-listed set of tools. Not a chat persona — a scoped worker. |
| **Task** | One unit of agent work (`agent_task`), triggered by an event or an interactive ask, carrying its own Status Schema lifecycle. |
| **Tool adapter** | A typed wrapper around one existing domain service call (e.g. `quote.createDraft`). Agents never touch a table directly — same rule as extensions calling "existing service interfaces," never raw data access. |
| **Approval gate** | The human-in-the-loop checkpoint every write-type task result passes through unless the tenant granted autonomy for that specific action type. |
| **Event** | A named thing that happened to a domain object (`quote.created`, `case.status_changed`). Carried on the shared outbox (§4 Piece A) — the same primitive the Sales Engine's rules layer needs. |
| **Autonomy level** | Per-tenant, per-action-type setting: `draft-only` (default) → `auto-with-notify` → `autonomous`. |

---

## 2. Where this sits (revised placement)

```
┌──────────────────────────────────────────────────────────────────┐
│  Nova UI  (Team page, Agent Inbox, Task detail)                  │
│  — gated on features.next_experience, same as every Nova surface │
├──────────────────────────────────────────────────────────────────┤
│  src/lib/nova-crew/            ← BPMSquare integration layer     │
│    adapters/     tool adapters bound to real domain services     │
│    runtime.ts    DB-backed task queue + approval gate wiring     │
│    agents/        Estimator, Dispatcher, Ops, Insights, Growth   │
├──────────────────────────────────────────────────────────────────┤
│  src/lib/crew-core/            ← framework-free core (pricing-   │
│    registry · task lifecycle contract · tool-adapter interface   │  core's exact
│    approval-gate contract · budget contract                      │  boundary pattern
│    (no Next.js, no Supabase import — pure TS, unit-testable)     │
├──────────────────────────────────────────────────────────────────┤
│  PLATFORM PRIMITIVES (new, shared with Sales Engine)             │
│  Event/outbox bus  ·  Status Schema engine (existing, reused)    │
│  Approval-chain service (shared with Sales Engine's rules layer) │
├──────────────────────────────────────────────────────────────────┤
│  DOMAIN MODULES (existing, unchanged public APIs)                │
│  Case · WFM · Projects/Sites · Quote · Pricing Engine             │
├──────────────────────────────────────────────────────────────────┤
│  Platform: Postgres · Supabase RLS · auth/tenant · Anthropic SDK │
└──────────────────────────────────────────────────────────────────┘
```

**What changed from the requirements doc's diagram:** the core runtime is
split into `crew-core` (portable, no framework imports — the thing that
could theoretically become a package later) and `nova-crew` (the
BPMSquare-specific wiring: real tool adapters, real Supabase-backed task
queue, real tenant/role checks). This split is the entire mechanism that
keeps decision #2 (clean boundary, no premature extraction) honest — same
lint-rule-enforced pattern as `pricing-core`.

---

## 3. What already exists vs what's new

| Requirement | Status |
|---|---|
| Task lifecycle (Queued → Running → Awaiting Approval → Done/Rejected/Failed) | **Reuse as-is.** `statusEngine.ts` + migration `0070`; add `agent_task` to `StatusEntityType`. |
| LLM client, tenant-scoped agentic tool-use loop | **Reuse the pattern**, not the code. `src/lib/ai/assistant.ts` is the proven shape (permission-filtered tool catalog, `MAX_TURNS` cap, validation-error-fed-back-for-self-correction). Nova Crew's tool adapters follow the same discipline but are write-capable where the assistant's are read-only. |
| Event/outbox bus | **New — foundational.** Does not exist. Blocks both Nova Crew and the Sales Engine's rules layer. Build once (§4 Piece A). |
| AI-advisory + audit-log pattern "from Pricing Engine" | **New.** Pricing Engine's own docs list this as an un-built Phase 3 design principle. Nova Crew builds the first real version; Pricing Engine's future Phase 3 should adopt Nova Crew's schema rather than inventing a second one — flag this explicitly when that phase starts. |
| Tenant extension hooks (`TenantExtension`) | **Not reusable.** UI/form hooks, not a tool-invocation registry. Tool adapters get their own registry in `crew-core`, not `src/extensions`. |
| Monolith-first with an extractable boundary | **Reuse the pattern.** Copy `pricing-core`'s lint-enforced "no framework import" rule verbatim for `crew-core`. |
| Memory (`agent_memory`, vector store) | **Unverified — open item.** Requires `pgvector` (or equivalent) on the Supabase instance; not confirmed available. Do not start Piece D until checked (see §8). |

---

## 4. Pieces (build order: A → B → C → D → E → F → G → H → I)

### Piece A — Event/outbox bus (platform primitive, shared with Sales Engine)
- `domain_event` table: `id, tenant_id, type (text, e.g. "quote.created"), payload jsonb, source_table, source_id, created_at, processed_at`.
- Emission: a small helper (`emitEvent()`) called from existing service functions at the points that already mutate state (quote create, case status change, wfm attendance flag, project scheduled) — **additive**, no behavior change to those functions.
- Consumption: polling-based dispatcher initially (no message broker) — a scheduled job reads unprocessed rows per tenant, ordered, marks `processed_at`. Matches this codebase's existing no-separate-services bias.
- RLS: standard tenant-isolation policy, same migration as the table (`MULTI_TENANT_GUARDRAILS.md` template).
- **Consumers in v1:** Nova Crew's trigger listeners (Piece C) and, separately, the Sales Engine's rules layer when it's built — same table, two independent consumers, no coupling between the two initiatives beyond the schema.

### Piece B — `crew-core` (framework-free core module)
- `registry.ts` — agent definition → allow-listed tool adapter keys. Pure data + lookup, no I/O.
- `taskLifecycle.ts` — the state machine contract (delegates actual persistence to `nova-crew`, defines the shape).
- `toolAdapter.ts` — the adapter interface every domain tool implements: `{ key, allowedRoles, invoke(ctx, params) }`.
- `approvalGate.ts` — contract for "does this action type require approval for this tenant" — pure function over a tenant's autonomy-matrix config.
- `budget.ts` — token budget check contract (soft warn / hard stop).
- Lint rule: no `next/*`, no `@supabase/*` imports in this directory — exact copy of the `pricing-core` boundary enforcement.

### Piece C — `nova-crew` integration layer
- Real task queue: `agent_task` table (tenant, agent_key, trigger event id, input context — **stored in full**, same replay-ability decision as pricing simulation), status via Status Schema engine.
- Real tool adapters: one per allow-listed domain call (`quote.createDraft` → calls the existing quote-creation service function, never a table). Every adapter enforces tenant + role scope at the adapter boundary, not trusted from the caller.
- Trigger listeners: subscribe to `domain_event` rows (Piece A) matching each agent's trigger list; enqueue `agent_task` rows.
- API routes: `POST /agents/{key}/ask`, `GET /agents/tasks`, `POST /agents/tasks/{id}/approve|reject|edit`, `PATCH /agents/{key}/settings` — all behind `requireTenantUser()` + `features.next_experience`.
- Nova UI: Team page (agent cards) and Agent Inbox as **Nova surfaces**, gated exactly like every other Nova piece — no separate flag.

### Piece D — Audit log + budget enforcement
- `agent_task_audit` table: input snapshot, model, prompt version, output, human decision, rationale. This becomes the shared audit standard other AI features (Pricing Engine Phase 3, when it happens) should adopt rather than re-invent.
- `agent_budget` table: tenant, period, tokens_allowed, tokens_used; enforced at the `crew-core` budget contract, checked before every model call.
- Kill switch: `agent_instance.paused` — checked before task execution, not before enqueue (paused agents keep queueing per NFR-06).

### Piece E — Estimator (Phase 1a)
- Triggers: `case.created` (with scope), interactive ask.
- Tool adapters: `pricing.evaluate` only — **never** computes a price itself (NFR-04). Assembles context, calls the engine, explains via the DSL's existing explain output.
- Output: draft quote (Awaiting Approval), margin-risk flag, missing-standard-line flag.

### Piece F — Insights (Phase 1b)
- Read-only. Scheduled reports (daily/weekly) + ad-hoc NL questions, reusing `LIST_SOURCES`/`compileAndRun` exactly like the existing dock assistant — this agent is closest to already-built code.

### Piece G — Dispatcher + Ops (Phase 2, draft-only)
- Dispatcher: crew assignment proposals from WFM data (skills, leave, attendance flags, site distance). No roster write without approval unless tenant sets `autonomous` for "same-site swap" specifically.
- Ops: SLA-dwell watcher on Status Schema transitions (already has the dwell-time data), drafts nudges/escalations.

### Piece H — Growth (Phase 3)
- Inbound lead qualification first, then follow-up cadence. Outbound is opt-in per tenant, respects consent flags (GDPR/DPDP) — same `resolveOutbound()` discipline as every other outbound email in this codebase.

### Piece I — Autonomy levels beyond draft-only, per-tenant model routing (Phase 4)

---

## 5. Data model summary

New tables (all `tenant_id uuid not null references tenants(id)`, RLS + same-migration isolation policy, `custom_data jsonb` only where genuinely user-facing):

`domain_event` (Piece A) · `agent_definition`, `agent_instance` (Piece C) · `agent_task` (Piece C — status via Status Schema engine, no separate status column) · `agent_tool_call` (Piece C) · `agent_task_audit` (Piece D) · `agent_budget` (Piece D) · `agent_memory` (Piece D — **blocked on pgvector verification**).

Every table: pending-migration degrade-clean rule applies (42P01 renders as empty/hidden, never a crash) — same as every other module per bpmsquarecore §3b, since the owner applies SQL by hand.

---

## 6. §3b new-object checklist — applicability

Nova Crew's tables are system/internal objects, not customer CRUD objects like Accounts or Quotes. Per §3b's own instruction ("if a point doesn't apply, say so explicitly"):
- **Applies in full:** DB/RLS, custom_data (only `agent_instance`, for tenant rename/autonomy config), feature flag (inherits `next_experience`, no new flag), change history on task decisions, Nova timeline integration (task comments/mentions land in the existing Nova inbox machinery).
- **Deliberately deferred / doesn't apply:** Data Workbench (import/export/update) — no bulk-editable business object here. v1 public API — internal-only in v1, not exposed to `/api/v1`. MCP `list_/get_` tools — revisit once the runtime is proven; not v1. Global search, ⌘K "New <object>" — an agent task isn't something a user creates from the palette; "Ask {agent}" could become a palette action later, not v1. Analytics/Reports metrics — defer to Insights agent itself surfacing this data, not a duplicate dashboard tile.

---

## 7. Phased plan (from requirements doc, unchanged) + the Nova-gate dependency

| Phase | Scope | Exit criterion | New dependency from this doc |
|---|---|---|---|
| 1 | Runtime + Inbox + Estimator + Insights | Vikas Pioneers uses Estimator drafts on ≥50% of quotes for 4 weeks; audit log complete | **Requires the owner to explicitly widen `features.next_experience` to Vikas specifically** (bpmsquarecore §10 rule 2) before this exit criterion can even start being measured — Nova has not been widened to any client tenant yet. Sequence this conversation before Phase 1 build, not after. |
| 2 | Ops + Dispatcher (draft-only) | Stalled-case rate down measurably; ≥70% dispatch-proposal acceptance | — |
| 3 | Growth | Follow-up sent within cadence on ≥90% of open quotes | — |
| 4 | Autonomy beyond draft-only, per-tenant model routing | Two tenants running ≥1 `autonomous` action type without incident | — |

---

## 8. Open items (carried forward + new)

1. **pgvector availability** — unverified on the Supabase instance. Confirm before Piece D memory work starts; if unavailable, `agent_memory` needs a fallback (e.g. tsvector full-text) or the feature slips.
2. Agent memory: shared across a tenant's agents, or siloed per agent? (requirements doc open question, unresolved)
3. WhatsApp as a Phase 1 approval channel, or in-app only? (requirements doc open question, unresolved)
4. Does a "Big Blue"-class enterprise need BYO-model before Phase 4? (requirements doc open question, unresolved)
5. Growth agent: tenant feature only, or later reused internally by ServiceSphere? Recommendation unchanged from requirements doc — tenant feature first.
6. **New:** who owns the `domain_event` dispatcher's polling job (cron, existing scheduled-tasks mechanism, or a new one) — not yet decided; pick when Piece A is built, informed by whatever the Sales Engine side needs too.
