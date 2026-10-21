# Settings simplification: marketing setup audit

> **Status:** audit, 2026-10-22, read-only (no application code changed). Owner brief (2026-10-22): *"Same level of
> simplicity as the Integration middleware in the whole Settings tab ... especially in marketing I see a lot of
> confusion. Keep it simple, don't complicate, don't duplicate, keep it lean."* Standard: `bpmsquarecore.md` §6b and §6c;
> `docs/design/ux-simplification.md`. Reference of "good": `src/app/(app)/settings/middleware/**` (chips for connections,
> one table per kind of thing, side panels, almost no running text).
>
> Method: read the screens' TSX on `develop` (commit ac1ddf1b), `src/lib/constants.ts` (NAV, `TenantFeatures`,
> `MarketingConfig`), `src/lib/settingsMenu.ts`, `src/lib/workcenters.ts`, `src/lib/marketing/**`, the marketing docs.
> Control counts are estimates from the code (default state), not from a live browser. **Not checked:** any tenant's
> flag state (database), the public pages (`/marketing/preferences|unsubscribe|confirm|interest`) beyond their route
> names, the attribution page's controls, the ABM record and event record tab contents, the lead record, the WhatsApp
> Template Studio beyond its group list, the admin tenant editor beyond the flag list, mobile rendering (taken from
> `ux-simplification.md`, not re-run).

---

## 1. Findings in 10 lines

1. **Marketing has no single "set up" place.** Setup is spread over 4 Settings pages, 4 studio side panels, 2 create forms,
   a WhatsApp page under Marketing, an Interests tab inside Buying signals, a Coverage team field and a Workforce page
   (timezone).
2. **Consent is set in 9 places** (section 3a). Settings holds the rules; newsletter, campaign, journey step, form and
   WhatsApp template each ask for a topic again, and "Counting opens" (a lawful-basis switch) sits in **Brand kit**.
3. **Two builders for the same email job.** Campaigns (legacy composer: 12 festival template files plus a rich-text editor)
   and Newsletter Studio (designs, languages, AI) both produce and send email; Studio already ships its own Eid and Diwali designs.
4. **Sending one newsletter takes 3 screens and 7 steps** and asks for the name twice, the topic twice and the languages
   twice; a journey cannot use a newsletter until you press "Use in a campaign" once, even if you never send it.
5. **One audience engine, five faces.** Marketing "Segmentation" (target groups), Coverage "segments", the campaign audience
   picker, the Scoring profile-rule filter and ABM "Source" all use the same filter shape under different words.
6. **Settings that cannot be changed at all.** Journey quiet hours, day off and 1-a-day cap, and the WhatsApp weekly cap and
   test number have no screen ("To change these limits, ask us", `marketing-how-to.md`). Journey timezone is borrowed from
   the Workforce attendance setting.
7. **Layout is blocks, not tables.** Consent shows one bordered card per topic and per country (9); Scoring one card per
   rule (about 90 controls on the default Rules tab). The middleware pattern (table, row opens a panel) is not used.
8. **Printed hint text survives on the screens the simplification batches have not reached:** WhatsApp setup (5 to 6
   paragraphs) and Template Studio (4 group hints), Events create (11 hint lines), New campaign, newsletter source card.
9. **Same word, different thing:** Campaign, Topic/Category/Interests, Segment/Target group, Template (6 meanings), Leads vs
   Lead scores, Version, Stage (3b). A flag called `marketing_scoring` also guards consent and hand-over.
10. **Good news for sequencing:** every 2026-10 module (Studio, Journeys, Forms, Signals, ABM, WhatsApp, Events,
    Attribution, scoring) is "off for every client" per `docs/marketing-build-status.md`, so simplifying them carries no
    client-parity risk. Only Campaigns and Segmentation (`marketing`, the older module) can have live users; those need the
    owner's visual-parity OK (§6c.7).

### One-home-per-concept map (recommended)

| Concept | One home | Everywhere else |
|---|---|---|
| Consent rules, topics list, country rule, opens counting | Settings > Marketing > **Consent** | pickers only list the topics; content inherits its topic |
| Topic of a message | Chosen once, on the **newsletter / WhatsApp template / form** | campaign, journey step, send panel inherit it, no second pick |
| Sender identity (from, reply-to) | Derived, **not a setting**; shown read-only on Email output | one shared function instead of four copies in code |
| Lead scoring + hand-over | One Settings page **Leads** (tabs: Scoring, Lines, Hand-over, Try it) | Coverage team keeps only "who in turn", linked from Hand-over |
| Templates (marketing email) | **Newsletter Studio** designs | no festival picker, no second email composer |
| Audiences | **Segmentation** (named saved groups) | campaign, ABM source, event follow-up, newsletter pick a saved group |
| Languages | **Newsletter** owns its languages; contact/account own preferred language | campaign sends all ready languages by default, fallback English |
| Sending limits (quiet hours, days off, per-day cap, WhatsApp weekly cap) | Settings > Marketing > **Consent**, tab "Limits" | journeys and WhatsApp read them |
| WhatsApp number and provider | A **connection chip** (Connectors pattern) | no setup page under Marketing |

---

## 2. Screen inventory (sorted by priority; P1 = confusing or duplicated today)

Effort S/M/L (S under a day, M a few days, L a week or more). Risk = risk to a live client or to consent/send behaviour.
Flag = the platform-admin flag guarding the screen; "none live" = the module is off for every client per
`docs/marketing-build-status.md` (actual tenant flags not checked). Size is estimated visible controls in the default state.

| # | Screen (path, how reached) and purpose | Size | Problems against 6b/6c and duplication | Flag / live client | Lean target | E / R / P |
|---|---|---|---|---|---|---|
| 1 | **Send one newsletter**: Newsletters > New (Studio), then "Use in a campaign", then `/marketing/new?...` (`MarketingComposeForm`), then the campaign page > Send now. Turns a design into a send. | 3 screens, 7 steps; compose page 4 cards, about 14 controls | Name asked in Studio and again in compose; consent topic in Studio Start and again in `NewsletterSourceCard`; languages chosen in Studio and again ("Languages to send", fallback); audience picker is a third large block; the result is a "campaign" the user never asked to create (6c.1, 6c.2, 6c.5). | `newsletter_studio` + `marketing`; none live | Studio header action **Send...** opens a side panel: audience (saved group or all consenting), languages preticked, topic inherited, "N will receive", test to me, Send. The campaign row is created automatically (name = newsletter + date) and kept as send history. | M / Med / P1 |
| 2 | **Settings > Marketing > Consent topics** `/settings/marketing-consent` (admin). Topics, home country, rule when nobody has said yes. | 3 sections; about 18 controls on defaults (4 topics x 2 inputs, 1 select, 9 country selects, India disabled); 1 conditional warning | One bordered card per topic and per country (9) = block-per-variant (6c.5); every Gulf country rule is shown though a workspace sits in one; named "Consent topics" (menu), "Consent and topics" (guide), "Consent & topics" (ux doc). Gated by `marketing_scoring`, a flag named after scoring. Duplicates: concept "Consent" in section 3a. | `marketing_scoring`; none live | Two tables: **Topics** (name, covers) and **Country rules** (country, rule), row opens a panel; home country first, other countries behind "Other countries". Add tab **Limits** (rows 8, 22) and move "Counting opens" here from Brand kit. One name: **Consent**. | M / Med / P1 |
| 3 | **Settings > Marketing > Brand kit** `/settings/brand-kit` (admin). Logo, colours, font, tone, footer, social, opens counting. | 4 sections; about 14 controls (logo upload, 3 colours x 2 inputs, font, tone, address, up to 6 social links x 3, 1 checkbox) | Two unrelated settings hide in it: **Counting opens** (lawful-basis switch, belongs with consent) and **Tone** (AI voice). With opens off (the default) the default scoring rule "Opened an email" never fires, a coupling no screen shows. Different flag (`newsletter_studio`) from its three neighbours. Duplicates: logo also on Company/Entities. | `newsletter_studio`; none live | Keep logo, colours, font, footer, social (3 sections); tone becomes a field in "Colours and fonts". Move opens counting to Consent. Logo defaults to the workspace logo; upload behind "Use a different logo". | S / Low / P1 |
| 4 | **Settings > Marketing > Scoring** `/settings/marketing-scoring` (admin). How a lead earns points, thresholds, try on a sample. | 3 tabs (Rules, Thresholds, Try it); Rules about 90 controls on defaults (10 behaviour rules x 5 fields, 4 profile rules with filter lines) | Block per rule; each profile rule embeds a full filter builder (third copy of the audience engine); bypasses the settings kit's own field (`ux-simplification.md` §1). Cold/Warm/Hot vs "ready for sales" vs 8 lead stages are three vocabularies. Duplicates: ready threshold here, routing in Hand-over and Coverage. | `marketing_scoring`; none live | One table of rules (what happened, points, fades, weekly cap); row opens a panel; profile rules edited in a panel with the shared filter component. Merge into Settings page **Leads** (tabs Scoring, Lines, Hand-over, Try it). "Fades" and "Counts up to" behind More. | L / Med / P1 |
| 5 | **Settings > Marketing > Hand-over** `/settings/marketing-handover` (admin). Auto-create lead, response time, days off, rota, overdue notices. | 4 sections; about 14 controls (1 toggle, 1 number, 7 day chips, rota list plus add, 2 toggles, 1 fixed "Nova inbox" row) | Small and tidy (labels plus `i`), but one job has 3 homes: this page, Coverage team "Who gets new sales-ready leads", and Scoring "Hot from". Days off duplicates Workforce `week_off_days` and journey `off_weekdays`. A fixed read-only row ("Where they hear: Nova inbox") is not a setting. Gated by `marketing_scoring`. | `marketing_scoring`; none live | Becomes the Hand-over tab of **Leads**. Add a read-only chip row "Teams: 2 in turn, 1 team lead" linking to Coverage (the result, not a copy). Drop the fixed "Nova inbox" row. Days off default from the workspace week where Workforce exists. | S / Low / P1 |
| 6 | **Campaigns > New** `/marketing/new` (legacy composer). Name, template or free text, audience, save draft. | 3 cards; about 12 controls, plus festival picker (12 template files), rich-text editor, 5-part audience picker | Competes with Studio (finding 3). Three content modes (Studio source, festival template, free text). Subject hint line printed. Audience picker repeats Segmentation's fields (types, include, exclude, manual emails, filters, any/all). Duplicates: Studio designs, Segmentation; Settings > Email templates (quote emails, different job, same word). | `marketing`; **the one module a live client plausibly uses** (festival templates, `en-IN` dates; tenant not checked) | Keep working unchanged for existing users. After Studio has the Send panel (row 1): Studio is the default entry, festival templates are folded into Studio built-in designs, free text sits behind "Plain email". Needs owner parity OK. | L / High / P2 |
| 7 | **Segmentation** `/marketing/segments`, `/new`, `/[id]` (SegmentBuilder: palette plus canvas). Reusable audience ("target group"). | List table (3 columns); builder: name, any/all, filters, include/exclude, manual emails, live preview | Called "Segmentation" in the nav but the object is a "target group". Coverage has "segments" using the same `filters/match` engine (`marketing-platform-architecture.md`, audience rules). Campaigns, ABM and events each pick audiences differently. | `marketing`; maybe live | One audience object (saved group) used by campaign, ABM source, event follow-up, send panel; rename the object **Audience** (nav label stays "Segmentation" until parity OK); rename Coverage's in a Settings-wide pass (other audit). | M / Med / P1 |
| 8 | **Journey limits** (no screen): quiet hours 20:00-08:00, day off Friday, 1 email a day, trouble-case 30 days, blast radius 200 (`config.marketing.journey_limits`; read-only chips in the Journey Rules group). | 0 controls, 3 chips | A setting with no home: editable only by us. Timezone comes from Workforce attendance (`moduleAccess.ts` reads `config.wfm.timezone`), so a workspace without WFM silently gets the WFM default. Third "days off" (Workforce, Hand-over, journeys). | `journeys`; none live | Expose 4 values on Consent > **Limits**: quiet from/to, days off, emails per person per day; the other two stay defaults. Show the timezone as a read-only chip with its source. | S / Low / P2 |
| 9 | **Journey Studio** `/marketing/journeys/[id]` (plus New `/journeys/new`). Trigger, steps, safety, try on a person, go live. | 4 tabs (Setup, Build, Try it, Running); panel 3 groups; about 20 controls on Build for 3 steps; New journey is 1 screen, 2 inputs | Already tabbed and `i`-based (batches 1-2). Remaining: "Replace the steps with a template" in Setup duplicates the template choice on New journey; a send step demands a *kept newsletter version* (hidden prerequisite, finding 4) and a topic the newsletter already carries; the Rules group is mostly read-only facts ("Re-entry: never"). | `journeys`; none live | Send step picks a **newsletter by name** (latest ready version), topic inherited. Drop the Setup template replacer (starters only on New). Fold Setup and Rules into one group "Start and rules". Minimum path: New, pick newsletter, Try it, Go live. | M / Low / P1 |
| 10 | **Form Studio** `/marketing/forms/[id]` (New is prefilled). Basics, fields, consent, after sending, share. | 2 tabs (Design, Answers); panel 5 groups; about 25 controls (Basics 5, Fields about 10, Consent 3, After sending up to 9, Share 3) | Defaults already make a working form (good). Consent repeats topic and words per form; "Ask the person to confirm by email" takes its default from "Where you are based" on the Consent page (a cross-page setting). Web address, Heading, Introduction, Button words always shown. "Share" (status, address, embed) is a group for what is really a header action. | `marketing_forms`; none live | Header: status chip, **Go live**, copy link/embed. Panel 3 groups: Fields, Consent (words, topics), After sending. Basics reduced to Name; Heading, Intro, Button, Web address behind More. Show the confirm-by-email default as a chip linking to Consent. | M / Low / P2 |
| 11 | **Newsletter Studio** `/marketing/newsletters/new`, `/[id]`. Design, languages, health, versions. | Panel 4 groups (Start, Blocks, Languages, Health) plus utility cards (template, versions, HTML); Start about 10 controls | Tabbed by batch 1. Remaining: **Category** (Newsletter, Offer, Event, Announcement, Festival) beside **Consent topic** = two classification words for one message (what Category drives besides the built-in design: not checked); three start modes plus built-in designs plus "My templates" plus saved versions = four template-like things; Languages here and again at send. | `newsletter_studio`; none live | Category merges into topic (design offers a default topic); Start = 3 buttons, nothing else until chosen; versions become automatic (rows 1, 9); Languages stays here and is *the* language setting. | M / Low / P2 |
| 12 | **WhatsApp > Number and messages** `/marketing/whatsapp/setup` (admin). Provider, business number, callback address and secret, match numbers. | 3 cards, about 8 controls, **5 to 6 printed hint paragraphs**, plus a recent-messages table | Printed text against 6b. Provider `<select>` with exactly one choice (sandbox). A settings page living under Marketing, not Settings; callback address plus signing secret is the pattern Connectors and the Webhooks library already own. `whatsapp.weekly_cap` and `redirect_number` have no screen (a second "redirect" beside Email output). | `whatsapp_marketing` (build-status doc says `whatsapp`: doc drift); none live | Becomes a **connection chip** in Connectors (Test, Edit, Turn off); number and provider in its panel, secret shown once as today; hints behind `i`; "Match numbers" a button in the same panel. Recent messages stays on the module page as a table. | M / Med / P1 |
| 13 | **WhatsApp > Templates** `/marketing/whatsapp`, `/new`, `/[id]` (TemplateStudio). | 4 groups (Basics, Message, Who may receive it, Approval) with **printed `hint=` lines** | Old `Group` with printed hints (batch 3 of `ux-simplification.md` not applied). "Who may receive it" is a consent topic again (concept 3a). Language is per template, separate from newsletter languages. | `whatsapp_marketing`; none live | Use `OptionGroup` with `info`; topic defaults from the template's purpose; one table list. | S / Low / P2 |
| 14 | **Events** `/marketing/events/new`, `/[id]` (EventForm plus follow-up panel). | 1 form, about 14 controls, **11 printed hint lines** (kind, status, date, capacity, venue, link, owner, about, form, journey, for) | Printed text against 6b. Registration needs a Form (separate screen) and follow-up a Journey (another): three objects for one event. Flag chain: `marketing_events` needs `marketing_forms`. | `marketing_events` + `marketing_forms`; none live | Create = Name, Date, Kind (3 controls); venue, capacity, link, owner, about behind More; "Create the registration form" and "Create the follow-up journey" as one-click actions that preset the other studios. Hints to `i`. | M / Low / P2 |
| 15 | **ABM > New program** `/marketing/abm/new`. | 1 form, 3 cards, about 12 controls (name, kind, owner, goal, metric, target, dates, tier, 4 roles, source) | Eleven decisions before any account exists. **Source** offers "a marketing target group" or "a Coverage segment": the two audience objects of row 7 side by side. Six `info` fields (good), no printed text. | `abm`; none live | Create = Name + Source; goal, dates, tier, roles move to the record's Details tab with defaults (record is already tabbed). Source lists saved audiences only. | S / Low / P2 |
| 16 | **ABM program and target account** `/marketing/abm/[id]`, `/accounts/[targetId]`. | 5 tabs on the program, 4 on the target (kit tabs); buying-group grid 5 columns | Tabbed (good). The grid scrolls sideways on a phone (`ux-simplification.md`); ProgramTools and AddAccountsButton repeat audience picking. Contents not audited further. | `abm`; none live | Grid becomes the standard table plus panel; "Add accounts" uses the audience picker. | M / Low / P3 |
| 17 | **Buying signals** `/marketing/signals` (workspace; Interests tab for admins). | 3 tabs (In market, Did it work?, Interests); filter panel 4 groups; Interests = list plus add form (name, keywords) | Hand-rolled tab strip (not kit `Tabs`/URL) per `ux-simplification.md`; Interests (the former "Topics", correctly renamed) is a configuration list living inside an analysis page, with an inline form instead of table plus panel. The signal rubric is fixed, not tenant-editable: correct, keep it fixed. | `buying_signals`; none live | Interests as a table with a side panel, opened from a small "Manage interests" action; tabs on kit `Tabs` plus `useUrlTab`. | M / Low / P2 |
| 18 | **Lead scores** `/marketing/leads` (plus `/[id]`) and **Leads** `/leads` ("Marketing & enquiries"). | Two list screens, both in the Marketing menu | Two differently named screens for overlapping things (a scored person vs a lead record). Stage words: Cold/Warm/Hot (scoring), 8 lead stages, "ready for sales", "Engaged (Warm)" in config comments. | `marketing_scoring` / `leads`; none live (Leads may be) | Product decision first: one **Leads** list with Score and Stage columns and a Hot filter; "Lead scores" becomes a saved view. Until then rename "Lead scores" to **Scored leads**. | L / Med / P2 |
| 19 | **Revenue by campaign** `/marketing/attribution`. | Not audited (page controls not read) | Name says campaign, scope covers newsletters, forms, journeys, events (`TenantFeatures` comment). No setup found. | `marketing_attribution`; none live | Rename **Revenue by source** only if it matches the data; otherwise leave. | S / Low / P3 |
| 20 | **Marketing menu and flags** (`NAV`, `settingsMenu.ts`, `workcenters.ts`, admin `TenantEditor`). | Sidebar Marketing: 12 items; Settings > Marketing: 4 entries; 10 marketing flags (plus `leads`, `partners`, `next_experience`) | Flat list of 12 mixes creating (Campaigns, Newsletters, WhatsApp), automating (Journeys, Forms, Events), targeting (Segmentation, ABM, Signals) and results (Revenue, Lead scores). `marketing_scoring` covers consent, hand-over, scoring and segment fields. Settings > Marketing has 3 entries on one flag and one (Brand kit) on another. | all; admin-only flags | Sidebar grouped Send / Automate / Target / Results (labels only). Settings > Marketing: **Consent**, **Leads**, **Brand kit** (4 entries to 3). Admin flag label becomes "Consent, lead scoring and hand-over" (key unchanged). | S / Low / P2 |
| 21 | **"Show me how" tours**: `StudioTour`, `FormTour`, `JourneyTour`, `SignalsTour` (70 to 82 lines each). | 4 near-identical components | Four copies of one walkthrough engine; only the steps differ (6c.4). | the four module flags | One shared `Tour` taking steps. No screen change. | S / Low / P3 |
| 22 | **WhatsApp limits and test number** (config only: `whatsapp.weekly_cap`, `redirect_number`). | 0 controls | No screen. The demo redirect already has a home on Settings > Email output (for email); WhatsApp has a separate hidden one. | `whatsapp_marketing` | Weekly cap on Consent > Limits; demo redirect on Email output (rename "Message output"), shown on demo workspaces only. | S / Low / P3 |
| 23 | **Email sender identity** (no screen). From = `<slug>@RESEND_SENDING_DOMAIN`, reply-to = Company info email; computed separately in `campaigns/[id]/send`, `newsletter/sendRoute.ts`, `forms/emails.ts`, `wfm/notify.ts` (journeys read the reply-to in `journeys/env.ts`). | 0 controls | Not a UI defect: there are **no per-tenant sender or domain settings** to simplify. Four copies of the formula is a code-duplication risk. RFQ has its own mail mode (sales-owned, not touched). | all email modules | Keep it a non-setting. One shared `senderFor(tenant)`; show "Sent from / replies to" read-only on Email output. | S / Low / P3 |
| 24 | **Contact consent card, email health, Needs attention** (`contacts/[id]`, Contacts `?view=email`). | 1 card plus table | Per-person consent (not a setup screen); 9 to 11 printed lines each per `ux-simplification.md` §1. Listed for the consent map only; not re-read. | `marketing_scoring` / `newsletter_studio` | Hints to `i` (already specified in the ux doc). | S / Low / P3 |
| 25 | **Partners** | not a marketing screen | Moved out of Marketing on 2026-08-22 (`constants.ts` NAV comment). Out of scope. | `partners` | none | n/a |

**Screens and steps audited: 25 rows.** Rows 1, 8, 22 and 23 are flows or hidden configuration with no screen of their
own; rows 12-13 and 6-7 each cover several routes; rows 19, 16 and 24 were read only at list level.

---

## 3. Concepts that exist in more than one place

### 3a. Concept, all locations, recommended home

| Concept | All locations found | Recommended home |
|---|---|---|
| **Consent (rules and topics)** | (1) Settings > Consent topics (topics, country rules, home country). (2) Form Studio > Consent (words, topics, required, confirm by email). (3) Newsletter Studio > Start > Consent topic. (4) Campaign source card > Consent topic. (5) Journey send step > Consent topic. (6) WhatsApp template > Who may receive it. (7) Contact consent card. (8) Legacy `accounts.marketing_opt_out`, read as a mirror (`consent.ts`). (9) Brand kit > Counting opens (`track_opens`). Also the Data Workbench consent import (not checked). | Settings > **Consent**: topics, country rules, opens counting, limits. Places (2) to (6) offer the same list and default it from the content; campaign and journey inherit. Keep (7) as a per-person record. (8) is code history. |
| **Topics / category / interests** | Consent topics (config); newsletter *Category*; Signals *Interests* (table `signal_topics`); WhatsApp template topic. | Consent topics stay "Topics". Newsletter Category merges into topic. Interests stays the name for product subjects and never uses the word Topic again (already renamed). |
| **Senders** | Computed in 4 code paths (row 23); no UI; RFQ has its own `mail_mode` (sales). | Non-setting; read-only on Email output; one shared function. |
| **Scoring** | Settings > Scoring (lead rubric); Buying signals fixed rubric (intent score, stages); ABM rule-based progress with override; Account 360 rating (deliberately separate, core §10a). | Lead rubric on the **Leads** settings page; the others stay code-defined. Name them differently on screen: **Lead score** (Cold/Warm/Hot), **Buying stage** (signals), **Progress** (ABM). |
| **Hand-over** | Settings > Hand-over; Coverage team field "Who gets new sales-ready leads"; Scoring "Hot from"; scored-leads owner action; Nova inbox notice. | **Leads** settings page (Hand-over tab); Coverage keeps the per-team field and Hand-over links to it. |
| **Templates** | Settings > Email templates (quote emails, Sales); Settings > Text templates (quote snippets); campaign festival templates (12 files); Studio built-in designs (7) and "My templates"; WhatsApp templates; journey templates (1: Quote follow-up). | Marketing email = Studio designs only. WhatsApp templates are a different regulated thing and keep their name. Journey templates become "starters" on New journey. Quote email templates stay in Sales. |
| **Audiences** | Segmentation target groups; Coverage segments; campaign picker; Scoring profile-rule filter; ABM Source; Journey "who would enter" (trigger-based); Event follow-up "For"; Signals audience fields; Newsletter Audience panel (a check, not a builder). | **Segmentation** saved groups are the one marketing audience; every picker lists them. A rule filter inside Scoring or ABM uses the same shared filter component. Coverage segments stay (ownership, not marketing) under a different word. |
| **Languages** | Contact/account preferred language; newsletter languages; campaign "Languages to send" plus fallback; WhatsApp template language; journey derives from the newsletter. | Newsletter owns its languages; send uses all ready ones; fallback English; contact/account own the preference. |
| **Days off / quiet hours / timezone** | Workforce attendance (`week_off_days`, timezone); Hand-over days off; Journey `off_weekdays` (Friday), quiet hours, 1 a day (no UI); WhatsApp `weekly_cap` (no UI). | Workforce keeps its own. Marketing gets one **Limits** tab on Consent; Hand-over days off default from the workspace week. Timezone shown with its source. |
| **Demo/test redirect** | Settings > Email output (email); `whatsapp.redirect_number` (no UI). | One "where messages go" page covering email and WhatsApp. |
| **Explanations** | `i` on most; printed hints on WhatsApp, Events, campaign compose; 4 tour copies; `marketing-how-to.md` repeats every setting. | `i` only (6b); one `Tour`; the guide stays the long form. |

### 3b. Same word, different thing (6b "one meaning per word")

| Word | Meanings found | Fix |
|---|---|---|
| Campaign | A send record (Campaigns), the source of a lead (`source_campaign_id`), the unit of "Revenue by campaign" (which includes forms and events) | "Campaign" for the send record only; "Revenue by source" for attribution |
| Topic | Consent topic; newsletter Category; (formerly Signals Topics, now Interests) | One word, one list: Topic = consent topic |
| Segment / target group / audience | Segmentation page = "target groups"; Coverage "segments"; Audience panel; ABM Source | Audience (marketing) vs Territory (Coverage, owner to choose) |
| Template | Quote email, text snippet, festival, design, WhatsApp, journey | See 3a: design / starter / template |
| Leads vs Lead scores | Two menu items, two lists | Row 18 |
| Version | Kept newsletter version; "rules version" on a lead score; saved Studio versions | "Version" for newsletters only; "Rules as of" on scores |
| Stage | Lead stage (8), pipeline stage, buying stage (signals), ABM tier/progress | Prefix each: Lead stage, Buying stage, ABM progress |
| Studio / builder | Newsletter Studio, Journey builder, Form builder, Template Studio, Process Design Studio | Studio for the three canvas tools (Newsletter, Journey, Form); "builder" nowhere |

---

## 4. Proposed lean setup flows (minimum clicks, everything else defaulted)

Setup before first use today: none is *required* (consent has strict defaults, Brand kit derives logo and colours, journeys
and forms ship defaults), but `marketing-how-to.md` sends an admin to Consent, Brand kit and Scoring first, and a form
needs the workspace's web address (custom domain). Lean target: **zero required Settings visits; one optional page per
concern**.

### 4a. First newsletter

| | Today | Lean |
|---|---|---|
| Steps | 1 Newsletters > New. 2 Start: name, category, consent topic, mode (AI brief / design / blank). 3 Edit blocks, subject per language, Languages, Health. 4 Save. 5 "Use in a campaign" opens compose. 6 Compose: name again, languages again, fallback, topic again, audience (5 sub-controls), Check audience, See as person. 7 Save draft, open the campaign, Send now, confirm. | 1 Newsletters > New, pick a design (or "Write it for me"). 2 Edit. 3 **Send...** panel: audience (saved group or all consenting), "N will receive, M skipped (no consent)", Send test to me, Send, confirm. |
| Counts | 3 screens, 7 steps, about 9 mandatory decisions, 3 values entered twice | 1 screen plus 1 panel, 3 steps, 2 decisions (design, audience) |
| Defaults | none | name = design name + date; topic = design's default topic; languages = all ready; fallback = English; audience preselected to "all consenting contacts" with the count shown |

### 4b. First journey

| | Today | Lean |
|---|---|---|
| Steps | 1 Build a newsletter and press "Use in a campaign" once to keep a version. 2 Journeys > New: template, name. 3 Studio Setup (rename, replace template), When it starts (trigger, condition, lookback), Rules (read-only). 4 Build: pick the kept version, topic, task text. 5 Try it on one person. 6 Go live (asks again if more than 200 would enter). | 1 Journeys > New: pick a starter. 2 Build: pick a newsletter by name (preselected if only one exists; topic inherited). 3 Try it. 4 Go live. |
| Counts | 2 modules, 6 steps, about 8 decisions, 1 hidden prerequisite | 1 module, 4 steps, 1 decision (which newsletter) |

### 4c. First form

| | Today | Lean |
|---|---|---|
| Steps | 1 Forms > New (prefilled name, address, fields, consent). 2 Optionally walk 5 groups (about 25 controls). 3 Share > Status Live. 4 Save. Needs a workspace web address first. | 1 Forms > New. 2 **Go live** in the header, with copy link / embed shown right there. Fields, Consent, After sending only if the user wants to change them. |
| Counts | 2 to 4 steps; 5 groups always offered | 2 steps; 3 groups; Basics and Share removed |
| Kept visible | No web address: the form has no public link (a blocker state, per 6b "what must stay visible") | same |

---

## 5. Recommended order of work (independently shippable batches)

Each batch merges alone. B1 to B6 touch only modules that are off for every client, or Settings pages seen only by an admin
of a marketing-enabled workspace. B7 (and the Segmentation rename in B5) change screens a live client may use.

| Batch | Contents | Rows | E / R | Owner decision needed |
|---|---|---|---|---|
| **B1 Words and text** | Printed hints to `i` on WhatsApp setup and Template Studio, Events create, New campaign subject, newsletter source card, contact cards; rename "Lead scores" to "Scored leads"; one name for the consent page; relabel `marketing_scoring` in the admin list; fix `whatsapp` vs `whatsapp_marketing` in the docs; one shared `Tour`; label-only fixes from 3b. | 12 (text), 13, 14, 18 (rename), 20 (labels), 21, 24 | S / Low | no |
| **B2 Settings > Marketing** | Consent as two tables; "Counting opens" moves out of Brand kit; tab **Limits** (journey quiet hours, days off, per-day cap, WhatsApp weekly cap) with a timezone chip; Scoring and Hand-over merged into **Leads** (rules table plus panel, lines, hand-over); menu 4 entries to 3. | 2, 3, 4, 5, 8, 22 | L / Med | Limits editable by admins (yes/no); moving opens counting |
| **B3 One send path** | Newsletter **Send...** panel; versions kept automatically; campaign row created behind it; topic and languages inherited; journey picks a newsletter by name; the "Use in a campaign" prerequisite removed. Campaign compose unchanged. | 1, 9, 11 (versions) | M-L / Med | Touches the consent gate: keep `gating.test` green and trial on a demo tenant |
| **B4 Lean studios** | Form Studio header Go live and 3 groups; Journey Setup/Rules merged; Events and ABM create reduced to the essentials; newsletter Category into topic; Signals Interests as table plus panel on kit `Tabs`. | 9, 10, 11, 14, 15, 17 | M / Low | no |
| **B5 Audience unification** | One shared audience picker (saved groups first, one-off behind More) in send panel, ABM source, event follow-up; Scoring profile rules use the shared filter component; object renamed Audience; Coverage's word changed in the Settings-wide pass. | 4 (filter), 7, 15, 16 | M-L / Med | Name of the Coverage object; parity OK for Segmentation if a live client uses it |
| **B6 Connection chip** | WhatsApp number and provider as a Connectors chip; callback address and secret in its panel; provider select removed while there is one option; demo redirect on one "where messages go" page. Aligns with `docs/design/webhooks-library.md`. | 12, 22, 23 | M / Med | Whether WhatsApp setup keeps a shortcut link under Marketing |
| **B7 Legacy composer** | Fold festival templates into Studio designs; free text behind "Plain email"; Campaigns list becomes send history. | 6, 7 (nav rename) | L / High | **Yes**: visual-parity OK for any live client using Campaigns or Segmentation (`client-familiarity`), shipped behind a platform flag (6c.7) |

### Definition of done for each batch (from 6c)
The batch's design note names what it replaced or reused, the duplicate count for the concept is zero, the option count of each
touched panel is justified (about six controls on a phone screen), `docs/design/settings-simplification.md` (the
Settings-wide list) is updated, and `docs/guides/marketing-how-to.md` is refreshed only after the owner has validated the
change (memory rule "Docs After Testing").

### Not checked, to resolve before building B2 to B7
- Which tenants have which marketing flag (database): decides whether B5's Segmentation rename and B7 are parity-gated.
- What the newsletter **Category** field drives besides the list label and the built-in design.
- Whether any tenant has hand-edited `config.marketing.journey_limits` or `config.whatsapp` values.
- The Data Workbench consent-import screen (in the consent map, not opened).
- Mobile (375 px) behaviour was taken from `ux-simplification.md`, not re-run for this audit.
