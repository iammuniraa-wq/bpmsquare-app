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
| Wave 1, M1 Words and text | done 2026-10-22: WhatsApp setup, Template Studio, Events create, New campaign and newsletter card hints behind "i"; Scored leads, Consent, Revenue by source names; one shared Tour; Buying stage and Lead stage labels |
| Wave 3, S4 People | done 2026-10-22: Settings > People (tabs People, Roles) replaces Settings > Team, Administration > Business users and Business roles. Screens 3 to 1 (old addresses redirect); settings menu entries 2 to 1, Administration tiles 2 to 1; main view from 1 button plus 2 to 3 buttons per row on every row, to a search and one Invite / New role button with no per-row buttons; person panel 6 visible controls (login details behind More); `+ New Employee` removed (Employees creates employees); `/api/*` routes and guards unchanged |
