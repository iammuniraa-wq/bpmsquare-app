# Buying signals: the shell (2026-10-20)

A thin, end-to-end, demo-able slice of `docs/signals-architecture.md` (phase 1,
first-party signals only), on a foundation the rest can be added to without
re-design. Flag: `buying_signals` (platform-admin only, default off, needs
`marketing`). With it off there is no menu item, no route, no cron work and no
Account 360 card for the tenant. Migrations 0175 to 0178 (0179 deliberately
unused) are pending on both databases; the code degrades cleanly (42P01, 42703,
PGRST204, PGRST205) until they are run.

## Built in the shell

1. **The score.** A fixed, decaying, capped rubric (`src/lib/signals/rubric.ts`),
   pure and tested, never an AI call. Four capped groups (They asked us 40, They
   responded 25, They are moving 20, They visited 15). Signals count in full for 14
   days, then half, quarter, eighth, gone after 60 (an unsubscribe holds 90). Every
   point is a named factor with its source and date; the factors add up to the score
   exactly, and a group limit shows as its own line. Stored per account in
   `account_intent` (with `account_intent_history`, one row per account per day,
   factors included). Stage in plain words: Quiet, Looking, Comparing, Deciding.
2. **Sources (first-party only).** Standard quotes (asked, still waiting), quotes in
   the Quotations table (read only), deals, three cases on one asset in 90 days,
   contracts ending within 60 days, "I am interested" leads, newsletter and
   campaign link clicks (topic-tagged click 6, untagged 3), and the shared event
   stream for what the product will emit (`quote.opened/accepted/change_requested`,
   `email.unsubscribed/opened`).
3. **Recompute.** `/api/signals/cron/rescore` every three hours: tenants that own
   `marketing` + `buying_signals` only, least recently scored first, a 50 second
   budget, accounts least recently scored first inside a tenant, idempotent (a
   second run writes the same rows, emits nothing twice, alerts nobody twice).
   "Rescore now" for admins. Row history older than 120 days is removed.
4. **Who is in market** (`/marketing/signals`), in the studio layout: options in a
   left panel (every group collapsible, one-line hint per option; the panel
   collapses above the workspace on a phone), the ranked list on the right, an
   account opens inside the workspace with Back. Optional English "Show me how".
   Each row: stage, the score with its eight-week line, a one-line reason, the owner,
   and one next step by fixed rule (Deciding: Call; Comparing: Follow up or Start a
   quote; Looking: Add to a campaign).
5. **Intelligence cues (owner feedback, 2026-10-20), all computed from stored rows.**
   - A one-line reason built by code from the two strongest signals' own words, for
     example "Comparing: asked for a quote (SIG-SQ-001) and clicked a link about
     Precast". Never AI.
   - Movement made visible: "Moved to Comparing 2 days ago" with a left-edge
     highlight for an upward move in the last 7 days, days in stage, and a
     "▲ Warming / ▼ Cooling / – Steady" label from the previous stage or the week's
     score change (text and arrow, not colour alone).
   - A score sparkline (last 8 weeks from `account_intent_history`), inline SVG on
     theme tokens, on list rows, in the account view and on the Account 360 card.
   - A signals timeline in the account view: the last 15 events that moved the score,
     newest first, each with date, source and a link to the record.
   - No fourth number: health (Account 360), in-market score, and the lead score
     stay separate rubrics.
6. **Topics.** Tenant-defined (`signal_topics`), minimal CRUD in the workspace
   (admin), with change history. A newsletter link that carries a topic id scores
   6 instead of 3 on click.
7. **Account 360.** A `buying_signals` card (score, stage, last signal, eight-week
   line, newest five signals) registered only when the module is on, plus the
   `in-market` suggestion for Comparing and Deciding. The health rating is untouched.
8. **Audience fields** in `SEGMENT_FIELDS`: buying stage, in-market score, days in
   stage, engaged with topic. Offered in the Segmentation builder only to a
   workspace with the module (not in Coverage), evaluated by the recipient
   resolver from the stored row, and false while the module is off or pending.
   Example target group, "everyone Comparing on Precast": Buying stage is
   Comparing AND Engaged with topic contains Precast.
9. **Did it work?** For a sent campaign or newsletter: recipients that moved up a
   stage in the 14 days after the send against the 14 before, clicks, now Deciding,
   average score before and after (with other accounts for contrast), names with
   "Looking to Comparing". Counts and names, a note when fewer than 20 recipients,
   "so far" while the 14 days are running. Reads `account_intent_history` only.
10. **Owner alert.** When an account moves up to Comparing or Deciding, a
    `record_comments` note on the account mentions the account owner (verified as
    a member of the tenant), which the Nova inbox already renders and links. The
    first run for a tenant sets a baseline and alerts nobody; at most 25 alerts per
    run. Only Nova workspaces see an inbox; others still get the note on the account.
11. **Event.** `account.buying_stage_changed` (from, to, score) on every stage
    change, once per change, written after the new stage is stored.
12. **`getBuyingStage(tenantId, accountId)`** in `src/lib/signals/stage.ts` for the
    ABM design: the stored stage and score, Quiet when no row, null when the module
    is off, the account is another tenant's, or the update is pending.
13. **Demo seed** `scripts/seed-marketing-signals-demo.sql` (is_demo only, idempotent):
    five accounts named "... (Sample)" with standard quotes, a contract, two sent
    campaigns, clicks, leads, a Precast topic and eight weeks of stored scores. Run it,
    then press Rescore now.

Isolation: all four tables are select-only for members (no write policy); every
write is on the service-role client with `.eq("tenant_id", tenantId)`; account ids
from a URL are re-verified against the tenant; the tenant never comes from a body.
v1 API: nothing is exposed yet, so `EXPLICIT_SCOPE_ONLY` is unchanged (it must gain
`signals` and `account_intent` the day a v1 endpoint is added).

## To enhance later (in the order I suggest)

1. **Program-level heatmap** of stage distribution and movement over time (needs ABM programs).
2. **Suggested plays** when an account reaches Comparing or Deciding, and a "My ABM
   day" feed (needs ABM and Journeys).
3. **Stability indicator** (stable vs volatile movement) once there are enough weeks
   of history.
4. **Richer timeline view** with filters (source, group, date range) and the full
   history beyond the stored 15.
5. **External sources**: news, tenders (Etimad, Monaqasat) and job postings with AI
   classification into topics and the "Check these" queue, company registry,
   reverse-IP, the website snippet, and paid intent connectors (Bombora, G2). Adding
   the Moving and Visited groups moves the stage thresholds back from the shell's
   scaled 42 / 26 / 10 to the design's 65 / 40 / 15 automatically (`thresholds()` in
   the rubric derives them from the live groups).
6. The account record tab "Signals" and the AI "this week" sentence (labelled as AI,
   never touching the score).
7. Data Workbench export of signals and intent; v1 endpoints, MCP tools, OpenAPI
   (with `EXPLICIT_SCOPE_ONLY`).
8. Rubric dials in Settings (decay half-life, daily AI budget), keywords used for
   matching, product-category mapping on topics.
9. Dashboard tile and Reports metric ("accounts in market", "marketing moved N"),
   global search and ⌘K entries, saved queries on the list.
10. Quote, deal and case header facts ("In market: Deciding"), the case "possible
    sale" action, and automation rules on `account.buying_stage_changed`.
11. A precision report on the team's "not in market" feedback; snooze.

## §3b surfaces skipped in the shell, and why

- Master ref (`XXX-####`) and custom fields on signals or topics: signals are
  system rows; topics are a small admin list (revisit with Settings).
- Data Workbench import, export and update: nothing hand-typed may reach the score;
  export is listed under later. No DW route was added, so no `assertObjectFeature`
  call was needed; `OBJECT_FEATURE` already maps `signals`, `account_intent` and
  `signal_topics` for the day they get one.
- v1 API, MCP, OpenAPI, `LIST_SOURCES` (so `/api/v1/ask` cannot reach it yet).
- Global search, ⌘K, advanced filter and saved queries, analytics and reports
  tiles, Nova object timeline entries (the alert is an ordinary account comment).
- Account record "Signals" tab (the Account 360 card carries the same content).
- Done: nav item under Marketing behind the flag, workcenter `signals`,
  `OBJECT_FEATURE`, change history (topics and not-in-market decisions, in the
  filter), capability file, Account 360 card order setting.
