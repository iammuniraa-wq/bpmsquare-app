# Settings simplification: the one list (owner decision 2026-10-22)

Owner: "The Integration middleware is simple now. I need the same level of simplicity in the whole Settings
tab: keep it simple, don't complicate, don't duplicate, keep it lean. In marketing I see a lot of confusion."
Rule of record: `bpmsquarecore.md` section 6c. Reference screen: Integration middleware.
Details, tables and screen-by-screen targets: `settings-simplification-settings.md` (48 rows) and
`settings-simplification-marketing.md` (25 rows). This file is the single ordered list; update it when a batch ships.

## Headline findings
- Settings: 38 non-marketing menu entries become 16 (Company, People, Quotations, Pricing, RFQ, Estimate templates,
  Coverage, Account 360, Workforce, Custom fields, Products, Integration middleware, Connectors, Webhooks, API keys,
  Appearance). Old routes stay as redirects.
- Biggest duplicates: Team vs Business Users vs Business Roles (one route, three screens); integration plumbing in
  five places; two Company profile screens, three logos, four colour systems; Workforce is 8 pages for one module.
- Marketing: consent is set in nine places; one newsletter takes 3 screens and 7 steps; two email builders; one
  audience engine under five names; journey limits and WhatsApp caps have no screen.
- Five patterns become the only patterns (page shell, chips choose the target, one table per kind with a side panel,
  one toggle list, one field kit): see section 6 of the settings audit.

## Owner decisions that override the audits
- **Live clients are not an exception** (2026-10-22). The audits say "ship behind `settings_lean` / needs parity OK"
  for Vikas, BIM, Campaigns and Segmentation: that gate is dropped. Keep every capability reachable, keep old URLs
  as redirects, name changed live-client screens in the commit.
- Docs: Drive guides are refreshed only after the owner validates (unchanged rule).

## The one ordered list (waves ship alone; S = settings batch, M = marketing batch)
| Wave | Items | Size | Notes |
|---|---|---|---|
| 1. Quiet text (no layout change) | **S1** drop repeated sentences, InfoTip for everyone, delete stale Developer lists, fix labels; **M1** hints to "i", rename Lead scores, one name for the consent page, one shared Tour | S | Pure subtraction, tonight |
| 2. Folded pages | **S2** Appearance tabs, Products tabs, Company tabs; **M2** Settings > Marketing: consent as two tables, Limits tab, Scoring + Hand-over merged into Leads, menu 4 to 3 | M-L | |
| 3. Biggest duplicates | **S4** People (Team + Business Users + Roles); **S3** Quotations tabs + Pricing as one table; **M3** one send path (newsletter Send panel, journeys pick a newsletter by name) | M-L | M3 touches the consent gate: keep `gating.test` green |
| 4. Studios and audiences | **S5** Workforce 8 pages into 1; **M4** lean studios (Form, Journey, Events, ABM, Signals); **M5** one audience picker, object renamed Audience | L | Check 375 px for Workforce |
| 5. Integrations | **S6** table + panel conversions (statuses and deal stages, entities, custom fields, Account 360 sources, keys); **S7** Webhooks library lands, Coverage endpoints out, Email output into Connectors, Developer keys table; **M6** WhatsApp as a connector chip | L | Webhooks library SQL run by hand (0202) |
| 6. Last | **S8** Custom fields vs Adapt: one home; **M7** fold the legacy campaign composer into Studio designs, Campaigns becomes send history | M-L | Highest change; after the owner has seen waves 1-5 |

## Per batch: definition of done (6c)
Design note names what it replaced or reused; duplicate count for the concept is zero; each touched panel at or
under about six controls; PC and 375 px checked; this file and `ux-simplification.md` updated; `tsc`, `vitest`,
`next build` clean; Drive guides after the owner validates.

## Status
| Item | State |
|---|---|
| Audits (settings, marketing) | done 2026-10-22 |
| Rule 6c | in `bpmsquarecore.md` |
| Wave 1, S1 Quiet text (settings) | done 2026-10-22 |
| Wave 2, S2 Folded pages (settings) | done 2026-10-22. Menu entries 10 to 3: **Company** (Profile, Entities, Tax and currency, Numbering) replaces Company profile, Entities & Tax, Currency, Number ranges; **Appearance** (Theme, Menu, Dashboard) replaces Theme & colours, Navigation visibility, Reset layout, Dashboard content; **Products** (Categories, Item types) replaces Product categories and Item types. Old addresses redirect to the tab (`src/lib/settingsFolded.ts`). Each screen is one draft with one Save. Duplicates gone: two company names to one (the workspace name; a differing letterhead name shows only in More), partner/accreditation/logo-URL variants of the logo into one logo plus More, four colour systems into one "Colour" row that follows the chosen theme (Nova hue, Spectacular mix or the accent), the nav pager and the separate Reset page into one list with "Reset to defaults", two Saves per page into one. Lists are the shared table + side panel (`components/settings/SettingsList.tsx`). Before to after: menu entries 10 to 3; screens 10 to 3 (9 tabs, old routes are one-line redirects); Saves per screen 2-3 to 1; controls on the first view: Company 12 letterhead fields + logo, phone, accreditation and partner lists + entity cards + tax (30 and more) to 7 (name, logo, address, email, website, tax ID, tagline) with the rest behind one More; Tax and currency 4; Numbering 4 plus a collapsed system-ID list; Theme page (up to 7 tiles with descriptions, 3 colour systems, dashboard choice, 3 layout switches, compact) to tiles, one Colour row and one switch; Menu list 3 pages with a pager to one page; Dashboard 3 to 4 controls on their own tab; Products: card per category and per item type to two tables with a panel. Fixed on the way: the old Number ranges Save POSTed to a route with no POST handler. Brand kit colours stay an email-only override (marketing batch to default them from the accent). Left: the sidebar logo (`tenants.logo_url`, set by the platform admin) is still separate from the Company logo (`company_info.logo_url`). |
| Wave 1, M1 Words and text | done 2026-10-22: WhatsApp setup, Template Studio, Events create, New campaign and newsletter card hints behind "i"; Scored leads, Consent, Revenue by source names; one shared Tour; Buying stage and Lead stage labels |
| Wave 2, M2 Settings > Marketing | done 2026-10-22, by removal, not by hiding. Menu entries 4 to 3 (Consent, Leads, Brand kit). Pages 4 to 3: Scoring and Hand-over are tabs of Leads, old addresses redirect. Consent: 18 inputs to 2 plus two tables (a row per country rule and per topic, a row opens a side panel, other countries behind "Show other countries"). Scoring: about 90 inputs to 3 plus one rules table (6 rows, then "Show all"). Hand-over: 4 sections to one short form; fixed "Nova inbox" row dropped; Coverage keeps the per-team choice and Hand-over shows its result with a link. New Limits tab (quiet hours, days off, emails a day, WhatsApp a week, timezone chip): had no screen. Counting opens moved from Brand kit to Consent, so consent settings are asked in 1 place, not 2. Live-client screens changed (admin only): Consent topics, Scoring, Hand-over, Brand kit |
| Wave 3, S4 People | done 2026-10-22: Settings > People (tabs People, Roles) replaces Settings > Team, Administration > Business users and Business roles. Screens 3 to 1 (old addresses redirect); settings menu entries 2 to 1, Administration tiles 2 to 1; main view from 1 button plus 2 to 3 buttons per row on every row, to a search and one Invite / New role button with no per-row buttons; person panel 6 visible controls (login details behind More); `+ New Employee` removed (Employees creates employees); `/api/*` routes and guards unchanged |
| Wave 3, M3 One send path | done 2026-10-22, by removal. **First newsletter: 3 screens and 7 steps to 1 screen and 3 steps** (New and pick a design, Edit, **Send...**); mandatory decisions 9 to 2 (design, audience); values entered twice 3 to 0 (name, topic and languages are the newsletter's own). The Send panel is one audience choice (saved audience first, one-off account types and typed addresses behind More), a live "N will receive, M left out and why", and Send. Gone: the "Use in a campaign" step and the version step (a version is kept automatically, and again only if the newsletter changed), the compose page for newsletters (campaign name, Languages to send, fallback, Topic, the third audience block, "Check the audience", "See it as this person" cards). The campaign row is created behind the panel (named newsletter + day) and is the send history; a refused send leaves no row. **First journey step: 6 steps over 2 modules with a hidden prerequisite to 4 steps in 1 module** (New, pick a newsletter by name, Try it, Go live); a workspace with one newsletter has it preselected; the step's consent-topic select is gone (inherited); the step follows its newsletter on Save. Consent gate, suppression, language rule, demo redirect and who may send unchanged (`sendNewsletterBranch` / `send.ts` untouched; `gating.test` green; regression tests in `quickSend.test.ts`). **Not done: scheduling** (no campaign has a send time today; it needs a column, a status and a cron, which is a new capability, not a simplification). Legacy composer and draft campaigns unchanged (M7). Live-client screens changed: none known (the audit lists Newsletter Studio and Journeys as live for no client; tenant flags not re-checked). No SQL |
