# Nova Assistant: the slider becomes an agent (design v1, 2026-10-21, Fable)

> Owner ask (2026-10-21): "make the Slider AI smarter: not only answer like
> Talk to data but perform actions like Ctrl+K, and suggest, like a real
> assistant. Whatever a user can do manually in BPMSquare, the assistant can
> do too. It comes with credits: make it feasible, and clients pay more if
> they want more. And the claim of native AI should stay true: any new table
> or customisation is read by the AI automatically, no specific action."

Status: design for the owner's approval. Build on Sonnet, one step at a
time (§10), each validated on the demo before the next.

## 1. What exists and is kept

| Piece | Where | Keep |
|---|---|---|
| The dock: chat over live data, follow-ups keep context, inline charts | `src/components/AIDock.tsx`, `/api/ai/ask`, `src/lib/ai/assistant.ts` | yes: it becomes the "answer" ability of the agent |
| The safe NL→query discipline (forced tool, field enum from `FIELD_REGISTRY`, compiled to the same query every list route validates; the model never writes SQL, never produces a number itself) | `docs/ai-vision.md` §2–3 | unchanged, it is the read half |
| Permission-filtered catalog (`canViewWorkcenter` before the prompt is built) | `assistant.ts` | extended to actions |
| Paste-to-record drafting (review, then it is real) | Nova draft panel | becomes one action among many |
| AI meter: monthly token allowance per workspace, `ai_usage_log`, `surface` | `src/lib/ai/usageCap.ts`, `structured.ts` | the credits system, extended |
| Capability catalogue generated from code (NAV, settings menu, field registry, object features, list sources, connectors) | `src/lib/capability` | the self-description the agent reads |
| Event bus `domain_event` / `emitEvent` | `src/lib/events` | suggestions and later autonomy |
| Nova Crew design (crew-core, tool adapters, approval gate, autonomy levels, budgets, audit) | `docs/nova-crew-architecture.md` | this assistant is Nova Crew's interactive front: same adapters, same gate, same audit tables, built first here |

## 2. The shape: one assistant, three abilities

1. **Answer** (today): query any object the user may see, compare, chart.
2. **Act**: do anything the user could do by hand: open a screen, create or
   change a record (including custom fields), run a verb (price a line,
   send a quote, go live, assign, approve, push to ERP), chain several into
   one plan. Every write is shown as a card and happens only when the user
   presses the button on it.
3. **Suggest**: on every screen the dock offers two or three next steps
   drawn from the record in front of the user and from events, in plain
   words, each one a button.

The dock also knows **where the user is** (route, object type, record id)
and starts from it: "send this quote" needs no id.

## 3. "Whatever a user can do" made true by construction

The agent is not given a hand-written list of tools. Its tools are
generated per request from the same registries the product already runs on,
filtered by the caller's features and Business Roles. That is the entire
mechanism behind the native-AI claim.

| Ability | Generated from | Executes through |
|---|---|---|
| Read / chart | `LIST_SOURCES` + `FIELD_REGISTRY` + the tenant's field config (custom `cf_` fields, extension fields) | today's compile path |
| Open a screen | `NAV`, `ROUTES`, `SETTINGS_MENU` (feature + workcenter gated) | a navigation card the dock follows |
| Create / update any object | `FIELD_REGISTRY` editable fields + field config | the object's own app route (`POST /api/<object>`, `PATCH /api/<object>/[id]`), called **with the user's own session**, so feature flags, Business Roles, PATCH allowlists, foreign-id checks, `logChange` and tenant isolation all apply exactly as for a click in the UI |
| Verbs (send, price, approve, go live, assign, push, start a journey, add a line, …) | a new **action registry** `src/lib/actions/registry.ts`: one entry per non-CRUD mutating route: key, label in plain words, object, method and path, parameters as a schema, `risk`, `featureKey`, `workcenterKey` | the registered route, user session |
| Delete / cancel | registry entries with `risk: destructive` | the object's DELETE route |

**The test that keeps it true.** `src/lib/actions/registry.test.ts` walks
`src/app/api/**/route.ts`; every POST/PATCH/DELETE handler must be either a
registry entry or in an explicit exclusion list with a reason (auth, cron,
webhooks, upload, v1, import/export/update, admin). Same pattern as
`objectFeatures.test.ts`: a new route that is not registered fails the
build. Section 3b of the project rules gains one line: "10 — Assistant:
nothing to wire; the registry test tells you what you missed."

So a new table wired per §3b (registry entry, routes, feature flag) is
readable, creatable and editable by the assistant with no further step. A
new custom field is read and written the moment it exists in the field
config. A tenant extension's extra fields come through `extraCustomFields`.
What is **not** automatic, and is said so: a new verb route needs its one
registry line (the test enforces it), and a brand-new table with no §3b
wiring is invisible to users and assistant alike.

## 4. Safety

- **Risk tiers**, set in the registry and never by the model:
  `read` and `navigate` run at once; `write` (create, update, add a line)
  shows a card with every field it will set and runs on **Confirm**;
  `outward` (email, WhatsApp, push to ERP, go live, publish a price book)
  shows the recipient or target and runs on an explicit button named after
  the act ("Send to faisal@…"); `destructive` (delete, cancel, withdraw)
  needs the same plus the record's name typed. No tier can be lowered by a
  prompt. Per-tenant autonomy (Nova Crew Piece I, `draft-only` →
  `auto-with-notify` → `autonomous`) comes later and only for `write`.
- **The user's session does the work.** The agent never uses the service
  role for an action; it calls the same route a click would, so it can do
  exactly what the user can do and nothing more. Cross-tenant ids fail the
  way they fail today.
- **Numbers come from engines.** Prices, scores, hours: the agent calls the
  engine (price-line route, scoring run) and reports; it never computes
  (Nova Crew decision 5).
- **Record data is data.** Tool results (names, notes, emails) are wrapped as
  data in the loop; text inside a record that reads like an instruction is
  shown, not followed. A plan is always restated in the model's own words
  on the card before Confirm, so a smuggled instruction is visible.
- **One execution per card.** Each proposed action has an id; Confirm runs
  it once; a second click is a no-op with the result shown again.
- **Audit.** Every executed action writes `assistant_actions` (tenant,
  user, the card as shown, parameters, route, result, tokens) and the
  route's own `logChange` row carries `via: assistant`. This table is the
  audit standard Nova Crew Piece D adopts.
- **Limits.** 10 model turns per ask, 20 rows per query into context, 6
  actions per plan, 3 plans per minute per user.

## 5. Suggestions

Deterministic first, worded by the model only where it adds nothing
numeric (same doctrine as the Account 360 rating):

- From the screen: on a quote in draft for 7 days → "Send a reminder";
  on an account with no contact → "Add a contact"; on a product with no
  cost → "Ask the supplier"; on a lead that is Hot → "Pick it up".
  Rules live in `src/lib/assistant/suggestions.ts`, one function per object,
  each returning `{ label, action, why }`; tested.
- From events (`domain_event`): a reply to an RFQ, a form submitted, a lead
  overdue → the suggestion appears on the next open of the dock.
- Each suggestion is a button that runs an action from §3 with the same
  confirm card; "why" sits behind an `i`.

## 6. Credits and cost

- **Meter**: the existing allowance (`usageCap.ts`) with `surface:
  assistant`; every model call metered; the dock shows a small usage pill;
  Settings → AI usage shows the month by surface; platform admin sets the
  budget per tenant in `TenantEditor` (default 1.5 M tokens a month, 0 = no
  AI).
- **Cost control before pricing**: the tool catalogue is large, so the system
  prompt and tools are sent with **prompt caching** (one cache per tenant
  per hour), routing and plain reads go to the small model, plans and
  actions to the mid model; tool results are trimmed to the fields the
  question needs. Expected: 4–8 k tokens per simple ask, 15–30 k per plan.
- **Feasibility (estimate, to confirm against the current price sheet)**: at
  roughly $3 per million input and $15 per million output tokens for the
  mid model and a fifth of that for the small one, a typical month of 300
  asks and 60 plans is in the order of $8–15 per workspace. The default
  1.5 M-token allowance costs under $10 at that rate.
- **Plans**: Included (the default allowance, enough for daily use by a
  small team); Plus (×5, priced above cost); Enterprise (set per contract).
  Over the allowance the dock still shows suggestions and navigation (no
  model call); answers and actions wait for next month or a top-up. Exact
  prices are the owner's decision (§11).

## 7. Screens (rule 6b: labels, values, actions; explanations behind the `i`)

- **The dock**: header with the usage pill; a suggestions strip (2–3
  buttons); chat; action cards (fields as label · value, one button named
  after the act, "Change" to edit a field, `i` for why); a plan card (a
  numbered checklist with one Confirm, then ticks as steps run); navigation
  cards ("Open quote SQ-2026-0013"). 375 px: the dock is full-screen with a
  sticky input. Mock-up: `docs/design/assistant-mockup.html`.
- **Settings → AI usage** (admin): month, tokens by surface, allowance,
  what happens when it runs out.
- **Platform admin**: budget and plan per tenant in `/admin/tenants`.

## 8. Integration points

| Surface | What changes |
|---|---|
| Ctrl+K palette | "Ask Nova: …" entry sends the typed text to the dock; the dock's navigation cards reuse the palette's `href`s |
| Paste-to-record | becomes the `draft_record` action; same review panel |
| Pricing engine | `price_line` action calls the existing price-line route; the why chip is shown on the card |
| Quotes / standard quotes | add line, price, send, revise, copy as actions; the send gate (block flags) is the route's, unchanged |
| Marketing | go live / pause (journeys, forms, ABM), send a test newsletter, start a journey for a person, pick up a lead |
| Coverage | "who owns X" answered from `resolveCoverage` |
| Nova inbox | executed actions and event suggestions post there |
| Nova Crew | this is Piece C's interactive ask; the registry is the tool-adapter registry; `assistant_actions` is Piece D's audit |
| Data Workbench | no change; bulk stays a file job |
| v1 API / MCP | `POST /api/v1/assistant` later, same loop with a key's scopes (phase after S4) |

## 9. Data

`assistant_actions` (tenant_id, user_id, conversation_id, card jsonb,
action_key, route, params jsonb, status, result jsonb, tokens, created_at,
executed_at), RLS select-only for members, writes on the service client,
`custom_data` not needed (not user-edited). Migration numbered next;
degrades to "no history" while pending. `ai_usage_log` gains nothing new.

## 10. Build steps (each: build → demo → owner validates → next)

| Step | Delivers | Flag |
|---|---|---|
| S1 Context, navigation, suggestions | page context in every ask; navigation cards from NAV/ROUTES/settings; the suggestions strip from rules; usage pill; prompt caching and small-model routing for reads | `ai_assistant` (today's) |
| S2 Records | action registry + test; generated create/update tools for every object with custom fields; confirm cards; `assistant_actions`; "via assistant" in change history | `ai_assistant_actions` (platform-admin, default off, requires `next_experience`) |
| S3 Verbs and plans | registry entries for every verb route; risk tiers; multi-step plan card; destructive confirm | same |
| S4 Credits | Settings → AI usage, platform-admin budget and plan, over-allowance behaviour, cost report per tenant | `ai_assistant` |
| S5 Events | event-driven suggestions, inbox posts; the bridge to Nova Crew autonomy levels | `next_experience` |

S1 is a week; S2 and S3 two weeks each; S4 and S5 a week each (Sonnet
build time, before validation).

## 11. Open decisions for the owner

1. Prices of the Included / Plus plans, and whether a top-up is sold.
2. Which model pair (small for reads, mid for actions) to standardise on.
3. Whether `write` actions may ever run without Confirm (autonomy per tenant).
4. Whether the assistant may send outward messages at all in the first
   release, or only draft them.

## 12. §3b applicability

New table `assistant_actions`: 1 (db, RLS, ledger, degrade) yes; 2–4 (registry,
custom fields, Data Workbench) no: it is an audit log, not a user object,
stated here deliberately; 5 (v1) later with `POST /api/v1/assistant`; 6
(MCP) no; 7 change history: executed actions already log through the
routes; search/analytics no; 8 docs: the Admin & Setup guide gains an "AI
assistant and credits" section after validation.
