# Journeys, the shell (phase M3 of the marketing platform)

> Written 2026-10-20 with the code. A shell is a thin, working, demo-able slice on a solid
> foundation (tables, row security, flag, runner, safety rules) with the rich features left
> for later. Design source: `docs/marketing-platform-architecture.md` sections 3 and 6, and the
> approved look `docs/design/marketing-automation-mockup.html`. Flag: `features.journeys`,
> platform-admin only, default off, needs `marketing`.

## Built in the shell

**The object.** A journey (`JNY-####`): name, status (draft, on, paused, archived), one trigger
event from a short list of plain-worded events (a quote is sent, accepted, a deal created or
closed, a case closed, an invoice paid, an AMC about to expire, a lead created, a form
submitted) with one optional simple condition (the kind of quote, or an amount), and a linear
list of steps. The stored definition is a closed JSON shape validated by `sanitizeJourney()` on
every write and again on every load.

**Steps (linear only).** Wait (hours or days), Send a newsletter version, Create a task for the
owner, Notify the owner, End. The wait at the start counts from the event, so "3 days after the
quote was sent" is true even for people picked up when the journey is turned on.

**One send path.** The send step does not send anything itself. It keeps one quiet campaign per
step (hidden from the Campaigns list, migration 0169) and hands one recipient to the same
`sendNewsletterCampaign()` the Campaigns page uses: contact resolution, `canContact()`, language
choice, `resolveOutbound()`, the recipient row, `email_log` (kind `campaign`) and the
`email.*` events. Two optional hooks were added to that function and nothing else: the event
depth and source a journey send carries (depth 1, source `runner`) and a per-recipient outcome
callback.

**Owner tasks and notices.** The product had no task object, so the shell adds the smallest one
(`journey_tasks`, migration 0168): a title, a due date, an owner and Mark done on the journey
page. The owner is the winning Coverage team's lead, else the owner cached on the account; no
owner means the task is created unassigned and the log says so. "Notify the owner" writes a
comment on the account that mentions the owner, so it lands in the Nova inbox.

**The builder.** `/marketing/journeys` (list through the object template),
`/marketing/journeys/new` (template chooser) and `/marketing/journeys/[id]`: options on the
left (Name and start, When it starts, Rules, Languages), each collapsible with a one-line hint;
the journey on the right as sentences; the panel collapses above on a phone; an optional
"Show me how" walkthrough in English that never opens by itself. A live journey is locked until
paused.

**The runner.** `GET /api/marketing/cron/journeys` every five minutes (`vercel.json`, the same
`CRON_SECRET` pattern as the other crons; the proxy lets `/api/marketing/cron/` through).
Per workspace, least recently run first, inside a 240 second budget: take the workspace's lock
(a conditional update, so overlapping ticks cannot both work), read new `domain_event` rows
after a per-workspace keyset cursor (`journey_cursors`), enrol people at most once per journey
(unique index on journey and subject, re-entry is off), then move due runs forward (up to 200
per tick, up to six steps each). Every finished, skipped or failed step writes one
`journey_run_steps` row unique on run, step and attempt, so a retried tick cannot do a step
twice; a send that crashed after the email went is recognised from its recipient row and not
repeated. A failed step retries with back-off (5, 20, 45 minutes), then the run is stalled and
the page says why. With the flag off the workspace is never read past the tenants list.

**Safety, enforced in code.**
- Consent: checked first, so a refusal is never hidden behind a wait (the step is skipped with
  the reason and the journey carries on), and checked again inside the one send path at the
  moment of sending. Nothing in the journey code can override `canContact()`.
- Quiet hours (default 20:00 to 08:00) and a weekly day off (default Friday, Saudi) in the
  workspace timezone: the step waits for the next allowed moment, never dropped.
- At most one journey email per person in any 24 hours across all journeys.
- Promotional steps wait while the company has an open case older than 30 days or an overdue
  invoice (switchable per journey).
- A demo workspace is redirect-only through `resolveOutbound()`; with no redirect inbox it
  sends nothing.
- Loop guard: a journey cannot start from `journey.*` or `email.*` events, events carry depth,
  nothing deeper than 2 enrols, and an event from a journey's own campaign never enrols.
- Blast radius: turning a journey on that would enrol more than 200 people (setting
  `config.marketing.journey_limits.blast_radius`) asks for a confirmation that lists the count.
- Pause is a kill switch: runs keep their place, nothing is sent.

**Transparency (owner feedback, same day).**
1. A one-line "why this step will fire" under every step, and "held or skipped if" listing the
   rules that can block it, both written by code from the step's own settings and the workspace
   limits (`explain.ts`), shown in the builder; the run log shows the reason a run is waiting or
   a step was skipped, from the same reason table (`reasons.ts`).
2. Live context on the journey page, from rows the runner already writes: entered, waiting,
   stuck (a step overdue by more than two ticks, or stalled), skipped or held grouped by reason
   (no consent, quiet hours, daily limit, open urgent case, nobody to contact, needs setting up),
   and clicking a group lists the people.
3. Before going live: who would enter today (count and the first ten, by the very functions the
   runner enrols with) and Try it on one person, shown as a day-by-day timeline with the message
   version and language named. It only reads: no run, step row, recipient or event is written.
4. Guardrail messages before Turn on: not ready (stops), over the blast radius (needs a
   confirmation), people with no consent (counted by asking `canContact()` for up to 300 of
   them), and people who could get more than one message a day across journeys.

**One starter template.** Quote follow-up: a Standard Quote is sent, wait 3 days, send a chosen
newsletter version, create a task for the owner. Plus Blank.

**Demo seed.** `scripts/seed-marketing-journeys-demo.sql`: for `is_demo` tenants only, flips the
flag on and adds the sample journey as a draft. Nothing is turned on and no history is invented.

**Surfaces done.** Migrations 0165 to 0169, flag in the platform-admin editor and the new-tenant
form, module dependencies, nav item under Marketing behind the flag, workcenter
(`marketing_journeys`), `OBJECT_FEATURE`, `JNY` refs, change history on every mutation including
its filter option, command palette "New Journey", capability file (experimental).

## To enhance later (in the order I suggest)

1. Journey health indicator and step-level performance (reached, sent, clicked, dropped) from
   the same step rows and the `email.clicked` events.
2. A compact flow heatmap showing bottlenecks and drop-off.
3. Smart suggestions: recommended templates from the Signals stage, ABM tier or recent
   engagement.
4. Tier-aware guardrails ("this step may over-send to tier 1:1 accounts").
5. ABM plays as a specialised journey mode (`kind = 'play'`: account-level triggers,
   buying-group audiences, progress-based actions, ABM vocabulary) on the same engine, once the
   ABM shell is merged.
6. Branching (if, yes and no paths) and waiting for an event ("until the quote is opened, at
   most 3 days"); the definition is already versioned for it.
7. Versions of a definition with "move everyone to the new version"; today a live journey must
   be paused to change its steps and runs follow steps by id.
8. Settings, Marketing, Journey limits screen (quiet hours, day off, daily limit, trouble days,
   blast radius). The values are read from `config.marketing.journey_limits` today and shown,
   not edited, in the builder.
9. The other templates from the design (New enquiry welcome, AMC renewal, Gone quiet, After an
   event) and the other triggers (segment entered, schedule, manual add).
10. Re-entry rules ("again after 90 days"), audiences from Segmentation and Coverage segments,
    and a true account-level journey.
11. The remaining actions: WhatsApp, add to audience, create lead or deal, ask a person; and the
    shared action registry with the Sales Engine rules.
12. The 3b surfaces skipped here: field registry and custom fields, Data Workbench, v1 API and
    MCP (with `EXPLICIT_SCOPE_ONLY`), global search, Nova timeline and inbox maps, analytics
    tile and report metric. Journeys are configuration with a run log, not records people look
    up, so none of these is needed to demo the slice.
13. A "Send test to me" button and a proper task list ("My tasks") outside the journey page.
14. A `journey` kind in `email_log` (today a journey email is logged as a campaign email, with
    the journey's quiet campaign as its related record).

## Decisions worth knowing

- **"Urgent case".** The product has no case priority, so "open urgent case" is read as the
  design document reads it: a case still open after 30 days (setting), or an overdue invoice.
- **Lookback.** Turning a journey on also enrols people from matching events in the last 3 days
  (setting per journey, 0 to 30) so there is something to see; the blast-radius check counts
  exactly those people.
- **Run history is not frozen per version.** Editing needs a pause first, and a run whose next
  step was removed leaves with the reason "journey changed".
