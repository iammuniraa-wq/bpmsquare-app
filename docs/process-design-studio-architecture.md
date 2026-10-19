# Process Design Studio — architecture v0.1 (2026-10-19)

> **Status: design only, nothing built.** Written for the owner to validate
> before any code. The interactive mock-up of the MVP flow is
> `docs/design/process-design-studio-mockup.html` (open it in a browser; it is the
> visual and behavioural spec, with two labelled sample companies).
>
> **Read first, every time:** `bpmsquarecore.md` (§1 extension boundary, §3
> record identity, §3b new-object checklist — this is a new object, the whole
> list applies; §10 Nova doctrine), `MULTI_TENANT_GUARDRAILS.md`,
> `TENANT_PROVISIONING.md` (the studio hands over to it), `docs/ai-vision.md`
> (the one AI discipline every surface follows), `docs/ui-restructure-spec.md`
> (the screen contract), `src/lib/admin/tenantStudio.ts` (the "model
> proposes, code decides" normaliser this design copies).

---

## 0. Why, in the owner's words

> "User goes into process design studio and tells how they do business, with
> AI we analyse and tell them how standard BPMSquare will help them and if
> there is customization needed it proposes customization and then builds the
> project plan for the client to validate and then they talk to us for
> customization." — owner, 2026-10-19

The owner's company already runs Dynamics 365 implementations the classic
way: a fit-gap list (hundreds of requirements rated covered / partly / not
covered), a phased project plan, tasks with owners and dates, open questions,
integrations. That takes a consultant weeks of workshops before a client sees
anything. The Process Design Studio does the same work **for BPMSquare
itself, in an afternoon, inside the product** — and ends with a real project
plan the client has already agreed to, plus a request to the BPMSquare team
for whatever needs building.

What makes it different from "a chatbot that sells the product": every fit
claim is **cited against a capability catalogue generated from the code**
(§5). The AI can describe a client's business freely; it can only say
"BPMSquare does this" by pointing at something that exists.

Two rules carried over from the Estimator review (owner, 2026-10-18): **plain
words, one clear flow, details tucked away.** No "fit-gap matrix", no
"requirements traceability". The client sees: *Tell us → Your process → How
BPMSquare fits → What we'd change → Your plan → Talk to us.*

---

## 1. Who uses it, and where it lives

| Person | Where | What they get |
|---|---|---|
| **A prospect** trying BPMSquare | the demo/trial workspace (`is_demo` tenant today) | A study of their own business ending in a plan and a request to talk. This is the sales tool. |
| **A new client** during onboarding | their own freshly provisioned workspace | The same study, but its plan becomes the real onboarding plan, and its "switch on" list can be applied to the workspace (§9.1). |
| **An existing client's admin** | their workspace | A new study for a new area ("we now want to run our workforce in it too"), or a re-run after the business changed. |
| **The BPMSquare team** (platform admins) | `/admin/studies` | Every study across tenants, the "Talk to us" queue, a review step on the fit report before it is called a proposal. |

**Module and gate.** A sold module like `estimator` or `rfq`: feature flag
`process_studio` in `TenantFeatures` (default off, missing key = false),
workcenter `process_studio`, nav item **"Process Design Studio"** in the
**Workspace** group under Dashboard (it is about the whole business, not one
pillar). The demo tenant gets it on; a client gets it when the owner says so.
It is **not** behind `next_experience`: it is a sold, finished capability, not
an experimental experience layer — but the Nova surfaces it hooks into (§9.2)
stay behind Nova's own flag as always.

**On the shared demo tenant, a study is private to the person who created it**
(`created_by = auth.uid()` in the RLS policy and every route when
`tenants.is_demo`). Two prospects on `app.bpmsquare.com` must never see each
other's business. On a client tenant, every admin of the tenant sees every
study. Platform admins see all, everywhere (same backdoor as `/admin/tenants`).

---

## 2. The flow, step by step

One record, six steps, shown as a stepper at the top of the study page. The
primary button (top right, per the UI contract) is always "the next step".
Each step is also a tab, so the client can go back and change things.

### Step 1 — Tell us how you work
- A conversation. The studio opens with one question: *"Tell us about your
  business in your own words — what you sell, who your customers are, how a
  job goes from the first call to getting paid."*
- **Guided area cards** sit beside the chat: Sales, Service & repairs,
  Production & delivery, Procurement, Workforce, Pricing & estimating,
  Marketing, Finance (handover only — BPMSquare has no accounting). Each card
  has three plain questions and a "Not relevant to us" switch. Answering a
  card is optional; the chat alone is enough.
- **Upload what you already have**: SOPs, process diagrams (PDF, PNG/JPG),
  spreadsheets, an existing fit-gap list from another project. The studio
  reads them with the same document engine the RFQ reader and Data Workbench
  use (`extractRowsFromDocument`, `src/lib/rfq/extract.ts` pattern). Phase 2.
- The AI asks **at most three follow-up questions at a time**, in plain
  words, and shows what it understood as chips ("5 technicians", "quotes by
  email", "OEM referrals") — blue for stated, amber for assumed, exactly as
  the Estimator intake does. Nothing is analysed until the client presses
  **Build my process map**.

### Step 2 — Your process
- The map: one lane per role the client named (Sales rep, Workshop manager,
  Technician, Buyer, …), one column per area, steps as cards in order, with
  arrows only where a step hands over to another lane. On a phone it is a
  list grouped by area.
- Every step card says: what happens, who does it, how it is done today
  (email / Excel / WhatsApp / ERP / paper), and roughly how often.
- The client **edits freely**: rename, reorder, add, delete, merge two steps,
  change the lane. The map is theirs; the AI only drafted it.
- **Check the fit** is the primary button.

### Step 3 — How BPMSquare fits
- Four tiles at the top: **Standard** · **Needs setup** · **Partly covered**
  · **Not covered**, with counts. Then one row per step:
  - the rating pill;
  - **what covers it, by name**: the module, the screen and the setting
    (e.g. "Estimates → New estimate, with an Estimate template set up in
    Settings → Sales → Estimate templates"), each one a chip that opens the
    catalogue entry (§5) so the client can see it is real;
  - one plain sentence of why;
  - a confidence mark (sure / likely / check with us) and, after the
    BPMSquare team has looked, a "Reviewed by BPMSquare" tick.
- A collapsed **"Things we noticed"** section for cross-cutting points
  (dependencies between modules, data they will need to load, a module they
  did not mention but will need).
- The report is labelled **"Draft — BPMSquare reviews this before it becomes
  a proposal"** until a platform admin marks it reviewed (§6.5).
- **See what we'd change** is the primary button.

### Step 4 — What we'd change
- One card per proposed change, derived from every Partly / Not covered
  step. Each card has:
  - a **kind** — the only five that exist in this product:
    *Setting* (a configuration a tenant admin can make), *Your own fields*
    (custom fields on an object), *Tenant extension* (a hook in
    `src/extensions/types.ts`, or a new hook), *New build* (a standard
    product feature that does not exist), *Integration* (a connector, API or
    webhook);
  - a plain description and which steps it serves;
  - an **effort band** — Small / Medium / Large — set by rule from the kind
    (§6.4), never a price, never a date;
  - an "Also fine without it" note where the standard product gives a
    workable alternative.
- The client can hide a change ("we can live without this") or add one in
  their own words.
- **Build my plan** is the primary button.

### Step 5 — Your plan
- Phases in a fixed order (§6.4), each with tasks, an owner (**You** or
  **BPMSquare**), a duration in working days and dependencies; milestones
  marked. A simple bar chart per phase, dates computed from a start date the
  client picks.
- The client **validates**: a "Looks right" tick per phase, and a comment box
  per phase and per task. Comments are theirs; the AI never edits them.
- "Add a task" and "Change owner" are inline. Changing a duration moves the
  dates immediately (code, not model).
- **Send to BPMSquare** is the primary button.

### Step 6 — Talk to us
- A summary card: the business in three lines, the counts from step 3, the
  changes kept from step 4, the plan length and the phases the client ticked.
- **Send to BPMSquare** creates a **study request**: the study is frozen as a
  version (§7), the BPMSquare team is emailed (through `resolveOutbound()`,
  so a demo workspace never mails anyone but the sandbox inbox) and the
  request appears in `/admin/studies`. The client sees "Sent — someone from
  BPMSquare will contact you within two working days" and a contact field to
  confirm.
- **Download**: PDF (same headless-print route pattern as quotes) and a
  Google Doc through the Drive connector when it is connected; the PDF is
  the package the client forwards internally.
- After the call, the BPMSquare team records the outcome on the request
  (accepted, re-scoped, declined) and can **apply the plan to the workspace**
  (§9.1).

---

## 3. What already exists that this reuses (nothing new where it can be avoided)

| Need | Existing piece | How it is used |
|---|---|---|
| "Model proposes, code decides, warnings not exceptions" | `normalisePlan()` in `src/lib/admin/tenantStudio.ts` | The same shape for every AI output of the studio: a normaliser per step that drops unknown ids and reports what it dropped. |
| Reading uploaded PDFs, images, spreadsheets safely | `extractSupplierReply` (`src/lib/rfq/extract.ts`), `extractRowsFromDocument` (`src/lib/import/extract.ts`) | Documents wrapped as data, structured output, file read only from the study's own storage folder. |
| One place that calls the model with a JSON schema | `askStructured()` in `src/lib/estimator/aiServer.ts` | Generalised into `src/lib/ai/structured.ts` (move, not rewrite) so the studio, the estimator and the RFQ reader share one client, one error mapping and — new — one usage meter (§6.3). |
| What the product has | `TenantFeatures`, `NAV`, `WORKCENTERS`, `SETTINGS_MENU`, `FIELD_REGISTRY`, `LIST_SOURCES`, `API_ENTITIES` + `UNDOCUMENTED_ENDPOINTS`, `mcp-server/mcp.json`, `FEATURE_DEPENDENCIES`, `src/extensions/types.ts`, `src/lib/connectors/d365/catalog.ts` | The sources the capability catalogue is generated from (§5). |
| Switching modules on from a validated plan | Tenant Creation Studio (`/admin/tenant-studio`, `normalisePlan`, the apply route) | §9.1: a study emits a `TenantStudioPlan` fragment; nothing is applied outside that route. |
| Who would see what | `src/lib/accessView.ts` | The fit report's "roles you described" preview (phase 3). |
| Screens | `ObjectListPage`, `ObjectRecordPage`, `ObjectFormPage`, kit in `src/components/ui`, `Tabs` with `?tab=` | §8. |
| Comments and mentions | Nova timeline / inbox (gated) | §9.2; the studio's own plan comments are a plain table so the flow works for every tenant. |
| Outbound mail | `resolveOutbound()` (`src/lib/emailOutput.ts`) | The "Talk to us" email and the "your fit report has been reviewed" email. |

---

## 4. The one invariant

> **The model never says what BPMSquare can do. It picks from a list of what
> BPMSquare can do.**

Concretely: every "covered by" in the fit report is a **catalogue id** chosen
from an `enum` in the output schema; the enum is generated from the
catalogue at request time (filtered to what is relevant, §6.2). A claim with
no id is not a claim — the normaliser downgrades it to *Needs review* and
says so. An id that is not in the catalogue cannot be emitted (schema), and
if it somehow were, it is dropped with a warning, the same as `normalisePlan`
drops an unknown module. This is the same mechanism `docs/ai-vision.md` §3
describes for Report Builder: a hallucinated field name becomes a 422, never
a confident wrong answer. Here a hallucinated feature becomes "Needs review",
never "Standard".

---

## 5. The capability catalogue — grounding

### 5.1 Shape
`src/lib/capability/catalog.ts` exports `CAPABILITY_CATALOG: CapabilityEntry[]`,
each entry:

```
{
  id: "cap.module.estimator",            // stable, never renamed
  kind: "module" | "screen" | "object" | "field" | "setting" | "api" | "mcp"
        | "connector" | "extension_point" | "rule",
  label: "Estimates",                     // the word the client sees
  plain: "Turn a few answers or an element schedule into a bill of
          materials, a cost build-up and a quote.",
  module: "estimator",                    // the TenantFeatures key that owns it
  needs: ["standard_quotes"],             // from FEATURE_DEPENDENCIES
  where: { nav: "/estimates", settings: ["/settings/estimate-templates"] },
  source: "src/lib/constants.ts#NAV",     // where it was generated from
  status: "live" | "experimental" | "coming",
  docs: "Sales Cloud Guide → Estimates"   // the Drive guide section
}
```

### 5.2 Generated, not typed
A script, `scripts/build-capability-catalog.ts`, run by `npm run build` (and
by a unit test that fails if the committed catalogue is stale — same discipline
as `objectFeatures.test.ts`), walks:

| Source | Entries it yields |
|---|---|
| `TenantFeatures` + the comment above each key | one `module` per flag, `status: experimental` for `EXPERIMENTAL_FEATURE_KEYS` |
| `NAV` | one `screen` per item with its `featureKey`/`workcenterKey` |
| `SETTINGS_MENU` | one `setting` per entry (label, description, gating) |
| `FIELD_REGISTRY` + `PILOT_OBJECT_TYPES` | one `object` per type and one `field` per standard field (so "do you track warranty end date on an asset?" can be answered precisely) |
| `OBJECT_FEATURE` | the module behind each object |
| `LIST_SOURCES`, `API_ENTITIES`, `UNDOCUMENTED_ENDPOINTS` | `api` entries ("readable through the REST API and `/ask`") |
| `mcp-server/mcp.json` | `mcp` entries per tool |
| `src/extensions/types.ts` | `extension_point` entries (the hooks a tenant extension can use today) |
| `src/lib/connectors/*/catalog.ts` | `connector` entries (Slack, Gmail, Mail server, Dynamics 365 — with their real state: the D365 connector "has never run against a live environment" stays visible as such) |
| `FEATURE_DEPENDENCIES` | `needs` on modules |

Code can only say *that* something exists, not *what it is for* in plain
words. So each `module` and `object` entry also has a hand-written
**`plain`** sentence and a `rule` list in `docs/capabilities/<module>.md`
(one short file per module, owned by whoever builds the module, checked by
the same test: a module flag without a capabilities file fails the build —
added to the §3b checklist as a new line). The `rule` entries are the
sentences that matter in a fit conversation: "A quote can have options",
"An employee cannot alter attendance data", "Fit ratings never show a price".

### 5.3 What is deliberately NOT in the catalogue
- Anything with `status: experimental` is included but **can never be cited
  as Standard**: the normaliser turns such a citation into *Coming — ask us*
  and the fit row says so in words. Nova, Nova Crew, the Enterprise theme
  stay invisible to a prospect unless the owner decides otherwise (§12 Q4).
- Prices, effort in days, dates. The catalogue describes capability only.
- Tenant-specific extensions (`src/extensions/vikas`). A study is about the
  standard product; what Vikas has is not what the next client gets.

### 5.4 How it stays current
Generated on every build from the same files the product runs on, so a new
module that passes §3b is in the catalogue the day it ships. The `plain`
file is the only hand-maintained part, and the build fails without it. The
Drive guides are referenced by section name only; the catalogue does not
scrape them.

---

## 6. AI design

### 6.1 Which steps call the model
| Step | Call | Output schema (structured output, `json_schema`, same as `extract.ts`) |
|---|---|---|
| 1 Tell us — follow-ups | one call per client message | `{ reply, questions[≤3], understood[{fact, stated|assumed}] }` |
| 1 Tell us — documents | one call per document (phase 2) | `{ steps[], facts[], warnings[] }` through the extract engine |
| 2 Build the map | one call over the whole conversation | `{ lanes[], areas[], steps[{area, lane, name, what, how_today, frequency}] }` |
| 3 Check the fit | one call per **area** (keeps the enum small and the answer sharp) | `{ rows[{step_id, rating, capability_ids[], why, confidence}], noticed[] }` with `capability_ids` an enum of the area's catalogue ids |
| 4 Changes | one call over Partly + Not covered rows | `{ changes[{kind, title, plain, step_ids[], alternative}] }` with `kind` an enum of the five |
| 5 Plan | one call | `{ tasks[{phase, name, owner, duration_days, depends_on[], milestone}] }` — phases are a fixed enum; dates are computed by code |
| 6 Talk to us | none | the summary is assembled by code from the stored rows |

Model: `claude-opus-5-5` with `effort: "medium"` (the one already used by
the RFQ reader and the estimator; consistency over micro-optimisation).
Step 1 replies use `effort: "low"` and a small `max_tokens` — they are short.

### 6.2 Grounding mechanics
- The fit prompt contains **only** the catalogue entries for the area being
  rated plus every cross-cutting `module` entry — a few hundred lines, not
  the whole catalogue — and the client's steps for that area. The enum of
  allowed `capability_ids` is built from exactly that set.
- Ratings are defined in the prompt in plain words and **checked by code
  after**: *Standard* requires at least one `live` citation; *Needs setup*
  requires a `setting` or `field` citation; *Partly covered* requires one
  citation plus a `why`; *Not covered* allows none. Anything else is
  rewritten to *Needs review* with a warning the BPMSquare reviewer sees.
- Confidence is the model's, shown as words. The reviewer tick (§6.5) is the
  human one; they are never merged.

### 6.3 Cost control — the first meter in the codebase
There is no credits helper today (`checkAndDeductCredits` is named in
`bpmsquarecore.md` §5 but does not exist in `src/lib`; the estimator's
`aiServer.ts` says so in its header). The studio is the first surface where
an unbounded loop is plausible (a chat), so it brings the meter the estimator
left as an open item:

- `ai_usage_log` (tenant_id, user_id, surface, study_id nullable, model,
  input_tokens, output_tokens, created_at) written by `src/lib/ai/structured.ts`
  after every call, for every surface that moves onto it.
- Caps in `config.process_studio`: `max_messages_per_study` (default 40),
  `max_documents_per_study` (default 10, each ≤ 10 MB, ≤ 60 pages),
  `monthly_token_budget` (default set per plan by the platform admin). Over
  budget: the studio says "You've used this month's AI allowance — the
  BPMSquare team can raise it", nothing crashes, the saved study stays
  readable.
- A per-tenant monthly total on the admin tenant page.
- Prompt caching for the catalogue slice (same text every call for an area).

### 6.4 What is rule, not model
- Effort bands: *Setting* → Small; *Your own fields* → Small; *Tenant
  extension* → Medium (Large if a new hook is needed); *New build* → Large;
  *Integration* → Medium for an existing connector, Large otherwise. The
  reviewer can change a band; the model never sets it.
- Plan phases: Foundations (workspace, users, roles, currency, tax) →
  Master data (accounts, contacts, products, employees — via Data Workbench)
  → Sales → Service / Production → Workforce → Customisations → Integrations
  → Go-live & training. Only phases with tasks are shown. The default task
  list per phase comes from a template in `docs/capabilities/plan-template.md`;
  the model adds client-specific tasks, never removes template ones.
- Dates: start date + working days + dependencies, computed in a pure,
  unit-tested function.
- Counts, totals, summary: code.

### 6.5 Human review
A platform admin opens a submitted study in `/admin/studies`, sees every
warning the normalisers produced, can change any rating or band, and presses
**Mark reviewed**. Until then the client's page says "Draft — BPMSquare
reviews this before it becomes a proposal." After it, the rows show the
reviewed tick and an email goes to the client. A study that is never
submitted is never reviewed, and that is fine: the draft is already useful.

### 6.6 Privacy and the documents
- Uploads go to a **private** bucket `process-studio` under
  `<tenant_id>/studies/<study_id>/`, RLS on the bucket by the tenant folder
  (the `0038` pattern), read only by the route that analyses that study,
  only from that folder (the `startsWith` check in `extract.ts`).
- Before the first upload the client sees one plain sentence: *"Documents
  you upload are read by an AI service to draft your process map. They are
  stored in your workspace only and are deleted when you delete the study."*
  Deleting a study deletes its files.
- No PII is needed for a study; the prompt asks about roles, not people. The
  intake schema has no name/email/phone fields, so none are extracted.
- Documents are not kept in the model's context across calls; each call
  re-reads only what it needs.

### 6.7 Prompt injection from uploaded documents and pasted text
- Every document and every client message enters the prompt inside data tags
  with the standing instruction that it is data, not instructions (the
  `extract.ts` wording).
- Output is constrained to a schema with enums; there is **no tool the model
  can call** in this flow and nothing it emits is executed. The worst a
  hostile SOP can do is produce a silly process map, which the client sees
  and edits.
- The only side effects — the "Talk to us" email and the §9.1 apply — are
  pressed by humans, and the apply route runs `normalisePlan()`.
- Free-text fields the model wrote are rendered as text, never HTML.

### 6.8 Multi-tenant isolation
- Every table in §7: `tenant_id`, RLS + isolation policy in the same
  migration; every route starts with `requireTenantUser()`; the demo-tenant
  rule in §1 adds `created_by`.
- The catalogue is **not** tenant data; it is code. Nothing a tenant writes
  changes what another tenant is told BPMSquare can do.
- Cross-tenant reads exist in exactly one place — `/admin/studies` — behind
  `isPlatformAdmin()`, like `/admin/tenants`.

---

## 7. Data model (described; migration `0134_process_studio.sql` when built)

All tables: `tenant_id uuid not null references tenants(id)`, RLS enabled
with the standard isolation policy in the same migration (this is not pay or
attendance data, so `for all` is correct; writes still go through routes),
`created_at`, `updated_at`, and `custom_data jsonb` on the header only.

| Table | What a row is | Key columns |
|---|---|---|
| `process_studies` | one study (the record) | `ref` (STU-####, via `insertWithMasterRef`), `name`, `status` (`telling` → `mapped` → `fit_ready` → `changes_ready` → `plan_ready` → `submitted` → `reviewed` → `accepted` / `rescoped` / `closed`), `created_by`, `plan_start_date`, `contact_name`, `contact_email` (encrypted like contacts), `current_version`, `reviewed_by`, `reviewed_at` |
| `process_study_messages` | one chat turn | `study_id`, `role` (`client` / `studio`), `text`, `understood jsonb` |
| `process_study_documents` | one upload | `study_id`, `filename`, `content_type`, `path`, `size`, `read_at`, `read_notes jsonb` |
| `process_study_steps` | one card on the map | `study_id`, `area`, `lane`, `sort_order`, `name`, `what`, `how_today`, `frequency`, `hands_to_step_id` |
| `process_study_fit` | the rating of one step | `study_id`, `step_id`, `rating` (`standard` / `needs_setup` / `partly` / `not_covered` / `needs_review` / `coming`), `capability_ids text[]`, `why`, `confidence`, `warnings jsonb`, `reviewed` |
| `process_study_changes` | one proposed change | `study_id`, `kind` (the five), `title`, `plain`, `alternative`, `effort_band`, `step_ids uuid[]`, `kept boolean`, `client_added boolean` |
| `process_study_tasks` | one plan task | `study_id`, `phase`, `sort_order`, `name`, `owner` (`client` / `bpmsquare`), `duration_days`, `depends_on uuid[]`, `milestone`, `from_template` |
| `process_study_comments` | a client comment on a phase or task | `study_id`, `phase`, `task_id nullable`, `text`, `author_user_id`, and `phase_ok boolean` rows for the "Looks right" tick |
| `process_study_versions` | a frozen snapshot | `study_id`, `version`, `snapshot jsonb` (steps + fit + changes + tasks + comments), `reason` (`submitted` / `re-run` / `manual`), `created_by` |
| `process_study_requests` | the "Talk to us" handoff | `study_id`, `version`, `status` (`new` / `contacted` / `accepted` / `rescoped` / `declined`), `assigned_to`, `notes`, `applied_at` |
| `ai_usage_log` | one model call (shared, §6.3) | `surface`, `study_id nullable`, `model`, `input_tokens`, `output_tokens` |

**Versions.** Simple and honest: a study has live rows (editable) and
frozen snapshots. A snapshot is taken when the client presses *Send to
BPMSquare* and whenever the client re-runs *Check the fit* after editing the
map ("Version 3 — you changed 4 steps"). The admin list and the PDF always
name the version. No row-level history beyond that; `logChange` records the
header changes as for every object.

Child rows key on their own `id` for update/delete (§3); `study_id` only
resolves the parent at create time.

---

## 8. Screens (the UI contract of `docs/ui-restructure-spec.md`)

### 8.1 Layout — the studio rule (owner, Newsletter Studio review)

Every "studio" screen in BPMSquare has the same shape as Fence projects and
the Project Estimator (`src/app/(app)/estimates/[id]/EstimateScreen.tsx`,
`docs/estimator-reference/studio-mockup-v2.html`): **options in a left
panel, the workspace on the right.**

- Left panel, 300 px, sticky: the options for the *current step only* —
  the area cards and documents (Tell us), the roles and the assumed-steps
  switch (Your process), the rating filter (Fit), the kinds filter
  (Changes), start date / weekend / Save (Plan), name / email / Send (Talk
  to us). The panel changes with the step; the stepper above both columns
  does not.
- **Every option carries a one-line plain-words hint** under it saying what
  it is for ("Days we skip when counting working days"). No option without
  a hint; a hint is one sentence, never a paragraph.
- **Every option group in the panel is collapsible** (owner rule from the
  Newsletter review, "so it looks leaner"): a header row with the group's
  name, its one-line hint and a chevron; the group in use is open, the rest
  start collapsed; native `details/summary` with `aria-expanded`, so it is
  keyboard-accessible without extra code.
- Right: the workspace — the conversation, the map, the fit rows, the
  change cards, the timeline and phases, the summary.
- Under 900 px the panel collapses **above** the workspace (single column,
  the panel is no longer sticky); under 780 px the map becomes a list by
  area and the tables become cards. **No horizontal page scroll at 375 px**
  — the swimlane canvas is the only element allowed to scroll sideways,
  and it is hidden on a phone in favour of the list.
- English is the default language of the studio. A Language option on the
  Tell-us panel offers Arabic (phase 3) and later Hindi; it changes the
  language the studio talks in, nothing else.

### 8.2 Guided walkthrough — "Show me how"

A **Show me how** button in the record header (beside the primary action)
runs an optional step-by-step tour of the *current step*: a highlight on
one element at a time (spotlight mask, 4 px accent ring), a one-sentence
caption in a fixed card at the bottom, and **Next / Back / Skip**. Rules:

- It starts closed and is **never forced** — no auto-start on first visit,
  no "don't show again" nagging; the button is simply there.
- Each step of the flow has its own short tour (two to four stops), defined
  as data (`element id → caption`) next to the screen, not as a component
  per stop.
- Escape, Skip, changing step, changing sample, or pressing the primary
  action ends it. It respects `prefers-reduced-motion` (no smooth scroll).
- Captions are plain words and say what the thing is for, in the same voice
  as the hints.

### 8.3 Pages

- **List** `/process-studio` — `ObjectListPage`: ref, name, status pill,
  version, last step reached, updated. "+ New study" top right; the empty
  state is the invitation: *"Tell us how you work and see how BPMSquare fits
  — about twenty minutes."*
- **Record** `/process-studio/[id]` — `ObjectRecordPage` with the six steps
  as a stepper (kit `Tabs`, `?tab=tell|process|fit|changes|plan|talk`), the
  header strip showing ≤ 4 facts (status, version, steps mapped, fit
  counts). Header right: **Show me how**, the primary action (= the next
  step), and "⋯" = Edit name, Print / PDF, Duplicate, New version, Adapt,
  Delete. Below the stepper the studio layout of §8.1. Overview is not a
  tab here: the study *is* the flow. `NovaTimelineSlot` at the bottom
  (self-gated).
- **Tell us**: panel = area cards, documents (one quiet "Add"), language,
  follow-up-questions switch; workspace = the conversation.
- **Your process**: panel = roles (lanes), assumed-steps and hand-over
  switches, Add step; workspace = swimlane canvas (pure CSS grid, no
  library), a list by area on a phone. Editing is inline and saves on blur
  with the optimistic feel every Nova surface has.
- **Fit**: panel = rating filter, catalogue-ids switch (off by default; for
  the client's IT people), Check again; workspace = banner, four tiles, rows,
  "Things we noticed" closed by default.
- **Changes**: panel = kinds filter, show-hidden switch, Add a change, the
  effort-band key; workspace = cards.
- **Plan**: panel = start date, weekend, only-my-tasks, **Save** (batch:
  ticks, comments, durations, per settings rule 11.1); workspace = timeline
  and phases.
- **Talk to us**: panel = name, email, Send, downloads; workspace = summary
  and "what happens next". Confirmation replaces the Send button in place.
- **Create** `/process-studio/new` — `ObjectFormPage` with only a name and
  "Start"; everything else happens in the record.
- **Admin** `/admin/studies` — table across tenants (tenant, study, version,
  status, warnings count, submitted at), filter "needs review"; a study opens
  read-write for the reviewer with a "Reviewer" band at the top.
- **Settings** — none for the client in MVP; caps and the budget live on the
  admin tenant page (`TenantEditor.tsx` FEATURES list + a small "AI
  allowance" field).
- Both looks, light and dark; focus visible; 375 px checked; icons SVG.

The mock-up shows every one of these states with two sample companies.

---

## 9. Integration points — how it connects to the rest of the suite

### 9.1 Provisioning from a validated plan
When a request is `accepted`, the reviewer presses **Apply to workspace**.
The studio emits a `TenantStudioPlan` fragment — `features` (the modules the
Standard / Needs setup rows cite, closed over `FEATURE_DEPENDENCIES`) and
`nav_hidden_hrefs` — and the existing `normalisePlan()` + apply route do the
writing. For a prospect on the demo tenant the same button becomes **Create
their workspace**, which opens the Tenant Creation Studio pre-filled, and
§2 of `TENANT_PROVISIONING.md` (Vercel, DNS, Supabase allowlist) stays a
human checklist. Settings seeds (statuses, custom fields the *Your own
fields* changes named, estimate templates) are listed as tasks in the plan
with owner BPMSquare, not auto-applied, until each one has its own
reviewable apply path. Experimental flags are never set from a study.

### 9.2 Nova
`NovaTimelineSlot` on the record; `process_study` in the comments `OBJECTS`
map, the inbox `LABEL`/`TABLE` and `ROUTE_FOR`; "New study" in the ⌘K
`CREATE_ACTIONS`. A later Nova pillar — paste an email and get a drafted
record — has a natural twin here: paste a tender or an RFP and get a drafted
study. Not MVP.

### 9.3 "Who sees what"
Phase 3: the fit report takes the lanes the client named and shows, with
`accessView.ts`, which screens each role would get and the Business Role it
maps to. It turns "Technicians only see their work orders" from a question
into a preview.

### 9.4 Tenant extensions
A change of kind *Tenant extension* names the hook from `src/extensions/types.ts`
it would use (`quoteExtraSection`, `beforeSaveAccount`, …) or says "needs a
new hook", which is itself a Medium/Large signal. The proposal is the input
to the conversation; the owner's team still decides whether it is an
extension or a standard feature (bpmsquarecore §1: "needed by all tenants →
standard").

### 9.5 Data Workbench, API, MCP (per §3b)
Export of a study (steps, fit, tasks) as XLSX/CSV in Data Workbench —
export only, with the reason in `DataWorkbenchClient.tsx` (a study is
written by a conversation, not imported). `GET /api/v1/process-studies` and
`/[id]` read-only, feature-gated, in `UNDOCUMENTED_ENDPOINTS` and
`EXPLICIT_SCOPE_ONLY` (a study describes a client's whole business — never
widened to existing `*` keys by default). MCP `list_process_studies` /
`get_process_study`. Global search on study name. Analytics tile: studies
by status. Change history filter entry.

---

## 10. Phases

**Phase 1 — MVP (the smallest impressive version).**
Text intake only (chat + area cards, no uploads); the process map as an
editable list grouped by area (the swimlane canvas is phase 2); the fit
report with catalogue citations and the four tiles; changes as a plain list
with rule-set bands; the plan from the template with computed dates, ticks
and comments; Talk to us with the email, the admin queue and the PDF. The
catalogue generator and its build test. The usage meter. `/admin/studies`
with Mark reviewed. Both sample companies seeded on the demo tenant from
`scripts/seed-process-studio-demo.sql`. Exit: the owner runs a study for a
real prospect and the fit report has no wrong "Standard" row.

**Phase 2 — documents and the map.**
Uploads (PDF, images, spreadsheets, an existing fit-gap list), the swimlane
canvas, versions with "what changed", client-added changes, the Google Doc
export, the "your report was reviewed" email.

**Phase 3 — connected.**
Apply to workspace / Create their workspace, the Who-sees-what preview, Nova
timeline + ⌘K + inbox, v1 API + MCP + DW export, Arabic (RTL) for the GCC
prospects, paste-a-tender intake.

Every phase: `tsc`, `vitest`, `next build` clean; migration listed in
PROJECT.md's ledger; the §3b checklist reported with every deliberate skip;
Drive doc refresh after the owner has validated (Admin & Setup Guide gains a
"Process Design Studio" chapter).

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| The studio claims a feature that does not exist | §4/§5: enum of catalogue ids, rating checked by code, review before "proposal". The exit criterion of phase 1 is exactly this. |
| It over-promises on effort or time | Bands only, set by rule, labelled "indicative"; no prices anywhere; dates are the client's own start date plus durations they can change. |
| Catalogue drifts from the product | Generated on build; test fails on stale output or a module without a `plain` file. |
| Two prospects see each other on the demo tenant | `created_by` rule in RLS and routes on `is_demo`; or a trial workspace per prospect (§12 Q1). |
| AI cost with no meter | §6.3 is part of phase 1, not later. |
| Long or hostile documents | Size and page caps; data tags; schema-only output; no tools; human presses every side effect. |
| It feels engineering-first again | The mock-up is the spec; words on screen are the client's words (areas, roles, "how you do it today"); every technical term lives in a closed disclosure or the admin view. |
| The BPMSquare team cannot review every study | Review is needed only for submitted studies; the admin queue shows warnings first; unsubmitted drafts are useful without review. |
| A client treats the plan as a contract | The PDF carries "Indicative plan — confirmed after the BPMSquare review call" on every page; the request status is the real commitment. |

---

## 12. Open questions for the owner

1. **Trial workspace or shared demo?** Should a prospect's study live on
   `app.bpmsquare.com` (private per creator, as designed) or should "Start a
   study" create a throw-away trial workspace per prospect? The second is
   cleaner but needs the §2 domain steps automated first.
2. **Who receives "Talk to us"?** One mailbox, a Jira project (VIK/KAN
   style), or both? The design sends an email and lists the request in
   `/admin/studies`; name the address.
3. **Effort bands visible to the client, or only to the reviewer?** The
   design shows Small / Medium / Large to the client with no prices. Say if
   even that should wait for the call.
4. **May the catalogue mention unreleased things as "Coming"?** Nova, Nova
   Crew, the D365 connector's live status. The design hides experimental
   flags from prospects entirely and shows the D365 connector as "built, not
   yet live with a client".
5. **Language.** English in phase 1, Arabic (RTL) in phase 3 — or does the
   first GCC prospect need Arabic in the MVP?

---

## 13. Decisions to record once the owner answers

- Name: **Process Design Studio**; object **study** (`process_studies`,
  STU-####); flag `process_studio`; nav under Workspace.
- The one invariant (§4) and the generated catalogue (§5) are not optional
  parts of the MVP.
- The usage meter (§6.3) ships with phase 1 and becomes the shared meter for
  the estimator and the RFQ reader.
- Ratings vocabulary, shown to clients exactly so: **Standard · Needs setup ·
  Partly covered · Not covered** (plus the two system states *Needs review*
  and *Coming*, which always say why).
- Nothing in a study is applied to a workspace without a human pressing
  Apply, and the apply path is the Tenant Creation Studio's.
