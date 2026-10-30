# Website screenshot gaps, 2026-10-29

Written while updating the public site (bpmsquare-site, main) and the two downloadable guides. Nothing here has been captured: the UI is being redesigned and the new screens are not deployed. Capture everything in one pass after deployment.

## Totals

| Where | Stale (replace) | Missing (new) | Total |
|---|---|---|---|
| Website pages (main branch) | 30 | 23 | 53 |
| Solution Guide PDF (6 chapters) | 59 placeholders have an image from the old UI | 162 | 221 placeholders |
| Integration Guide PDF (7 chapters) | 0 | 19 | 19 |
| **Capture list** (everything below) | | | **293** |

The site-page count is the one that matters first; the guide counts are the Screenshot: placeholder lines in docs/guides/solution and docs/guides/integration. Many guide placeholders repeat a screen the site pages need (dashboard, quotations, tender overview), so one capture serves several places.

## Capture rules

- Light theme, desktop 1568 px wide (the existing images are 1568 x 520 to 675), JPEG for site pages, PNG for the guides.
- Demo workspace only (is_demo tenant). Fictional names only. No KAMCO, BIM or Vikas data on any public image.
- The demo workspace has **no tender deals** and probably no contract project with buy-out. Seed them before the pass, or the tender rows below cannot be captured.
- Webhooks list and Inbox need the platform-admin flags (Webhooks library, Shared Inbox, GCC tender, Contract projects, Integration middleware) on the capture workspace.
- Hide or mask: API key values, signing secrets, email addresses of real people.
- Put site images in bpmsquare-site/assets/screens/ with the suggested name, then point the page at them. Existing L01..L24 files can be deleted once replaced (L03_new_project.jpg, L04_subproject.jpg and L13_email_output.jpg are already unused).
- Mobile (375 px) variants are not used on the site today; add one only where a page would benefit.

## 1. Website pages

"Stale" means an image exists but shows the pre-redesign UI (all L-files date from 2026-09-05; the two tenders screens are from 2026-10-29). "Missing" means the page has no image where one would help.

### index.html

| Location | Current | State | What it should show | Suggested file |
|---|---|---|---|---|
| Hero, right side | L20_dashboard.jpg | Stale | The Dashboard with the tile layout a new workspace sees (Control room or Bold). | assets/screens/home-dashboard.jpg |
| Real screens, card 1 | L23_quotations.jpg | Stale | Quotations list: ref, customer, status, total, PDF. | assets/screens/home-quotations.jpg |
| Real screens, card 2 | L01_insights.jpg | Stale | Hours this month by project (Workforce projects insights). | assets/screens/home-hours-by-project.jpg |
| Real screens, card 3 | L17_talk.jpg | Stale | Talk to data: a question in English, the chart and rows beneath. | assets/screens/home-talk-to-data.jpg |
| Third door card (Tenders and contract projects) | none | Missing | The door has no picture. One tender screen (bill of quantities with costing counts) beside the other two doors' art. Needs tender data in the demo workspace first (it has none). | assets/screens/home-tender-door.jpg |

### service-operations.html

| Location | Current | State | What it should show | Suggested file |
|---|---|---|---|---|
| Hero (browser bar app.bpmsquare.com/cases) | L24_cases.jpg | Stale | Cases list with status chips. | assets/screens/service-cases-list.jpg |
| Quotations block | L23_quotations.jpg | Stale | Quotations list. | assets/screens/service-quotations.jpg |
| Account block | L15_account.jpg | Stale | An account page with its contacts, assets, cases and invoices (Account 360 drawer open is a good variant). | assets/screens/service-account.jpg |
| Dashboard block | L20_dashboard.jpg | Stale | Dashboard for a service workspace. | assets/screens/service-dashboard.jpg |
| Invoice block | L11_invoice.jpg | Stale | An invoice page with lines and payment position. | assets/screens/service-invoice.jpg |

### workforce.html

| Location | Current | State | What it should show | Suggested file |
|---|---|---|---|---|
| Hero (browser bar /wfm/projects) | L01_insights.jpg | Stale | Hours this month by project. | assets/screens/wfm-hours-by-project.jpg |
| Live board | L21_live_board.jpg | Stale | Live board: who is in, where. | assets/screens/wfm-live-board.jpg |
| Time summary | L22_summary.jpg | Stale | Monthly summary with overtime and the Excel export button. | assets/screens/wfm-monthly-summary.jpg |
| Billing settings | L14_settings_billing.jpg | Stale | Workforce billing settings (rates, VAT, invoice period). | assets/screens/wfm-settings-billing.jpg |
| Project tree | L02_tree.jpg | Stale | Projects with sub-projects, three levels. | assets/screens/wfm-project-tree.jpg |
| Where hours come from | L05_sources.jpg | Stale | The sources panel of a project (878 x 322 crop). | assets/screens/wfm-project-sources.jpg |
| Roster | L09_roster.jpg | Stale | Roster with project assignments. | assets/screens/wfm-roster-projects.jpg |
| Punch | L10_punch.jpg | Stale | Punch screen with the project shown. | assets/screens/wfm-punch-project.jpg |
| Project page | L06_project.jpg | Stale | A single project page. | assets/screens/wfm-project-page.jpg |
| Billing preview | L07_preview.jpg | Stale | Invoice-from-hours preview: hours, rate, VAT. | assets/screens/wfm-billing-preview.jpg |
| Invoice from hours | L11_invoice.jpg | Stale | The invoice raised from hours. | assets/screens/wfm-invoice-from-hours.jpg |
| Email invoice | L12_email.jpg | Stale | The invoice email (675 x 606 crop). | assets/screens/wfm-invoice-email.jpg |
| Account projects tab | L15_account.jpg | Stale | An account with its Projects tab open. | assets/screens/wfm-account-projects.jpg |
| Project costing analytics | L16_analytics.jpg | Stale | Analytics tiles for project costing. | assets/screens/wfm-analytics-tiles.jpg |

### platform.html

| Location | Current | State | What it should show | Suggested file |
|---|---|---|---|---|
| Talk to data | L17_talk.jpg | Stale | Talk to data. | assets/screens/platform-talk-to-data.jpg |
| Dashboard per person | L16_analytics.jpg | Stale | Analytics / dashboard tiles arranged by one user. | assets/screens/platform-dashboard-tiles.jpg |
| API and integrations table | none | Missing | Settings, Integrations, API keys and developer: the API key row (value hidden) and the scoped key list with one key. | assets/screens/platform-api-keys.jpg |
| API and integrations table | none | Missing | Settings, Integrations, Connectors: the tile grid with Gmail connected and Dynamics 365, SAP, ePROMIS not connected. | assets/screens/platform-connectors.jpg |
| API and integrations table | none | Missing | Integration middleware page (Links tab) for a demo ERP. | assets/screens/platform-middleware-links.jpg |
| Modules or Your data | none | Missing | Settings, People: the people list with one person's panel open (role, validity, lock/reset). | assets/screens/platform-people.jpg |
| Modules (Master data / Analytics and admin) | none | Missing | Data Workbench, Import tab: object list, template download, upload box. | assets/screens/platform-data-workbench.jpg |

### gcc.html

| Location | Current | State | What it should show | Suggested file |
|---|---|---|---|---|
| Chain step 1 | L10_punch.jpg | Stale | Punch with the project picked. | assets/screens/gcc-punch-project.jpg |
| Chain step 2 | L07_preview.jpg | Stale | Billing preview with rate and VAT. | assets/screens/gcc-billing-preview.jpg |
| Chain step 3 | L17_talk.jpg | Stale | Talk to data answering a billing question. | assets/screens/gcc-talk-to-data.jpg |

### tenders.html

| Location | Current | State | What it should show | Suggested file |
|---|---|---|---|---|
| Costing section | screens/rfq-compare.jpg (1400 x 455) | Stale | Compare and award: supplier replies side by side, lowest valid price marked. | assets/screens/tenders-rfq-compare.jpg |
| After the award section | screens/contract-project-overview.jpg (1400 x 455) | Stale | Contract project overview: contract value, budget, planned margin, buy-out progress. | assets/screens/tenders-contract-project-overview.jpg |
| Bid decision and BOQ section (right column is text cards) | none | Missing | Tender overview: stage, bid decision with approver, bid end date countdown, bid guarantee, open work. | assets/screens/tenders-overview.jpg |
| Bid decision and BOQ section | none | Missing | Bill of quantities table in the client's row order with product-match suggestions on one row. | assets/screens/tenders-boq-table.jpg |
| Costing section (second picture) | none | Missing | Costing tab counts: Rows priced, Still need a cost, RFQs out, Replies in, with the Estimates and RFQs list. | assets/screens/tenders-costing-tab.jpg |
| Costing section | none | Missing | An estimate from a template: inputs on the left, price panel and the estimator visual on the right. | assets/screens/tenders-estimate-detail.jpg |
| The bid (text cards) | none | Missing | Bid tab: submitted versions, the warnings list (unpriced lines, old prices, no approval) and the compare-two-versions view. | assets/screens/tenders-bid-versions.jpg |
| Start from an email (new line in Decide section) | none | Missing | Inbox with an email open and the Create from this email menu showing Deal. | assets/screens/tenders-inbox-create-deal.jpg |
| The team section (text cards) | none | Missing | Team room thread on a tender plus the competitors list. | assets/screens/tenders-room-competitors.jpg |
| The team section | none | Missing | Dashboard tender blocks: closing soon and needs your action. | assets/screens/tenders-dashboard-blocks.jpg |
| After the award section | none | Missing | Buy-out tab: packages table with budget, best quote, committed, position, ePROMIS state. | assets/screens/tenders-buyout-tab.jpg |
| After the award section | none | Missing | Contract project Budget grid with revisions and the approved baseline. | assets/screens/tenders-cp-budget.jpg |

### api.html

| Location | Current | State | What it should show | Suggested file |
|---|---|---|---|---|
| Quick start, step 1 | none | Missing | Settings, Integrations, API keys and developer with the New key form open: name, Read/Write, object checkboxes, expiry. Token value must not be real. | assets/screens/api-new-scoped-key.jpg |
| Authentication | none | Missing | The same screen with the key list (prefix, last used, expiry, Revoke). | assets/screens/api-key-list.jpg |
| Webhooks | none | Missing | Settings, Webhooks list (Kind, State, Last call) and one webhook open on the Request tab. Needs the Webhooks library flag on the capture workspace. | assets/screens/api-webhooks-list.jpg |
| Webhooks | none | Missing | A webhook's Security tab with the signing secret masked. | assets/screens/api-webhook-security.jpg |
| Beyond the REST API | none | Missing | Data Workbench, Update tab showing the Record ID rule. | assets/screens/api-data-workbench-update.jpg |
| Beyond the REST API | none | Missing | Integration middleware Monitor tab with a few messages and View request / View response. | assets/screens/api-middleware-monitor.jpg |

### solution-guide.html

| Location | Current | State | What it should show | Suggested file |
|---|---|---|---|---|
| Chapters grid | none | Missing | Optional: a cover or spread image per chapter. The page has no images today and reads fine without; skip unless a visual is wanted. | assets/screens/solution-guide-cover.jpg |

Pages with no screenshot need: none beyond the rows above. Orphan files in assets/ (unused): L03_new_project.jpg, L04_subproject.jpg, L13_email_output.jpg.

The parked redesign branch (redesign-2026-10, ../bpmsquare-site-redesign) is not on main and is not counted here. If it is revived it will need its own image pass.

## 2. Downloadable guides

The published Solution Guide PDF was redesigned by the owner and the build omits placeholders without an image, so readers see no gap marker. The counts come from the build rules in scripts/guide-build/build.mjs (an image is used when shotmap.tsv has the screen name or its path and the description is not about an opened panel or dialog), not from inspecting each PDF page. The six tender screens captured on a client workspace are deliberately left out of the public edition (replaced by a showcase image), so they count as missing.

### 2a. Solution Guide: placeholders that already have an old-UI image (59, stale after the redesign)

The 9 named captures in docs/guides/solution/images (sales-estimate-detail, sales-rfq-compare, sales-sq-detail, sales-cp-overview, sales-cp-budget, sales-buyout-tab, sales-invoice-detail, settings-people-add-panel, settings-people-person-panel) and the path captures from scripts/guide-build/shotmap.tsv (settings and master-data screens). Re-capture all of them; the file names are already set by the build (path with non-letters turned into hyphens).

### 2b. Solution Guide: placeholders with no image yet (162)

### Solution Guide, missing

**01-settings-and-setup.md** (26)

| Section | Suggested file | Screen | What it should show |
|---|---|---|---|
| A.1 Core (every workspace) | settings-people-changes.png | /settings/people?ptab=changes | A person's panel on the Changes section. |
| A.4 Estimates | settings-estimate-template-editor.png | /settings/estimate-templates | A template open in the editor on the Rules tab (open any row, then Edit). |
| A.5 Shared Inbox | settings-inbox-channels.png | /settings/inbox | The channels table with one channel panel open. |
| B.1 Company and access | settings-people-roles.png | /settings/people?tab=roles | The Roles tab with one role panel open showing the Access list. |
| B.2 Sales | settings-order-types.png | /settings/order-types | The order types table with one type open in the panel. |
| B.2 Sales | settings-account-360.png | /settings/account-360 | The Cards list with switches and arrows, and one external source open. |
| B.3 Marketing | settings-marketing-consent.png | /settings/marketing-consent | Based in, Rules by country and Topics tables. |
| B.3 Marketing | settings-marketing-limits.png | /settings/marketing-consent?tab=limits | The Limits tab with quiet hours and day chips. |
| B.3 Marketing | settings-leads-scoring.png | /settings/marketing-leads | Scoring tab with the three lines and the rules table. |
| B.3 Marketing | settings-leads-handover.png | /settings/marketing-leads?tab=handover | Hand-over tab with the switches and the turn-taking list. |
| B.3 Marketing | settings-brand-kit.png | /settings/brand-kit | The Logo, Colours and fonts, and Footer sections. |
| B.5 Data | settings-custom-fields.png | /settings/custom-fields | The object tabs and a list of fields with Required / Optional pills. |
| B.5 Data | settings-products-categories.png | /settings/products | The category table and one category open. |
| B.5 Data | settings-products-types.png | /settings/products?tab=types | The Item types table. |
| B.6 Appearance | settings-appearance-theme.png | /settings/appearance | The Theme tab with theme tiles and the colour row. |
| B.6 Appearance | settings-appearance-menu.png | /settings/appearance?tab=menu | The Menu tab with groups and switches. |
| C.2 Integrations | settings-middleware-links.png | /settings/middleware | The connector chips, the setup line and the Links table. |
| C.2 Integrations | settings-middleware-monitor.png | /settings/middleware?tab=monitor | The Monitor with filters and the action bar. |
| C.2 Integrations | settings-webhooks-panel.png | /settings/webhooks | A webhook open on the Request tab. |
| C.2 Integrations | settings-push.png | /settings/push | The Webhooks list and the Push to external systems section. |
| C.2 Integrations | settings-developer.png | /settings/developer | The API key row, the Scoped API keys list and the API reference row (hide the key value). |
| C.3 Single sign-on, Workforce extras and logs | settings-sso.png | /settings/sso | The page with the Coming soon label. |
| C.4 Logs and checks (no settings) | settings-deleted-records.png | /settings/deletion-log | The log table with the type chips. |
| C.4 Logs and checks (no settings) | administration-hub.png | /administration | The hub with its cards. |
| C.4 Logs and checks (no settings) | administration-change-history.png | /administration/change-history | The object filter and a list of changes. |
| C.4 Logs and checks (no settings) | administration-outbound-emails.png | /administration/outbound-emails | The channel filter and the sent / failed rows. |

**02-sales-and-tenders.md** (47)

| Section | Suggested file | Screen | What it should show |
|---|---|---|---|
| 1. Deals and Pipeline | sales-pipeline-board.png | /pipeline | The deals board with the Open and Weighted figures and the Owner and Account filters. |
| 1. Deals and Pipeline | sales-deal-new.png | /pipeline/new | The New Deal form. |
| 1. Deals and Pipeline | sales-deal-lines.png | /pipeline/<id>?tab=lines (a deal with lines) | The Lines tab with the add-line panel open. |
| 1. Deals and Pipeline | sales-deal-close.png | /pipeline/<id> (select Mark lost) | The close dialog with the loss reason list. |
| 2. Tenders | sales-tenders-tab.png | /pipeline?tab=tenders | The Bids ending soon list above the tender board. |
| 2. Tenders | sales-tender-new.png | /pipeline/new/tender | The New tender form. |
| 2. Tenders | sales-tender-overview.png | /pipeline/<id> (a tender) | The header with stage, bid decision, bid end date and bid guarantee, and the Overview blocks. |
| 2. Tenders | sales-tender-decision.png | /pipeline/<id> (select Propose bid decision) | The bid decision panel with Go, No-go and the reason box. |
| 3. Bill of quantities | sales-boq-upload.png | /pipeline/<id>?tab=boq (after choosing a file) | The How the file was read card with the column choices. |
| 3. Bill of quantities | sales-boq-table.png | /pipeline/<id>?tab=boq | The tiles for lines, share priced and total, with the upload and price-all actions. |
| 3. Bill of quantities | sales-boq-match.png | /pipeline/<id>?tab=boq (open the product chip) | The match panel with a strong suggestion. |
| 3. Bill of quantities | sales-boq-row.png | /pipeline/<id>?tab=boq (select a row) | The row panel with Where the cost came from. |
| 4. Costing a tender | sales-costing-tab.png | /pipeline/<id>?tab=costing | The four tiles (rows priced, still need a cost, RFQs out, replies in) and the Estimates and RFQs list. |
| 4. Costing a tender | sales-costing-price-rows.png | /pipeline/<id>?tab=costing (select Price the BOQ rows) | The allocation panel with ticked rows. |
| 4. Costing a tender | sales-costing-compare.png | /pipeline/<id>?tab=costing (select Compare and award) | Two suppliers side by side with Lowest valid marked. |
| 4. Costing a tender | sales-costing-award.png | /pipeline/<id>?tab=costing (select Award and price) | The award panel with markup and reason. |
| 5. Bid, versions and outcome | sales-bid-tab.png | /pipeline/<id>?tab=bid | The tiles, the Before you submit warning and the Submit bid button. |
| 5. Bid, versions and outcome | sales-bid-compare.png | /pipeline/<id>?tab=bid (after Compare) | The comparison of two versions. |
| 5. Bid, versions and outcome | sales-bid-documents.png | /pipeline/<id>?tab=bid | The Documents we send block. |
| 5. Bid, versions and outcome | sales-tender-outcome.png | /pipeline/<id> (a closed tender) | The Outcome block with our total against the awarded value. |
| 6. Room, calls and competitors | sales-room.png | /pipeline/<id>?tab=room | The team room: open questions, the discussion, decisions and files. |
| 6. Room, calls and competitors | sales-log-call.png | /pipeline/<id>?tab=room (select Log a call) | The Log a call panel. |
| 6. Room, calls and competitors | sales-competitors.png | /pipeline/<id>?tab=competitors | The three tiles and the Competitors list, ready for the first competitor. |
| 7. Tender blocks on the Dashboard | sales-dashboard-bold.png | / (Bold look) | The tender tiles and the pipeline by stage block. |
| 7. Tender blocks on the Dashboard | sales-dashboard-control.png | / (Control room look) | The same blocks in the dark look, with Needs you today. |
| 8. Estimates | sales-estimate-new.png | /estimates/new | The template cards. |
| 9. RFQs and supplier quotes | sales-rfq-new.png | /rfqs/new | The form with lines, suppliers and reply date. |
| 9. RFQs and supplier quotes | sales-rfq-suppliers.png | /rfqs/<id>?tab=suppliers | The Suppliers tab with states and the reply actions. |
| 10. Quotations | sales-quotation-type.png | /quotations/new | The offer type picker. |
| 10. Quotations | sales-quotation-detail.png | /quotations/<id> | The status and outcome drop-downs, the More menu and the scope of work. |
| 11. Standard Quotes and templates | sales-sq-form-details.png | /standard-quotes/new | The Details step. |
| 11. Standard Quotes and templates | sales-sq-form-lines.png | /standard-quotes/new (Lines step) | The line editor with the Add a line panel open. |
| 11. Standard Quotes and templates | sales-sq-template-builder.png | /standard-quotes/templates/<id> | The settings, the layout blocks and the preview. |
| 12. Sales Orders and order types | sales-order-new.png | /sales-orders/new | The form with customer, order type and lines. |
| 12. Sales Orders and order types | sales-order-detail.png | /sales-orders/<id> | The path across the top, the Overview tab and the header buttons. |
| 12. Sales Orders and order types | sales-order-erp.png | /sales-orders/<id>?tab=erp | The ERP tab with the checks and the transfer log. |
| 13. Purchase Orders | sales-po-form.png | /purchase-orders/new | The form with a line from inventory. |
| 13. Purchase Orders | sales-po-receive.png | /purchase-orders/<id>?tab=lines | The Receive stock card. |
| 14. Contract projects | sales-cp-variation.png | /contract-projects/<id>?tab=variations (open a variation) | The variation panel with value and cost changes. |
| 14. Contract projects | sales-cp-invoicing.png | /contract-projects/<id>?tab=invoicing | The billing schedule with Create invoice. |
| 15. Buy-out packages | sales-buyout-new-package.png | /contract-projects/<id>?tab=buyout (select + New package) | The new package panel with lines ticked. |
| 15. Buy-out packages | sales-buyout-quotes.png | /contract-projects/<id>?tab=buyout (open a package) | Two quotes side by side with Lowest valid marked. |
| 15. Buy-out packages | sales-buyout-handover.png | /contract-projects/<id>?tab=buyout (open an awarded package) | The Handover block with Download Excel and Mark as sent. |
| 16. Invoices | sales-invoice-payment.png | /invoices/<id>?tab=payments | The payment form. |
| 16. Invoices | sales-invoice-einvoice.png | /invoices/<id> (Saudi e-invoicing on) | The e-invoice block with the readiness list. |
| 17. From enquiry to invoice | sales-flow-quote-to-invoice.png | /standard-quotes/<id> (an Accepted quote with an invoice) | The header with the invoice and sales order facts. |
| 17. From enquiry to invoice | sales-flow-tender-to-project.png | /pipeline/<id> (an Awarded tender) | The Open contract project button. |

**03-service.md** (11)

| Section | Suggested file | Screen | What it should show |
|---|---|---|---|
| 1. Cases | service-case-new.png | /cases/new | The New Case form with the optional assets list open. |
| 1. Cases | service-case-inspection.png | /cases/<id> (a case in Inspection) | The stage tracker and the inspection report card with Findings, Recommendations and Estimated cost. |
| 1. Cases | service-case-detail.png | /cases/<id> (a case In repair) | The full case page with the right-hand panel and the Work orders card. |
| 2. AMC contracts | service-amc-list.png | /amc | The three tiles and the contract list with the Days left column. |
| 3. Work orders | service-create-work-order-panel.png | /cases/<id> (select Create work order) | The Create work order side panel with date and technician. |
| 3. Work orders | service-work-order-detail.png | /work-orders/<id> (a Completed work order) | The work order page with the Raise Invoice button and the Authorization panel. |
| 5. Technicians | service-technicians-list.png | /technicians | The capacity tiles and the list with Free today and the certificate warning. |
| 5. Technicians | service-technician-schedule.png | /technicians/<id>?tab=schedule | The month calendar with work orders and leave. |
| 6. Assets, including loaner units | service-asset-detail.png | /assets/<id>?tab=cases | An asset with open and closed cases on the Service history tab. |
| 7. From case to quote, work order and invoice | service-quote-from-case.png | /quotations/new (opened from a case) | The blue "Creating quotation from case" box with Yes, carry over and Start fresh. |
| 7. From case to quote, work order and invoice | service-case-related-tab.png | /cases/<id>?tab=related | The Related tab with the linked quotation. |

**04-workforce.md** (10)

| Section | Suggested file | Screen | What it should show |
|---|---|---|---|
| My Workforce | wfm-my-workforce-punch.png | /wfm/me | The Punch tile with the four large buttons, the Other list and the Your day column |
| My Workforce | wfm-my-details-requests.png | /wfm/me/details?tab=requests | The Requests tab with Leave, Overtime / Work from home and Clarifications |
| Door tablet (kiosk) and face punch | wfm-kiosk-choice.png | /kiosk | The tablet showing "Hi <name>" and the valid punch buttons |
| Workforce employees | wfm-employee-correct-time.png | /wfm/employees/{id} | The Correct time window with Change and Add a missing punch |
| Corrections | wfm-flagged-for-review.png | /wfm/corrections?tab=recheck | The Flagged for review tab with its filters |
| Roster and shifts | wfm-settings-shifts.png | /settings/workforce?tab=shifts | The shifts table and the New shift panel |
| Projects | wfm-project-billing-preview.png | /wfm/projects/{id}?tab=billing | The Bill hours preview with the rate, tax and Create draft invoice button |
| Leave and holidays | wfm-holidays.png | /wfm/leave?tab=holidays | The holiday calendar and the Add a holiday form |
| Overtime | wfm-overtime-queue.png | /wfm/corrections?tab=ot | The overtime sessions table with pending total |
| Time summary and exports | wfm-summary-daily.png | /wfm/summary?tab=daily | One employee's daily detail with breaks and totals |

**05-marketing.md** (34)

| Section | Suggested file | Screen | What it should show |
|---|---|---|---|
| 2. Segmentation | 04-segmentation-builder.png | /marketing/segments/new | The attribute palette on the left, two conditions on the canvas with Match ALL selected, and the recipient count line |
| 3. ABM programs | 04-abm-programs-list.png | /marketing/abm | The program list with status chips and the target progress bars |
| 3. ABM programs | 04-abm-program-targets.png | /marketing/abm/<id> | A live program on the Target accounts tab with progress pills |
| 3. ABM programs | 04-abm-buying-group.png | /marketing/abm/<id>/accounts/<targetId> | The Buying group tab with a missing-role row and an Add one button |
| 4. Campaigns | 04-campaign-new.png | /marketing/new | New Campaign with the template folders open and the Target audience card with a recipient count |
| 4. Campaigns | 04-campaign-recipients.png | /marketing/<id> | A sent campaign with the facts bar and the Recipients list showing skipped reasons |
| 5. Newsletters | 04-newsletter-studio.png | /marketing/newsletters/<id> | The Studio with the four option tabs on the left and the phone preview on the right |
| 5. Newsletters | 04-newsletter-send-panel.png | /marketing/newsletters/<id> | The Send... panel showing "N of M people will receive it" and the who-is-left-out list |
| 5. Newsletters | 04-newsletter-languages.png | /marketing/newsletters/<id> | The Languages tab with an Arabic row and Check this lines |
| 6. WhatsApp | 04-whatsapp-templates.png | /marketing/whatsapp | The template list with status chips |
| 6. WhatsApp | 04-whatsapp-template-studio.png | /marketing/whatsapp/<id> | A template with the message bubble on the right and the Approval group on the left |
| 6. WhatsApp | 04-whatsapp-setup.png | /marketing/whatsapp/setup | Number and provider, the callback address and the Recent messages table |
| 7. Events | 04-events-list.png | /marketing/events | The events list with the Registered and Came counts |
| 7. Events | 04-event-attendees.png | /marketing/events/<id>?tab=attendees | The Attendees tab with Check in and Did not come buttons |
| 7. Events | 04-event-results.png | /marketing/events/<id>?tab=results | The Results tab with the show rate sentence |
| 8. Forms and the preference centre | 04-form-studio.png | /marketing/forms/<id> | The form builder with option groups on the left and the live preview on the right |
| 8. Forms and the preference centre | 04-form-answers.png | /marketing/forms/<id> | The Answers tab with the Agreed to emails column |
| 8. Forms and the preference centre | 04-preference-centre.png | /marketing/preferences/<contactId>/<token> | The person's topics as switches with Save my choices and Unsubscribe from all |
| 9. Journeys | 04-journey-studio.png | /marketing/journeys/<id> | The journey as sentences on the Build tab with the Rules group open |
| 9. Journeys | 04-journey-try-it.png | /marketing/journeys/<id>?tab=test | Try it on one person showing the Day 0 and Day 3 path |
| 10. Buying signals | 04-signals-in-market.png | /marketing/signals | The ranked list with stage pills, scores and sparklines |
| 10. Buying signals | 04-signals-company.png | /marketing/signals | One company open with How this is worked out and the Signals timeline |
| 10. Buying signals | 04-signals-did-it-work.png | /marketing/signals?tab=didit | A sent campaign compared before and after |
| 11. Leads | 04-lead-new.png | /leads | The New lead dialog with Account, Title and Source |
| 12. Scored leads | 04-scored-leads-list.png | /marketing/leads | The list with score meters, Lead stage pills and Respond by chips |
| 12. Scored leads | 04-scored-lead-why.png | /marketing/leads/<id> | The Why score card with reasons and the Pick this up button |
| 12. Scored leads | 04-settings-leads-scoring.png | /settings/marketing-leads | The Scoring tab with Warm from, Hot from and the rules table |
| 13. Revenue by source | 04-revenue-by-source.png | /marketing/attribution | The choices on the left and the four figures and table on the right |
| 13. Revenue by source | 04-revenue-how-to-read.png | /marketing/attribution | The How to read this card |
| 14. Consent and unsubscribe | 04-settings-consent.png | /settings/marketing-consent | Based in, the Rules by country table and the Topics table |
| 14. Consent and unsubscribe | 04-settings-consent-limits.png | /settings/marketing-consent?tab=limits | The Limits tab with quiet hours and the per-person limits |
| 14. Consent and unsubscribe | 04-contact-consent-card.png | /contacts/<id> | The Consent card on the Marketing tab with Record consent |
| 14. Consent and unsubscribe | 04-unsubscribe-page.png | /marketing/unsubscribe/<accountId>/<token> | The public unsubscribe page with its confirm button |
| 15. Partners | 04-partners-placeholder.png | /partners | The placeholder page, to show the module is not built yet |

**06-platform-and-master-data.md** (34)

| Section | Suggested file | Screen | What it should show |
|---|---|---|---|
| 1. Dashboard | platform-dashboard-curated.png | / | The Dashboard in Curated mode with the Curated |
| 1. Dashboard | platform-dashboard-adapt.png | / | The Adapt dashboard drawer open, showing Quick add chips, size buttons and the Analytics widgets list. |
| 1. Dashboard | platform-dashboard-tender-bold.png | / | A tender workspace in the Bold look: five tiles, then the stage and closing blocks. |
| 1. Dashboard | platform-dashboard-tender-control-room.png | / | The same Dashboard in the Control room look (dark). |
| 2. Analytics | platform-analytics-quotations-table.png | /reports | The Quotations table with Filters open and the Export CSV button. |
| 3. Talk to data | platform-talk-to-data.png | /reports/talk | A question answered with a chart and the interpretation line. |
| 3. Talk to data | platform-talk-to-data-insights.png | /reports/talk | A broad question answered with a Summary and several chart cards. |
| 4. The AI assistant | platform-assistant-panel.png | / | The assistant open with the context line, suggestions and the AI usage pill. |
| 4. The AI assistant | platform-assistant-confirm-card.png | /accounts | A confirm card for a new account with required fields marked. |
| 4. The AI assistant | platform-assistant-guide.png | /contacts/new | Guide mode with a highlighted control and the numbered steps. |
| 4. The AI assistant | platform-briefing-tile.png | / | The My day block with Yesterday, Open and Focus rows. |
| 5. Global search and the command palette | platform-search-results.png | / | The search box with grouped results open. |
| 5. Global search and the command palette | platform-command-palette.png | / | The palette with Go to, Create and Records sections (Nova workspace). |
| 6. Accounts, including Account 360 | platform-account-detail.png | /accounts/<id> | An account with tabs and the Quick create rail. |
| 6. Accounts, including Account 360 | platform-account-360.png | /accounts/<id> | The Account 360 panel with rating, What to do next and cards. |
| 7. Contacts | platform-contacts-list.png | /contacts | The Contacts list with the Email needs attention chip. |
| 7. Contacts | platform-contact-marketing-tab.png | /contacts/<id>?tab=marketing | The Email health and Consent cards. |
| 8. Partners | platform-partners-placeholder.png | /partners | The placeholder screen. |
| 9. Suppliers and supplier groups | platform-supplier-group-panel.png | /suppliers/groups | The group side panel with name, client and member ticks. |
| 10. Products | platform-product-components.png | /products/<id>?tab=components | A kit with its components and the Cost roll-up card. |
| 10. Products | platform-product-pricing-tab.png | /products/<id>?tab=pricing | The Cost sheet and Quantity breaks cards. |
| 11. Inventory | platform-inventory-list.png | /inventory | The list with Low stock chip and red Low pills. |
| 11. Inventory | platform-inventory-stock-tab.png | /inventory/<id>?tab=stock | Adjust stock and Recent stock movements. |
| 13. Employees | platform-employee-delete-dialog.png | /employees | The Delete dialog listing records and the Make obsolete button. |
| 14. Pricing | platform-pricing-today.png | /pricing/today | Today's rates with the tab strip and Price Book picker. |
| 14. Pricing | platform-pricing-setup.png | /pricing/setup | The setup wizard with cost rates and the cost ladder. |
| 14. Pricing | platform-pricing-draft-bar.png | /pricing/setup | The amber "unsaved pricing changes" bar with Discard and Go live. |
| 15. Data Workbench | platform-dw-export.png | /data-workbench?tab=export | Choose columns and Filters, with Record ID always included. |
| 15. Data Workbench | platform-dw-update.png | /data-workbench?tab=update | The Update mode asking for an exported file. |
| 16. Change history and Audit | platform-audit-hub.png | /administration | The Audit and Access cards. |
| 16. Change history and Audit | platform-change-history.png | /administration/change-history | Results for Accounts with the action pills and the Download CSV button. |
| 17. Process Design Studio | platform-studio-list.png | /process-studio | The studies list with status chips. |
| 17. Process Design Studio | platform-studio-fit.png | /process-studio/<id> | The How BPMSquare fits step with rating pills. |
| 17. Process Design Studio | platform-studio-plan.png | /process-studio/<id> | The Your plan step with phases, tasks and owners. |

### 2c. Integration Guide: placeholders with no image yet (19)

The Integration Guide has no images at all today.

### Integration Guide, missing

**01-overview-and-security.md** (1)

| Section | Suggested file | Screen | What it should show |
|---|---|---|---|
| 3. Keys and scopes | integration-developer-keys.png | /settings/developer | The API Key row (hide the value), the Scoped API keys list with one key, and the API reference row. |

**03-change-feed-and-webhooks.md** (2)

| Section | Suggested file | Screen | What it should show |
|---|---|---|---|
| 3. Event webhooks | integration-webhooks-list.png | /settings/webhooks | The webhooks list with Kind, State, Last call and Used by columns. |
| 3. Event webhooks | integration-webhooks-panel.png | /settings/webhooks | A webhook open on the Request tab, with the Address, Method and Headers. |

**05-connectors-and-middleware.md** (12)

| Section | Suggested file | Screen | What it should show |
|---|---|---|---|
| 2. The Connectors screen | integration-connectors.png | /settings/connectors | The connector tiles with Connected and Not connected labels. |
| 3. Slack | integration-connector-slack.png | /settings/connectors | The Slack tile open on the Connect form. |
| 4. Google Calendar | integration-connector-google-calendar.png | /settings/connectors | The Google Calendar tile open on the Connect form. |
| 5. Gmail | integration-connector-gmail.png | /settings/connectors | The Gmail tile open on the Connect form. |
| 6. Mail server (SMTP and IMAP) | integration-connector-mail-server.png | /settings/connectors | The Mail server tile open on the Connect form with the seven fields. |
| 7. Microsoft Dynamics 365 | integration-connector-dynamics.png | /settings/middleware?connector=dynamics365 | The Dynamics 365 connection panel open on the connected line with Test, Edit and Disconnect. |
| 8. SAP S/4HANA | integration-connector-sap.png | /settings/middleware?connector=sap_s4 | The SAP S/4HANA connection panel with Login type, API host, Communication user and Password. |
| 9. ePROMIS | integration-connector-epromis.png | /settings/connectors/epromis | The ePROMIS page with Base URL, Sign-in, the credential and the Endpoint map box. |
| 10. The Integration middleware page | integration-middleware-links.png | /settings/middleware | The connector chips, the setup line and the Links table. |
| 10. The Integration middleware page | integration-middleware-mapping.png | /settings/middleware?tab=mapping | The Mapping tab with the Mapping for choice, the Fields and Value mapping switch, and the field lines. |
| 10. The Integration middleware page | integration-middleware-monitor.png | /settings/middleware?tab=monitor | The Monitor with the status chips, filters, the action bar and the message list. |
| 10. The Integration middleware page | integration-middleware-resync.png | /settings/middleware?tab=resync | The Resync tab on Full resync, with one row for each entity. |

**06-data-workbench.md** (4)

| Section | Suggested file | Screen | What it should show |
|---|---|---|---|
| 1. Where it is and who can use it | integration-dw-import.png | /data-workbench?tab=import | The Import mode: the object list on the left, the template download and the upload box. |
| 3. Import | integration-dw-review.png | /data-workbench?tab=import | The Review step with the ready and problem counts, Show only problems and the Import button. |
| 4. Export | integration-dw-export.png | /data-workbench?tab=export | The Export mode: Choose columns with Record ID always included, and Filters. |
| 5. Update | integration-dw-update.png | /data-workbench?tab=update | The Update mode asking for an exported file under Or use a file you exported. |

