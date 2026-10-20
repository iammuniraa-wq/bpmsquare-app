# Leads that score themselves: the shell (phase M2 of the marketing platform)

Written 2026-10-20. Design: `docs/marketing-platform-architecture.md` sections 4 and 12 (M2).
Foundation it builds on: M0 (`domain_event`, `src/lib/marketing/scoring.ts`, `leadStages.ts`,
`setLeadStage`, the lead columns of migration 0140, `canContact`).

A shell is a thin slice that works end to end and can be shown, on a solid foundation, with the rich
features left for later. This is that slice for lead scoring. The story it tells on the demo workspace:
a person clicks a newsletter and opens a quote, the score rises, the lead becomes *Ready for sales*,
it is handed to a salesperson through Coverage, who is told in the Nova inbox, has a response time,
and sees exactly why the lead scored what it did. The same fact shows on the Account 360 card and can
be used to pick a campaign audience.

Everything is behind the existing platform-admin flag `features.marketing_scoring` (default off; needs
`marketing` and `leads`). With it off, no one sees or gets anything new. The Leads list, the
"Convert to deal" route and the stage route of M0 are unchanged.

## Built in the shell

1. **The scorer** (`src/lib/marketing/leads/scorer.ts`). Reads a lead's person's events from
   `domain_event` (their own events if the lead names a contact, everyone at the company if not), the
   account and contact profile, and runs the pure `computeLeadScore` with the workspace's rubric. Stores
   `score`, `score_factors` (the factors, the rubric version, the events seen) and `scored_at`. A pure
   recompute, never an increment: running it twice gives the same result and announces nothing twice.
   Ignores the score's own `lead.*` events and events past the loop-guard depth. Moves a lead *up*
   New, Engaged, Ready when it earns it; never down, never touches a lead a person has taken on.
   Emits `lead.scored` only when the band changes or the score moves 10 points.
2. **The scoring run** (`runner.ts`, route `GET /api/events/cron/score-leads`, every 15 minutes,
   `CRON_SECRET`). Visits only workspaces with the flag on, the one visited longest ago first, stops
   starting work when its 45-second budget is spent, re-scores leads whose people did something since
   the bookmark plus leads not scored for 20 hours (so scores fade), and flags overdue ready leads
   (`lead.sla_breached`, once each). Bookmark in `marketing_scoring_state` (0162); without it the run
   looks back an hour each time. Placed under `/api/events/cron/` because the session gate in
   `proxy.ts` already lets that prefix through to the route's own bearer check.
3. **Score on demand**: `POST /api/marketing/leads/[id]/rescore`, the "Score again" button.
4. **The lead record page** (`/marketing/leads/[id]`, new): the score as a number and a bar, **"Why 72?"**
   as plain-word factors (what they did, who they are, each with its reason and points, negative first),
   how many points to the next band, the stage with a change control (the existing stage route, with an
   optional note), the owner with a picker and "Take this lead", the response time with an overdue chip,
   the hand-over reason, a timeline of what the person did in plain words, and the Activity tab (Nova
   comments + change history). A "Pick this up" button on a ready lead moves it to Working and, if
   unowned, makes it theirs.
5. **The scored list** (`/marketing/leads`, new): best score first, chips per stage with counts plus
   "Overdue", search, sortable columns with column search, paging. Score bar, stage, owner (or a
   "Needs an owner" chip on a ready lead), respond-by with an overdue marker. The existing Leads list is
   untouched; the nav gets a "Scored leads" item under Marketing for workspaces with the flag.
6. **Assignment through Coverage** (`assign.ts`, `stageEffects.ts`). When a lead enters *Ready* (by the
   scorer or by hand) and has no owner: Coverage resolves the owning team of the account; the team's new
   `assignment_mode` (`lead` = team lead, the default and today's behaviour; `round_robin` = next member
   in turn, pointer moved by compare-and-set so two leads at once take different people); otherwise the
   workspace's oldest admin with the reason recorded ("No coverage matched, so an admin has it" shown as
   a warning chip), otherwise a visible gap. The account's own owner is never changed. Writes
   `lead.assigned`. A setting in Settings, Coverage, Teams ("Who gets new sales-ready leads"), shown only
   with the flag.
7. **Response time (SLA)**. `sla_due_at` is set when a lead becomes ready: one working day by default,
   Sunday off, configurable in `config.marketing.lifecycle` (`sla_business_days`, `weekly_off`).
   *Overdue* is computed, never stored: a lead is overdue while it is still Ready and past its time;
   Working stops the clock.
8. **"Ready for sales" in the Nova inbox**: a system-written comment on the lead that mentions the owner
   (the inbox is built from mentions), only for a workspace with the Nova surfaces. Needed `leads` in the
   comments route, the inbox label/table maps and the inbox's click-through map.
9. **Account 360 "Marketing" card**: best lead's score and band, stage, owner, response-time warning,
   link to the record. Only computed for a workspace with the flag; registered in `BUILTIN` ids, the
   settings route and the settings screen (shown only with the flag).
10. **Campaign audiences**: `lead_score` and `lead_stage` in `SEGMENT_FIELDS` (scope `marketing`): offered
    only in the campaign target-group builder and only with the flag, never in Coverage's segment builder;
    loaded from the account's best lead only when a rule uses them.
11. **Structure**: migrations 0160 (lead hand-over columns), 0161 (team assignment mode),
    0162 (scoring bookmark, service-role only); demo seed `scripts/seed-marketing-leads-demo.sql`
    (six leads with the events behind them, stages, round robin on the first team); change history for
    leads (with the filter option, shown only with the flag); nav item; `leads` workcenter reused; the
    existing `OBJECT_FEATURE` entry (`leads`); every query tenant-scoped, owner ids verified against the
    workspace, no tenant taken from a request.
12. **Tests** (`src/lib/marketing/leads/*.test.ts`): scoring from events, plain-word factors, idempotent
    recompute, fading, loop guard, tenant isolation, flag-off (the run never reads a workspace without
    the flag), stage moves and hand-over, round robin and fallbacks, overdue flagging, tenant rotation and
    time budget, missing-table degradation, the Account 360 card, audience fields.

## To enhance later (in the order I suggest)

1. **Leads appear by themselves**: a contact with no lead who crosses *Engaged* gets one created
   (`source: inbound`, `lead.created`). Waits on the owner's open question 7; until then a person (or the
   existing campaign interest link) creates every lead.
2. **Settings screen for the hand-over**: response time and weekly-off days, a fallback list of
   people to rotate when Coverage matches nothing, who is told when a lead is overdue. Today these are
   defaults plus `config.marketing.lifecycle` with no screen.
3. **Overdue actions**: an inbox row to the salesperson and the team lead when a lead breaches
   (`lead.sla_breached` is already emitted once per lead), then an optional rule to reassign.
4. **Recycling**: *Not now* returns to *Engaged* on a new event after `recycle_after_days`; *Not a fit*
   is kept out of auto-creation for 12 months.
5. **Vikas parity**: Score, Stage and Owner columns on the existing Leads list, only after the owner has
   seen this on the demo workspace (open question 2).
6. **More assignment modes**: least-open, skipping members on leave when WFM knows it, Coverage
   fallback people.
7. **The other surfaces** (section 3b, deliberately skipped now, listed below): v1 `GET /api/v1/leads`
   with `EXPLICIT_SCOPE_ONLY`, MCP tools, Data Workbench export/update/import for the new columns,
   global search, custom fields tab, field registry entry, analytics tiles and a reports metric,
   saved queries and advanced filtering on the scored list, "New lead" in the command palette, a Nova
   Stream item.
8. **Scale of the list**: filter, sort and page in the database (today it loads up to 2000 leads and does
   it in memory, like the other lists), a "My leads" view.
9. **Company-in-market** (Signals): the one cross-score factor, once Signals exists; "Score a sample
   lead" preview in Settings, Scoring; an AI-written sentence under the number (never the number).
10. **Contact record**: the person's score and a Consent card; consent-aware wording on the record.
11. **Drive guides** (Marketing, Sales Cloud, Admin), refreshed after the owner has validated the screens.

## Section 3b: surfaces deliberately skipped, and why

| Surface | Why skipped in the shell |
|---|---|
| Field registry entry | Leads are not a registry (pilot) object yet; adding one needs the Data Workbench modes decided together. |
| Custom fields tab | The `custom_data` column exists (0140); the tab and the record's custom sections come with the registry entry. |
| Data Workbench import / export / update | Leads are not in Data Workbench today; all three modes arrive together (the Update mode must key off `id`, section 3). |
| v1 `GET /api/v1/leads`, MCP tools, OpenAPI | Needs the `EXPLICIT_SCOPE_ONLY` decision and the `LIST_SOURCES` field whitelist reviewed (the existing whitelist already excludes `score_factors`). |
| Global search | A `SEARCH_SPECS` entry needs its feature keys and workcenter reviewed so it cannot leak; the list's own search covers the need. |
| Advanced filter / saved queries | The scored list is new; chips, search and column search cover the demo. |
| ⌘K "New lead" and a create page | The existing Leads page already creates a lead; the shell adds no second way. |
| Analytics tile / reports metric | A "leads ready" tile belongs with M9 (every surface, once). |
| Nova Stream item, contact record card | Later, with the contact record work. |

Done in the shell: `OBJECT_FEATURE` (already mapped `leads` to `leads`; every scored page and route also
requires the flag), change history incl. its filter option, nav item, workcenter (reused), the four Nova
mention surfaces (comments, inbox label and table, click-through) plus the timeline on the Activity tab,
Account 360, audience fields, the demo seed.

## Open questions for the owner

1. The default response time is **one working day, Sunday off**. A Gulf workspace wants Friday and
   Saturday off: set per workspace in `config.marketing.lifecycle` for now. Which default do you want?
2. When no Coverage team matches, the lead goes to the workspace's **oldest admin** (with a visible
   warning chip). Is that right, or should it stay unassigned and show in an "Unassigned" chip only?
3. Should a ready lead be allowed to be picked up by **any** member ("Take this lead"), as built, or only
   by the owner and admins?
