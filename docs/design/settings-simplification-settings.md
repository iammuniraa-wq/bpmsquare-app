# Settings simplification audit: everything except marketing setup

> Audit 2026-10-22, read-only, `develop`. Owner brief: the Settings tab should be as simple as the Integration
> middleware page (`settings/middleware/**`): chips for connections, one table per kind of thing, side panels,
> two-column mapping, one list with filters, almost no running text. Rules: `bpmsquarecore.md` 6b and 6c,
> `docs/design/ux-simplification.md`. Marketing setup (Scoring, Consent topics, Hand-over, Brand kit) is audited by
> someone else; those four rows are light and only flag cross-duplication.
>
> Method: `settingsMenu.ts` (42 entries, 9 groups) + every folder under `src/app/(app)/settings/` + the API routes
> they call + `src/app/(app)/administration/*` + `AdaptObjectDrawer`. Size columns are JSX-tag counts from a script
> (inputs/selects/switches, buttons, `<p>` blocks, Section/Card blocks, kit tabs); they under-count controls inside
> repeated items, so read them as a floor. "Live" = likely used by Vikas Pioneers (quotations/service CRM) or BIM
> (WFM only), inferred from the feature flag that gates the entry; per-tenant flags were **not checked** in the DB.

## 1. Summary (10 lines)

1. **42 menu entries for about 15 jobs.** Workforce alone is 8 pages for one module; Sales has 9 entries; people and access is split between Settings and Administration.
2. **Biggest duplication: people and access.** Settings > Team, Administration > Business Users and Business Roles all assign Business Roles through the same route (`/api/settings/team/{id}/roles`); the Business Roles page tells you to "assign roles in Settings > Team".
3. **Second: integration plumbing in five places.** Connectors (tiles), Integration middleware (chips), Webhooks and push (event hooks + one push URL + signing secret), the Coverage tab (a second list of "ERP endpoints"), and the Developer page (a hand-written copy of the API list). `docs/design/webhooks-library.md` already plans to merge two of these.
4. **Third: two things called "Company profile"** (workspace name in Company; letterhead name/address/GSTIN/logo in Entities & Tax), **three logos** (Entities, Brand kit, per entity) and **four colour systems** (accent, Nova accent, Spectacular mixes, Brand kit).
5. **Running text everywhere.** Only the three marketing files pass `info`/InfoTip; `SettingsField` shows the old "?" box unless the tenant is demo or has Nova (`useInfoTip()` in `SettingsField.tsx`), so Vikas and BIM never see the "i". 9 pages print the same sentence twice (page subtitle + `Section description`/`<p>`).
6. **Stale content on screen:** the Developer page lists Webhooks and `GET /api/v1/openapi.json` as "coming soon"; both exist (`settings/webhooks`, `api/v1/openapi.json`). "Pipeline & quote statuses" edits quote statuses only; deal stages (`config.opportunity_stages`) have no screen at all.
7. **Biggest offenders:** Team/Business Users, Developer, Entities & Tax, Theme & colours, Workforce (8 pages), Pipeline & quote statuses, Webhooks & push + Coverage endpoints.
8. **Four list patterns in use** (card per item, `RecordRow` inline expand, plain table, hand-built tab buttons); only the middleware family uses table + side panel. Save is in the standard header slot on most pages, but Team, Text templates, Pricing, Custom fields and the Workforce lists save per row with their own buttons.
9. **Visibility toggles live in 4 places**: Navigation visibility, Quote types, Reset layout, Appearance > Compact sidebar (plus Item types hide and Account 360 card toggles). One toggle-list pattern covers all.
10. **The 5 patterns to keep** are in section 6. Target: 38 non-marketing entries become 16.

## 2. Inventory table (sorted by priority; E = effort S/M/L, R = risk Low/Med/High)

Live column: V = Vikas likely, B = BIM likely, D = demo/Nova/prospect only, ? = not checked. Where a change touches V or B, rule 6c.7 applies (platform flag or owner parity OK).

### P1: confusing or duplicated today

| # | Screen (menu id, path) | For | Size | Pattern | Problems (6b/6c) | Duplication | Live | Lean target | E/R |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Team `team` `/settings/team` | invite members, admin/member, Business Roles | 2 Cards, invite form 4 fields, per-member MoreMenu + inline role checkboxes | card list | Invite is an inline card, not a panel; role edit inline; dead-end text "create a Business Role in Administrator first" | Administration > Business Users (create login, lock, validity, licence, **role assign**); Business Roles page; same roles route | V B | One **People** page: member table, row opens side panel (role, Business Roles, lock, validity); Invite = panel; Business Users merged in (button "From employee"); Roles = second tab | M / Med |
| 2 | Entities & Tax `entities` `/settings/entities` | letterhead, legal entities, tax | ~15 inputs plus per-entity copies, 3 big Cards, 5 `<p>`, 14 buttons, 670 lines | stacked cards, one long scroll | Company block of 12 fields + partner-logo list + certification-logo list + phone rows on one page; legacy "ISO text, fallback only" field still shown; "moved to Number ranges" and "new quotations only" notes printed | Company profile (name); Brand kit logo falls back to this logo; entity cards repeat name/address/GSTIN/phone/email of the company block; Number ranges saves via the same `/api/settings/entities` | V | Company page tabs: Profile, Entities (table + panel), Tax and currency; legacy ISO field hidden; partner/cert logos behind More | L / High (print output) |
| 3 | Company profile `company` `/settings/company` | workspace name | 1 field, 1 Section, 1 `<p>` | single card | Same sentence in the subtitle and the Section description for ONE field; second `<p>` links away to Entities | Entities > "Company profile" has its own "Company name" (`company_info.name`) separate from `tenants.name` | V B | Becomes the **Profile** tab of Company (name + logo + address + phones) | S / Low |
| 4 | API keys & developer `developer` `/settings/developer` | API key, scoped keys, endpoint docs | 1 key row, ApiKeysPanel (5 fields + 15 object checkboxes), 30 hand-typed endpoints, 5 "integrations" cards, 203 lines | one long page | Static `API_ENDPOINTS` (30 rows) is a third copy beside the `/api/v1` index and `openapi.json`; `API_COMING_SOON` lists endpoints that exist; "Available integrations" calls Webhooks coming soon; header sentence printed twice; entry is `adminOnly:false` while the key parts are admin-only | Webhooks & push; Connectors vs the integrations catalogue; legacy tenant key vs scoped keys (two key systems on one page) | V (API) | Keys table + side panel (name, scope chips, expiry); one "OpenAPI" link to `/api/v1/openapi.json`; delete the endpoint list, the coming-soon list and the catalogue; legacy key = one row marked legacy | M / Low |
| 5 | Webhooks & push `push` `/settings/push` | event webhooks + one-record push URL + signing secret | WebhooksPanel (name, URL, object checkboxes) + push Section (URL, secret), 5 buttons, 3 help blocks | 2 stacked blocks | Two jobs on one page; push is "live today on Accounts only"; explanations printed | Coverage tab "ERP endpoints" (named URLs) and its text "default endpoint (Settings > Webhooks and push)"; middleware connection; webhooks-library design | V? | Execute `docs/design/webhooks-library.md`: one Webhooks table (kind Event/Call); push URL and coverage endpoints migrate into it | L / Med (flag `webhooks_library`) |
| 6 | Coverage `coverage` `/settings/coverage` | teams, segments, coverage wiring | 3 local-state tabs, ~21 controls, 662 lines, MoreMenu rows | tabs (state, not `useUrlTab`) + lists | Tab lost on reload and not shareable; Teams tab carries lead routing (lead / round robin); "ERP endpoints" form is a second place to add push URLs | Marketing Hand-over "people who take new leads in turn"; Team; push/webhooks | D? (flag `coverage_model`) | Keep as 3 kit tabs with `useUrlTab`; remove ERP endpoints (pick from Webhooks library); lead routing stated once (see marketing audit) | M / Low |
| 7 | RFQ `rfq` `/settings/rfq` | mailbox choice, reply window, terms | 7 controls, 2 radio cards, 4 status "Check" lines | 2 sections | Mail channel re-asks "Gmail or mail server" that Connectors already holds; status lines always visible even when OK | Connectors gmail / mail_server; Email output; Email templates category "Supplier RFQs"; "Terms printed on every RFQ" vs Text templates "terms" | ? (flag `rfq`) | Keep, 6 fields max; mailbox = chip pulled from Connectors; terms = pick a Text template; status lines only when failing | S / Low |
| 8 | Email output `email-output` `/settings/email-output` | deliver to real recipients or redirect to one inbox | 1 radio pair + 1 email, 1 Section | single card | A whole menu entry for a safeguard that is forced on the demo workspace and untouched elsewhere; subtitle and paragraph duplicate | Connectors (mailbox); WFM notification text and Developer note both say "see Settings > Email output"; Administration > Outbound Emails | V B D | Remove the entry. One "Delivery" row in Connectors (platform admin / demo); WFM text points to Connectors | S / Low |
| 9 | Navigation visibility `navigation` `/settings/navigation` | hide sidebar items | one Toggle per NAV row (~40), Pager over 3 groups, 1 Section | toggle list + Pager | Pager over toggles; sub-row captions; subtitle = Section description | Reset layout; Appearance > Compact sidebar; Quote types (same hide/show idea) | V B | "Menu" tab of Appearance: one toggle list with group headers, no pager; reset as a link | S / Low |
| 10 | Reset layout `reset` `/settings/reset` | restore nav + compact sidebar | 1 button, 1 `<p>` | page for one button | An entire menu entry and page for a single action; text repeated 3 times | Navigation visibility; Appearance | V B | Remove; "Reset to default" inside Appearance > Menu | S / Low |
| 11 | Theme & colours `appearance` `/settings/appearance` | theme, accents, dashboard start, chrome toggles | up to 7 theme tiles, 3 accent systems, dashboard picker, 3 chrome toggles, compact switch; 1 Section, 461 lines | one Section | Section description repeats the subtitle; 4 explanation paragraphs; per-theme conditional blocks (Nova accent, Spectacular mixes, Layout toggles) all in one scroll | Brand kit colours; Dashboard content page; Navigation/Reset; `accent_color` vs `nova_accent_color` vs spectacular colours | V B | Tabs: Theme (tiles + the one accent that theme uses), Menu (nav toggles, compact), Dashboard (start page + content); extra colours behind More | M / Med |
| 12 | Pipeline & quote statuses `statuses` `/settings/statuses` | quote status list | one **card per status**: key, label, 12-swatch grid + picker, default radio, closed checkbox, up/down/delete; intro paragraph | card per variant | Name says Pipeline but it edits `quote_statuses` only; deal stages have no UI; raw "value (key)" exposed; warning paragraph printed | Pipeline board stages; Quote types | V | One table (dot, label, Default, Closed), row opens panel (label, colour); key auto-made and locked; chips "Quotes / Deals" so deal stages get the same table | M / Med |
| 13 | Small Scale Pricing `pricing` `/settings/pricing` + Dynamic Pricing `dynamic-pricing` (external `/pricing/setup`) | static rate card / pricing engine | 4 category Cards, add form 5 fields, per-item edit; engine has its own workcenter | card per category | Two "Pricing" entries in one group with different meanings; card per category | Dynamic Pricing; Estimate templates > Rates; product price | V | One **Pricing** entry: one table, category as filter chip, panel to add/edit; Dynamic Pricing appears only when flagged, as a banner link | M / Med |
| 14 | Custom fields `custom-fields` `/settings/custom-fields` | add fields to any object | ~14 hand-built object buttons, add form ~8 fields, drag-reorder list, 453 lines | list + inline form | Object picker is hand-built buttons; inline add form; no overrides/rules here | **AdaptObjectDrawer** (10 form/list files) also creates custom fields (same route) and is the only home for field overrides and rules | V | Table of fields, object as chips, panel to add/edit; Adapt becomes a link to this page with the object preselected, or the reverse (pick one) | L / High (client knows Adapt) |
| 15 | Attendance rules `wf-attendance` `/settings/workforce/attendance` | timezone, hours counting, week off, Saturdays | WorkforceConfigClient page=attendance: 3 SettingsSections, all `defaultOpen`; ~12 controls; 28 help props in the file | stacked sections | `defaultOpen` on every section defeats the collapse design; 8 pages for one module | Shifts (week off and Saturday rule are shift concerns) | B | One **Workforce** entry, kit tabs: Rules, Shifts, Places, Leave, Alerts (+ Billing when projects on) | L / Med (BIM live) |
| 16 | Punching & verification `wf-verification` | punch types, selfie/face, geofence | 2 sections, ~15 controls | stacked sections | same | Kiosks (face punching); Sites (geofence radius) | B | Tab Rules; geofence stays with Places | in #15 |
| 17 | Reminders & notifications `wf-reminders` | phone reminders, emails | 2 sections, ~14 controls | stacked sections | text refers to "Settings > Email output" | Email output | B | Tab Alerts | in #15 |
| 18 | Employment & billing `wf-employment` | employment types, project billing | 1-2 sections; billing only with `wfm_projects` + invoices | stacked sections | billing is a finance topic on a workforce page | Invoices module | B | Tab Billing (conditional) | in #15 |
| 19 | Text templates `text-templates` `/settings/templates` | saved snippets for quotes | 4 category Cards each with a description line, add form 3 fields, MoreMenu | card per category | Card per category; 4 category descriptions always printed | Email templates, Estimate templates, newsletter templates (all "templates"); RFQ terms | V | Part of **Quotation templates** table with filter chips (Line item, Notes, Terms, Scope, Email); panel to edit | M / Med |
| 20 | Email templates `email-templates` `/settings/email-templates` | subject+body per document | hand-built pill tabs (4 categories, one marked "not live yet"), placeholder legend, RecordList + inline editor | tab buttons + RecordRow | A category shown that does nothing; placeholder legend always visible | Text templates; Email output; Administration > Outbound Emails | V | Same table as #19 (category Email: Quote / Invoice / RFQ); hide non-live categories; legend behind "i" | M / Low |
| 21 | Deleted records `deletion-log` `/settings/deletion-log` | log of deletions | table, 5 filter buttons, clear action, 217 lines | table | An audit log inside Settings; Change history already records deletes (`action: "delete"`) | Administration > Change history | V | Remove from Settings; Change history gets a "Deleted" filter and keeps the clear action | M / Med |

### P2: inconsistent layout or option count

| # | Screen | For | Size | Pattern | Problems | Duplication | Live | Lean target | E/R |
|---|---|---|---|---|---|---|---|---|---|
| 22 | Number ranges `number-ranges` | quote ID format + fixed ranges list | 4 controls, 2 cards, 1 table, 2 `<p>` | 2 cards | Saves through `/api/settings/entities`; token help always printed; table lists ranges nobody can change | Entities (old home) | V | Tab "Numbering" of Company; tokens behind "i"; read-only ranges collapsed | S / Low |
| 23 | Currency `currency` | workspace currency | 1 select, `<p>` + subtitle repeat | single card | A whole entry for one dropdown; same sentence twice; shows an admin notice although the entry is adminOnly | Entities > Tax | V | Field in Company > Tax and currency | S / Low |
| 24 | Quote types `quote-types` | show/hide offer types | ~6 toggles, 1 Section | toggle list | Subtitle = Section description; "Coming soon" types listed | Navigation visibility (same pattern) | V | Tab in **Quotations** using the shared toggle list | S / Low |
| 25 | Product categories `product-categories` (+ `/settings/sales` redirect) | category tree | tree editor, CODE field per row, 3 controls | tree | CODE exposed to every user; legacy "sales" route name | Item types | ? (flag `products`/`quotations`) | **Products** entry, tabs Categories + Item types; CODE behind More | S / Low |
| 26 | Item types `item-types` | kinds of products | RecordRow list + inline form (name, description, 3 flags) | RecordRow | Flags and Hide/Rename in a MoreMenu | Product categories | ? (flag `products`) | Tab of Products, table + panel | S / Low |
| 27 | Asset print fields `asset-print-fields` | which equipment fields print | ~19 hard-coded checkboxes (motor nameplate) + custom fields, intro `<p>` | long checkbox list | One print option on its own page in a one-entry group ("Service"); 19 motor-specific labels for every tenant | Entities (print branding); Custom fields | V | Tab "Print" in Quotations next to letterhead; nameplate group behind More | S / Low |
| 28 | Shifts `wf-shifts` | working hours | RecordList + inline form, 6 controls | RecordRow | content fine, separate page | week off and Saturday rule (Attendance) | B | Tab Shifts, with week off and Saturday rule moved in; table + panel | in #15 |
| 29 | Sites `wf-sites` | punch locations, supervisors | RecordList + inline form, 378 lines, 4 help blocks | RecordRow | Largest list client; help blocks printed | Kiosks | B | Tab Places (Sites and Kiosks as two chips) | in #15 |
| 30 | Leave types `wf-leave-types` | types and quotas | RecordList + inline form, 6 controls; tooltips by `title=` | RecordRow | Hand-made `title` tooltips instead of InfoTip | Attendance (carry forward) | B | Tab Leave; InfoTip | in #15 |
| 31 | Kiosks `wf-kiosks` | register face tablets | RecordList, 2 controls | RecordRow | Own entry for one short list | Punching & verification | B | Chip in Places | in #15 |
| 32 | Dashboard content `dashboard` | news + tips blocks | 2 toggles + topics input, hint under each | single card | Entry for 3 controls; `<p>` repeats subtitle; hint under each toggle | Appearance > Dashboard start page | V D | Tab Dashboard in Appearance | S / Low |
| 33 | Account 360 `account-360` | drawer cards, external sources | 11 built-in rows (toggle + up/down), source cards (~8 fields each), 297 lines | list + card per source | Card per source; description line on every built-in | Coverage, Marketing, ABM cards | D (Nova flag) | Table of cards (toggle + drag), sources as a second table with side panel (auth value stays write-only) | M / Low |
| 34 | Connectors `connectors` | Slack, Calendar, Gmail, Mail server, Dynamics 365 | tile grid with expanding tiles, 1-4 controls per tile | tiles | Expanding tiles differ from the middleware chip pattern; menu text says "Slack today, more on the way" (5 exist); Dynamics tile hops to middleware | Integration middleware chips; RFQ mailbox; Email output; Developer integrations list | V? | Keep as the one place for credentials (chip with Test / Edit / Disconnect); ERP-type connectors link to middleware; absorb the Delivery row | M / Low |
| 35 | Dynamics 365 sub-page `/settings/connectors/dynamics365` | legacy D365 connect | 16 controls, 305 lines | form | Redirects to middleware when `integration_middleware` is on; old UI otherwise | Integration middleware | D | Delete once the flag is on for every D365 tenant | S / Low |
| 36 | Settings landing `/settings` | right pane on desktop | one Card per group, 1 `<p>` | cards | A third rendering of the menu (left nav, search, landing grid) | the menu itself | all | Right pane = search box + recently used | S / Low |

### P3: polish, keep as is

| # | Screen | For | Size | Pattern | Problems | Duplication | Live | Lean target | E/R |
|---|---|---|---|---|---|---|---|---|---|
| 37 | Integration middleware `middleware` | the reference | chips + 5 kit tabs (`useUrlTab`), tips in `tips.ts` | reference | none against 6b/6c | absorbs the D365 sub-page | D | Keep. Add Webhooks as a tab only if the library ships | n/a |
| 38 | Estimate templates `estimate-templates` + `[id]` | inputs, rates, rules for estimates | list + editor with 5 kit tabs (Details, Inputs, Rates, Rules, Check) | list + tabbed editor | Closest to target already; 5 help props in Rules, 4 in Details | Products price, Pricing | D (flag `estimator`) | Keep; move help to InfoTip | S / Low |
| 39 | Business roles `business-roles` (external `/administration/business-roles`) | named roles | own client | separate area | Listed in Settings but lives in Administration; its text points back to Team | Team, Business Users | V B | Second tab of People; keep route | in #1 |
| 40 | Scoring `marketing-scoring` | lead score rubric | 3 kit tabs, 12 controls, 8 InfoTips | tabs | marketing auditor | Hand-over, Consent | D | per marketing audit | - |
| 41 | Consent topics `marketing-consent` | topics, regions | 3 Sections, InfoTips | sections | marketing auditor | Contact consent card | D | per marketing audit | - |
| 42 | Hand-over `marketing-handover` | lead pickup, rota, overdue | 4 Sections all `defaultOpen`, 7 help props | sections | marketing auditor; rota duplicates Coverage team round-robin | Coverage > Teams | D | per marketing audit | - |
| 43 | Brand kit `brand-kit` | newsletter logo, colours, fonts, footer | 4 Sections, 9 controls, 8 always-printed `<p>` hints | sections | marketing auditor; printed hints (6b) | Entities logo + address; Appearance accent | D | per marketing audit; logo/colours default from Company, only overrides here | - |

### Related surfaces outside the Settings folder (same jobs, other homes)

| # | Surface | Duplicates | Lean target |
|---|---|---|---|
| 44 | Administration > Business Users (`/administration/business-users`) | Team (invite, role) | merged into People (#1) |
| 45 | Administration > Change history, Outbound Emails | Deleted records (#21); Email output | stay as audit tools; Change history gains "Deleted" filter |
| 46 | `AdaptObjectDrawer` on account/contact/inventory/invoice/PO/quote forms (10 files) | Custom fields (#14) | one home for field definitions (see #14) |
| 47 | Pricing workcenter `/pricing/setup`, `/pricing/advanced` | Small Scale Pricing (#13) | reached from the Pricing entry only |
| 48 | Redirect-only pages `general`, `sales`, `pricing-engine`, `workforce` | none | keep as redirects, targets updated |

## 3. Settings that exist in more than one place

| Setting or concept | Locations (verified in code) | One home to recommend |
|---|---|---|
| Company name | Company profile (`tenants.name`); Entities > Company profile (`company_info.name`); each legal entity card | Company > Profile (one name; entities override only when set) |
| Logo | Entities company logo (`tenants.logo_url`); Brand kit logo (falls back to it); legal entity logos; partner and certification logo lists | Company > Profile; Brand kit holds an override only |
| Colours | Appearance accent (`accent_color`); Nova accent; Spectacular mixes + accent; Brand kit primary/secondary/text | Appearance > Theme for the app; Brand kit for emails only, defaulting from it |
| Hide/show menu | Navigation visibility; Reset layout; Appearance > Compact sidebar; Quote types (offer types) | Appearance > Menu (nav), Quotations > Offer types, one toggle-list component |
| Custom field definitions | Settings > Custom fields; Adapt drawer on 10 screens (also holds overrides and rules, which have no Settings page) | Settings > Custom fields (Adapt links to it) |
| Who can do what | Team (admin/member + Business Roles); Business Users (same roles route); Business Roles page | People page: Members + Roles tabs |
| Where an ERP record is pushed | Webhooks and push URL + secret; Coverage "ERP endpoints"; middleware connection; D365 tile | Webhooks library (Call kind); connection stays in middleware |
| API access | Legacy tenant key + scoped keys on the Developer page; endpoint list in the page, in the `/api/v1` index and in `openapi.json`; integrations catalogue vs Connectors | Developer: keys table + OpenAPI link only |
| Mailbox / outbound mail | Connectors gmail + mail_server; RFQ mail channel; Email output; Email templates categories | Connectors (credentials); RFQ and Email templates only pick |
| Lead routing | Coverage > Teams (lead or round robin); Marketing Hand-over rota and overdue; Team | decide once (marketing audit), state in one tab |
| "Templates" | Text templates; Email templates; Estimate templates; newsletter templates | Quotations > Templates (text + email); estimate and newsletter keep their own editors, same word only for the same thing |
| Pricing | Small Scale Pricing; Dynamic Pricing workcenter; Estimate rates; product price | One Pricing entry with a clear mode |
| Quote ID format | Number ranges (saves via `/api/settings/entities`); note and link left on Entities | Company > Numbering |
| Dashboard | Appearance "Dashboard" (which one opens); Dashboard content page | Appearance > Dashboard tab |
| Deleted records | Settings > Deleted records; Change history `delete` rows | Change history |
| Explanation text | page subtitle + `Section description` or `<p>` repeated on 9 pages (company, currency, navigation, quote-types, appearance, reset, developer, email-output, dashboard) | one InfoTip in the header |

## 4. Proposed final menu (42 entries to 16 plus marketing)

| Group | Entry (tabs) | Absorbs (old route becomes a redirect) |
|---|---|---|
| Company | **Company** (Profile, Entities, Tax and currency, Numbering) | Company profile, Entities & Tax, Currency, Number ranges |
| People | **People** (Members, Roles) | Team, Business users (Administration), Business roles link |
| Sales | **Quotations** (Statuses, Offer types, Templates, Print) | Pipeline & quote statuses, Quote types, Text templates, Email templates, Asset print fields |
| Sales | **Pricing** (one table; Dynamic Pricing banner when flagged) | Small Scale Pricing, Dynamic Pricing entry |
| Sales | **RFQ** | unchanged, trimmed |
| Sales | **Estimate templates** | unchanged |
| Sales | **Coverage** (Teams, Segments, Coverage; kit tabs) | ERP endpoints removed |
| Sales | **Account 360** (flagged) | unchanged |
| Marketing | per marketing audit (today 4 entries) | - |
| Workforce | **Workforce** (Rules, Shifts, Places, Leave, Alerts, Billing when on) | the 8 `wf-*` entries |
| Data | **Custom fields** | Adapt drawer links here |
| Data | **Products** (Categories, Item types) | Product categories, Item types |
| Integrations | **Integration middleware** (reference) | D365 sub-page |
| Integrations | **Connectors** (chips; Delivery row for platform admin) | Email output |
| Integrations | **Webhooks** (library when flagged; today Webhooks & push) | push URL, Coverage endpoints |
| Integrations | **API keys** (keys table + OpenAPI link) | endpoint list, integrations catalogue |
| Appearance | **Appearance** (Theme, Menu, Dashboard) | Theme & colours, Navigation visibility, Reset layout, Dashboard content |
| removed | Deleted records | Administration > Change history, "Deleted" filter |

Count: 16 non-marketing entries against 38 today. The 9 groups become 8 (Company, People, Sales, Marketing, Workforce, Data, Integrations, Appearance); "Service" disappears because Asset print fields moves into Quotations.

## 5. Recommended order of work (each batch ships alone)

Gate rule for every batch: anything V or B touches ships behind a platform flag `settings_lean` (default off, on for the demo workspace first), per 6c.7; old URLs stay as redirects so no link or Drive guide breaks.

| Batch | Content | Size | Risk | Why here |
|---|---|---|---|---|
| 1. Quiet text (no layout change) | Drop the repeated sentence on the 9 pages; show InfoTip to everyone (retire `LegacyHelpDot`; needs owner OK for Vikas and BIM); delete the stale Developer lists (endpoints, coming-soon, integrations catalogue); fix labels ("Pipeline & quote statuses" to "Quote statuses"; Connectors menu text) | S | Low | Pure subtraction; removes wrong statements on screen |
| 2. Folded pages | Appearance tabs (absorbs Navigation, Reset, Dashboard content); Products tabs; Company tabs (Profile, Tax and currency, Numbering) | M | Low | Reuses existing components; routes redirect |
| 3. Quotations | Quotations tabs (Statuses, Offer types, Templates, Print), templates as one table; Pricing as one table | M | Med | Vikas uses these; needs parity sign-off before flag-on |
| 4. People | Team + Business Users + Roles into People | M | Med | Removes the largest duplicate |
| 5. Workforce | 8 pages into 1 with tabs; drop `defaultOpen` on every section | L | Med | BIM live; check 375 px first |
| 6. Table + panel conversions | Statuses (and deal stages), Entities, Custom fields, Account 360 sources, Keys | L | Med | One pattern; after batches 2-4 so the tabs exist |
| 7. Integrations | Webhooks library (already designed), Coverage endpoints out, Email output into Connectors, Developer keys table | L | Med | Needs `webhooks_library` flag and the SQL run by hand |
| 8. Custom fields and Adapt | Decide the one home, link the other | M | High | Client knows Adapt; last |

Definition of done per batch (6c): duplicate count zero, panels at or under about six controls, PC and 375 px checked, `docs/design/ux-simplification.md` and this file updated; Drive guides refreshed only after the owner confirms.

## 6. The 5 patterns that should become the only patterns

1. **Page shell:** title + one InfoTip, no subtitle, no hint lines; more than about five option groups means 3-5 `useUrlTab` tabs (middleware, Estimate templates, Scoring already do this).
2. **Chips choose the target:** a connector, an object, a category or a kind is a chip row above one table (middleware `ConnectorSwitcher`), never hand-built button strips (Custom fields, Email templates, Deleted records) or one card per variant (Statuses, Pricing, Text templates, Account 360 sources).
3. **One table per kind of thing:** row opens a side panel (bottom sheet on phones), actions in the row "..." menu, "+ New" top right. Retire the `RecordRow` inline-expand lists and per-item cards.
4. **One toggle list for visibility** (menu items, offer types, Account 360 cards, hidden item types): name, "i", switch, drag handle; no pager.
5. **One field kit:** `SettingsField`/`SettingsRow` + InfoTip for every workspace, Save in the header slot (`SettingsSave`), defaults decide the rest, rare options behind one "More", choice-with-target as a two-column mapping.

Not checked: tenant feature flags in the live DB, usage per settings page, mobile rendering of each page, the marketing screens in depth.
