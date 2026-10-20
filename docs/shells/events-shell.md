# Marketing events, the shell (phase M8 of the marketing platform)

> Written 2026-10-20 with the code. A shell is a thin, working, demo-able slice on a solid foundation (tables, row
> security, flag, events) with the rich features left for later. Design source:
> `docs/marketing-platform-architecture.md` section 9. Flag: `features.marketing_events`, platform-admin only, default
> off, needs `marketing` and `marketing_forms` (the follow-up also needs `journeys`).

## Built in the shell

**The event object** (`marketing_events`, EVT-####): name, kind (webinar, exhibition, roadshow, site visit), date and
start and end time (the workspace's wall clock, stored as an instant in its time zone), venue, an https link, capacity,
a plain description, status (draft, registration open, closed, completed, cancelled), the registration form, the
follow-up journey and who it is for, and the owner (the creator by default). Every value passes a closed sanitiser
(`sanitizeEvent`): unknown keys dropped, a link must be https with no credentials, the end must follow the start.
The form, the journey and the owner are loaded **by id and this workspace** before they are used; a form can belong
to one running event (a submission would otherwise register the person twice). Standard tenant-isolation RLS.
List (`/marketing/events`) on the shared list template with status chips and registered/came counts; record page on the
shared record template with four tabs: **Details** (edit, the form's public address, the link), **Attendees**,
**Follow-up**, **Results**. Status-only saves drive Open registration, Close, Mark completed and Cancel.

**Registration through a Form.** Attach an existing form to an event and open registration. When the Forms submit has
kept a submission, it calls one hook (`registerFromSubmission`, behind the workspace's flags, never throwing, so a
problem can never lose a visitor's answers): every **open** event of the form's own workspace whose form this is
registers the person (`event_registrations`, unique per person per event, so a second submission changes nothing).
The tenant is the one on the form row, never the request. Consent is exactly what the form recorded: an event never
records consent. `event.registered` goes to the event stream (a cancelled person who registers again emits it again).
Capacity is never enforced; the page shows "N over capacity".

**Attendees tab, built for a phone at the stand.** A search that filters as you type; each row has a name, company,
the company's owner through **Coverage** (live, for the first 60 companies), the status and big buttons: **Check in**,
**Did not come**, **Cancel**, **Register again**. A rep can add a walk-in or phone sign-up (a name-only lookup; no
phone or email is ever shown) and **Register and check in** in one step. After the event starts, **Mark everyone left as
not coming** marks the rest. Moves are a small table (`canMove`): attendance is final because events, journeys and
revenue reports have already seen `event.attended`; a no-show can still turn up; a cancelled person can register
again. `event.attended`, `event.no_show` and `event.registered` are emitted once each, check-ins are written to change
history with who did it, and registrations are **select-only** to members (a forged "attended" would drive follow-ups
and revenue credit).

**Follow-up.** Choose a journey you already built and who it is for (people who came, or people who did not). **Start
the follow-up** puts those people into that journey through the journey runner's own enrolment function
(`enrolFromEvent`): no new automation is built. The journey must be turned on; it keeps every consent, quiet-hours and
daily-limit rule of its own; a person is stamped once started, so the button cannot enrol anyone twice, and someone who
already went through that journey is not put through it again. The journey's own start rule is ignored for these people.

**Results.** Registered (not counting the cancelled), came, did not come, not marked yet, cancelled, **show rate** (came
out of everyone marked either way, stated only once somebody is marked) and a sentence saying what the number is and
what it is not yet ("2 not yet checked in, so this may rise"). Events are touches in **Revenue by campaign** (a
registration or attendance is an engaged touch of the event).

**Surfaces done.** Migrations 0195 and 0196, flag in the platform-admin editor and new-tenant form, module dependencies
(Marketing and Forms hard, Journeys partial), nav item under Marketing behind the flag, workcenter `marketing_events`,
`OBJECT_FEATURE`, `EVT` references, change history on create, update, status moves, delete and every check-in with the
filter options, capability file (experimental) and facts, the demo seed `scripts/seed-marketing-events-demo.sql` and the
ledger in PROJECT.md. **Guides**: no Drive guide was changed (flagged off for every client).

**Skipped 3b surfaces, and why.** Field registry and custom fields (the `custom_data` column is there), Data Workbench
(badge-scan import is the natural first use, below), v1 API and MCP (registrations name people; a test fails the build
if either appears), global search, Nova timeline, inbox and comment maps (so no Activity tab: the change history carries
the audit), command-palette entry, analytics tile, reports metric, saved queries. A shell event is configuration plus a
list, not yet something people look up across the product.

## To enhance later (in the order I suggest)

1. **Confirmation and reminders through the consent gate**: a confirmation email to the registrant with an `.ics` file
   (a Newsletter Studio version, sent with `canContact` and `resolveOutbound`), and a reminder two days before and the
   morning of, as a journey that starts when someone registers. Today nothing is sent to a registrant by the event.
2. **The "After an event" journey template** and `event.attended` / `event.no_show` as journey start events, so the
   follow-up can start by itself instead of by a button (the runner already reads the stream).
3. **Check-in by QR code or a link per person** on the confirmation, and a stand mode (full-screen list, offline-tolerant).
4. **Waiting list and a hard capacity** (registration refused or put on a list when full, promote on a cancellation).
5. **Badge-scan and attendee import through Data Workbench** (create registrations from a spreadsheet, source `import`),
   and export of the attendee list for the organiser.
6. **Cost and return**: an optional cost on the event, shown beside the revenue from Revenue by campaign, and a
   per-event "deals it started" figure on the Results tab.
7. **Several registration forms per event, or several events per form** with a chooser on the form (today one running
   event per form), and languages for the event page and confirmation (English first, then Arabic, as the Studio does).
8. **A public event page** (`/e/<slug>`) with the details and the embedded form, and a calendar view of events.
9. **Webinar providers**: push `event.*` from an external webinar tool through `POST /api/v1/events` (design section 9),
   with `EXPLICIT_SCOPE_ONLY`.
10. **The skipped surfaces above**, once events are something people look up and report on.

## Decisions worth knowing

- **Why registration is a form hook and not an event feature.** A form already finds or creates the person, records
  consent with the exact words shown and files a lead. Duplicating that for events would fork the consent rules.
- **Why attendance is final.** The stream is read by scoring, journeys and attribution; a retraction would have to be
  an event of its own. A mistaken check-in is rare enough to fix with a note on the person's record for now.
- **Why the follow-up is a button.** Starting a journey for a hundred people should be a decision, with a count, not
  a side effect of a check-in screen at a stand. Making it automatic is item 2 above.
- **Why the owner shown per attendee is the company's.** The event has an organiser; the person who should call a
  company after the event is whoever Coverage says owns that company.
