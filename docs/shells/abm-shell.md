# ABM shell (phase A1) — what is built, what comes next

> Status: built on the `abm` flag (platform-admin only, default off, needs `marketing`), migrations
> 0180 to 0183 **pending on both databases**, nothing run, nothing pushed. Design: `docs/abm-architecture.md`
> (look: `docs/design/abm-mockup.html`). Capability file: `docs/capabilities/abm.md` (experimental).
> The design doc called its migration 0137; that number is the domain event table, so ABM is 0180 to 0183
> (0184 stays free). The doc's references were corrected.

## Built in the shell

**Objects (own first-class object, own nav item "ABM programs" in the Marketing group)**
- ABM program (`ABM-####`) → Target account → Buying group member. Own `id` on all three; Update and Delete key off the id only; a program ref and an account name are used only to resolve the relationship when something is created.
- Standard tenant-isolation RLS in the same migration as each table, `custom_data` on all three, degrade on 42P01 / 42703 / PGRST204 / PGRST205 (hidden / empty, never a crash).

**Screens (ObjectListPage / ObjectRecordPage)**
- Program list: status chips, search, sortable columns, a compact "how many are moving" bar.
- Program record, tabs **Target accounts / Buying groups / Results / Activity / Details**. Start / Pause / Resume is the one primary action; the menu has Edit, Archive, Mark completed, Adapt fields, Delete.
- Target account record, tabs **Buying group / Plan / Activity / Details**. One primary action: **Update progress**.
- **Buying stage, Progress and Next step always appear together** (owner decision): side by side on every list row and in the target account header (cards under 780 px keep the three together).
- **Progress is explainable**: wherever it shows it is a pill; clicking it opens "Why this status?" with the rule that fired, the events behind it with dates, what the status means, what moves it next, and for a manual change who made it, when, and the reason.
- **Buying group as an editable grid** (owner decision): one row per person (name and job title, role in this program, last activity, our owner, call-first), role changed in place, add or remove a person, and a ghost row for every required role nobody holds ("No decision maker yet — Add one"). Roles are per program.

**Behaviour**
- Target list built by hand-picking accounts or by copying a marketing target group or a Coverage segment. It is a **snapshot** (the program remembers its source); "Refresh from source" shows what is new and what no longer matches and applies only what is ticked.
- Progress (Planned · Reached · Engaged · In talks · Deal open · Won · Lost · Dropped) is derived by fixed rules from the event stream (`src/lib/abm/progress.ts`), forward only, **overridable by a person with a required reason**; Dropped needs a reason; Won/Lost follow the linked deal. Rules run when a person presses "Check progress" and after a person or role is added or a deal linked (nothing runs by itself yet).
- Required roles per program (default decision maker + influencer) drive the gaps; with the strict default a company is not marked Engaged until the gap is filled ("would be Engaged, but no decision maker is named").
- Owner resolved through Coverage (team lead of the winning owner rule), falling back to the program owner, overridable per program; the account's own owner is never written.
- Minimal Results funnel by **account**: targets → reached → engaged → in talks → in a deal → won, by tier, the goal sentence, open and won money from linked deals, a dropped/lost note and a small-sample note.
- Buying stage read through `src/lib/abm/stage.ts`, which calls `getBuyingStage` from `src/lib/signals/stage.ts` through a guarded `require` and returns nothing when that module does not exist. No ABM score exists.
- Account 360 card **In ABM programs** (stats, one row per program, two rule-based suggestions; the rating is untouched; hideable and reorderable in Settings → Account 360).
- Three segment fields: `in_abm_program`, `abm_progress`, `abm_tier` (loaded for Coverage segments, and in bulk for marketing target-group audiences).
- Demo seed `scripts/seed-abm-demo.sql` (demo tenant only, idempotent, 12 clearly labelled sample Saudi developer/contractor accounts, funnel 12 → 11 → 7 → 4 → 3 → 1, two gaps, three sample deals, a second program).

**§3b surfaces (the full list)**
- Types / registry: `ABM-####` via `insertWithMasterRef`, `PilotObjectType` + `PILOT_OBJECT_TYPES` + `FIELD_REGISTRY` for `abm_program`, `abm_target`, `abm_member`; custom-fields tabs + `VALID_OBJECTS` + the `custom_fields` constraint (0183); `ObjectSections` on the Details tabs.
- App routes under `/api/abm/*` (`requireTenantUser` first via `abmAccess`, explicit PATCH allowlists, `diffForLog` / `logChange` and an event on every mutation, every foreign id tenant-verified, a contact must belong to the target's own account).
- Data Workbench import / export / update for all three objects (`abm_programs`, `abm_targets`, `abm_members`); Update by id only; progress is not updatable in bulk (it needs a reason).
- v1 API: `/api/v1/abm-programs[/id[/targets]]`, `/api/v1/abm-targets[/id]`, `LIST_SOURCES` (so `/api/v1/ask` can answer), `OBJECT_FEATURE`, `EXPLICIT_SCOPE_ONLY` += `abm_targets`, index, `UNDOCUMENTED_ENDPOINTS`, scope panel, endpoint table. Notes, dropped reasons, progress reasons and every contact detail stay out.
- MCP: `list_abm_programs`, `get_abm_program`, `list_abm_targets`, `get_abm_target` (version 1.11.0).
- Global search (programs), change-history filter ×3, Nova timeline on both record pages + comments / inbox / click-through maps, ⌘K "New ABM program", dashboard tile + reports metric `abm_targets_engaged`.
- Events added to the catalogue: `abm.program.created/updated`, `abm.target.added/removed/progress_changed/tier_changed/owner_changed/next_step_set`, `abm.buying_group.member_added/member_removed/role_changed`.

**Deliberate skips in the shell (stated, with the reason)**
- No plays or journeys (they come with Journeys, A2). No `journeys` / `leads` / `marketing_campaigns` / `opportunities` columns added.
- The `opportunities.abm_program_id` column and the deal-card chip / Win-tab line: the program-to-deal link is `abm_target_accounts.opportunity_id`, set on the target's Plan tab; touching Sales screens waits for owner feedback (Sales is a live client surface).
- No master ref on targets and members (children keyed by their own id; stated in the doc).
- Global search finds programs only (companies and people are reached through the program and account).
- Nova inbox / timeline on programs and targets; members are reached through their target.
- Analytics: one tile ("targets engaged of N"); the open-deals and won-in-30-days tiles are not built.
- Settings → Marketing → ABM (default roles, tiers in use, Engaged toggle, labels) is not built: the strict Engaged rule is the default and required roles are set per program.
- Consent chips on the buying group and "Ask for consent" (no send path exists in the shell; naming a person sends nothing).
- "Suggested" strip (contacts who engaged but are not in the group) and AI role suggestions.
- Bulk row actions on the target list, Duplicate program, AMC-based expansion shortcut.
- Drive guides (Marketing, Admin, API) are not refreshed: the owner validates first.
- Studio layout / "Show me how": the shell has no studio workspace (plain list and record pages), so there is no left panel or tour yet; the plays studio will carry both.

## To enhance later (in the order I suggest)

Owner's list first (2026-10-20), then the build items that unlock them.

1. **"My ABM day"** page for the owner: overdue next steps, new signals, fresh engagement, stalled accounts, in one place.
2. **Quick actions on every row**: log a call, set next step, add a person, start a play (a play needs step 5).
3. **Richer Results**: blockers, missing roles, stalled deals, play effectiveness (counts and names that click through; no new number).
4. **Suggested plays per stage and tier, and tier-based content suggestions** (needs steps 5 and 8).
5. **Plays (A2)**: a play is a journey scoped to a program; the plays studio (options left with one-line hints, collapsible groups, optional English "Show me how", phone collapses the panel); the two ABM registry actions; the progress subscriber in the journey runner so progress updates by itself (today it updates when a person presses Check progress); the five seeded templates; "Who would get this now" and "Try it on one company".
6. **A simple readiness indicator per account**: required roles filled + recent engagement + next step set, shown as a labelled checklist and **never a score** (keeps the no-fourth-number rule).
7. **Engagement heatmap by person and week** (read from the event stream at render time).
8. **Buying stage and Signals (A3)**: the stage already shows when `src/lib/signals/stage.ts` exists; add the factor pop-over, "Add to a program" and the "in ABM" chip on the Signals list, "buying stage moved" on Results.
9. **Money (A3)**: linked revenue through the attribution chain, WhatsApp steps in plays, the Deal stalled template.
10. **Deal side**: `opportunities.abm_program_id`, program chip on the pipeline card and the Win tab, a "Create deal" button on a target that pre-fills account, primary person and program.
11. **Consent and the group**: consent chips per person, "Ask for consent", the "Suggested" strip, then AI role suggestions (proposes, a person accepts).
12. **Settings → Marketing → ABM**, bulk row actions, Duplicate program, the two remaining analytics tiles, `abm_program_stats` materialisation past about 500 targets, Nova Crew drafting plays, Drive guides after the owner validates.

## Merge notes for the coordinator

- Shared registry files touched, each kept small: `constants.ts` (flag, routes, nav, analytics id), `TenantEditor.tsx`, `NewTenantForm.tsx`, `moduleDependencies.ts`, `fieldRegistry.ts`, `objectFeatures.ts`, `masterRef.ts`, `workcenters.ts`, `capability/generate.ts` (+ regenerate `facts.generated.json` after merging: `node scripts/build-capability-facts.mjs`), `events/catalog.ts`, `PROJECT.md`.
- `src/lib/abm/stage.ts` loads Signals with `require("@/lib/signals/stage")` inside try/catch so the tree builds without it. Once Signals has landed everywhere it can become a plain import (one line); check the real `getBuyingStage` signature then (the adapter accepts a string or an object with `.stage`).
- Migrations: 0180, 0181, 0182, 0183 in that order, then the demo seed. 0183 rewrites the `custom_fields` constraint with a superset list; if another branch also widens it, keep the union.
