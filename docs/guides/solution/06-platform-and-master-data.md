# Chapter 6. Platform and master data

Snapshot 4 Nov 2026

> Screen names and button words may be refined as the product improves. If a name here is slightly different on your screen, look for the same idea nearby. Anything marked "(verify)" could not be confirmed from the product and should be checked with your BPMSquare contact before you rely on it.

## About this chapter

This chapter is for business users and for the consultants who set a workspace up. It covers the screens that every other module leans on: the **Dashboard**, **Analytics**, **Talk to data**, the **AI assistant**, **search**, the **master data** (accounts, contacts, partners, suppliers, products, inventory, assets, employees), **Pricing**, **Data Workbench**, **Change history** and the **Process Design Studio**.

Settings are not in this chapter. They have their own chapter (Chapter 1). Where a screen here depends on a setting, the text names the setting and sends you there.

### How the menu is laid out

The left menu groups these screens as follows.

| Menu group | Items in this chapter |
| --- | --- |
| Workspace | **Dashboard**, **Process Design Studio** |
| Master data (a folder you expand) | **Accounts**, **Contacts**, **Partners**, **Suppliers**, **Products**, **Inventory**, **Assets**, **Employees** |
| Insights | **Analytics**, **Pricing** |
| Admin | **Data Workbench**, **Audit & Users**, **Settings** |

Search sits in the top bar on every screen. The AI assistant is the round button at the bottom right.

### Who switches modules on

The BPMSquare team switches each module on for your workspace. Your own administrator cannot do it. A module that is off does not appear in the menu. Your administrator can also hide menu items for a person through business roles in **Settings > People**. That only hides the item from their menu. It is not a security lock. The assistant and Talk to data are the exception: they only read what a person's business roles allow them to view.

Every feature below names the **module flag** that switches it on. If you cannot see a screen, the flag is off, or your business role hides it.

### Reading the feature sections

Each feature has the same parts: what it is, where to find it, who uses it, how to use it, fields and statuses (where useful), links to other records, good to know, and a suggested screenshot.

The examples use made-up names such as Example Trading LLC.

### Contents

**Part A. The platform**

1. [Dashboard](#1-dashboard)
2. [Analytics](#2-analytics)
3. [Talk to data](#3-talk-to-data)
4. [The AI assistant](#4-the-ai-assistant)
5. [Global search and the command palette](#5-global-search-and-the-command-palette)

**Part B. Master data**

6. [Accounts, including Account 360](#6-accounts-including-account-360)
7. [Contacts](#7-contacts)
8. [Partners](#8-partners)
9. [Suppliers and supplier groups](#9-suppliers-and-supplier-groups)
10. [Products](#10-products)
11. [Inventory](#11-inventory)
12. [Assets](#12-assets)
13. [Employees](#13-employees)

**Part C. Pricing, data tools and audit**

14. [Pricing](#14-pricing)
15. [Data Workbench](#15-data-workbench)
16. [Change history and Audit](#16-change-history-and-audit)
17. [Process Design Studio](#17-process-design-studio)

[Common questions](#common-questions)

---

# Part A. The platform

## 1. Dashboard

### What it is

The Dashboard is the home screen. It opens with a greeting, then a set of blocks: figures, charts and lists drawn from the modules your workspace owns. Each block links to the screen behind it.

There are two ways to see it. **Curated** is a fixed set of blocks in a fixed order, with nothing to set up. **My layout** is an arrangement you choose and order yourself.

### Where to find it

**Dashboard** at the top of the left menu (`/`). The old address `/dashboard` redirects to `/`.

### Who uses it and which module switches it on

Everyone. There is no module flag for the Dashboard itself. Each block follows the flag of the module it reads. A workspace that has not bought Cases never shows case blocks. Business role entry: **Dashboard**.

### How to use it

**Switch between Curated and My layout**

1. At the top right of the greeting, select **Curated** or **My layout**.
2. Your choice is remembered in this browser. Nothing is lost by switching. Your saved arrangement is still there when you switch back.
3. The workspace default is set in **Settings > Appearance**, on the **Dashboard** tab, under **Opens on**.

**Change your own layout (every user)**

1. Choose **My layout** in the switch, then select **My layout** (the button with the person icon).
2. In the drawer, drag a block by its handle to move it. Select the eye icon to hide or show it.
3. Under a visible block, select **Small**, **Half** or **Full** to set its width.
4. Under **Quick add**, select a starter set such as **+ Quotations** or **+ Workforce**. It adds the blocks for that module in one click.
5. Open **Analytics widgets** at the bottom and tick any extra block.
6. Changes save automatically ("Changes saved automatically"). To go back, select **Reset to my default**.

**Set the default for the whole workspace (administrators)**

1. Choose **My layout** in the switch, then select **Adapt dashboard**.
2. The drawer works the same way. What you save becomes the default for everyone who has not made their own layout.

**Add the daily briefing to the Dashboard**

1. Open **Adapt dashboard** (administrator) or **My layout**.
2. Open **Analytics widgets** and tick **My day (daily briefing)**. It needs the AI assistant to be on for the workspace.

**Switch the look of a tender dashboard**

1. In a workspace with the tender edition, use the **Bold | Control room** switch next to Curated | My layout.
2. **Bold** is the light dashboard. **Control room** turns the whole Dashboard page dark. The dark look stays on this page and does not change other screens.
3. Your choice is remembered for you. The workspace default is **Settings > Appearance > Dashboard tab > Dashboard look**.

### Which layout wins

When you open the Dashboard, the product uses the first of these that exists:

1. Your own layout (**My layout**).
2. For a member with business roles: the dashboards of their roles, joined together.
3. The workspace default (**Adapt dashboard**).
4. The built-in default for the modules your workspace owns.

In **Curated** mode none of these is used. Curated ignores every saved layout.

### The block catalogue

**Standard blocks**

| Block | Shows | Needs one of |
| --- | --- | --- |
| Overview | The headline figures | Quotations, Cases, Work orders, Assets |
| Revenue | Revenue from quotations | Quotations |
| Invoiced vs paid | Invoiced and paid totals | Invoices |
| Overdue tasks | Things past their date | Accounts, Cases, Quotations, Work orders |
| Work orders by technician | Workload per technician | Technicians, Work orders |
| Top accounts by revenue | Best accounts with values | Accounts |
| Quick create | Shortcuts to start a record. Sits in a right-hand rail | Accounts, Cases, Contacts, Quotations, Assets |
| Attendance summary (day + month) | Workforce attendance | Workforce |
| Tips & shortcuts | A short list of tips, each only for modules you own | Switched on by an administrator |

**Analytics widgets** are the extra blocks in the drawer. Each follows its module flag.

| Group | Widgets |
| --- | --- |
| Counts | Accounts, Contacts, Assets, Products, Open cases, Work orders, AMC contracts, Leads, Technicians |
| Breakdowns | Accounts by type, Lead funnel, Assets by kind, Case status, Work order status, Technician availability, Loaner availability, Invoices by status |
| Sales | Quote pipeline, Quote won/lost value, Quote overdue, Quote source (cases vs standalone), Pipeline (open deals), Revenue overview, Sales orders (to confirm / open), Estimates (draft / quoted), RFQs (open / to award), Inbox (unhandled / reply time), ABM (targets engaged) |
| News and activity | Recent activity (analytics), Client news, Business news |
| Workforce | Attendance by site (today), Night shift cost (today), Corrections queue, Leave requests queue, Recheck requests queue, Headcount by site, Workforce composition, Leave taken by type (YTD) |
| Project costing | Hours by project (this month), Project budget burn, Project billing (this month) |
| Per person | My day (daily briefing) |

**Quick add starter sets** in the drawer: Accounts, Contacts, Quotations, Cases, Work orders, Assets, AMC / Contracts, Leads, Technicians, Invoices, Workforce, Project costing and Tenders. A set only appears for modules your workspace owns.

**Business news** and **Tips & shortcuts** are switched on by an administrator in **Settings > Appearance > Dashboard**. When on, they always show, even if a saved layout had hidden them.

### The tender blocks

A workspace with the tender edition gets thirteen extra blocks. They lead the Dashboard, in Curated and in My layout alike. Each is its own block, so each can be moved, resized or hidden. Every tender block needs the **Pipeline** module. The two buy-out blocks also need **Contract projects**.

| Block | Width | Shows | Where it goes |
| --- | --- | --- | --- |
| Open pipeline | Tile | Value and number of open tenders | The Tenders tab of Pipeline |
| Weighted by chance | Tile | Each open tender's value times its chance of winning, added up | The Tenders tab |
| Closing in 14 days | Tile | Open tenders whose bid end date is within 14 days | The Tenders tab, filtered to closing in 14 days |
| Win rate, 12 months | Tile | Won out of won plus lost. Dropped tenders do not count | The Tenders tab, filtered to won |
| Buy-out committed | Tile | Value awarded in buy-out | The project's Buy-out tab |
| Pipeline by stage | Half | Open tenders by stage. The bar is the value in millions | A stage opens the tenders in that stage |
| Bids closing soonest | Half | Next bid end dates. Red is three days or less, amber ten days or less, green later | A row opens the tender |
| Won and lost by month | Half | Tenders decided in each of the last 12 months | A column opens that month's tenders |
| Open value by client | Half | The five largest clients by open value, then the rest together | A slice opens that client's tenders |
| Needs you today | Half | Things only a person can move, most urgent first | A row opens the record |
| Open pipeline, last 12 weeks | Half | Open value rebuilt week by week from created and closed dates. Later edits to an amount are not replayed | The Tenders tab |
| Bid deadlines, next 28 days | Full | Each marker is a bid end date, coloured as above | The Tenders tab, filtered to the next 28 days |
| Buy-out against budget | Full | The bar is the budget, the marker is the best quote, the filled part is what is awarded | The Buy-out tab |

If the tender data cannot be read, the Dashboard stays up and each tender block says so. An item in **Needs you today** about a late supplier reply only appears when the **RFQ** module is on.

A workspace that saved its layout before the tender edition was switched on gets the tender blocks in front, once. A layout that already names any tender block is left alone.

### Good to know

- A scoped workspace never opens on a blank screen. If your saved layout holds only blocks for modules you do not own, the product falls back to a default built from the modules you do own.
- If you hide every block, the Dashboard says "Your dashboard is empty" and offers **Choose cards**.
- In **Curated** mode the **Adapt dashboard** and **My layout** buttons are hidden, because Curated has no layout to adapt.
- A workspace on the Nova experience opens a different home screen (the Stream) instead of this Dashboard. It uses the same saved layout storage but its own presentation.
- Block figures come from the same data as the screens they link to.

Screenshot: platform-dashboard-curated.png | / | The Dashboard in Curated mode with the Curated | My layout switch visible.
Screenshot: platform-dashboard-adapt.png | / | The Adapt dashboard drawer open, showing Quick add chips, size buttons and the Analytics widgets list.
Screenshot: platform-dashboard-tender-bold.png | / | A tender workspace in the Bold look: five tiles, then the stage and closing blocks.
Screenshot: platform-dashboard-tender-control-room.png | / | The same Dashboard in the Control room look (dark).

---

## 2. Analytics

### What it is

Analytics is the reports screen. It shows key figures and charts across your modules, and a table of quotations you can filter and export.

### Where to find it

**Insights > Analytics** (`/reports`).

### Who uses it and which module switches it on

Managers and administrators. Module: **Analytics** (`reports`). Business role entry: **Analytics**. Each figure and chart also follows the flag and the business role of its own module. A person who has only Workforce and Analytics sees the Workforce charts and no sales or service ones.

### How to use it

**Read the figures**

1. Open **Analytics**. The top row shows tiles such as Accounts, Contacts, Assets, Open cases, Contracts, Leads and Technicians.
2. Select any tile or chart title to open the list behind it, already filtered. Segments of a chart are links too.

**Hide metrics you do not want (administrators)**

1. Select **Adapt** at the top right.
2. Under **Show / hide metrics**, untick the metrics to hide. A metric whose module is off shows "(feature off)" and cannot be ticked.
3. The choice is saved for the whole workspace.

**Filter and export quotations**

1. Scroll to the **Quotations** table. It appears only when the Quotations module is on and your role can view it.
2. Select **Filters**. Pick a status button, or type in **Search account…**.
3. Sort by selecting the **Date**, **Total** or **Ref** column heading.
4. Select **Export CSV** to download the filtered rows as `quotes.csv`.

### Charts you may see

| Chart | Needs |
| --- | --- |
| Accounts by type, Lead pipeline funnel, Assets by kind (with Loaner stock) | Accounts, Leads, Assets |
| Cumulative quote value, Quote outcome value, Quote overdue, Quote source | Quotations |
| Service case status | Cases |
| Work orders by status, Technician availability | Work orders, Technicians |
| Revenue overview, Invoices by status | Invoices |
| Attendance by site, Night shift cost, Corrections queue, Leave requests, Flagged for review, Headcount by site, Workforce composition, Leave taken (YTD) | Workforce |
| Hours by project, Project budget burn, Project billing | Project costing |
| Recent activity, Loaner availability | Accounts, Assets |

### Good to know

- The tender blocks are Dashboard blocks. They are not listed in Analytics.
- The CSV export covers quotations only. For other objects use **Data Workbench > Export** (section 15).
- The CSV neutralises cells that start with `=`, `+`, `-` or `@`, so Excel does not run them as formulas.

Screenshot: platform-analytics-overview.png | /reports | The tile row and first charts.
Screenshot: platform-analytics-quotations-table.png | /reports | The Quotations table with Filters open and the Export CSV button.

---

## 3. Talk to data

### What it is

Talk to data lets you ask a question in plain English and get a live chart or table. Every answer is worked out from your data at that moment. The line under each chart says exactly what was measured.

### Where to find it

**Insights > Analytics**, then the **Talk to data** tab (`/reports/talk`). The tab only shows when the module is on. Without it the address answers "not found".

### Who uses it and which module switches it on

Managers who want answers without building a report. Modules: **Analytics** (`reports`) and **Talk to data** (`ai_reports`, a separate module). It only offers objects your business roles allow you to view and your workspace owns. Saving a report needs edit rights on the Analytics workcenter.

### How to use it

**Ask a question**

1. Open **Talk to data**.
2. Type a question, for example "Top 5 accounts by open quote value", or select one of the example chips.
3. Select **Ask**. The answer appears as a chart or table with an interpretation line.

**Refine an answer**

1. With an answer on screen, type a follow-up such as "only this year" or "top 5 instead" in the same box.
2. Select **Ask**. The product decides whether the new question refines the last one or stands alone.
3. Select **+ New question** to start clean.

**Answer a clarifying question**

1. If the question is too vague, a blue box asks one question.
2. Type your answer under **Your answer…** and select **Continue**.

**Get several angles at once**

1. Ask a broad question such as "How is my business doing?" or "Give me insights about quotes".
2. The product proposes several specific questions, runs each, and shows a **Summary** followed by a card per angle.

**Save a report**

1. Under an answer, select **Save this report**.
2. Saved reports list under **Saved reports**. Select a title to open it. Select **Remove** to delete it.

### What it can ask about

Quotations, accounts, service cases, inventory items, products, deals (pipeline), tenders, contract projects, RFQs, standard quotes, sales orders, ABM programs, ABM target accounts, estimates, workforce projects and project hours, employees, invoices, purchase orders, contacts, assets, suppliers, work orders and leads. Only the ones your workspace owns and your role can view.

### Good to know

- A question can be up to 500 characters.
- The product refuses what it cannot answer from your data and says why, in an amber box.
- A product's **cost price** and its **preferred supplier** are never available here. They are internal.
- Each new question calls the AI model. Opening a saved report does not.
- Whether Talk to data counts against the monthly AI allowance shown on the assistant is not confirmed (verify).

Screenshot: platform-talk-to-data.png | /reports/talk | A question answered with a chart and the interpretation line.
Screenshot: platform-talk-to-data-insights.png | /reports/talk | A broad question answered with a Summary and several chart cards.

---

## 4. The AI assistant

### What it is

The assistant is a chat panel you can open on any screen. It answers questions about your data, takes you to screens and records, shows you how to do things on the screen you are on, and in some workspaces proposes new records for you to confirm. Some places in the product call it "the AI slider".

### Where to find it

The round button at the bottom right of every screen. Above it, a small switch turns the assistant on or off for you in this browser. When it is off the round button disappears.

### Who uses it and which module switches it on

Anyone. Module: **AI assistant** (`ai_assistant`). Three extras are separate switches that only the BPMSquare team sets:

| Extra | Module flag | Also needs |
| --- | --- | --- |
| Create a record from a confirm card | `ai_assistant_actions` | The AI assistant, and the Nova experience (`next_experience`) |
| Web research and company analysis | `ai_assistant_web` | The AI assistant. Not blocked by the workspace's own policy against external calls |
| Daily briefing tile on the Dashboard | `ai_assistant` | Added by hand to the Dashboard (section 1) |

### How to use it

**Ask about your data**

1. Open the assistant. The panel shows "How can I help you today?" and suggestions for the screen you are on.
2. Type in **Ask, or say where to go…** and press Enter.
3. The answer comes with buttons that open a screen or a record, or an inline chart.
4. Select **New chat** to start again. Your chat is kept in this browser until you do, or until you sign out.

**Go somewhere**

1. Type "open accounts" or "open the quote for Example Trading".
2. If exactly one match is found, the assistant goes there at once. Otherwise it offers buttons.

**Be shown how (guide mode)**

1. On any screen, ask "How do I add a contact?" or pick a guide offered in the panel.
2. The assistant lists the steps and starts the guide at once. The real control on the page is highlighted for each step. The guide card in the chat has **Show me** to run it again.
3. Use **Next** (it becomes **Done** on the last step), **Back** and **Stop**. On a phone the steps sit in a bar at the bottom.
4. The assistant never clicks for you. A step you cannot take is shown greyed with the reason.

**Create an account or a contact (where switched on)**

1. Ask "Create an account Example Trading LLC" or "Add a contact to this account".
2. A confirm card appears with the fields. Fill in anything missing (required fields are marked `*`).
3. Select **Create account** or **Create contact**. Nothing exists until you press it. Select **Cancel** to drop it.
4. If a similar record already exists, the card says "Similar already exists" and offers **Open instead**.
5. After it is created, the card offers **Open →** and, for an account, **Add a contact**.

**Look up a company on the web (where switched on)**

1. Ask about a company, for example "What does Example Trading LLC do?". The assistant first asks "Search the web?".
2. Select **Yes** to run one search for exactly that question. Select **No** to refuse.
3. The answer is marked "From the web" and lists its sources.
4. On an account record, select **Analyse company**. The assistant produces a company analysis card with a fit score. Select **Refresh** to redo it.

**Fill a new account from the web**

1. Give only a company name when you ask for a new account.
2. The assistant asks "How do you want to fill in the details for …?". Choose **I'll give the details** or **Look it up on the web**.
3. Web values are shown on the card per field. You still press **Create account**.

### What it reads

- The objects Talk to data can ask about (section 3), limited to the modules your workspace owns and the screens your business roles let you view.
- Two quick lookups: how many leads are still open, and who is checked in right now (Workforce).
- The record and screen you are on. The server checks that the record belongs to your workspace.
- It cannot read anything outside that list. A product's cost price and preferred supplier are never offered to it.

### What it can create today

Accounts and contacts only. Every other object is deliberately left to its own screen. Examples: cases, assets, products, suppliers, leads, deals, quotes, estimates. It cannot change or delete a record. Nothing is created without your press on the card, and the record is made by the same route as the New screen, so the same checks and Change history apply. The Change history marks such a record "via assistant".

### The daily briefing

The briefing is a short list worked out from your own records by fixed rules. The AI only words a short summary on top. It has three rows:

| Row | Meaning |
| --- | --- |
| Yesterday | What you did yesterday |
| Open | What is open for you today |
| Focus | The few things most worth your time, each with a reason |

It shows as a card at the top of the assistant, and as the **My day** block on the Dashboard once added. **Refresh** makes it again, with a short cool-down. With no history it says "Nothing yet. Your work from today shows here tomorrow."

### Fields and statuses

| Item | Meaning |
| --- | --- |
| AI usage % pill | This month's share of the workspace allowance used. The allowance is shared by every AI feature |
| Over 100% | New answers stop. Suggestions and opening screens keep working. Answers return next month or when the allowance is raised |
| Suggestions | Chips for the screen you are on, worked out by rules, not by the AI |

### Good to know

- Web research asks first, every time, for one search at a time. Only company names go out, never people, emails, phone numbers or anything from your records.
- A person can trigger at most 20 web research calls a day. A workspace has a daily limit on company analyses (default 30).
- While a web answer is in the last six chat turns, the assistant's own navigation, open-record, create and guide tools are switched off. Your **Create** press on a card still works.
- Text inside your records is treated as data. A note that says "delete this" is not an instruction.
- Under 900 px wide the panel is full screen.
- Business roles limit what it can read, as above.

Screenshot: platform-assistant-panel.png | / | The assistant open with the context line, suggestions and the AI usage pill.
Screenshot: platform-assistant-confirm-card.png | /accounts | A confirm card for a new account with required fields marked.
Screenshot: platform-assistant-guide.png | /contacts/new | Guide mode with a highlighted control and the numbered steps.
Screenshot: platform-briefing-tile.png | / | The My day block with Yesterday, Open and Focus rows.

---

## 5. Global search and the command palette

### What it is

Search finds a record by name or ID from any screen. In workspaces on the Nova experience, a command palette (Ctrl+K or ⌘K) also jumps to screens and starts new records.

### Where to find it

The search box in the top bar of every screen. On a phone it opens as an overlay. Press **Ctrl+K** (Windows) or **⌘K** (Mac) to focus it. On Nova workspaces the same keys open the palette instead.

### Who uses it and which module switches it on

Everyone. There is no module flag. What it finds follows your modules and your business roles. A scoped member never sees results for something their menu hides.

### How to use it

**Search**

1. Click the search box and type at least two characters. Results appear after a short pause.
2. Results are grouped by object. In "all objects" mode each group shows up to six results.
3. Use the object picker next to the box to search one object only. That shows up to twenty results.
4. Select a result to open it.

**Use the palette (Nova workspaces)**

1. Press Ctrl+K or ⌘K. The palette says "Jump to, create, or find anything…".
2. Type to see **Go to** (screens), **Create** (for example New Account, New Quotation, New Supplier, New Product) and **Records** matches. Use ↑↓ and Enter.
3. Type "prep me for my next call with Example Trading". The palette offers to open Account 360 for that account.
4. Paste a block of contact text. The palette offers "Draft an account from this text".

### What it finds

| Object | Matched on |
| --- | --- |
| Accounts, Contacts | Name or ID |
| Cases | ID or equipment label |
| Quotations | ID, reference number, PO number or name |
| Standard Quotes, Sales Orders, Invoices, Purchase Orders | ID (sales orders also the customer PO) |
| Work Orders, Assets, Inventory, Suppliers, Products | ID, name and the usual identifiers (serial, SKU) |
| Deals, Contract projects, Buy-out packages, RFQs, Estimates, ABM programs, Projects | Reference or title |
| Inbox | Sender and subject only, in channels you are on the team of |
| Leads, Employees | Title; name, code, department |

### Good to know

- Phone numbers and email addresses on accounts and contacts are encrypted, so search does not match them. Search the name or ID instead.
- Partners are not searchable. There is no partners object yet (see section 8).
- Employees found by search open the Workforce employee page for a supervisor, and the Employees list for anyone else.

Screenshot: platform-search-results.png | / | The search box with grouped results open.
Screenshot: platform-command-palette.png | / | The palette with Go to, Create and Records sections (Nova workspace).

---

# Part B. Master data

Master data is the set of records everything else points to. Create a record once and reuse it everywhere.

**Record IDs.** Every record gets a unique ID the moment it is created, shown as a short reference such as `ACC-0001`. Bulk update (section 15) always matches on the real record ID, never on a name.

**Adapt fields (administrators).** On each record page, the **⋯** menu has **Edit**, then **Adapt fields**. The drawer lets an administrator rename a field label, show or hide a field (locked fields cannot be hidden), add a custom field (Text, Number, Date, Dropdown, Yes / No, Long text, optionally required), and add rules that show, hide, require or make a field optional under a condition. The settings side of this is in Chapter 1.

**Lists.** Every master data list has the same controls: a search box, sortable columns, column filters, an **Advanced filter** panel with **Apply**, **Clear** and **Save query…** (saved queries reload from a dropdown), and paging.

## 6. Accounts, including Account 360

### What it is

An account is a company or organisation: a customer, a prospect, an OEM or an end customer. It is the hub: contacts, cases, assets, quotations and invoices all hang off it. **Account 360** is a side panel with a health rating and everything about one account in one view.

### Where to find it

**Master data > Accounts** (`/accounts`). New: **+ New Account** (`/accounts/new`). An account opens at `/accounts/<id>`.

### Who uses it and which module switches it on

Sales, service and management. Module: **Accounts** (`accounts`). Business role entry: **Accounts**. Account 360 shows only in workspaces on the Nova or Spectacular experience. **Analyse company** needs the AI assistant and web research.

### How to use it

**Create an account**

1. Select **+ New Account**.
2. Under **Identity** enter **Company name** (required) and **Account type** (required).
3. Fill in **Address**, **Communication** (Primary phone, Secondary phone, Primary email, Secondary email, Website) and **Business** (Industry, Employees, Annual revenue, GSTIN).
4. Under **Notes & Referral**, set **Referred by account ID** when an OEM referred an end customer.
5. Select the save button. The account opens with its ID.

**Find and filter**

1. On the list, use **Search accounts…** and the **All types** picker.
2. Open the **…** menu to turn on the optional **Phone** and **AMC** columns.
3. Use **Advanced filter** for conditions on any standard or custom field.

**Work from the account page**

1. The page opens on **Overview**. Other tabs appear for the modules you own: **Cases**, **Contacts**, **Assets**, **Quotations**, **Projects**, **Invoices**, **Estimates** and **Activity**. Each tab shows a count.
2. In the right-hand rail, **Quick create** starts a new case, contact, asset, quotation, invoice or project with this account already chosen.
3. Select **Edit** in the **⋯** menu to edit fields in place on the Overview tab.

**Open Account 360**

1. On the account page select **Account 360**. In the list, use the small icon next to a name.
2. Read the **rating** at the top: a score out of 100, a grade and the working behind it.
3. Read **What to do next**: suggested actions, most urgent first, each with a link.
4. Read the cards below. Each card is a summary with figures and rows that link to the records.
5. Cards from outside sources are tagged **Source**.

**Analyse the company**

1. Select **Analyse company** on the account page. The assistant opens, asks to search the web, and returns an analysis card.

### Fields and statuses

| Account type | Meaning |
| --- | --- |
| Prospect | Not yet a customer |
| Direct customer | Buys from you directly |
| OEM / Vendor | A dealer or OEM that refers business to you |
| End-customer (under OEM) | Reached through an OEM. Use **Referred by** |

Field sections: Identity, Address, Communication, Sales, Business, Saudi e-invoicing, Notes. The Saudi e-invoicing section (buyer type, VAT number, commercial registration, Arabic name, building and district) is for workspaces that use Saudi e-invoicing.

**Account 360 rating**

| Part | Points | What it looks at |
| --- | --- | --- |
| Recency | 25 | Days since anything happened on the account |
| Win rate | 25 | Decided quotations only. An account with none is neutral |
| Payment | 20 | Overdue invoices, the loudest bad signal |
| Service | 15 | Open cases, and cases that have aged |
| Relationship | 15 | How many contacts you have. One contact is fragile |

| Grade | Score | Label |
| --- | --- | --- |
| A | 80 to 100 | Healthy |
| B | 60 to 79 | Steady |
| C | 40 to 59 | Needs attention |
| D | below 40 | At risk |

**Account 360 cards:** Pipeline, Revenue, Service, People, Installed base, Contracts, Sales coverage (when Coverage is on), Projects, plus buying signals, company analysis and "Won work, nothing invoiced" when they apply. External sources are added in **Settings > Account 360** (Chapter 1).

### Links to other records

- **Contacts, Cases, Assets, Quotations, Invoices, Estimates, Projects**: the tabs above.
- **Referred by**: another account (an OEM).
- **ERP**: when an integration is on, an ERP ID line shows under the title.
- **Change history**: the Activity tab (administrators).

### Good to know

- The rating is not an AI call. It is a fixed rubric that shows its working, so it is the same on every reload. The AI may word suggestions but never changes the score.
- Phone, email and GSTIN are stored encrypted.
- Deleting an account is not offered on the account page (verify where an administrator deletes one).
- The new-account form calls the types "Direct Customer", "OEM / Dealer" and "End Customer". The list and pills say "Direct customer", "OEM / Vendor" and "End-customer (under OEM)". They are the same four values.
- Account 360 never exposes external-source credentials to non-administrators.

Screenshot: platform-accounts-list.png | /accounts | The Accounts list with type picker and counts.
Screenshot: platform-account-detail.png | /accounts/<id> | An account with tabs and the Quick create rail.
Screenshot: platform-account-360.png | /accounts/<id> | The Account 360 panel with rating, What to do next and cards.

---

## 7. Contacts

### What it is

A contact is a person at an account. Every contact belongs to exactly one account.

### Where to find it

**Master data > Contacts** (`/contacts`). New: **+ New Contact** (`/contacts/new`). A contact opens at `/contacts/<id>`.

### Who uses it and which module switches it on

Sales, service and marketing. Module: **Contacts** (`contacts`). Business role entry: **Contacts**. The **Marketing** tab needs Marketing with the Newsletter Studio (Email health) or Lead scoring (Consent).

### How to use it

**Add a contact**

1. Select **+ New Contact**. From an account page you can start with the account already chosen.
2. Under **Identity** enter **Full name** (required) and **Account** (required). Add Role / designation, Department, Birthday and LinkedIn URL.
3. Add up to three phone numbers, two emails and a website. Add the address and notes if you need them.
4. Select the save button.

**Find a contact**

1. Use **Search by name, role or account…**.
2. Turn on the optional **Email** and **Account type** columns from the **…** menu.

**Check email health (where switched on)**

1. Select **Email needs attention** on the list to see contacts whose address bounced or is in doubt. Columns show the status, since when, and the account owner.
2. On a contact, open the **Marketing** tab. On **Email health** select **Check address**, **Fix the address** or **Mark as checked** (with a reason).

**Record consent (where switched on)**

1. Open the **Marketing** tab. On the **Consent** card, select **Record consent** or **Record withdrawal**. Pick a topic, or "Any consent topic".
2. The card keeps a history.

### Fields and statuses

Sections: Identity, Phone numbers, Email & web, Address, Sales, Notes.

| Email health | Meaning |
| --- | --- |
| Not checked yet | Not sent to and not checked |
| Working | Mail was delivered, or it was checked and looks fine |
| Trouble delivering | A soft bounce. It may clear by itself |
| Bounced | The address does not exist. We will not email it again |

### Links to other records

- **Account**: required. Shown in the facts line.
- **Cases**: the Cases tab, with open cases counted.
- **Marketing**: consent, email health, newsletters and leads.

### Good to know

- A contact cannot exist without an account. In bulk import (section 15) the contact file must name an account that already exists.
- Phone and email are stored encrypted.
- There is no delete on the contact page (verify).
- Business roles hide the menu item. They do not change what consent allows.

Screenshot: platform-contacts-list.png | /contacts | The Contacts list with the Email needs attention chip.
Screenshot: platform-contact-marketing-tab.png | /contacts/<id>?tab=marketing | The Email health and Consent cards.

---

## 8. Partners

### What it is

A placeholder for OEM referral partners. In the current product it holds no records.

### Where to find it

**Master data > Partners** (`/partners`).

### Who uses it and which module switches it on

Module: **Partners** (`partners`). Business role entry: **Partners**.

### How to use it

There is nothing to do on this screen yet. The screen shows "Coming in a later slice". There is no partners list, form, API, import or export.

### Good to know

- To track an OEM or dealer today, create an **Account** of type **OEM / Vendor** and link its end customers with **Referred by**. That is how referral sources are recorded now.
- Partners are not in search, Change history or Data Workbench.

Screenshot: platform-partners-placeholder.png | /partners | The placeholder screen.

---

## 9. Suppliers and supplier groups

### What it is

A supplier is a company you buy from: a vendor, a subcontractor, or both. A **supplier group** is a client's approved supplier list. For that client's tenders and projects, only its members can be asked for a price.

### Where to find it

**Master data > Suppliers** (`/suppliers`). New: **+ New Supplier** (`/suppliers/new`). A supplier opens at `/suppliers/<id>`. Groups: the **Groups** chip on the list, or the **Groups** tab (`/suppliers/groups`).

### Who uses it and which module switches it on

Procurement and estimating. Module: **Suppliers** (`suppliers`). Business role entry: **Suppliers**. Groups also need the tender edition (`gcc_tender`). Without it the Groups address answers "not found".

### How to use it

**Add a supplier**

1. Select **+ New Supplier**.
2. Under **Supplier details** enter **Name** (required) and **Type** (required): Vendor, Subcontractor, or Both.
3. Add Phone, City, Email, GSTIN and Notes. Select the save button.

**Find a supplier**

1. Use **Search by name, city, email or GSTIN…** and the chips **All**, **Vendors**, **Subcontractors**, **Both** and **Inactive**.

**See what a supplier provides**

1. Open the supplier and its **Products** tab. It lists products that name this supplier as their preferred supplier, with SKU, UoM and list price.

**Create a supplier group (tender edition)**

1. Open **Suppliers**, select **Groups**, then **New group**.
2. Enter a **Name** (required). Choose the **Client** account it belongs to.
3. Under **Members** tick the suppliers on the client's approved list. **All** and **None** select a page at once. Search when the list is long.
4. Select **Save**. A row opens the same panel to edit. **Delete** asks for a second confirmation (**Delete group** or **Keep**).

### Fields and statuses

| Type | Pill |
| --- | --- |
| Vendor | Vendor |
| Subcontractor | Subcontractor |
| Both | Vendor & Sub |

Status: **Active** or **Inactive**. A group has a name, a client, and members; the list shows the member count.

### Links to other records

- **Products**: preferred supplier on a product.
- **Inventory**: preferred supplier on an item.
- **Purchase orders and RFQs**: suppliers are who you buy from and ask.
- **Accounts**: a group is tied to a client account.

### Good to know

- A client has one group. A client with none can be asked any supplier. A supplier can sit in several groups.
- Once a client has a group, an RFQ for that client's tender deal or contract project to a supplier outside the list is refused, with no override.
- The supplier form calls the tax number **GSTIN**.
- Suppliers have a delete in the **⋯** menu, with a few seconds to undo. Groups need a database update to be applied first, otherwise the screen says so.

Screenshot: platform-suppliers-list.png | /suppliers | The Suppliers list with type chips and the Groups chip.
Screenshot: platform-supplier-group-panel.png | /suppliers/groups | The group side panel with name, client and member ticks.

---

## 10. Products

### What it is

A product is something you sell or use: goods, services, or a bill-of-materials kit. The product record carries prices, tax, category and, for kits, the components and rolled-up cost.

### Where to find it

**Master data > Products** (`/products`). New: **+ New Product** (`/products/new`). A product opens at `/products/<id>`.

### Who uses it and which module switches it on

Sales and pricing owners. Module: **Products** (`products`). Business role entry: **Products**. The **Pricing** tab appears when any of these is on: Pricing (`pricing_engine`, shows **Cost sheet**), Standard Quotes (shows **Quantity breaks**), or Coverage (shows **Availability**).

### How to use it

**Add a product**

1. Select **+ New Product**.
2. Under **Product details** enter **Name** (required). Add SKU, Unit of measure, Category, Sub-category, Item type, Preferred supplier and Description.
3. Under **Pricing** enter **List price**, **Cost price** and **Tax %**.
4. Select the save button.

**Find a product**

1. Use **Search by name, SKU, category, supplier or description…** and the **All item types** picker (including **Not classified**).

**Build a kit with components**

1. Give the product the item type **BOM / kit**. Only that type can have components.
2. Open its **Components** tab and select **+ Add component**.
3. Search by name or SKU and pick the item. Enter **Quantity**, **Unit**, **Scrap %** and **Kind** (**Consumed**, or **Used (tool)** for a tool that adds no material cost). Add a note.
4. Select **Add to BOM**.
5. Read the **Cost roll-up**: **Rolled-up cost**, **Stored cost price** and the **Difference**. Select **Apply to product cost** to copy the roll-up into the cost price.

**Set a cost sheet or quantity breaks**

1. Open the **Pricing** tab. On **Cost sheet** select **Edit**, then **+ Add a cost line** and **Save**.
2. On **Quantity breaks** read the price list with its scales. It is replicated from your ERP or kept here, and quotes use it automatically.

### Fields and statuses

Sections: Identity, Pricing, Details. Status: **Active** or **Inactive**. The record also shows Margin, worked out from list and cost price.

| Item type (default list) | Description |
| --- | --- |
| Finished product | Made by you and sold as it is |
| Semi-finished | A part you make and use inside something else |
| Raw material | Bought in bulk and consumed |
| Bought-out component | A ready-made part bought from a supplier |
| Consumable | Used up along the way |
| Custom / made to order | Built for one order, never held in stock |
| Service | Labour, installation, a service plan |
| Tool / equipment | Used to do the work, not consumed |
| Certification / document | A certificate or drawing that goes with an order |
| BOM / kit | Made up of other items, with cost rolled up |

A workspace can rename, hide or add types in **Settings > Products** (Chapter 1).

### Links to other records

- **Supplier**: the preferred supplier.
- **Quotations, Standard Quotes, Sales Orders**: lines copy a product's details. Existing lines keep their copy if the product is later deleted.
- **Used in**: the tab lists the kits that use this product as a component.
- **Pricing engine**: the cost sheet and quantity breaks feed price lookup.

### Good to know

- **Cost price is internal.** It is shown to staff in the app and in Data Workbench. It never appears in Talk to data, the assistant, the REST API or MCP. The preferred supplier is internal in the same way.
- The roll-up does not update the cost price by itself. You must select **Apply to product cost**. **Apply anyway** appears only when the roll-up is incomplete.
- A product that is a component of a kit cannot be deleted until it is removed from that kit. The error names the kits.
- BOM components can be bulk loaded with Data Workbench (**BOM components**).
- The product page has a delete in the **⋯** menu with a few seconds to undo.

Screenshot: platform-products-list.png | /products | The Products list with item type picker.
Screenshot: platform-product-components.png | /products/<id>?tab=components | A kit with its components and the Cost roll-up card.
Screenshot: platform-product-pricing-tab.png | /products/<id>?tab=pricing | The Cost sheet and Quantity breaks cards.

---

## 11. Inventory

### What it is

Inventory holds stocked items (parts and spares) with quantity on hand, a reorder level and a movement history.

### Where to find it

**Master data > Inventory** (`/inventory`). New: **+ New** from the list (`/inventory/new`). An item opens at `/inventory/<id>`.

### Who uses it and which module switches it on

Store keepers and buyers. Module: **Purchasing** (`purchasing`), which also switches on Purchase Orders. Business role entry: **Inventory**.

### How to use it

**Add an item**

1. Select the new-item button.
2. Under **Item details** enter **Name** (required). Add SKU, Description, Category, UOM and Preferred supplier.
3. Enter **Reorder level** and **Unit cost**. Add notes. Select the save button.

**Spot low stock**

1. On the list, a quantity at or below the reorder level shows a red **Low** pill. The **Low stock** chip filters to those items.

**Adjust stock**

1. Open the item and select **Adjust stock** (or the **Stock** tab).
2. Enter **Qty change** (use a negative number to reduce stock, a positive number to add stock not tied to a purchase order). Add a **Reason (optional)**.
3. Select **Apply**. The change shows in **Recent stock movements**.

### Fields and statuses

Sections: Identity, Stock, Notes. Status **Active** or **Inactive**. Movements are labelled **Received (PO)** or **Manual adjustment**.

### Links to other records

- **Supplier**: the preferred supplier.
- **Purchase orders**: receiving a purchase order adds stock and writes a "Received (PO)" movement.
- **Quotation lines**: a line can point at an inventory item.

### Good to know

- An item referenced by a purchase order line or a quote line cannot be deleted. The product says so.
- The adjustment must be a non-zero number.
- Inventory is separate from Products. Products is what you sell. Inventory is what you hold.

Screenshot: platform-inventory-list.png | /inventory | The list with Low stock chip and red Low pills.
Screenshot: platform-inventory-stock-tab.png | /inventory/<id>?tab=stock | Adjust stock and Recent stock movements.

---

## 12. Assets

### What it is

An asset is a piece of equipment: a customer's motor, transformer, pump, generator or panel, or one of your own loaner units. Chapter 3 (Service) covers assets in full, including loaner units and service history. This section covers the master data side.

### Where to find it

**Master data > Assets** (`/assets`). New: **+ New Asset** (`/assets/new`). An asset opens at `/assets/<id>`.

### Who uses it and which module switches it on

Service coordinators and quotation writers. Module: **Assets** (`assets`). Business role entry: **Assets**.

### How to use it

1. Select **+ New Asset**. Enter **Asset name** and **Kind** (required). Add Make / brand, Model, Serial number and Rating / specs.
2. Under **Ownership** choose the **Customer account**, or leave it blank and tick **This is a loaner unit**.
3. Find assets with **Search name, make, model, serial or account…** and the **All types** picker (including **Loaner stock**).

### Fields and statuses

Kinds: Motor, Transformer, Pump, Generator, Panel / Switchgear. Sections: Identity, Specifications, Nameplate, Notes.

### Links to other records

Account (owner), Cases (service history), Quotations (attached equipment), Work orders.

### Good to know

- Assets have no status workflow.
- There is no delete on the asset page (verify).
- See Chapter 3 for loaners and history.

Screenshot: platform-assets-list.png | /assets | The Assets list with the Loaner stock card.

---

## 13. Employees

### What it is

Employees are your people as master data: name, code, contact, department, designation and validity dates. This list is separate from a person's login. An employee can be given a login in **Settings > People**.

### Where to find it

**Master data > Employees** (`/employees`).

### Who uses it and which module switches it on

HR and administrators. Module: **Business roles** (`business_roles`), the bundle that ships Employees with business roles and business users. Business role entry: **Employees**. Only administrators can create, edit or delete. Other people with the menu item see the list read-only.

### How to use it

**Add an employee**

1. Select **+ New Employee**.
2. Enter **First name** (required). Add Last name, Employee code, Email, Phone, Department, Designation, **Valid from** and **Valid to**.
3. Set **Status** to **Active** or **Obsolete**. Select the save button.

**Make an employee obsolete**

1. On the row, select **Delete**. The dialog first checks what is recorded for the person.
2. If records exist, it lists them and offers **Make obsolete** instead. The person stays in reports up to their Valid to date.
3. If nothing is recorded, it offers **Delete**.

**Bring someone back**

1. On an obsolete row, select **Make active**. Confirm. A note warns if the old valid-to date was in the past.

**Load many at once**

1. Use **Data Workbench > Import > Employees** with an HR export (section 15).

### Fields and statuses

| Status | Meaning |
| --- | --- |
| Active | Counts in reports |
| Obsolete | Counts for every day up to and including Valid to, and for no day after |

Sections: Identity, Contact, Employment, Custom fields.

### Links to other records

- **Workforce**: attendance, roster, leave and time summary read the employee list.
- **Login**: **Settings > People** gives an employee a login.
- **Search**: found by name, code, department.

### Good to know

- Delete is blocked once attendance records exist, because deleting would erase those records for good. Make the person obsolete instead.
- An obsolete employee with no Valid to date is excluded from reports.
- The module flag for this screen is `business_roles`, not the Workforce flag (verify that this is intended for workspaces with Workforce only).

Screenshot: platform-employees-list.png | /employees | The Employees list with status pills and row actions.
Screenshot: platform-employee-delete-dialog.png | /employees | The Delete dialog listing records and the Make obsolete button.

---

# Part C. Pricing, data tools and audit

## 14. Pricing

### What it is

Pricing is the pricing engine: you choose how you price, set your numbers, check a sample bill, and go live. Quote lines can then fetch a price from it. It is a separate product module.

### Where to find it

**Insights > Pricing** (`/pricing`, which opens **Today's rates** at `/pricing/today`). Five tabs sit across the top.

| Tab | Address | What it is for |
| --- | --- | --- |
| Today's rates | `/pricing/today` | What is live right now, in plain language |
| Pricing setup | `/pricing/setup` | Pick a method, set numbers, see a sample bill |
| History | `/pricing/history` | Every version that has gone live, and what was live on any date |
| RFQs | `/pricing/rfqs` | Where the engine found no cost and asked a supplier. Enter the reply here |
| Advanced | `/pricing/advanced` | Raw versioned configuration, for when the wizard is not enough |

### Who uses it and which module switches it on

Pricing managers. Module: **Pricing** (`pricing_engine`). Business role entry: **Pricing**. Only people with edit rights on Pricing can change anything. A quote line pulling a live price needs a second, separate switch (`pricing_engine_quotes`).

### How to use it

**Set up pricing for the first time**

1. Open **Pricing setup**. Pick a method (below).
2. Set your numbers: rates, margins, discounts, tax. Rates can depend on customer tier, region or document type.
3. Select **Continue to sample bill** and check the sample.
4. Select **Go live** in the amber bar at the top.

**Change a number later**

1. Edit on **Pricing setup**. An amber bar says "You have unsaved pricing changes". That is a draft.
2. Select **Go live** to publish it, or **Discard** to drop it (this cannot be undone).

**Run a second Price Book**

1. Select **+ New price book** (top right) and name it, for example "Service parts".
2. Use the Price Book picker to switch between books. Each book holds one pricing method.

**Answer a supplier request**

1. Open the **RFQs** tab. Enter the supplier's reply. The next **Fetch price** uses it.

### The four methods

| Method | Idea |
| --- | --- |
| Cost-based | Start from what it costs you, then mark up, by segment, not one number for everyone |
| Price list | One list price per customer group, most specific wins |
| Value-based | Adjust from a base value by what the customer values |
| Catalog + Formula | A negotiated rate where you have one, a cost formula everywhere else |

**Cost-based** setup also has:

- **Your cost rates**: what one unit of each input costs today.
- **Where a cost comes from**: a ladder tried in order. A figure older than its limit is skipped, never used.

| Rung | Source | Fresh for |
| --- | --- | --- |
| 1 | ERP cost price on the product | 30 days |
| 2 | Supplier RFQ reply | 180 days |
| 3 | Imported cost price list | 365 days |
| 4 | Rate kept by hand in the cost model | no limit |

- **When a quote falls below the minimum margin**: **Warn the rep, let the quote go out**, or **Block sending until it is re-priced or approved**.

### Fields and statuses

A pricing version is **DRAFT**, **PUBLISHED** or **SUPERSEDED**. The Price Book picker marks a book "(draft)" or "(empty)" until it has a published version.

### Links to other records

- **Products**: cost price, cost sheet and quantity breaks.
- **Standard Quotes**: lines can fetch a price from the live book.
- **RFQs**: a missing cost raises a supplier request.
- **Change history**: **Pricing: Versions** and **Pricing: RFQs**.

### Good to know

- Going live is always a deliberate step. Nothing changes for quotes until you select **Go live**.
- Small Scale Pricing in **Settings** is a separate, simpler rate list and is unchanged by this module.
- If your live pricing was set up in an older way the screen cannot read, Today's rates says so (verify what it offers).

Screenshot: platform-pricing-today.png | /pricing/today | Today's rates with the tab strip and Price Book picker.
Screenshot: platform-pricing-setup.png | /pricing/setup | The setup wizard with cost rates and the cost ladder.
Screenshot: platform-pricing-draft-bar.png | /pricing/setup | The amber "unsaved pricing changes" bar with Discard and Go live.

---

## 15. Data Workbench

### What it is

Data Workbench loads, extracts and corrects records in bulk from spreadsheets. It has three modes: **Import** (create new records), **Export** (download records) and **Update** (change existing records).

### Where to find it

**Admin > Data Workbench** (`/data-workbench`). You choose the **object** first, then the **mode**. The mode is a tab under the object's name. The object and the mode are both kept in the address, so a reload or a shared link opens the same place: `/data-workbench?tab=import&object=accounts`. With no object in the address you land on the start screen.

### Who uses it and which module switches it on

Administrators and data owners. Module: **Data Workbench** (`data_workbench`). Business role entry: **Data Workbench**. Each object also needs its own module. A workspace without Cases never sees Cases here, and the routes behind enforce the same.

### How to use it

**Start screen and finding an object**

1. With no object chosen, the screen asks **What do you want to do?** and offers three tiles: **Bring data in**, **Take data out** and **Fix data in bulk**. A tile sets the mode and sends you to the object list. **Recent** lists the objects you used last (five at most, kept per person in this browser).
2. The object list is a picker. **Find an object** is a search box: type part of a name, such as `accounts` or `boq`, and the list narrows. Press `/` anywhere on the page to jump to it. `Up` and `Down` move, `Enter` opens an object and `Esc` clears the search.
3. Objects are grouped: **Master data**, **Sales**, **Service**, **Marketing**, **Workforce** and **People**. Select a group to open it. The number is how many objects it holds. Lines sit under their parent: for example BOM components under Products and Tender BOQ lines under Deals (pipeline). In a small workspace every group is open. In a larger one only the group holding your object is open.
4. Only the objects your workspace has switched on are listed. If you search for one you do not have, the picker says so, for example "Cases is not switched on in this workspace", and lists nothing.
5. On a phone the object list is not shown above the page. Select **Choose an object** or the **Change** chip in the header and it opens as a sheet.
6. The header shows the object's name, its group and an "i" that says what it is for. Under it are three tabs, **Import**, **Export** and **Update**. A tab the object does not support is grey, and its "i" says why. Short chips beside the steps show what must be true first, for example **Needs Accounts first**, **Needs a file from Export** and **Required:** with the columns.

**Import new records**

1. Choose the object (for example **Accounts**), then the **Import** tab.
2. Select **Download Accounts template**. It carries every column, with example rows. It always matches your current field setup, including custom fields.
3. Replace the examples with your data. Save as `.csv`, `.xlsx` or `.xlsm`.
4. Drop the file on the dashed box, or click it to browse (up to 15 MB). Your own column names are fine.
5. On **Match columns**, point each column at a field.
6. On **Review**, read "N ready" and "N with problems". Rows with problems are left out. Select **Show only problems** and **Download** the problem list if needed.
7. Select **Import N rows**. The **Result** step shows what was imported and what failed, with a report to download.

**Export records**

1. Pick an object and choose the **Export** tab. From the start screen, **Take data out** does the same.
2. Under **Choose columns** tick the columns. **Record ID** is always included. **Clear all** unticks every column so you can tick just the few you want, and **Select all** ticks them all again. Each is grey when it would change nothing.
3. Under **Filters** select **+ Add filter** to export only matching rows.
4. Select **Download … CSV**.

**Update existing records**

1. First **Export** the records you want to change. Keep the **Record ID** column.
2. Edit the values in the file. Do not edit the Record ID.
3. Pick the object and choose the **Update** tab. The chip **Needs a file from Export** reminds you that rows are matched by Record ID. Upload the exported file.
4. Match columns, review ("Rows with problems are left out"), and select **Update N rows**.

### What each object supports

| Object | Import | Export | Update | Notes |
| --- | --- | --- | --- | --- |
| Accounts | Yes | Yes | Yes | Import first. Others link to it by name |
| Contacts | Yes | Yes | Yes | Needs an existing account by name |
| Assets | Yes | Yes | Yes | Blank account makes loaner stock |
| Suppliers | Yes | Yes | Yes | |
| Products | Yes | Yes | Yes | Includes quantity breaks |
| BOM components | Yes | Yes | Yes | Needs the kit product |
| Inventory | Yes | Yes | Yes | |
| Employees | Yes | Yes | Yes | Includes custom fields |
| Users | Yes | Yes | No | Invites by email. Never updated in bulk |
| Consents | Yes | Yes | No | An append-only ledger. A change is a new answer. Needs Marketing |
| Quotes | Yes | Yes | Yes | One row per line, header values repeated. Import creates the quote with its lines in one file |
| Quote lines | Yes | Yes | Yes | Only adds lines to an existing quote |
| Standard quotes | Yes | Yes | Yes | Header only. Add lines with Standard quote lines |
| Standard quote lines, Sales order lines | Yes | Yes | Yes | Only for existing draft documents, found by their ID |
| Sales orders | Yes | Yes | Yes | Header only |
| Cases, Work orders, Invoices, Purchase orders | Yes | Yes | Yes | |
| Deals (pipeline) | Yes | Yes | Yes | Amount and probability are computed |
| Tender BOQ lines | Yes | Yes | Yes | Sits under Deals (pipeline). Adds or revises lines of an existing tender by item number and never removes a line. Cost and markup are never in a file. The **WBS code** column is on Export and Update only |
| Tender WBS items | Yes | Yes | Yes | Sits under Deals (pipeline). Adds items to an existing tender's WBS, found by code; Update changes name, code, parent, owner and note by Record ID. No cost is ever in a file |
| RFQs | No | Yes | Yes | An RFQ is raised from a record, with its lines and suppliers |
| Estimates | Yes | Yes | Yes | Header only. Import makes a draft from a template name |
| ABM programs, ABM target accounts, ABM buying groups | Yes | Yes | Yes | Needs ABM |
| Projects (workforce) | Yes | Yes | Yes | Import parents before children |

The picker lists only the objects your workspace owns. An object that cannot be used in a mode keeps its place and shows that mode as a grey tab with the reason, instead of disappearing.

**Work with a tender's WBS in bulk**

These objects need the tender module. Both sit under Deals (pipeline) in the **Sales** group.

1. **Tender WBS items, Import.** Type `wbs` in **Find an object** and choose **Tender WBS items**. **Required** reads **Tender, Name**. **Tender** is the Deal ID (for example `OPP-0044`) or the tender number. **WBS code** is optional: empty gets the next number, and a code already on the tender is skipped, so loading the same file twice adds nothing. **Parent code** says where the item sits, and the parent may be a row further down the file. **Owner (email)** must belong to an active employee. One file can hold several tenders. Items go up to three levels deep.
2. **Tender WBS items, Export.** One row for each item of every tender: **Record ID**, **Tender**, **WBS code**, **Name**, **Parent code**, **Owner (email)**, **Note**, and three columns that are only for reading, **Lines**, **Shared lines** and **Client amount**, rolled up from the sub-items. A WBS item has no price of its own, so no cost is in the file.
3. **Tender WBS items, Update.** Rows are matched by **Record ID**. **Required** reads **Record ID, Name**. It changes name, code, parent, owner and note. A value that says what the item already has is "No change". An empty **Parent code** moves the item to the top level, an empty **Owner (email)** clears the owner, and an empty **WBS code** is left alone.
4. **Tender BOQ lines, WBS code.** Which lines sit in which item is set on the lines. The **WBS code** column holds the item code for a whole line, a list such as `2.1:60;2.2:15;2.3:25` (code, a colon, the percent) for a split line, and nothing for a line in no item. It is on Export and Update only: Import never reads it, so a revised BOQ file does not regroup lines.
5. On **Update**, upload an export, match the column to **WBS code** and review. A code or a list puts the line in that item or splits it, and an empty cell makes the line Unassigned. The code is looked up on the line's own tender. A row fails with a reason when the code does not exist, when the shares do not add up to 100 %, or when the item has sub-items, because lines go in bottom-level items. A cell that already matches is "No change". The moves go through the same checks as the screen and are recorded in the change history. If a row's other columns were updated but its WBS code failed, the reason says so.

### Fields and statuses

| Step | Name on screen |
| --- | --- |
| 1 | Upload |
| 2 | Match columns |
| 3 | Review |
| 4 | Result |

### Links to other records

- **Change history**: every row updated in bulk writes a Change history entry.
- **Import order**: a chip on the object, such as **Needs Accounts first**, names the objects that must already exist, for example contacts need accounts.
- **Custom fields**: template columns include your custom fields.

### Good to know

- **Create does not use a record ID.** A new record has none yet. Import links records by a business key you type: an account name, a program ID such as `ABM-0001`, a template name.
- **Update always needs the Record ID** from an earlier Export. A file with names or references only is refused. Do not type IDs by hand.
- Update only changes plain fields. Fields that link to other records are not updated in bulk.
- A row whose ID does not exist in your workspace fails cleanly and is never turned into a new record.
- Quotes can also be created from a PDF or Word document: the product reads the document, you review the rows, then import.
- Cost price is in the Products export and import, but never in the API.
- Cells that start with `=`, `+`, `-` or `@` are protected in downloaded CSVs.
- Legacy `.xls` files are not supported. Save them as `.xlsx` or `.csv`.

Screenshot: platform-dw-import.png | /data-workbench?tab=import | The Import mode with the template download and upload box.
Screenshot: platform-dw-review.png | /data-workbench?tab=import | The Review step with ready and problem rows.
Screenshot: platform-dw-export.png | /data-workbench?tab=export | Choose columns and Filters, with Record ID always included.
Screenshot: platform-dw-update.png | /data-workbench?tab=update | The Update mode asking for an exported file.

---

## 16. Change history and Audit

### What it is

**Audit & Users** is the home for audit tools. **Change History** records every create, update and delete at the moment it happened: who, when and what changed. **Outbound Emails** records every email the product tried to send.

### Where to find it

**Admin > Audit & Users** (`/administration`). Cards: **Change History** (`/administration/change-history`), **Outbound Emails** (`/administration/outbound-emails`) and **People**, which opens **Settings > People**. A single record also has an **Activity** tab.

### Who uses it and which module switches it on

Administrators only. The pages send other people back to the Dashboard. Modules: **Administration** (`administration`) for the hub, **Change history** (`change_history`) and **Outbound email** (`outbound_email`) for the two cards. Business role entry: **Audit & Users**.

### How to use it

**Look up changes to an object**

1. Open **Change History**.
2. Pick an object in the object picker (for example **Accounts**, **Products**, **Sales Orders**).
3. Leave **Record ID (optional)** blank for all records, or paste one record's ID.
4. Select the search button. Rows list **When**, **Action**, **Record** and **By**. Select a row to see the field-by-field changes.
5. Select **↓ Download CSV** for a file with date, action, object, ID, record, changed by, via and the changes.

**See one record's history**

1. Open the record and its **Activity** tab. Administrators see the history there.

**Check an email**

1. Open **Outbound Emails**. Pick a channel (**Quote emails**, **Invoice emails**, **Sales order emails**, **Supplier RFQs**, **Inbox replies**, **Campaign sends**, **Workforce alerts**, **Password resets**) and optionally a record ID.
2. Rows show recipient, subject and whether it succeeded. Select **↓ Download CSV** to export.

### Fields and statuses

| Action | Meaning |
| --- | --- |
| create | A record was made |
| update | One or more fields changed |
| delete | A record was removed |
| reopen | A record was reopened |

A change made by the assistant or an integration carries a "via" note, for example "via assistant".

### Links to other records

Every object on the list, from accounts to pricing versions, writes here. Some entries are shown only when the matching module is on: for example Newsletters, Leads, Forms, ABM, Journeys, Webhooks, Integration mappings, Deals: Tender details, Contract projects and Inbox.

### Good to know

- A search returns up to 5,000 rows.
- Only changes made after the feature was switched on are listed.
- Records made by Data Workbench bulk update are logged row by row.
- Change history cannot be edited.

Screenshot: platform-audit-hub.png | /administration | The Audit and Access cards.
Screenshot: platform-change-history.png | /administration/change-history | Results for Accounts with the action pills and the Download CSV button.

---

## 17. Process Design Studio

### What it is

The Process Design Studio helps a business describe how it works and see how BPMSquare fits. It ends with a cited fit report, proposed changes, a project plan to validate, and a request to talk to BPMSquare. It is guided: tell us, check the map, check the fit, see what we would change, validate the plan, send.

### Where to find it

**Workspace > Process Design Studio** (`/process-studio`). New: **+ Study** (`/process-studio/new`). A study opens at `/process-studio/<id>`.

### Who uses it and which module switches it on

Prospects trying the product, new clients during onboarding, and administrators starting a study for a new area. Module: **Process Design Studio** (`process_studio`). Business role entry: **Process Design Studio**. It is a sold module. It also uses the workspace's monthly AI allowance.

### How to use it

**Start a study**

1. Select **+ Study**. Give it a **Name** (your company, or the part of it you want to look at). It takes about twenty minutes.
2. Step 1 opens.

**The six steps**

| Step | What you do | Main button |
| --- | --- | --- |
| Tell us | Describe your business in your own words. Answer the area cards if you want (Sales, Service & repairs, Production & delivery, Procurement, Workforce, Pricing & estimating, Marketing, Finance). Pick a language | Build my process map |
| Your process | Edit the map. Rename, add, reorder or remove steps, change the role, add a role | Check the fit |
| How BPMSquare fits | Read the rating per step, with what covers it, named | See what we'd change |
| What we'd change | Keep or drop each proposed change, or add your own | Build my plan |
| Your plan | Set the start date and weekend. Edit tasks, owners and days. Tick or comment per phase. **Save** | Send to BPMSquare |
| Talk to us | Enter your name and an email for the call-back. **Download PDF** | Send to BPMSquare |

1. Use **Show me how** on any step for a short walkthrough.
2. Use the **Build … again** or **Check again** buttons to redo a step after you change the inputs.
3. After sending, **Send a new version** lets you send an updated study.

### Fields and statuses

| Study status | Meaning |
| --- | --- |
| Telling us | You are describing the business |
| Mapped | The process map is built |
| Fit ready | The fit report exists |
| Changes ready | Proposed changes exist |
| Plan ready | The plan exists |
| Sent to BPMSquare | Submitted |
| Reviewed by BPMSquare | The BPMSquare team has looked |
| Accepted | Agreed |
| Re-scoped | Scope changed after review |
| Closed | Finished |

| Fit rating | Meaning |
| --- | --- |
| Standard | Covered as it ships |
| Needs setup | Covered once an administrator sets it up |
| Partly covered | Some of it is covered |
| Not covered | Not covered |
| Needs review / Coming | To be checked by the BPMSquare team, or planned |

| Kind of change | Meaning |
| --- | --- |
| Setting | A choice an admin makes in Settings |
| Your own fields | Extra fields on an object |
| Built for you | A tenant-specific extension |
| New build | A standard feature that does not exist yet |
| Integration | A connector, API or webhook |

Plan phases, in order: Foundations, Master data, Sales and estimating, Service and production, Workforce, Customisations, Integrations, Go-live and training.

### Links to other records

- **Settings**: many proposed changes are Settings entries named in the report.
- **Change history**: studies are logged as **Process studies**.
- **Provisioning**: an accepted plan hands over to workspace set-up.

### Good to know

- The list shows each study's ID, status, version (v1, v2…), the step reached and the date.
- On the shared demo workspace a study is private to the person who made it. On a client workspace, every administrator sees every study.
- Each fit claim is cited against what the product really has. The report is labelled a draft until the BPMSquare team marks it reviewed.
- A study has a cap on the number of messages you can send. When it is reached, press **Build my process map** to carry on with what you have said.
- The map, the changes and the plan are yours to edit. The AI only drafts them.

Screenshot: platform-studio-list.png | /process-studio | The studies list with status chips.
Screenshot: platform-studio-fit.png | /process-studio/<id> | The How BPMSquare fits step with rating pills.
Screenshot: platform-studio-plan.png | /process-studio/<id> | The Your plan step with phases, tasks and owners.

---

## Common questions

**1. I switched to Curated and my layout disappeared. Is it lost?**
No. Curated is a fixed set of blocks that ignores every saved layout. Select **My layout** in the switch and your arrangement is back.

**2. Why can I not see Talk to data, Pricing or the Process Design Studio?**
Each is a separate module that the BPMSquare team switches on. If the menu item or tab is missing, the module is off for your workspace, or your business role hides it. Ask your BPMSquare contact. Your own administrator cannot switch modules on.

**3. Why does Update say it needs a Record ID?**
Update changes existing records, and it finds them by their real record ID, never by a name or reference. A name can repeat or change. The ID cannot. Export the records first, edit the file and keep the **Record ID** column.

**4. I search for a customer's phone number and nothing is found.**
Phone numbers and email addresses on accounts and contacts are stored encrypted, so they cannot be searched. Search by name or ID.

**5. Why can the assistant not create a case or a product?**
Today it can propose only accounts and contacts, and only in workspaces where the BPMSquare team switched that on. Everything else is made on its own screen. It also cannot change or delete a record.

**6. Why can I not delete an employee?**
Deleting would erase their attendance and other records and remove them from every report. When records exist the product blocks delete and offers **Make obsolete**. The employee stays in reports up to their Valid to date.

**7. Where can I see who changed a record?**
An administrator opens the record's **Activity** tab, or **Admin > Audit & Users > Change History**, picks the object and optionally pastes the record ID. Changes made by the assistant are marked "via assistant".

**8. Does the cost price I enter on a product reach the API or the AI?**
No. Cost price and preferred supplier are internal. They are available to staff in the app and in Data Workbench, and are never sent to Talk to data, the assistant, the REST API or MCP.
