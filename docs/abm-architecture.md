# Account-Based Marketing (ABM) — architecture v0.1 (2026-10-19)

> **Update 2026-10-20: the A1 shell is built (flagged off, migrations 0180 to 0183 pending).** What is
> built and what comes next, in order: `docs/shells/abm-shell.md`. Where this document and the shell
> doc differ, the shell doc is as-built.
>
> **Status of the design below: written before any code.**
> Written for the owner to validate before any code. The clickable mock-up
> is `docs/design/abm-mockup.html` — the programs list, a program record with
> its target accounts, a target account with its buying group, the plays
> studio and the results view. Works at 375 px and desktop, light and dark,
> with sample data (a Saudi precast maker targeting developers and
> contractors) labelled as sample.
>
> **Owner decision that shapes everything (2026-10-19):** ABM is its **own
> first-class object** with its own nav item, list and record pages — not a
> flag or a tab on Account master data. One account can be in several ABM
> programs at once, each with its own goal, stage, owner and plan; master
> data cannot hold that. *"That is the trend in marketing now; as part of
> master data it would not be effective."* It must still be integrated,
> never an island (§9 is the contract).
>
> **Read first, every time:** `bpmsquarecore.md` (§1 extension boundary, §3
> record identity, §3b new-object checklist — walked in full in §11, §10
> Nova doctrine, §10a the Account 360 card contract and the
> explainable-number rule), `MULTI_TENANT_GUARDRAILS.md`,
> `docs/marketing-platform-architecture.md` (the umbrella: §1 foundations,
> §1.2 event catalogue, §1.3 `canContact()`, §1.4 the score contract, §1.5
> audiences, §3 journeys, §12 roadmap M0–M9), `docs/signals-architecture.md`
> (the buying stage ABM reads and never duplicates),
> `docs/newsletter-studio-architecture.md` (versions per audience and
> language), `docs/sales-engine-architecture.md` §5 (events, rules, the
> action registry) and `docs/nova-crew-architecture.md` Piece A,
> `docs/ui-restructure-spec.md` (ObjectListPage / ObjectRecordPage) and the
> studio UX rule in the marketing doc §6.0.

---

## 0. The answer in ten lines

1. **In plain words:** ABM is *choosing the companies that matter and working
   each one as a team, on purpose, for a stated goal* — instead of sending
   the same campaign to everyone and waiting for a lead. In B2B with long,
   many-person purchases (a precast maker selling to developers and
   contractors; a service company expanding inside its installed base) the
   buyer is a **company with a group of people**, not one lead.
2. **Why a separate object:** a program has a goal, a time window, an owner,
   a target list, tiers, plays and results. The same company can be in
   "Riyadh developers 2027" at tier 1:1 with a decision maker named, and in
   "AMC expansion" at tier 1:many with no one named yet. Two programs, two
   states, two owners, one account. A flag on the account holds none of
   this; a tab on the account would hide the program-level view (how is
   *the program* doing) that marketing actually manages.
3. **Three objects:** **Program** (the goal and the plan) → **Target
   account** (one company inside one program: tier, progress, owner, next
   step) → **Buying group member** (a contact with a role in that company
   for that program). Plays and results hang off the program.
4. **Two stages, deliberately different questions.** *Buying stage* (Quiet ·
   Looking · Comparing · Deciding) is **read from Signals**, is the same for
   the account everywhere, and ABM never edits or re-scores it. *Progress*
   (Planned · Reached · Engaged · In talks · Deal open · Won · Lost ·
   Dropped) is **per target account per program**, derived by fixed rules
   from the shared event stream, overridable by the owner. No new score,
   no new number — progress is a status, not a rubric.
5. **Plays are journeys**, not a second engine: a play is a journey whose
   audience is a program's buying groups and whose trigger is a progress or
   buying-stage change. The plays studio is the journey builder with ABM
   choices in plain words. One runner, one action registry, one
   `canContact()` at the send step, one `resolveOutbound()`.
6. **Results by account, not by lead:** targets → reached → engaged → in
   talks → deals → won, as counts and names, per program and per tier, with
   a one-sentence "did it work". Revenue comes from the deals linked to the
   program (direct) and, after M7, from the attribution chain.
7. **Ownership from Coverage:** a target account's owner defaults to the
   Coverage owner team (its lead or the team's assignment mode) and can be
   overridden per program. The account's own `owner_user_id` is never
   touched.
8. **Audiences from segments:** the target list starts from a target group
   or Coverage segment, is **snapshotted** into the program (a list is a
   commitment, it must not silently change), refreshed only by a button;
   hand-picked additions and removals are logged.
9. **Integrated:** Account 360 card *In ABM programs*, deal cards and the
   Win tab show the program, the Nova inbox carries gaps and next steps,
   the v1 API / MCP / Data Workbench / search / analytics all carry the
   three objects (§11 walks §3b with every skip named).
10. **First slice (A1)** is demo-able end to end without journeys or
    Signals: a program, targets from a segment, buying groups with gaps,
    progress from existing quotes and deals, the Results tab and the
    Account 360 card. Plays (A2) land with the journey runner (M3); the
    buying stage column fills in when Signals (M5) ships, showing "—" until.

---

## 1. Challenging the proposed shape — what is kept, what is changed, and why

| Proposed | Decision | Why |
|---|---|---|
| ABM Program with goal, window, owner, target list, tiers, plays, results | **Kept** | It is the unit marketing manages and reports on. |
| Target Account with tier, buying stage, owner, next step, buying group | **Kept, with one split**: *buying stage* (Signals, read-only here) and *progress* (per program, rule-derived, overridable) are two fields, two words | "Buying stage" is an account truth: Najd is Deciding whether we look at it from program A or B. What differs per program is how far *we* have got with them — that needs its own name or the two will be edited over each other. |
| Tiers 1:1, 1:few, 1:many | **Kept**, on the target account, with a program default | A tier is a decision per company per program (the same contractor is 1:1 in a strategic program and 1:many in a renewal push). |
| Buying group with roles decision maker / influencer / user / blocker, gaps shown | **Kept**, roles are **per program** (`abm_buying_group_members`), not on the contact | Khalid is the decision maker for precast and an influencer for HVAC. A role on the contact's master data would be wrong for one of them. The contact keeps its job title (`contacts.role`, free text); ABM adds the *buying role*. |
| Plays: stage-based actions for an account or its whole buying group | **Kept as journeys**, not a new `abm_plays` engine: `journeys.abm_program_id` + a `kind = "play"` and ABM triggers/audiences in the builder | The marketing doc §3 says there is one engine with two faces. A third face with its own runner, caps and consent gate is exactly the island the owner forbids. What ABM adds is *vocabulary* (when a company reaches Engaged, send the decision makers the case-study version) and *scope* (a play runs only for this program's targets). |
| Results by account | **Kept, and extended by tier and by "who did what"** | A funnel per program is the "did it work" view; by tier it says whether 1:1 effort paid. Reusing Signals' before/after component gives "buying stage moved" for free once Signals exists. |
| Industry context: PCBS, Vikas-style expansion | **Both covered**: a program's `kind` is *new business* or *expansion*; expansion programs can start from Coverage segment HAS_ACTIVE_AMC and progress through the same statuses | Same objects; the difference is the audience and the plays, not the model. |

Two things added that were not in the proposal: a **required-roles rule per
program** ("a target is not Engaged until a decision maker is named"),
because gaps are only useful if the program says what complete looks like;
and an explicit **Dropped** progress with a reason, because the honest
result of a program includes who was taken off the list.

One thing deliberately **not** added: an "ABM score" or "account
engagement score". The platform already has account health, in-market
score and lead score (marketing doc §1.4: *there is no fourth number*).
Engagement counts on the Results tab are counts of events, shown as counts.

---

## 2. Vocabulary (the words on screen)

| On screen | Meaning | Not said on screen |
|---|---|---|
| **Program** | A named effort to win or grow a chosen set of companies, with a goal and a time window. | campaign (that word stays for one-shot email sends), orchestration |
| **Target account** | One company inside one program. | ICP, named account |
| **Tier** | How much personal effort this company gets: **1:1** (its own plan), **1:few** (a small cluster with shared content), **1:many** (the programme's standard plays). | tiering model |
| **Buying group** | The people at the company who decide, influence, use or block a purchase. | buying committee, persona |
| **Role** | Decision maker · Influencer · User · Blocker · (Unknown). | stakeholder map |
| **Gap** | A role the program requires that no one has yet ("no decision maker yet"), or a person who cannot be contacted ("no consent for email"). | coverage gap |
| **Buying stage** | Quiet · Looking · Comparing · Deciding — from Buying signals; the account's own truth. | intent |
| **Progress** | Planned · Reached · Engaged · In talks · Deal open · Won · Lost · Dropped — how far *this program* has got with *this company*. | lifecycle, MQA, SQA |
| **Next step** | One sentence and a date, owned by a person. | task (the word is used only in the Nova inbox) |
| **Play** | Something the program does when a company reaches a point: "when a target is Reached and nobody clicked in 7 days, send the decision makers the case-study issue, then a next step for the owner". | journey (same thing underneath; the program page says play) |
| **Results** | How many targets were reached, engaged, in talks, became deals, were won — and the money linked. | attribution model (say "where this deal came from") |

---

## 3. Objects and fields

All tables: `tenant_id uuid not null references tenants(id)`, UUID `id`,
`created_at`/`updated_at`, RLS enabled **in the same migration**. Policy:
standard tenant isolation `for all` on the three user-managed tables (they
are CRM records a member edits, like accounts and contacts — not pay or
forgeable scores). Progress history is not a table: it is `domain_event`
rows (§8), the platform rule that anything a person is told must be
reconstructible from the stream.

### 3.1 `abm_programs` — ref `ABM-####`

| Column | Type | Notes |
|---|---|---|
| `ref` | text | `MASTER_REF_TABLES` prefix `ABM` |
| `name` | text | "Riyadh developers 2027" |
| `kind` | text | `new_business` \| `expansion` |
| `goal` | text | one plain sentence: "Win 3 precast supply contracts with Riyadh residential developers" |
| `goal_metric` | text | `deals_won` \| `deals_opened` \| `accounts_engaged` \| `revenue` |
| `goal_target` | numeric | 3, or 1 500 000 |
| `starts_on`, `ends_on` | date | the window |
| `owner_user_id` | uuid | the program owner (a marketer or a sales lead) |
| `status` | text | `draft` \| `active` \| `paused` \| `completed` \| `archived` (status engine, `StatusEntityType` gains `abm_program`) |
| `default_tier` | text | `one_to_one` \| `one_to_few` \| `one_to_many` |
| `required_roles` | text[] | default `['decision_maker','influencer']`; drives gaps |
| `source_target_group_id` | uuid null | the marketing target group the list was built from |
| `source_segment_id` | uuid null | or a Coverage segment |
| `source_snapshot_at` | timestamptz null | when the list was last pulled from the source |
| `topic_id` | uuid null | Signals topic (`signal_topics`), so plays and newsletters can be chosen by subject |
| `budget` | numeric null | optional, for a simple return figure (M7) |
| `custom_data` | jsonb | tenant custom fields |
| `created_by` | uuid | |

### 3.2 `abm_target_accounts` — the child; keyed by its own `id`

| Column | Type | Notes |
|---|---|---|
| `program_id` | uuid → `abm_programs` | |
| `account_id` | uuid → `accounts` | **unique `(tenant_id, program_id, account_id)`** — once per program; the same account in another program is another row |
| `tier` | text | as above, defaults from the program |
| `progress` | text | `planned` \| `reached` \| `engaged` \| `in_talks` \| `deal_open` \| `won` \| `lost` \| `dropped` |
| `progress_source` | text | `rule` \| `manual` — whether the last change came from §5.2 or a person |
| `progress_changed_at` | timestamptz | |
| `owner_user_id` | uuid null | defaults from Coverage (§7.2); overridable; `owner_source` `coverage` \| `manual` |
| `next_step` | text null | one sentence |
| `next_step_due` | date null | |
| `next_step_user_id` | uuid null | who does it |
| `added_via` | text | `segment` \| `manual` \| `signals` \| `import` |
| `added_by` | uuid | |
| `dropped_reason` | text null | required when `progress = dropped` |
| `opportunity_id` | uuid null | the deal this program opened or claims (tenant-verified on write) |
| `notes` | text null | |
| `custom_data` | jsonb | |

No master ref on the child: it is referenced through its program and its
account, like a quote line through its quote (§3 of bpmsquarecore: the
child's own `id` is the contract for update/delete; the parent ref is used
only to resolve the relationship at import time). Stated skip in §11.

### 3.3 `abm_buying_group_members` — a person's role in one target account

| Column | Type | Notes |
|---|---|---|
| `target_account_id` | uuid → `abm_target_accounts` | |
| `contact_id` | uuid → `contacts` | must belong to the target's account **and** the tenant (both checked on write) |
| `role` | text | `decision_maker` \| `influencer` \| `user` \| `blocker` \| `unknown` |
| `is_primary` | boolean | the one to call first |
| `notes` | text null | "Prefers WhatsApp, Arabic" — plain text, never a score |
| `added_by`, `added_via` | | `manual` \| `suggested` (from engagement, §5.3) |

Unique `(tenant_id, target_account_id, contact_id)`. Engagement per member
("clicked twice, opened the quote") is **not stored here** — it is read from
`domain_event` by `contact_id` at render time, which is what keeps the
buying-group view honest and the table small.

### 3.4 Columns added to existing tables

| Table | Column | Why |
|---|---|---|
| `journeys` | `abm_program_id uuid null`, `kind text default 'journey'` (`journey` \| `play`) | a play is a journey scoped to a program (§6) |
| `opportunities` | `abm_program_id uuid null` | "this deal came out of program X" — set when a deal is created from a target account, or chosen on the deal; tenant-verified |
| `leads` | `abm_program_id uuid null` | a lead created by a play carries its program (optional; leads are person-level, ABM is account-level) |
| `marketing_campaigns` | `abm_program_id uuid null` | a one-shot send made from a program's page is credited to it |

### 3.5 Config

`TenantConfig.abm`: `{ required_roles_default: string[], tiers_enabled:
("one_to_one"|"one_to_few"|"one_to_many")[], progress_rules: { engaged_needs_required_roles: boolean, reached_window_days: 30 }, labels?: Record<progress, string> }`.
Progress labels are tenant-renameable through the status engine like every
other object; the system keys above never change.

### 3.6 Degrade cleanly

A missing `abm_programs` table (42P01) hides the nav item, renders the list
as its empty state, returns no Account 360 card and makes the segment fields
evaluate false — the owner applies SQL by hand and the migration may be
pending.

---

## 4. Screens

Every screen follows `docs/ui-restructure-spec.md`: `ObjectListPage`,
`ObjectRecordPage` (≤ 4 header facts, one primary action, ⋯ with Edit /
Duplicate / Delete, tabs in the URL), cards under 780 px, both looks, light
and dark, SVG icons, real empty states. The **plays studio** follows the
owner's studio rule (marketing doc §6.0): options in a left panel with a
one-line hint under each option, every group collapsible, the workspace on
the right, the panel collapsing above the workspace on a phone, and an
optional **Show me how** walkthrough that starts closed. The mock-up is the
spec for all five.

### 4.1 Programs — `/marketing/abm` (`ObjectListPage`)

Columns (≤ 7): Program (name + ref + kind), Goal, Window, Owner, Targets,
Progress (a compact bar: reached / engaged / in talks / deals of targets),
Status pill. Quick-filter chips: Active · Paused · Draft · Completed. `+ New
Program` top right; ⋯: Export (Data Workbench), Settings → ABM. Empty state:
*"No programs yet. Pick the companies that matter most and work them as a
team."* with `+ New Program` and *Start from a target group*.

### 4.2 Program — `/marketing/abm/[id]` (`ObjectRecordPage`)

- Header: name, `ABM-0001` · status pill; facts: **Goal** ("3 contracts · 1 so far"), **Window** ("Jan–Dec 2027 · 71 days left"), **Owner**, **Targets** ("12 · 7 engaged"). Primary action: **Start** (draft) / **Pause** (active) / **Resume**. ⋯: Edit, Duplicate, Refresh targets from source, Archive, Delete, Adapt.
- Tabs: **Overview** (`ObjectSections`: goal, window, kind, default tier, required roles, source list, topic, custom fields), **Target accounts** (default tab when active), **Plays**, **Results**, **Activity** (`NovaTimelineSlot` + change history).
- **Target accounts tab**: a table — Account (name · city · industry), Tier, Buying stage (Signals pill or "—"), Progress pill, Buying group ("3 people · no decision maker" with the gap in warn tone), Owner, Next step (sentence + due; overdue in warn). Row click opens the target account. Above the table: chips Planned / Reached / Engaged / In talks / Deals / Won / Dropped, a tier chip set, a search, and one quiet action `+ Add accounts` (drawer: pick from a target group, a Coverage segment, "Who is in market" (Signals) or by name). Bulk ⋯ on selected rows: Change tier, Change owner, Drop with reason, Add to a play.
- **Plays tab**: the list of the program's plays (name, "When…" sentence, status, people in it, sent this month) and `+ New play`, which opens the studio (§4.4) in the same workspace.
- **Results tab**: §4.5.

### 4.3 Target account — `/marketing/abm/[id]/accounts/[targetId]` (`ObjectRecordPage`)

- Header: company name, program name as the back link ("← Riyadh developers 2027"); facts: **Tier**, **Buying stage** (from Signals, with "how this is worked out" one tap away — Signals' own component), **Progress** (with "set by rule: quote opened 12 Oct" or "set by Faisal"), **Owner**. Primary action: **Update progress** (a small drawer: progress, next step, due date, who; a manual change records `progress_source = manual` and the reason). ⋯: Change tier, Change owner, Open account, Open deal, Remove from program (→ Dropped with reason), Adapt.
- Tabs: **Buying group** (default), **Plan**, **Timeline**, **Details**.
- **Buying group tab**: one card per role group (Decision makers, Influencers, Users, Blockers, Unknown). Each person: name, job title, role pill, consent chips (Email ✓ / WhatsApp —), last engagement in words ("Clicked the case study · 3 days ago") read from the stream, quiet actions Call / Email / Change role / Remove. **Gaps** at the top in warn tone: "No decision maker yet — add one" with `+ Add person` (pick from the account's contacts, or create a contact with the normal create form), and "Noura cannot be emailed — no consent" with *Ask for consent* (opens the consent drawer from the marketing platform §5.5, never a direct send). A **Suggested** strip lists contacts of the account who engaged in the last 30 days but are not in the group ("Omar opened the quote twice — add him?").
- **Plan tab**: next step (editable in place), the plays running for this account with their current step ("Case-study follow-up · waiting 7 days for a click"), and the deal if one is linked (amount, stage, open it).
- **Timeline tab**: every `domain_event` of the account's buying-group contacts plus the program's own events for this target, newest first, each a quiet grey line with the person's name ("Khalid opened QT-2026-0142 · Quotes").

### 4.4 Plays studio — inside the program's Plays tab (`StudioPage`)

The journey builder (marketing doc §6, `StudioPage`) with ABM vocabulary
and the program as its scope. Not a new builder.

**Left panel (options; each with its one-line hint; every group collapses;
the group in use starts open):**

| Group | Options | Hint under the group |
|---|---|---|
| Start from | templates: *First touch*, *Reached but quiet*, *Engaged → meeting*, *Decision maker missing*, *Deal stalled*, *Blank* | "A ready-made play you can change." |
| When | a progress is reached (Reached / Engaged / In talks), a buying stage is reached (Looking / Comparing / Deciding — from Signals), a target is added, "nothing happened for N days", by hand | "What has to happen for the play to start for a company." |
| Who | the whole buying group · decision makers only · influencers and users · the primary person · the owner (internal) | "Which people at the company the play speaks to." |
| Which targets | all tiers · 1:1 only · 1:few · 1:many; optional topic | "Which companies in this program the play applies to." |
| Rules | re-entry, one play at a time per company, pause when the account is in trouble, quiet hours, caps — **read from Settings → Marketing, shown not edited** | "Safety rules every send obeys. Change them in Settings." |
| Languages | English, + add (Arabic, Hindi, Urdu…) per the Newsletter Studio rule | "English first; other languages on top." |

**Workspace (right):** the play as sentences, each step editable in place
with plain choices: *Send the "Precast case studies" issue (Arabic for
Arabic readers)* → *Wait 7 days for a click* → *If nobody clicked: next
step for the owner "Call the decision maker"* → *If someone clicked: notify
the owner, move progress to Engaged*. Above the steps: **Who would get this
now** (count and the first 20 companies with the per-company reason), **Try
it on one company** (the simulate mode — renders every send inline, nothing
goes out), **Send test to me**. Header: title, status, **Show me how**,
primary **Turn on / Pause**; ⋯: Rename, Duplicate, Versions, Archive.
Folded, closed: *Details for your IT team* (the compiled trigger and
conditions, the journey version, run counts).

**Show me how** (optional, starts closed, Back / Next / Skip, remembered per
person in `localStorage` key `abm.plays.walkthrough.done`, reduced motion
respected; the shared `Walkthrough` kit component from Signals §4.7):

| # | Anchored to | Words |
|---|---|---|
| 1 | Start from | "Pick a ready-made play. You can change every line of it." |
| 2 | When | "Say what has to happen first. Progress comes from what your team does; buying stage comes from Buying signals." |
| 3 | Who | "Choose the people at the company. Decision makers only, or the whole buying group." |
| 4 | Which targets | "Limit the play to a tier, so 1:1 companies get the personal version." |
| 5 | The steps | "Read the play as sentences. Click a line to change what it sends or how long it waits." |
| 6 | Who would get this now | "Before you turn it on, see which companies would start today and why." |
| 7 | Try it on one company | "Run the play for one company without sending anything. Every email is shown here." |
| 8 | Turn on | "Plays run within five minutes of the thing that starts them. Pause any time; nobody falls out." |

### 4.5 Results — the Results tab on the program

```
Did it work?                         Riyadh developers 2027 · 12 targets · 71 days left
Targets 12 → Reached 11 → Engaged 7 → In talks 4 → Deals 3 → Won 1
Goal: 3 contracts · 1 won, 2 open worth SAR 4.2 m · Linked revenue SAR 1.8 m (invoiced)
By tier     1:1 (3): 3 engaged · 2 deals · 1 won        1:few (4): 3 engaged · 1 deal        1:many (5): 1 engaged
Buying stage moved up for 5 of 12 since the program started (Buying signals)
┌ Account ───────── Tier ── Progress ───── What happened ─────────────────────────┐
│ Najd Urban Dev.   1:1    Won            Case study clicked by 2, meeting 3 Nov, QT-0142 accepted │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Rules, not statistics: every number is a count of rows a person can click
through to; "engaged" means at least one buying-group member produced an
engagement event (click, interest, quote opened, form, WhatsApp reply)
after the target was added; "reached" means at least one delivered send or
a logged touch; money is the linked deals' amounts (open) and the invoiced
and paid amounts through the attribution chain once M7 exists (until then
the row says "from linked deals"). A tiny-sample note appears under 20
targets (*"Fewer than 20 targets — read this as a list, not a trend."*).
"Buying stage moved" reuses Signals' before/after component and shows "—
needs Buying signals" when the module is off. Actions: *Export this list*,
*Save the engaged accounts as a target group*, *Send a one-off newsletter
to these* (credits the campaign to the program).

### 4.6 Where ABM appears on other screens

- **Account record → Related tab**: card *ABM programs* — one row per
  program the account is in (program · tier · progress · owner · next
  step), "View all" opens the program. Same data as the Account 360 card.
- **Account 360** (§9.6): built-in card `abm`.
- **Deal record**: header fact "Program: Riyadh developers 2027" when
  `abm_program_id` is set; the Win tab's *Where this deal came from* names
  the program; the Pipeline board card shows a small program chip.
- **Contact record → Related tab**: card *Buying roles* ("Decision maker in
  Riyadh developers 2027").
- **Who is in market (Signals)**: a row's ⋯ gains *Add to a program*; the
  list shows a small "in ABM" chip. The program's `+ Add accounts` drawer
  can pick from the Signals list ("everyone Comparing on Precast").
- **Leads list**: a lead created by a play shows "from play *First touch*
  (ABM-0001)".
- **Nova inbox**: the "Needs a decision" section carries ABM items (§9.5).
- **Settings → Marketing → ABM** (admin, settings shell, Save top right):
  default required roles, tiers in use, progress labels (status engine
  page link), the Engaged rule toggle, play templates on/off.

---

## 5. Stage, score and progress — the contract

### 5.1 Buying stage comes from Signals; ABM never has a second score

| Number / stage | Owner | ABM's relationship |
|---|---|---|
| Account health (A–D) | `account360/rating.ts` | shown on the target account header strip as a quiet fact; never edited |
| In-market score + **buying stage** | `signals/rubric.ts`, stored in `account_intent` | **read** per account (`account_intent.stage`, `score`, `factors`); the target-account table and header show the stage; "how this is worked out" opens Signals' factor list; ABM **never** writes `account_intent`, never adds points, never computes its own |
| Lead score | `marketing/scoring.ts` | not shown on ABM screens (ABM is account-level); a play may create a lead, which is then scored by the platform |
| Win rating | Sales Engine | shown on the linked deal, not here |

There is no "ABM score". Engagement on the buying-group view is a count
and a sentence read from `domain_event`. If a tenant has no Signals module
every stage cell shows "—" with the hint *"Turn on Buying signals to see
who is in market"*, and progress rules that mention buying stage simply
never fire.

### 5.2 Progress — fixed rules over the shared stream, overridable, explainable

`src/lib/abm/progress.ts`, pure, unit-tested: `deriveProgress(current,
events, target, program) → { progress, reason }`. Runs on every relevant
event for a target's account or buying-group contacts (via the same
dispatcher the journey runner uses, §6.3) and nightly. Only moves
**forward** by rule; backward moves and terminal states are by a person,
except `won` / `lost` which follow the linked deal.

| From → to | Rule (first that matches) | Reason text stored on the event |
|---|---|---|
| planned → **reached** | an `email.delivered` / `whatsapp.delivered` to a buying-group member **from a play or a program-credited campaign**, or a logged touch (`abm.target.touch_logged` — a call or visit the owner records) | "Case-study issue delivered to Khalid, 4 Oct" |
| reached → **engaged** | any of `email.clicked`, `email.interest`, `quote.opened`, `form.submitted`, `whatsapp.replied`, `web.page_viewed` (buying-interest path) by a buying-group member — **and**, when `config.abm.progress_rules.engaged_needs_required_roles` is on, the required roles are filled | "Khalid clicked 'Precast walls', 8 Oct" / held: "would be Engaged — no decision maker named yet" (shown as a gap) |
| engaged → **in_talks** | **manual only** (a meeting happened — the product cannot know) — or `opportunity.created` with `abm_program_id` jumps straight to `deal_open` | "Set by Faisal: site meeting 3 Nov" |
| any open → **deal_open** | `opportunity.created` / linked deal with `abm_program_id` for this account | "Deal OPP-0042 opened" |
| deal_open → **won** / **lost** | `opportunity.closed` of the linked deal | "OPP-0042 won, SAR 1.8 m" |
| any → **dropped** | manual, reason required | "Dropped by Reem: awarded to a competitor" |

Every change is one `domain_event` `abm.target.progress_changed` with
`from`, `to`, `source` (`rule` \| `manual`), `reason`, `actor_id`. The target
account's header shows the reason beside the progress ("set by rule: Khalid
clicked, 8 Oct"). AI may later phrase the program's weekly summary; it
never sets progress.

### 5.3 Buying-group suggestions (rule, not AI)

A contact of the target's account who is **not** in the buying group and
has an engagement event in the last 30 days appears under *Suggested* with
the plain fact ("Omar opened the quote twice"). The role is left `unknown`
until a person picks one. No model guesses roles from job titles in v1;
a later, optional AI step may *propose* a role with the title as its
reason, for a person to accept (ai-vision: model proposes, code decides).

---

## 6. Plays — the shared automation engine, reused

### 6.1 A play is a journey

`journeys.kind = 'play'`, `journeys.abm_program_id = <program>`. The
definition is the marketing doc §3.1 shape (`version: 2`) with:

- `audience: "contact"` always (a play speaks to people), **plus** an ABM
  scope the runner applies before anything else: `abm: { program_id,
  tiers?: [...], who: "buying_group" | "decision_makers" | "influencers_users"
  | "primary" | "owner_internal" }`. The runner resolves the people from
  `abm_buying_group_members` of the program's targets at **each step**, not
  at entry, so a decision maker added today joins tomorrow's step.
- `trigger` gains two kinds, compiled to the same DSL: `{ kind: "event",
  name: "abm.target.progress_changed", filter: to = "reached" }` and
  `{ kind: "event", name: "account.buying_stage_changed", filter: to =
  "comparing" }`, plus `{ kind: "event", name: "abm.target.added" }` and the
  existing `schedule` ("nothing happened for N days" is a schedule trigger
  with the audience rule `abm_last_engaged_before`).
- Actions: the existing registry (`send_newsletter`, `send_whatsapp`,
  `create_task`, `notify_rep`, `add_to_segment`, `create_lead`,
  `create_deal`, `wait_for_human`, `webhook`) **plus two ABM rows** added to
  `src/lib/events/actions.ts`: `abm_set_progress { to, reason }` (forward
  only, through `deriveProgress`'s validation, never backward) and
  `abm_log_touch { kind: call | visit | gift | event, note }`. No other new
  action. `notify_rep` with `who: owner` resolves to the **target
  account's owner** when the subject is an ABM target.

### 6.2 Safety — nothing new, everything inherited

Every rule in marketing doc §3.2 applies unchanged: `canContact()` at the
send step, re-entry, one per account (on by default and **meaningful here**:
"one play at a time per company" so two plays never email the same buying
group in one week), frequency caps, quiet hours and weekly off days
(`tenantClock`), "account in trouble" (open case > 30 days or an overdue
invoice → promotional steps deferred), demo-workspace redirect through
`resolveOutbound()`, kill switch (`journeys.status = paused`, tenant
`config.marketing.paused`), loop guard (`depth`), blast-radius
confirmation. A play adds one more: **a target that is Dropped, Lost or
Won exits every play of that program** at its next step.

### 6.3 Execution

The journey runner (`GET /api/marketing/cron/journeys`, every 5 minutes)
runs plays as journeys; ABM adds a small **progress subscriber** in the same
tick (`src/lib/abm/subscriber.ts`): for each unprocessed `domain_event`
whose `account_id` or `contact_id` touches an active target, call
`deriveProgress` and emit `abm.target.progress_changed` when it moves. Same
cursor, same per-tenant iteration, same caps, same admin client with
`.eq("tenant_id", …)`. Nightly: the "nothing happened for N days"
schedules and the Results materialisation (§9.8).

### 6.4 Seeded play templates (per tenant, off until turned on)

| Template | When | Who | Steps |
|---|---|---|---|
| **First touch** | target added | decision makers + influencers | send the program's intro issue (per language) → wait 7 days for a click → no click: next step for the owner "Call the primary person" |
| **Reached but quiet** | progress Reached and nothing for 14 days | buying group | send a second version (case study) → wait 7 days → still nothing: notify the owner, suggest a call |
| **Engaged → meeting** | progress Engaged | owner (internal) | next step "Book a site meeting" due 5 days; `wait_for_human` "Did the meeting happen?" → yes: progress In talks |
| **Decision maker missing** | target Engaged with the gap open | owner (internal) | task "Find the decision maker at <company>"; repeats every 14 days while the gap is open |
| **Deal stalled** | linked deal in one stage > 21 days (`opportunity.stage_changed` + days) | decision makers | optional "still deciding?" version, then notify the owner |

---

## 7. Consent, ownership, audiences

### 7.1 Consent — the single `canContact()` gate

- Naming a person in a buying group is an internal business record (the
  same as noting their job title); it needs no marketing consent and sends
  nothing.
- Every send a play makes goes through the Studio's one send branch, which
  calls `canContact(tenantId, contact, channel, topic)` **at the send step**
  (marketing doc §1.3, Studio §12.5) and records a refusal as
  `email.skipped` with its reason. ABM never calls Resend, never reads
  `marketing_opt_out`, never keeps an opt-out of its own.
- The buying-group view **shows** the consent state per person (chips read
  from `consent_state`) and offers *Ask for consent* — which opens the
  platform's consent drawer (a rep-recorded basis with evidence, or a link
  to the preference centre), never a send.
- A `consent.withdrawn` / `email.complained` for a member shows as a gap
  the next day ("Noura can no longer be emailed"); plays simply skip her.

### 7.2 Ownership — via Coverage, never writing the account

When a target is added: `resolveCoverageForAccount(tenantId, account)` →
the owner team → the team's `assignment_mode` (marketing doc §4.3: `lead`
default, `round_robin`, `least_open`) → `abm_target_accounts.owner_user_id`
with `owner_source = coverage`. No Coverage match → the program owner, with
a visible "no coverage matched" chip. A person may override per program
(`owner_source = manual`, logged). `accounts.owner_user_id` is **never**
changed by ABM. The program owner is a plain user field.

### 7.3 Audiences — segments in, snapshot kept

- **Building the list**: `+ Add accounts` offers (a) a marketing target
  group, (b) a Coverage segment, (c) the Signals list with a stage/topic
  filter, (d) by name. The chosen accounts are **inserted as rows**
  (`added_via`), and the program remembers its source. A list is a
  commitment: it never changes by itself. *Refresh from source* (⋯ on the
  program) shows "4 new, 2 no longer match — add / drop?" and applies only
  what the person ticks, logging each.
- **`SEGMENT_FIELDS` gains three rows** (the file's own extensibility
  point): `in_abm_program` (select: the tenant's programs; "is in program
  X"), `abm_progress` (select; evaluated against the account's best
  progress across active programs, or per program when
  `in_abm_program` is also set), `abm_tier` (select). Each has a loader in
  the server-side record builder like `computeAccountSignals`. Result:
  *"In Riyadh developers 2027 + Engaged + Arabic readers"* is a saved target
  group a newsletter or a campaign can send to with no new UI — and a
  Coverage rule can say "ABM 1:1 targets are owned by the key-accounts
  team".
- Person-level: a play's people come from the buying group (§6.1), which
  is the ABM form of the platform's `audience_level: contact`.

---

## 8. Events — emitted and consumed (catalogue names)

Added to `src/lib/events/catalog.ts` under a new "ABM" row of the marketing
doc §1.2 table. Every row carries the common fields (`tenant_id`,
`account_id`, `contact_id` where a person is involved, `occurred_at`) and
`payload.program_id`, `payload.target_account_id`.

**Emitted by ABM**

| Event | When | Payload beyond common |
|---|---|---|
| `abm.program.created` / `.updated` / `.started` / `.paused` / `.completed` / `.archived` | program routes | `status`, `changes` |
| `abm.target.added` / `.removed` | target routes, refresh, import | `tier`, `added_via`, `dropped_reason` |
| `abm.target.progress_changed` | rule (§5.2) or manual | `from`, `to`, `source`, `reason` |
| `abm.target.tier_changed` / `.owner_changed` | target routes | `from`, `to`, `owner_source` |
| `abm.target.next_step_set` / `.next_step_done` | target routes | `text`, `due`, `user_id` |
| `abm.target.touch_logged` | the owner logs a call / visit / gift / event; the `abm_log_touch` action | `kind`, `note` |
| `abm.buying_group.member_added` / `.member_removed` / `.role_changed` | member routes | `role`, `from`, `to` |
| `abm.buying_group.gap_opened` / `.gap_closed` | the subscriber, when required roles or consent change | `gap: missing_role:<role> \| no_consent:<contact_id>` |
| `abm.play.started` / `.completed` / `.exited` per target | the runner (these are `journey.entered` / `journey.exited` with `kind = play`; the ABM names are aliases in the catalogue that resolve to the same rows — one row, two readable names) | `play_id`, `reason` |

**Consumed by ABM** (the subscriber, §6.3, and the Results tab)

| Event | Use |
|---|---|
| `account.buying_stage_changed` (Signals; the umbrella doc's name — Signals' draft says `signal.stage_changed`, one must win, §14 Q5) | shown on the target; a play trigger; "buying stage moved" on Results |
| `email.sent / delivered / clicked / interest / skipped / bounced / complained / unsubscribed` | reached / engaged rules; consent gaps; the buying-group "last engagement" line |
| `whatsapp.delivered / replied / opted_out` | same, when M6 exists |
| `quote.sent / opened / accepted / change_requested` | engaged rule; the timeline |
| `form.submitted`, `web.page_viewed`, `web.identified` | engaged rule (buying-interest paths only) |
| `opportunity.created / stage_changed / closed` | deal_open / won / lost; the *Deal stalled* play |
| `invoice.paid` | linked revenue on Results (direct) and the attribution chain (M7) |
| `case.created`, `invoice.overdue` | the "account in trouble" pause (inherited from the runner) |
| `consent.withdrawn` | gap |
| `contact.updated` (if the contact leaves the account) | the member is flagged "no longer at this company" — a gap, not an auto-removal |

---

## 9. Integration points — the map (nothing standalone)

| Module | What ABM gives it | What it gives ABM | Owner of the code |
|---|---|---|---|
| **Sales — deals / pipeline** | `opportunities.abm_program_id`; *Create deal* from a target account pre-fills account, primary contact, program; board card chip; Win tab *Where this deal came from* names the program | `opportunity.*` events drive progress; deal amount and outcome feed Results | Sales routes set the column (tenant-verified id); ABM reads |
| **Sales — quotes / Standard Quotes / Estimator** | nothing written | `quote.sent / opened / accepted` by a buying-group member → engaged; an estimate created from a target's email shows "in program X" on the estimator's customer card | ABM subscriber |
| **Marketing — campaigns & Newsletter Studio** | *Send a one-off to these* from Results credits the campaign (`marketing_campaigns.abm_program_id`); a play's `send_newsletter` always sends a **version** per language | `email.*` events; the Studio's per-audience versions are what a tier gets (1:1 gets the personal version, 1:many the standard) | Studio owns the send path |
| **Marketing — Journeys** | plays are journeys (§6); the plays studio is the journey builder scoped to a program; two actions added to the shared registry | the runner, versions, simulate mode, safety rules, caps | Marketing platform |
| **Marketing — Signals** | *Add to a program* on the Signals list; `in_abm_program` chip there | the buying stage per account, its factor list component, the before/after "moved" component, the topic list (`signal_topics`) for the program's `topic_id` | Signals owns stage; ABM reads |
| **Marketing — Leads** | a play may `create_lead` carrying `abm_program_id` | none needed (ABM is account-level) | Marketing |
| **Segmentation / audiences** | three `SEGMENT_FIELDS` (§7.3) | the target list source; audience previews | shared engine |
| **Coverage** | nothing written to accounts | the owner team / member for every target (§7.2); a Coverage segment as a list source | Coverage |
| **Service / AMC** | expansion programs start from `has_active_amc` segments; a target's open case shows on the Plan tab | `contract.expiring` can be a play trigger for expansion programs; "account in trouble" pause | Service emits |
| **Finance** | none | `invoice.paid` → linked revenue; `invoice.overdue` → pause | Finance emits |
| **Account 360** | built-in card `abm` (§9.6) | the health rating shown on the target header | ABM builds the card |
| **Nova** | inbox: next steps due / overdue, gaps on 1:1 targets, `wait_for_human` play steps ("Did the meeting happen?"); timeline on program and target; ⌘K "New program"; Nova Stream item `abm_next_step_due` | the inbox, timeline, palette, stream | ABM wires the four Nova maps |
| **Nova Crew (Growth agent, later)** | reads programs, gaps and next steps as its context; may **draft** a play or a next step for approval | nothing in v1 | Nova Crew |
| **Process Design Studio** | the three objects appear in the capability catalogue the day they ship; `docs/capabilities/abm.md` is part of phase A1 | — | ABM |
| **Pricing / RFQ / WFM** | **no touchpoint**, stated: pricing versions and RFQs are supplier-side; attendance and payroll never enter ABM | — | — |

### 9.6 Account 360 card — "In ABM programs" (§10a contract)

Built in `buildAccount360()` (`src/lib/account360/server.ts`), id `abm`,
`kind: "internal"`, appended to `BUILTIN_CARD_IDS` (after `marketing`),
added to `BUILTINS` in `settings/account-360/Account360Client.tsx` and to
`CARD_IDS` in `api/settings/account-360/route.ts`, so a tenant can hide or
reorder it. Stats: **Programs** (count, hint "1 active"), **Best progress**
(the furthest progress across active programs, tone good for In talks and
beyond), **Buying group** ("4 people · 1 gap", tone warn when a gap exists).
Rows: one per program — title = program name, meta = "1:1 · Owner Faisal ·
next: Call Khalid by 24 Oct", value = progress label, `href` = the target
account page. Empty: *"Not in any program. Add this account from a program's
Target accounts tab."* The **rating is untouched** (marketing doc §1.4 rule
3); the card never adds a factor.

Suggestion (`Account360Suggestion`), rule-based: when a 1:1 target has an
overdue next step → *"Next step overdue in Riyadh developers 2027 — Call
Khalid was due 20 Oct"*, urgency high, href to the target; when a target is
Engaged with a missing required role → *"Engaged but no decision maker
named"*, urgency medium.

### 9.8 Results — how the numbers are made

`src/lib/abm/results.ts`, pure over rows: targets by progress and tier
(from `abm_target_accounts`), engaged/reached counts (from the progress
events, so history is exact), deals (from `opportunities` with
`abm_program_id`), linked revenue (open deal amounts; invoiced/paid through
quotes → invoices by `opportunity_id` / `quote_id`, and after M7 through
`marketing_touches`), buying-stage movement (Signals'
`account_intent_history`). Cached with `unstable_cache` keyed on
`[tenantId, programId, day]`. A nightly `abm_program_stats` materialisation
is **deferred** until a program exceeds 500 targets (performance doc R4).

---

## 10. API, MCP, Data Workbench, search, analytics

| Surface | Addition |
|---|---|
| App routes | `/api/abm/programs` (GET/POST), `/api/abm/programs/[id]` (GET/PATCH/DELETE), `/api/abm/programs/[id]/targets` (GET/POST bulk add with `added_via`), `/api/abm/targets/[id]` (GET/PATCH/DELETE — tier, owner, progress with reason, next step, drop), `/api/abm/targets/[id]/members` (GET/POST), `/api/abm/members/[id]` (PATCH/DELETE), `/api/abm/programs/[id]/refresh` (preview + apply), `/api/abm/programs/[id]/results` (GET), `/api/abm/targets/[id]/touch` (POST). All `requireTenantUser()` first; every `account_id`, `contact_id`, `opportunity_id`, `target_group_id`, `segment_id` from a body verified with `.eq("id", x).eq("tenant_id", tenantId)`; a `contact_id` additionally checked to belong to the target's `account_id`; explicit PATCH allowlists; `diffForLog` / `logChange` on every mutation. |
| v1 API | `GET /api/v1/abm-programs[/id]` (with `targets_count`, progress totals), `GET /api/v1/abm-programs/[id]/targets`, `GET /api/v1/abm-targets/[id]` (with its buying group). `LIST_SOURCES` entries `abm_programs`, `abm_target_accounts` (field whitelists) so `/api/v1/ask` answers *"which Riyadh developers are in talks?"*. Feature gate `abm` → 404 without the module. `API_ENTITIES` defs (OpenAPI + metadata), `/api/v1` index, `SCOPABLE_OBJECTS`, Settings endpoint table. **`EXPLICIT_SCOPE_ONLY` += `abm_targets`** (buying groups name people and their roles — personal data; existing `objects: ["*"]` keys must not gain it silently). Programs alone are not personal and stay in the normal scope. `POST /api/v1/abm-programs/[id]/targets` (add by account id) and `POST /api/v1/events` (already planned) let an external tool push an ABM touch. |
| MCP | `list_abm_programs`, `get_abm_program`, `list_abm_targets`, `get_abm_target`; `mcp.json` version bump. |
| Data Workbench | **Programs**: import (resolve `owner_email`, `source_target_group_name`), export (real `id`), update by `id`. **Target accounts**: import (resolve `program_ref` + `account_name` at create — the parent ref resolves the relationship only; §3), export with `id`, update by `id` only (tier, owner, next step, progress with `progress_reason` required). **Buying group members**: import (resolve `program_ref`, `account_name`, `contact_email` by hash), export, update by `id`. The template offers each object's `cf_` columns. Every route calls `assertObjectFeature("abm")`. |
| Global search | programs by name and ref (`SEARCH_SPECS` + `SearchObjectType`, featureKey `abm`, workcenter `abm`); targets and members are found through the account and the program — **skip**, stated. |
| Advanced filter / saved queries | on the programs list and the target-accounts tab. |
| Analytics | `AnalyticsMetricId` `abm_targets_engaged` (across active programs), `abm_deals_from_programs` (open), `abm_won_from_programs` (30 days); labels; dashboard tile *ABM: 7 of 12 targets engaged*; `METRIC_META` with feature + workcenter keys. A tile counting programs is skipped (not a number anyone acts on). |
| Change history | `logChange` on every mutation of the three tables and on progress/owner/tier changes; dropdown entries in `ChangeHistoryClient.tsx` for all three. |
| Nova maps | `OBJECTS` in `api/nova/comments/route.ts`, `LABEL`/`TABLE` in `api/nova/inbox/route.ts`, `ROUTE_FOR` in `NovaInbox.tsx` for `abm_programs` and `abm_target_accounts`; `NovaTimelineSlot` on both record pages; ⌘K `CREATE_ACTIONS` "New program" gated on `abm`. |

---

## 11. §3b checklist — walked in full (every skip named)

| # | Item | Decision |
|---|---|---|
| 1 | DB | Three tables (§3) + four column additions, RLS `for all` tenant isolation in the same migrations `0180_abm_programs.sql`, `0181_abm_target_accounts.sql`, `0182_abm_buying_group_members.sql` and `0183_abm_custom_field_types.sql` (renumbered at build time: the doc first said 0137, which is the domain event table; 0180 to 0184 are reserved for ABM); ledger entry pending on both DBs; degrade on 42P01 (§3.6); `custom_data` on all three; `scripts/seed-abm-demo.sql` (two programs — "Riyadh developers 2027" new business, "AMC expansion 2027" expansion — 12 + 8 targets over the demo accounts, one account in both, buying groups with two open gaps, progress history as events, one linked won deal; idempotent; flips `abm` on for `is_demo`; run AFTER 0183 and the marketing demo seed). |
| 2 | Types & registry | `AbmProgram`, `AbmTargetAccount`, `AbmBuyingGroupMember` in `types.ts`. Master ref: `abm_programs` → `ABM-####` via `insertWithMasterRef`; **skip on targets and members** (children, referenced through program + account / contact, like quote lines — their own `id` is the update contract). `PilotObjectType` + `PILOT_OBJECT_TYPES` + `FIELD_REGISTRY` for all three (sections: Program → Goal, Window, Ownership, Source; Target → Position, Ownership, Next step; Member → Person, Role), `ref`/`id`/`progress_changed_at` marked locked/exportOnly. |
| 3 | Custom fields | all three in `VALID_OBJECTS`; tabs in the custom-fields page carrying `featureKey: abm`; PATCH routes accept `cf_`-filtered `custom_data`; `ObjectSections` on both record pages (excluding the hand-rendered header facts and the buying group). |
| 3½ | CRUD + screens | §10 routes; list, record, create (program) pages; target and member create in drawers (no separate pages — a drawer keeps the person on the program; stated); `ROUTES`; `NAV` item **ABM** in the Marketing group with `featureKey: abm`, `workcenterKey: abm`; `WorkcenterKey` + catalog entry; flag `abm` in `TenantFeatures`, `TenantEditor` FEATURES (dependency: `marketing`; optional: `buying_signals`, `coverage_model`, shown in the dependency list), `DEFAULT_FEATURES` **off**. |
| 4 | Data Workbench | all three modes for all three objects (§10); `ImportObjectId`, `REGISTRY_OBJECT_TYPE`, `REQUIRED_KEYS`, `OBJECT_META`, `OBJECT_ORDER` + feature filter; import routes `collectCustomData`; export emits `id`; update matches `id` only. No deliberate exclusions. |
| 5 | v1 API | §10; `OBJECT_FEATURE` entries; `authorizeApi` on every route; `EXPLICIT_SCOPE_ONLY` += `abm_targets`; internal-only: `notes` on members and `dropped_reason` are **excluded** from every v1 select and from `LIST_SOURCES` (a rep's private note about a person is not for integrations — deliberate, commented). |
| 6 | MCP | four tools; version bump. |
| 7 | Cross-cutting | `OBJECT_FEATURE`: `abm_programs`, `abm_target_accounts`, `abm_buying_group_members` → `abm` (the `objectFeatures.test.ts` build check covers the new routes). Change history ×3 + dropdown. Global search: programs only (skip on children, stated). Advanced filter + saved queries on the list. Nova ×4 for programs and targets (members are reached through the target — skip, stated). ⌘K "New program". |
| 7½ | Analytics | three metrics, tile, `METRIC_META` (§10); program count tile skipped. |
| 7¾ | Cross-object | §9 in full. **Deferred, stated:** Nova Crew drafting plays (its Phase 3); AI role suggestions (§5.3); the `abm_program_stats` materialisation (§9.8); revenue through `marketing_touches` (M7); WhatsApp steps in plays (M6); "Add to a program" from the Estimator's customer card (small, after A1 feedback). |
| 8 | Docs | Marketing Guide gains a chapter "Account-based marketing"; Admin & Setup gains Settings → Marketing → ABM; API guide gains the three endpoints and the explicit scope. **After the owner validates** (memory: docs after testing). |
| 9 | Prove it | `npx tsc --noEmit`, `vitest` (`progress.ts` rules, `results.ts` counts, `objectFeatures.test.ts`, segment-field loaders), `npx next build` clean; the commit reports this table and the SQL files to run. |

---

## 12. Feature flag, migrations, settings

- **Flag:** `abm` in `TenantFeatures` (sold module, default off, missing key
  = false). Requires `marketing`. `buying_signals` and `coverage_model` are
  optional and only enrich (stage column, owner resolution). ABM is **not**
  gated on `next_experience`: it is a standard module, not a Nova
  experiment; its Nova surfaces (inbox, palette, timeline) self-gate like
  every other object's.
- **Migrations:** `0180_abm_programs.sql`, `0181_abm_target_accounts.sql`, `0182_abm_buying_group_members.sql` (one per table, built in A1) and `0183_abm_custom_field_types.sql` — the three tables with indexes
  `(tenant_id, program_id)`, `(tenant_id, account_id)` on targets,
  `(tenant_id, target_account_id)` and `(tenant_id, contact_id)` on
  members, unique constraints in §3, RLS + policies; the four column
  additions with FKs; `StatusEntityType` seeds for `abm_program` and
  `abm_target_account` through the status engine's seed helper.
  A separate segment-fields migration is **not** needed — segment fields are
  code. Both listed in PROJECT.md's ledger as pending on both DBs.
- **Settings → Marketing → ABM** (admin): default required roles, tiers in
  use, the Engaged rule toggle, play templates on/off, progress labels
  (link to Statuses). Save top right.

---

## 13. Build phases, and where ABM sits in M0–M9

ABM depends on **M0** (`domain_event`, `emitEvent`, consent ledger) for
progress rules and consent chips, on **M3** (journey runner) for plays, and
benefits from **M5** (Signals) for the stage column and "moved" view. It
does not depend on M1/M2/M4. Proposed placement: **A1 right after M2**
(it reuses nothing from M2 but the owner can see the ABM frame while
journeys are being built), **A2 with M3** (plays are the first scoped
journeys and a good integration test), **A3 with M5–M7**.

| Phase | Delivers | Demo on the demo tenant (honest) | Roadmap slot |
|---|---|---|---|
| **A1 — The frame (first demo-able slice)** | tables + migration + seed; programs list, program record (Overview, Target accounts, Results, Activity), target account record with buying group, gaps and suggestions; progress rules over the events that already exist after M0 (quotes sent/opened, deals created/closed, campaign sends) + manual progress with reason; owner via Coverage; `+ Add accounts` from target groups, Coverage segments and by name; three `SEGMENT_FIELDS`; Account 360 card + two suggestions; Account/Contact/Deal related cards and the deal column; Nova inbox next steps + timeline + ⌘K; change history; `GET /api/v1/abm-*` + MCP + DW all modes; analytics tile; flag | Open "Riyadh developers 2027": 12 Saudi developers and contractors from a target group, tiers set, buying groups with "no decision maker yet" on two, Najd Urban Development already *Deal open* because its deal is linked, the Results funnel reading 12 → 11 → 7 → 4 → 3 → 1, the same account visible in "AMC expansion 2027" at a different tier and progress, and the Account 360 card listing both. Nothing sent, nothing faked — every number clicks through to rows. | after M2 |
| **A2 — Plays** | `journeys.kind = play` + `abm_program_id`; the plays studio (journey builder with ABM options, hints, Show me how); the two ABM actions; the progress subscriber in the runner; the five templates; *Who would get this now*, *Try it on one company*; Results gains "reached by play" | Turn on *First touch* for the 1:1 targets: the demo decision makers get the Arabic / English case-study version in the redirect inbox, a click moves a target to Engaged with the reason, the owner gets the next step in the inbox. | with M3 |
| **A3 — Market and money** | buying stage column + factor pop-over + "moved" view from Signals; *Add to a program* on the Signals list; linked revenue through the attribution chain; WhatsApp steps in plays; the *Deal stalled* template | "Buying stage moved up for 5 of 12 since the program started" and "SAR 1.8 m invoiced from this program" on the Results tab. | with M5, M6, M7 |
| **A4 — Polish** | AI role suggestion (proposes, person accepts); Nova Crew Growth drafts a play; `abm_program_stats` materialisation when needed; Drive guides | — | M9 |

Each phase ends with tests + build clean, a commit listing the §11 table
and the SQL files, the demo tenant seeded, and the owner validating before
the next (bpmsquarecore §10 rule 2 applies to the look).

---

## 14. Privacy

- ABM is **account-level** data by design; the only personal data it adds
  is the buying-group row (which contact, which role, a rep's note). That
  table is `EXPLICIT_SCOPE_ONLY` on the v1 API, members are excluded from
  global search, and `notes` never leave the app (no v1, no `LIST_SOURCES`,
  no MCP).
- No engagement is copied into ABM tables; the buying-group view reads
  `domain_event` at render time under the platform's retention and consent
  rules (no opens unless `track_opens`, identified web visits only with
  consent).
- Naming someone in a buying group sends nothing and needs no consent;
  every send is gated by `canContact()` at the send step; demo workspaces
  are redirect-only through `resolveOutbound()`.
- Money on ABM screens is deal amounts and invoiced totals the tenant
  already sees on those objects; cost/margin never appears. Exports of the
  target list carry no contact PII unless the member object is exported
  explicitly (its own DW object, its own permission).
- Isolation, concretely: every route `requireTenantUser()` first; every
  foreign id from a body verified against the tenant (§10); the subscriber
  iterates tenants and filters `.eq("tenant_id", …)` on the admin client;
  cache keys include `tenantId`; a cross-tenant `account_id` on `POST
  targets` matches zero rows and fails cleanly.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| **A second automation engine creeps in** ("plays are simple, just a cron") | plays are journeys by table and by code (§6); the only ABM additions are two registry actions and a progress subscriber in the existing tick. |
| **Two stages confuse people** (buying stage vs progress) | two words, two columns, two hints; buying stage is read-only everywhere in ABM with "from Buying signals" on it; progress always shows its reason. |
| **Target lists drift silently** | snapshot + explicit Refresh with a diff the person ticks. |
| **Buying-group roles go stale** (people change jobs) | `contact.updated` → "no longer at this company" gap; nothing is auto-removed. |
| **Results are flattering** (every click counts) | engaged needs a buying-group member and, optionally, the required roles; counts click through to rows; tiny-sample note; "from linked deals" until M7. |
| **Vikas sees a new nav item** | `abm` is default off; nothing changes for a tenant without the module. |
| **Signals catalogue name mismatch** | §14 Q5 — one name decided before M0's catalogue is frozen. |
| **Migration pending on production** | 42P01 → hidden module, empty card, false segment fields. |
| **Looks like old CRM** | mock-up first; plain words; the plays studio reads as sentences; gaps are sentences, not red icons. |

---

## 16. Open questions for the owner (with a recommendation each)

1. **Name on screen:** "ABM" (the term marketers use) or "Key accounts" /
   "Account programs" (plainer)? **Recommend "ABM programs"** as the nav
   item, with the page title "Programs" and the hint "Account-based
   marketing — work the companies that matter as a team". Rename touches
   labels only.
2. **Plays = journeys** (§6, recommended) or a separate, simpler ABM-only
   builder? **Recommend journeys**: one engine, one consent gate, one
   runner; the ABM vocabulary lives in the panel options and the
   templates.
3. **Engaged rule:** should a target become *Engaged* only when the
   required roles are filled (strict, makes the gap bite), or on the first
   engagement regardless (lenient)? **Recommend strict as the default**,
   per-tenant toggle, because the gap is the point of a buying group.
4. **Owner per target:** default from Coverage with a per-program override
   (recommended), or always the program owner? **Recommend Coverage** —
   it is the one place ownership is already decided.
5. **Catalogue name for the stage event:** the umbrella doc says
   `account.buying_stage_changed`, the Signals draft says
   `signal.stage_changed`. **Recommend `account.buying_stage_changed`**
   (the object is the account) and align the Signals doc.
6. **Where in the roadmap:** A1 right after M2 (recommended, so the ABM
   frame is visible early and plays arrive with the runner), or A1+A2
   together after M3? **Recommend A1 after M2**.
7. **Tiers:** the three classic tiers (recommended) or let a tenant name
   its own? **Recommend the three with tenant labels** via config.
8. **Dropped accounts:** keep them visible in Results (recommended — an
   honest result includes who was dropped and why) or hide them?
