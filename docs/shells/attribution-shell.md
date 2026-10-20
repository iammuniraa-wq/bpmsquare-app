# Attribution, "Revenue by campaign", the shell (phase M7 of the marketing platform)

> Written 2026-10-20 with the code. A shell is a thin, working, demo-able slice on a solid foundation (tables, row
> security, flag, cron) with the rich features left for later. Design source:
> `docs/marketing-platform-architecture.md` section 8 and the event stream (1.2). Flag:
> `features.marketing_attribution`, platform-admin only, default off, needs `marketing`.

## Built in the shell

**The touches ledger** (`marketing_touches`, 0190) is a read model of the `domain_event` stream, written only by the
cron. An event becomes zero, one or two touches of a company (and the person, when the event names one):
- `email.clicked` / `email.interest`: the campaign and its newsletter, **engaged**;
- `email.sent`: the campaign and its newsletter, **reached** (only sent something);
- `form.submitted`: the form, engaged;
- `journey.entered`: the journey, reached;
- `whatsapp.sent`: the template, reached (a dry run reached nobody and is ignored); `whatsapp.read`: engaged;
  `whatsapp.replied`: engaged, credited to the template the person was last sent (the WhatsApp inbound now carries
  that id, ids only);
- `event.registered` / `event.attended`: the marketing event, engaged.
A touch is unique per source event and kind, so reading an event twice writes it once. A contact-only event gets its
company from the contact (this workspace only); an event about nobody we can place makes no touch.

**Three models, set in code** (`models.ts`, pure and deterministic). For each deal (not dropped), the touches of the
same company in the 90 days before it was created up to the day it closed (or today):
- **started**: the touches before the deal existed share the credit: first touch (earliest gets all), last touch
  (latest gets all), or shared evenly (every touch an equal share). The credit adds up to one deal per deal, so
  these figures can be added;
- **touched**: every asset with a touch in the window, once per deal. A deal appears under every asset that touched
  it, so these overlap and the page says never to add them up.
One company touching the same asset several times within a day (a registration then the visit, two clicks) is one
touch in the credit, so it cannot hold three shares of an even split; the per-asset touch count still shows every one.
Each kind of asset (campaign, newsletter, form, journey, WhatsApp template, event) is its own question. A touch counts
only when the person **did something** unless the person ticks "also people only sent something". Money: open pipeline
and won revenue are the deal amounts; **paid** is the money received on invoices raised from the deal's quotes
(`quotes.opportunity_id` then `invoices.quote_id`), shared in the same proportion. Standard quotes are not invoiced in
the product, so they add nothing to paid.

**The recompute** (`runTenant`, cron `/api/marketing/cron/attribution` every 3 hours, and **Refresh figures** for an
admin). Tenant-rotated (least recently run first), time-budgeted (a 240 second budget in the cron, 40 seconds for the
button; nothing new starts after it), idempotent. Per workspace: take the lock (a conditional update), read new events
after a keyset bookmark in slices of 1000 and write their touches, then recompute and replace the results in place and
delete the rows an earlier run left that no longer apply. Running it twice, or with the bookmark lost, leaves the same
touches and the same results (a test proves it). With the flag off the workspace is never read past the tenants list.
It is read-only on opportunities, quotes, invoices, accounts, contacts and the event stream: a test lists every table
it writes and a source test fails the build if one more appears.

**The page** `/marketing/attribution` ("Revenue by campaign") in the studio layout: the choices on the left, each in a
collapsible group with a one-line hint (what to look at; who gets the credit, with a hint per model; what counts as a
touch), the answer on the right (four figures, then a table: companies, deals started, open, won, paid, deals touched,
won touched), the panel above on a phone, an optional English "Show me how". The model is named next to the numbers and
a "How to read this" card says in plain words what attribution can and cannot say: it shows where deals came from, not
why they were won; a company that clicked may have bought anyway; a deal with no touch may have come from a phone call
that is not recorded; touched figures overlap; and with fewer than 20 deals "read it as a list, not a rate". Money is
shown in whole units of the workspace currency and deals in thousandths: no more precision than the data has. Every
choice is in the address (`?by=form&model=linear&mode=all`), so a view can be linked.

**Surfaces done.** Migrations 0190 to 0192, flag in the platform-admin editor and new-tenant form, module dependencies
(Marketing hard, Pipeline partial), nav item under Marketing behind the flag, workcenter `marketing_attribution`,
`OBJECT_FEATURE`, capability file (experimental) and facts, the cron in `vercel.json`, the demo seed
`scripts/seed-marketing-attribution-demo.sql` and the ledger in PROJECT.md. **Guides**: no Drive guide was changed
(flagged off for every client); refresh the Marketing guide when the owner confirms.

**Skipped 3b surfaces, and why.** There is no record here: the touches and results are computed, so there is no master
reference, field registry, custom fields, Data Workbench, change history (nothing a person edits) or detail screen.
No v1 API or MCP (a test fails the build if any appears: touches say which person clicked what), no global search, no
Nova timeline, inbox or comment maps, no palette entry, no analytics tile, no saved queries.

## To enhance later (in the order I suggest)

1. **"Where this deal came from" on the deal** (the Win tab): the chain of touches for one deal, the first and last in
   words, using the same function. The data is there; it needs a deal-level credit table or an on-demand read.
2. **Time-decay** (the design's fourth model, 7-day half-life) and a position-based model (40/40/20), plus choosing
   the window (30, 60, 90, 180 days) on the page instead of the fixed 90.
3. **Cost and return**: an optional cost on a campaign, event or journey, and a plain "return" figure beside the
   revenue; never a forecast.
4. **Drill-down**: click a campaign to see the companies and deals behind each figure, and the touches in order.
5. **Opportunity linkage to the lead's own source**: use `leads.source_campaign_id` / `source_form_id` and
   `opportunities.lead_id` so a deal created from a lead credits the lead's first source even when the click happened
   outside the window or on another person at the company.
6. **Person-level touches**: credit by the buying group (ABM) instead of the whole company, and show which person
   engaged.
7. **Offline and web touches**: website visits (when the tracker ships), imported badge scans, a rep logging a
   source on a deal; each as another event kind.
8. **A trend**: the same figures by month, so a campaign's contribution can be seen over time, and a dashboard tile
   and reports metric.
9. **Data Workbench export** of the report (aggregates only, no person), and a v1 endpoint for aggregates only, behind
   `EXPLICIT_SCOPE_ONLY`.
10. **Invoices from standard quotes** once the product links them, so paid covers those deals too.

## Decisions worth knowing

- **Why only "engaged" touches count by default.** Being sent an email is not influence; counting it would give credit to
  every campaign that happened to go to a company that later bought. The other mode exists, named plainly.
- **Why started and touched are separate.** Started answers "what brought this deal in" and is additive; touched answers
  "what did this deal see" and overlaps. Mixing them is how attribution reports end up claiming 300% of revenue.
- **Why results are stored, not computed on page load.** The page must be fast and the same for everyone; a recompute
  every three hours (and on demand) is honest about "figures updated at".
- **Why a dropped deal is excluded and a lost deal is not.** A dropped deal went cold with no decision and is not
  pipeline; a lost deal was real and counts toward "deals started", but contributes no value.
