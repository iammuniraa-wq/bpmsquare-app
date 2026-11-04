# Setting up your workspace

Snapshot 4 Nov 2026.

> Screen names and button words may be refined as the product improves. If a word on your screen differs slightly, look for the same idea nearby. Items marked "(verify)" were read from the code but not checked on a live screen.

This guide is for an implementation consultant or a workspace admin who has to set up a workspace and be sure nothing was missed. It is also the one place where every setting of the product is explained. The Sales, Service, Marketing and Workforce chapters do not repeat settings. They point here.

## How the three tiers work

Every setting in the product is in exactly one of three tiers. Work through the tiers in order.

| Tier | What it means | What to do |
|---|---|---|
| **Part A. Must have** | Without it the workspace will not work: a screen or an action is blocked, or the shipped default is for India and will put wrong figures on records from day one. | Do every A setting that belongs to your modules, before anyone uses the product. |
| **Part B. Nice to have** | The product works without it, on a shipped default. It is noticeably better with it. | Do these as time allows. Each one says what you lose if you skip it. |
| **Part C. Optional** | Integrations, connectors, webhooks, API keys, email output, and anything only some clients need. Read-only logs are here too. | Do these only when the client asks for them. |

How to use the guide:

1. Find your modules in the master checklist below. The **Module** column says who a setting is for. **Core** means every workspace.
2. Do every **A** row for Core and for each of your modules. A workspace that bought only Tenders, or only Workforce, reads only its own A rows.
3. Then work through B and C in the order of "Setup order" at the end. That one numbered run merges all three tiers.
4. Tick each row when its **How to confirm it is done** is true.

Every setting has the same parts: what it controls, where to find it, who can change it, why it is needed (or what you lose if you skip it), how to set it up, the options with their defaults, what it affects elsewhere, a "Check it worked" line, and the screenshot to capture. A setting appears once, in its tier. Where a setting ships with a working default, it says "ships with a default".

## Who does what

| Who | What they are | What they can do |
|---|---|---|
| Platform admin | A member of the BPMSquare team. Not part of your company. | Creates the workspace, switches modules on and off, sets the domain, and invites the first workspace admin. Can enter any workspace for support. |
| Workspace admin | A person in your company with the role **Admin** in Settings > People. | Reaches every Settings page of the modules you have, plus everything in the product. Business Roles do not limit an admin. |
| Member | A person in your company with the role **Member**. | Works in the product. What they see depends on their Business Roles. Members do not use the Settings pages, except where noted below. |

## How the Settings menu works

Open **Settings** from the sidebar. On a computer, the menu is on the left and the page is on the right. On a phone, the menu is the page.

- The menu is grouped. The groups, in order: **Company**, **Users & access**, **Sales**, **Marketing**, **Service**, **Workforce**, **Data**, **Integrations**, **Appearance**. A group with nothing in it for you is not shown.
- The **Search settings** box at the top finds a page by its name, its description or a keyword. For example "rupee", "logo" or "numbering".
- An entry shows only if the module behind it is on for your workspace. Each setting below names the module it needs.
- Nearly every page is admin only. Most pages edit one draft and have one **Save** button (shown at the top). A line next to it says "Unsaved changes" until you save. Leaving with unsaved changes asks first. Lists that open a side panel (such as Templates, Shifts, Sites, Leave types, Pricing rates and Webhooks) save from the panel instead.
- Explanations are behind a small **i** next to a label. Press or tap it.
- Several Settings pages hold more than one setting, one per tab. This guide splits them by tab, so one page can appear in more than one tier. Each entry says which tab.
- The Service group exists in the menu code but has no pages in it today (see "Service" in Part A).

Who sees what in the menu:

- An **admin** sees every entry the modules allow.
- A **member with a Business Role** gets into Settings only if one of their roles grants Edit on something. The menu then shows just the entries tied to that area. Order types, RFQ, Estimate templates, Workforce and Products are tied to areas this way.
- A **member with no Business Role** is treated as unrestricted, so those entries can show too. In the current code, the page itself still sends a non-admin back to the Settings home (verify).

## Master checklist

One row per setting. **Tier** is A (must have), B (nice to have) or C (optional). The ids (A1, B4, C2 ...) are the headings used below.

| Id | Setting | Module it is for | Tier | Where | How to confirm it is done |
|---|---|---|---|---|---|
| A1 | Workspace, modules and domain | Core (platform admin) | A | Admin > Tenants; hosting and DNS | Address opens over https; sidebar shows only the modules bought |
| A2 | First admin and first sign-in | Core | A | Admin > Tenants > the workspace > Users | First sign-in forces a new password; no alias left after hand-over |
| A3 | People (the logins) | Core | A | Settings > Users & access > People | Each person is Active in the list; employees show a login chip |
| A4 | Tax and currency | Core | A | Settings > Company > Company > Tax and currency | A quote or invoice preview shows your currency, tax label and rate |
| A5 | Timezone and weekly off days | Workforce | A | Settings > Workforce > Workforce > Rules | Time Summary judges lateness in local time; weekly off day not absent |
| A6 | Shifts | Workforce | A | Settings > Workforce > Workforce > Shifts | Shift is Active; employee's My Workforce shows it |
| A7 | Sites and their supervisors | Workforce | A | Settings > Workforce > Workforce > Places | No "has no supervisor" line on the Places tab |
| A8 | Leave types | Workforce | A | Settings > Workforce > Workforce > Leave | Leave request form lists the type |
| A9 | Holidays | Workforce | A | Workforce > Leave & Holidays > Holidays | Holiday is in the list and not counted absent on the Time Summary |
| A10 | Employee assignments | Workforce | A | Workforce > Workforce employees | WFM role, Shift, Home site and Supervisor filled for every person |
| A11 | Tender approvers | Tenders (GCC tender deals) | A | Settings > Sales > Tenders | A test bid proposal is approved by an approver |
| A12 | Estimate templates | Project Estimator | A | Settings > Sales > Estimate templates | New estimate shows a template card |
| A13 | First inbox channel | Shared Inbox | A | Settings > Integrations > Inbox channels | Channel address copied; test mail appears in the Inbox |
| A14 | Saudi e-invoicing seller details | Saudi e-invoicing | A | Settings > Company > Company > Entities | A draft invoice says Ready and can be sent |
| B1 | Company profile and letterhead | Core | B | Settings > Company > Company > Profile | Print preview shows logo and letterhead |
| B2 | Legal entities | Core (Quotations, Invoices) | B | Settings > Company > Company > Entities | New Quotation offers the entity |
| B3 | Quotation numbering | Sales (Quotations) | B | Settings > Company > Company > Numbering | "Next quotation" shows your format |
| B4 | Business Roles | Core (Business Roles) | B | Settings > Users & access > People > Roles | A test Member sees only the role's areas |
| B5 | Quotation statuses | Sales (Quotations) | B | Settings > Sales > Quotations > Statuses | New quote starts at your starting status |
| B6 | Offer types | Sales (Quotations) | B | Settings > Sales > Quotations > Offer types | New Quotation picker lists the types switched on |
| B7 | Quotation templates | Sales (Quotations) | B | Settings > Sales > Quotations > Templates | Sending a quote email uses your default |
| B8 | Quote print fields | Sales (Assets) | B | Settings > Sales > Quotations > Print | Printed quote shows the ticked fields |
| B9 | Order types | Sales (Sales Orders) | B | Settings > Sales > Order types | New order offers your types and numbers with the prefix |
| B10 | Pricing rate card | Sales (Quotations) | B | Settings > Sales > Pricing | Rate appears in the rate picker |
| B11 | RFQ mail and timing | Sales (RFQ) | B | Settings > Sales > RFQ | Check lines show ready; a test RFQ arrives |
| B12 | Tender pricing defaults | Tenders | B | Settings > Sales > Tenders | Stale price flagged; Award and price starts at your markup |
| B13 | Contract project lists and margin | Tenders (Contract projects) | B | Settings > Sales > Contract projects | Lists show "from a file" or "entered by hand" |
| B14 | Account 360 cards | Sales (Nova or Spectacular) | B | Settings > Sales > Account 360 | Drawer shows cards in your order |
| B15 | Coverage | Sales (Coverage) | B | Settings > Users & access > Coverage | New account in a segment gets the team's owner |
| B16 | Marketing consent | Marketing | B | Settings > Marketing > Consent | Forms show your topics; no-answer contacts held back |
| B17 | Marketing limits | Marketing (Journeys, WhatsApp) | B | Settings > Marketing > Consent > Limits | Timezone chip shows your zone; journey waits in quiet hours |
| B18 | Lead scoring | Marketing | B | Settings > Marketing > Leads > Scoring | Try on a sample lead gives the expected score |
| B19 | Lead hand-over | Marketing | B | Settings > Marketing > Leads > Hand-over | A Warm lead becomes a lead within 15 minutes |
| B20 | Brand kit | Marketing (Newsletter Studio) | B | Settings > Marketing > Brand kit | Newsletter preview shows your logo, colours, footer |
| B21 | Punch rules | Workforce | B | Settings > Workforce > Workforce > Rules | My Workforce shows the punch types you ticked |
| B22 | Location rule | Workforce | B | Settings > Workforce > Workforce > Places | A test punch away from the site is kept or refused as chosen |
| B23 | Workforce alerts | Workforce | B | Settings > Workforce > Workforce > Alerts | A test correction emails the supervisor |
| B24 | Custom fields | Core | B | Settings > Data > Custom fields | New field shows on the record form |
| B25 | Products (categories, item types) | Core (Products) | B | Settings > Data > Products | Product form offers a category picker |
| B26 | Theme and colour | Core | B | Settings > Appearance > Appearance > Theme | Workspace reloads in the chosen theme |
| B27 | Sidebar menu | Core | B | Settings > Appearance > Appearance > Menu | Hidden item is gone from the sidebar |
| B28 | Dashboard | Core | B | Settings > Appearance > Appearance > Dashboard | Dashboard opens as chosen |
| C1 | Email output | Core | C | Settings > Integrations > Email output | Test email goes to the redirect inbox; later to real recipients |
| C2 | Connectors | Integration | C | Settings > Integrations > Connectors | Tile shows Connected; Test connection passes |
| C3 | Integration middleware | Integration (ERP) | C | Settings > Integrations > Integration middleware | Setup line complete; test quote has an ERP number |
| C4 | Webhooks | Integration (Webhooks library) | C | Settings > Integrations > Webhooks | Test tab sends; Log shows the answer |
| C5 | Webhooks and push | Integration | C | Settings > Integrations > Webhooks & push | Push to ERP accepted by the receiver |
| C6 | API keys and developer | Integration | C | Settings > Integrations > API keys & developer | Call to /api/v1 with the key returns your data |
| C7 | Account 360 external sources | Sales (Nova or Spectacular) | C | Settings > Sales > Account 360 > External sources | Card appears with an external value |
| C8 | Single sign-on (Coming soon) | Core | C | Settings > Users & access > Single sign-on | Page shows Coming soon |
| C9 | Face, passkey and door tablets | Workforce | C | Settings > Workforce > Workforce > Rules > More; Places | Tablet registered; a punch at it is recorded |
| C10 | Project billing | Workforce (Project Costing, Invoices) | C | Settings > Workforce > Workforce > Billing | Billing preview shows a non-zero amount |
| C11 | Deleted records (log, no settings) | Core | C | Settings > Data > Deleted records | Log lists permanent deletions |
| C12 | Audit and users hub (no settings) | Core (Administration hub) | C | Audit & Users | Cards open |
| C13 | Change history (log, no settings) | Core (Change History) | C | Audit & Users > Change History | Your setup changes are listed |
| C14 | Outbound emails (log, no settings) | Core (Outbound Emails) | C | Audit & Users > Outbound Emails | Test sends are listed |

---

# Part A. Must have

Without these the workspace will not work. The rule for this part is strict. A setting is here only for one of two reasons:

- **It blocks something.** Skip it and a screen shows an empty state or a refusal, or an action is stopped. The entry names the screen and the message.
- **Its shipped default is for India and wrong for most Gulf workspaces.** Nothing refuses, but every record is stamped with the wrong figure from day one (currency and tax, timezone, weekly off days, holidays). The entry says "ships with a default" and explains why it is here anyway.

If the product ships a working default, the setting is in Part B. Do the Core entries first, then only the modules your workspace bought.

## A.1 Core (every workspace)

### A1. Workspace, modules and domain

**Module:** Core. **Done by:** the BPMSquare team (platform admin), not by your admin.

**What it controls.** The workspace itself: its name, permanent short code, the address people sign in at, accent colour, currency, plan, first admin and which modules are switched on.

**Where to find it.** Admin > Tenants > New (or the Tenant Creation Studio at `/admin/tenant-studio`, which drafts the whole plan from a plain description). Then the hosting project, the DNS provider and the sign-in redirect list.

**Who can change it.** Platform admin only.

Only the platform admin can switch a module on. Your admin cannot. If a Settings page in this guide is missing from your menu, the module behind it is not switched on for your workspace. Ask the BPMSquare team.

Some flags are for the platform admin only, because they open work that is still being proven. Examples are the Nova theme, the Enterprise and Spectacular themes, Integration middleware, the Webhooks library, Shared Inbox, Sales Orders, GCC tender deals and the marketing programs. Your admin cannot turn these on.

**Why it is needed.** The product finds a workspace by the address typed in the browser. A new address opens nothing until it is wired. A module that is not switched on has no sidebar item and no Settings page.

**If you skip it.**

- No domain wiring: the address does not open at all (the browser shows DNS_PROBE_FINISHED_NXDOMAIN).
- Signing in while the certificate still says "Generating SSL Certificate": the site loads over plain HTTP, the session cookie is secure-only so the sign-in does not stick, and the password would travel unencrypted.
- No entry in the sign-in redirect list: forgot-password emails bounce to the wrong workspace's address, where the person has no membership. It looks like "password reset loops".
- A module left off: its sidebar items and Settings pages simply do not exist. For Workforce, Business Roles must be on as well (employee master, Business Users and the automatic Workforce roles need it).

**How to set it up.**

1. Decide before you touch anything: shared database (the default) or a dedicated instance; the module package; the currency (it relabels figures and never converts them, so settle it before any data is loaded); and the provisioning admin email (see A2).
2. Create the workspace in Admin > Tenants > New: **Name**, **short code** (lowercase, permanent), **custom domain** (required, for example `<code>.bpmsquare.com`), **accent colour**, **currency**, **plan**, the first admin's alias email and initial password, and the modules.
3. Modules. The form pre-ticks the eleven core CRM modules, so a scoped workspace must untick the ones not sold. A Workforce-only package is `wfm`, `business_roles`, `administration`, `reports` (recommended), `data_workbench` (needed for bulk employee upload) and optionally `change_history`. A full CRM package is the form's defaults plus whatever optional modules were sold. Experimental flags (Nova, Enterprise, Spectacular) are set by hand only.
4. In the hosting project (bpmsquare-app), open Settings > Domains > Add Existing and add `<code>.bpmsquare.com`.
5. At the DNS provider, add a CNAME: name `<code>`, target `cname.vercel-dns.com`. Wait until the row shows **Valid Configuration**.
6. In the authentication settings, open URL Configuration and add the redirect URL `https://<code>.bpmsquare.com/**`. The one-time wildcard `https://*.bpmsquare.com/**` covers every future workspace.

**Check it worked.** The address opens over https. The first admin can sign in (A2). The sidebar shows only the modules bought. The Settings menu has no pages for absent modules. Global search lists only your objects. The dashboard starts nearly empty for a scoped workspace, which is correct: use **Adapt** on the dashboard to install the module's widgets.

### A2. First admin and first sign-in

**Module:** Core. **Done by:** the BPMSquare team creates it; your admin completes the first sign-in.

**What it controls.** The one login that can configure everything else.

**Where to find it.** Admin > Tenants > the workspace > Users > Invite (platform admin). The first sign-in is at the workspace address.

**Who can change it.** Platform admin creates it. After that, your admin manages people in People (A3).

The platform admin creates the workspace and invites the first admin (Admin > Tenants > the workspace > Users > Invite). That invite exists for the first admin only. It gives the client's first admin system access, once. Everything after that happens inside your workspace, in **Settings > Users & access > People**, never from the platform admin screens. When you name your own admin, add them in People, then remove the provisioning alias login and any plain-email login the platform admin used during setup. The platform admin can always re-enter for support.

**Why it is needed.** Nothing else in this guide can be done without an admin who can sign in.

**If you skip it, or do it wrong.** If the invite uses the operator's plain email and that email already has an account anywhere on the platform, the account is linked and **its own password stays**. The password typed at creation is silently ignored. A plain-email login "working" proves nothing either, because platform admins are admitted to any workspace automatically.

**How to set it up.**

1. Use a plus-alias of the operator's address as the provisioning admin email, for example `<operator>+<code>@gmail.com`. It makes a genuinely new login, and mail still lands in the operator's inbox.
2. Give an initial password at creation. It is shown once, in the result, and stored nowhere.
3. The first admin signs in at the workspace address with the alias and the initial password, and is sent to a screen to choose a new password before anything else loads.
4. When the client names their own admin, add them in People as **Admin**, then remove the provisioning alias and any plain-email login (see the last steps of "Setup order").

**Check it worked.** The first sign-in shows the choose-a-new-password screen, then the dashboard. Later, People lists your own admin as Admin and no alias.

### A3. People (the logins)

**Module:** Core (the Business Roles tick list needs the module Business Roles). 

**What it controls.** Everyone who can sign in to the workspace: whether each is an Admin or a Member, which Business Roles a Member has, who is locked, and when each login is valid. **People are business users (logins). Employees are records.** The People screen replaced three older screens: Settings > Team, Administration > Business users and Administration > Business roles.

**Where to find it.** Settings > Users & access > People. URL: `/settings/people`. A person's panel remembers its section in the address (`?ptab=validity`, `?ptab=changes`). From an employee, Employees (`/employees`) links here.

**Who can change it.** Admin only. The People tab is always shown. The **Changes** section needs the module **Change History**.

The People page has an **i** tip: "People who can sign in. Add someone from their employee record, or here directly." The People table has an **Employee** column: the linked employee's name, or a dash. It shows when Business Roles is on and is hidden on narrow screens.

**Why it is needed.** Until you add people, the only login is the first admin. A Workforce employee with no login cannot open My Workforce to punch (unless the workspace punches only at a door tablet). A Member cannot be given a Business Role until the login exists.

**If you skip it.** Nobody except the first admin can sign in. Employees do not appear with a login chip, and the Employees list keeps showing **Create login** on their rows.

**Employees are records, People are logins.**

Two lists, two jobs:

- **Employees** (sidebar > Master data > Employees) hold the **records**: code, name, email, department, validity dates and, with Workforce, the Workforce role and supervisor. The Employees list has no subtitle. Its **i** tip reads: "Everyone you track. A login is optional and is created from the row."
- **People** (Settings > Users & access > People) hold the **business users**: the logins, with their role, Business Roles, lock and validity.

A login can be tied to an employee. There are two routes to add one, described under How to set it up below. The employee route comes first because it carries the employee's code, email and dates across for you. The direct Invite in People is the shortcut for people who are not employees, such as a second admin.

**How to set it up.**

*Route 1, employee first (the usual way for staff)*

1. Open **Employees** in the sidebar (Master data). Add the employee if there is no record yet. Employee codes are made by the system.
2. For Workforce, set the **WFM role** (supervisor or employee) and, for employees, the **Supervisor**. That decides who approves corrections, leave and overtime.
3. On the employee's row press **Create login**. In the employee's Edit dialog the same action reads **Create business user**. Once a login exists, the row shows a chip with its state (Active, Locked, Outside validity) that opens that person in People.
4. The Add panel opens with the employee, the email and the validity dates already filled in. Choose the **Role** (Admin or Member). Type a **Password** (required, because no invite email is sent). Press **Add**.
5. The result shows the sign-in details with **Copy details**. Hand them over. The person must choose a new password at first sign-in. The matching "WFM Supervisor" or "WFM Employee" Business Role attaches automatically.

*Route 2, direct Invite (the shortcut for people who are not employees)*

1. In Settings > People press **Invite**.
2. Type the **Email**. The **Role** (Member or Admin) is always shown. Pick it.
3. Either leave **Password** empty and press **Send invite** (the person gets an email whose link opens a set-password screen), or type a **Password** of at least 8 characters and press **Add** (the sign-in details are shown to hand over, and the first sign-in forces a new password).
4. Optionally pick an **Employee** in the same panel. Only an employee without a login is listed. The email and the **Validity** line fill in from the record.

The panel button reads **Send invite** until you set a password or pick an employee. Then it reads **Add**.

*Open a person*

1. Click the person's row. A panel opens.
2. At the top are the actions: **Lock** (or **Unlock**), **Reset password** and **Remove**. For Reset password, type the new password and press **Set password**.
3. The sections are:
   - **Access rights**: the workspace **Role** (Member or Admin). For a Member, tick the **Business roles**. Each one shows its areas in one line.
   - **Validity** (when the person has a login): **Valid from**, **Valid to**, **Counted user**. Under **More**: **Display name** and, if the login has no employee yet, **Employee**.
   - **Changes**: the history of this login, newest first. A few rows, then **Show all**.
4. Press **Save** to keep edits to the role, Business roles and Validity. Lock, Reset password and Remove act at once.

*Bulk*

For many staff at once, use the Data Workbench: import the Employees sheet, export to get the codes, then import the Users sheet (email, employee code, role name). Temporary passwords are generated and returned in the import report. Never put passwords in a spreadsheet. Details are in the Data Workbench chapter.

**Locking and validity dates.**

On a person in Settings > People:

- **Lock** stops the person entering the workspace. **Unlock** brings them back. Their login is not deleted. The panel and the list show the state: Active, Locked or Outside validity.
- **Valid from** and **Valid to** (the Validity section) set the dates the login works. Outside those dates the person is treated as locked. Leave both empty for no limit. A login made from an employee copies the employee's dates.
- You cannot lock yourself, and you cannot set your own dates to exclude today.
- You cannot change your own role. On your own row the **Member** option is disabled, and the server refuses it with 400 "You can't change your own role".
- **Counted user** says the person takes one licence seat. It is on by default.
- **Remove** takes the person out of the workspace. It does not delete their login. Removing yourself is refused.
- Every one of these changes is recorded (see "Every access change is logged" below).

**Passwords and the forced password change.**

- **Every path that creates a new login with an initial password forces a change.** The first sign-in sends the person to a screen where they choose their own password before anything else loads. This covers: the Add panel in People (Invite), Employees > Create login, the Data Workbench Users import (temporary passwords are generated and returned in the import report), and the BPMSquare team's invite of the first admin.
- **Reset password** on a person sets a new password you choose and forces the same change at their next sign-in.
- If the email already has an account anywhere on the platform, the account is **linked** and **its own password stays**. The password you typed is ignored. The person is not forced to change anything.
- If no password is given, an invite email is sent. Its link lands on a set-password screen.
- After an add or a reset, the screen shows the sign-in address, the email and the password with a **Copy details** button, and the line "They will be asked to choose a new password at first sign-in." The password is not shown again. Pass it on in person.

**Every access change is logged.**

Creating a login, removing it, changing the role or the Business Roles, locking and unlocking, resetting a password, and changing validity dates are all written to Change History under the object **People and access**. The row shows who did it and when. A password is never shown: a reset appears as "reset: changes at next sign-in". The same history shows on the person's **Changes** section (needs the Change History module). A removed login keeps its history.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Email | The login name. | Required |
| Role | Admin: all settings and no role limits. Member: reaches what Business Roles allow. Always shown, on every route. | Member |
| Password (Add panel) | Empty sends an invite email. Filled sets the password now (minimum 8 characters). Required when an employee is picked. If the email already has an account, it is linked and the password is ignored. | Empty |
| Employee (Add panel) | Ties the login to an employee record and copies the name and validity dates. | None, or the employee you started from |
| Lock / Unlock | Locks or unlocks the login at once. | Unlocked |
| Reset password | Sets a new password now. The person must choose their own at next sign-in. Minimum 8 characters. | Not set |
| Remove | Takes the person out of the workspace. The login is not deleted. | Not applicable |
| Business roles | The roles that decide which screens a Member sees. With none picked, the Member keeps full access. | None |
| Valid from, Valid to | The dates the login works. | Empty (no limit), or the employee's dates |
| Counted user | Takes one licence seat. | On |
| Display name | The name shown in lists. | Email or employee name |
| Employee (person, under More) | Links a login to an employee afterwards. Only an unlinked employee can be picked. | Not linked |

**What it affects elsewhere.**

- Who can sign in at all (lock, validity).
- The sidebar and the Settings menu for each Member, the dashboards they open, and the page guards that send them back to the dashboard.
- Employees: the row shows the login state or a Create login button.
- Change History: the object "People and access" (Change history, C13).
- The Inbox channel "Team" choice (it lists Business Roles, see Inbox channels, A13).
- Workforce: an employee's login and the supervisor routing.

(verify) Whether choosing an employee who is a Workforce supervisor still defaults the role to Admin when no role is sent. The Add panel always sends the role you pick, so on screen the choice is yours.

**Check it worked.** The new person is in the People list with the state **Active**. For an employee login, the Employees row shows a chip with the login state instead of **Create login**. The person's first sign-in asks for a new password. Their panel's **Changes** section shows the creation.

Screenshot: settings-people-list.png | /settings/people | The People table with the Invite button and the search box.
Screenshot: settings-people-add-panel.png | /settings/people | The Invite panel open, showing Email, Role, Password and Employee.
Screenshot: settings-people-person-panel.png | /settings/people | A person's panel open: Lock, Reset password and Remove at the top, then the Access rights section.
Screenshot: settings-people-changes.png | /settings/people?ptab=changes | A person's panel on the Changes section.
Screenshot: employees-create-login.png | /employees | The Employees list with a Create login button on one row and a login chip on another.

### A4. Tax and currency

**Module:** Core. Currency is shown to every workspace. The tax label, rate and "Rates include tax" appear only if the workspace has Quotations, Invoices or Standard Quotes.

**What it controls.** The currency every amount is shown in, printed in and emailed in, and the tax line on quotations, standard quotes and invoices.

**Where to find it.** Settings > Company > Company > **Tax and currency** tab. URL: `/settings/company?tab=tax`. The old address `/settings/currency` opens the same tab.

**Who can change it.** Admin only. No module flag.

**Why it is needed.** The setting **ships with a default** (INR, tax label GST, rate 18, rates exclude tax), so nothing is blocked. It is here because the default is India's. Every figure and every printed document carries it.

**If you skip it.** A Gulf workspace shows INR-formatted amounts on every screen, PDF, email and API answer, and an 18 percent "GST" line on printed quotations and invoices. The currency only relabels figures. It does not convert them, so a currency changed after data is loaded relabels the old figures too. Saudi e-invoicing also needs SAR (see A14).

**How to set it up.**

1. Open the **Tax and currency** tab.
2. Pick the **Currency**. For a workspace that prints documents, set **Tax label** (for example VAT), **Rate (%)** and **Rates include tax**.
3. Press **Save**. The documents update at once.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Currency | How every amount is shown, printed and emailed. It relabels figures. It does not convert them. Choices: INR, QAR, AED, SAR, OMR, KWD, BHD, USD, EUR, GBP. | INR |
| Tax label | The word beside the tax line, such as GST, VAT or MwSt. | GST |
| Rate (%) | The tax rate, 0 to 100. | 18 |
| Rates include tax | On when your rates already include tax. Off adds tax on top. | Off |

**What it affects elsewhere.**

- Every money figure on screens, PDFs, emails and the API.
- Every printed or emailed quotation, standard quote and invoice (the tax line).
- Change the currency before you load data. It relabels, it does not convert.
- Change History records the currency change.

**Check it worked.** Open a quotation or an invoice (or its print preview). The amounts show your currency and the tax line shows your label and rate.

## A.2 Workforce

Everything in this block is on one page: Settings > Workforce > Workforce (`/settings/workforce`). It replaced eight older pages (Attendance rules, Shifts, Sites, Leave types, Punching & verification, Kiosks, Reminders & notifications, Employment & billing). The settings below are split by tab; the other tabs are in Part B and Part C.

**Who can change it.** Admin only. Needs the module **Workforce (wfm)**.

How the page saves: Rules, Places (the location rule), Leave (carry forward), Alerts and Billing save together with the **Save** button at the top. Shifts, sites and leave types save from their own panel.

**Order.** Work through the settings in this order, the same order the provisioning runbook uses: timezone, then shifts, then sites, then leave types, then holidays, then the employee assignments. The runbook says punching works only once a site and a shift exist and are assigned. The code is more precise (see the "If you skip it" lines): a punch is recorded without them, but nobody can be marked late or absent and no location is checked (verify against a live workspace).

### A5. Timezone and weekly off days

**Module:** Workforce.

**What it controls.** The time zone that lateness, shift days and absences are worked out in, and the days of the week that are not working days.

**Where to find it.** Settings > Workforce > Workforce > **Rules** tab. URL: `/settings/workforce`.

**Why it is needed.** It **ships with a default** (Asia/Kolkata, Sunday off), so nothing is blocked. It is here because the default is India's. Every late mark and every absence is judged in this zone, on these days.

**If you skip it.** A Gulf workspace has its punches judged in Indian time, so people look late or early by the difference between the two zones. Friday and Saturday are treated as working days, so staff who are off are marked absent. The same timezone also sets the quiet hours of marketing journeys (see Marketing limits, B17).

**How to set it up.**

1. Open **Rules**. Pick the **Timezone** of your site.
2. Tick the **Weekly off days**. For a Friday and Saturday weekend, tick both and untick Sunday.
3. Press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Timezone | Lateness, shift days and absences are worked out in this zone. | Asia/Kolkata |
| Weekly off days | No lateness or absence is marked on these days or on holidays. | Sunday |

**What it affects elsewhere.** My Workforce (punching), the Roster, the Monthly Summary and the CA Excel export, and Marketing journeys (quiet hours).

**Check it worked.** On the Time Summary, a day of punches shows lateness against the shift in local time, and a weekly off day is not marked absent.

Screenshot: settings-workforce-rules.png | /settings/workforce | Rules tab with the six everyday fields and More closed.

### A6. Shifts

**Module:** Workforce.

**What it controls.** The working times people are measured against.

**Where to find it.** Settings > Workforce > Workforce > **Shifts** tab. URL: `/settings/workforce?tab=shifts`.

**Why it is needed.** Lateness and absence are measured against a shift.

**If you skip it.** The Shifts tab says "No shifts yet. Without one, nobody can be marked late or absent." My Workforce shows an employee "No shift assigned yet — ask your supervisor." The summaries have no late marks or absences.

**How to set it up.**

1. Open **Shifts**. Press **+ New shift**.
2. Set **Name**, **Start** and **End** (a new shift offers 09:00 to 18:00), **Grace (minutes)** (10 is offered), and **Night shift** only if the shift pays the night allowance.
3. Press **Save** in the panel. Then give each employee the shift (A10), or plan it in the Roster.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Name, Start, End | The shift. | New shift: 09:00 to 18:00 |
| Grace (minutes) | How late someone can check in before it counts as a late mark. | 10 |
| Night shift | Pays the night allowance. A shift that ends after midnight is recognised from its start and end times, whatever this switch says. Shows a night allowance amount. | Off, allowance 0 |
| Active | Switch off to retire a shift. | On |

**Check it worked.** The shift is in the table and Active. An employee's My Workforce shows the shift name.

### A7. Sites and their supervisors

**Module:** Workforce.

**What it controls.** The places people punch in at, how near the pin counts as on site, and who approves overtime, leave and corrections for each site.

**Where to find it.** Settings > Workforce > Workforce > **Places** tab. URL: `/settings/workforce?tab=places`.

**Why it is needed.** The site is where the supervisor routing comes from, and where the location check measures against.

**If you skip it.**

- No site at all: the Places tab says "No sites yet. Until one exists, punches are recorded without a location check."
- A site with no supervisor: an amber line on the Places tab says "N sites have no supervisor" and names the sites whose overtime, leave and corrections have nobody to approve them. A supervisor who is not a workspace admin is refused with "<site> has no supervisor or approver assigned — set one in Settings → Workforce → Sites."
- An employee with no home site: the approver is refused with "That employee isn't assigned to any site, so nobody supervises them — set their site first."
- A workspace Admin can approve for anyone. Nobody can approve their own request: "You can't approve your own request — it goes to your manager."

**How to set it up.**

1. Open **Places**. Press **+ New site**.
2. Type a **Name**. Click the map for the **Location** (or type latitude and longitude under More). Pick the **Supervisor**. Set the **Radius (m)** (150 is offered). Add **Also approve here** people so nothing waits when one person is away.
3. Press **Save** in the panel. Then give each employee a home site (A10).

**Options.**

| Option | What it does | Default |
|---|---|---|
| Site: Name, Location | A place people punch in at. Click the map, or type latitude and longitude under More. | Empty |
| Site: Supervisor | Approves overtime, leave and corrections for this site. | None |
| Site: Radius (m) | How far from the pin still counts as on site. | 150 |
| Site: Also approve here | Extra approvers, so nothing waits when one person is away. | None |
| Site: Active | Switch off to retire a site. | On |

**What it affects elsewhere.** Where the app lets people punch (with the location rule, B22), and which queue an employee's requests land in.

**Check it worked.** The site shows on the table with its supervisor and no amber "has no supervisor" line is left on the Places tab.

Screenshot: settings-workforce-places.png | /settings/workforce?tab=places | Places tab with the location rule and the sites table.

### A8. Leave types

**Module:** Workforce.

**What it controls.** The kinds of leave people can ask for, and their quotas.

**Where to find it.** Settings > Workforce > Workforce > **Leave** tab. URL: `/settings/workforce?tab=leave`.

**Why it is needed.** A leave request must name a leave type.

**If you skip it.** The Leave tab says "No leave types yet. Until one exists, nobody can request leave." In My Workforce an employee sees "No leave types configured yet — ask your admin to set them up in Settings → Workforce → Leave Types." The request form refuses with "Please choose a leave type".

**How to set it up.**

1. Open **Leave**. Press **+ New leave type**.
2. Set **Name**, **Category** (Paid, Unpaid or Half-day), **Days** and **Per** (Month or Year). A monthly quota is also the most anyone can take in that month. Open **More** to cap days in a month or to fix how many days a month are paid.
3. Decide **Unused leave carries forward** (it lapses at year end by default). Press **Save** at the top for that switch; the leave type itself saves from its panel.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Unused leave carries forward | On: unused leave carries into next year. Off: it lapses at year end. | Off |
| Leave type: Name, Category | Paid, Unpaid or Half-day. | Paid |
| Leave type: Days, Per | The default quota per employee. A monthly quota is also the most anyone can take in that month. Per Month or Year. | 1 per Month |
| More: Most days in a month | Cap in one calendar month. Empty means no cap. | No cap |
| More: Paid days a month | The first N days a month are paid and later ones count as unpaid in the summary. Empty means the category decides. | All |
| Active | Switch off to retire a type. | On |

**Check it worked.** The type is in the table and Active. An employee's leave request form lists it.

### A9. Holidays

**Module:** Workforce. **Not in Settings.** Holidays are kept on the Leave & Holidays screen in the Workforce area (`/wfm/leave`), next to leave requests (verify).

**What it controls.** The dates on which nobody is expected to work.

**Where to find it.** Workforce > Leave & Holidays > **Holidays** tab. URL: `/wfm/leave`.

**Who can change it.** Supervisors and admins (the screen is a supervisor item in the Workforce menu).

**Why it is needed.** The Monthly Summary judges lateness and absence only on days that are not a holiday, a leave day or a weekly off day.

**If you skip it.** The Holidays tab says "No holidays configured." A public holiday is treated as a working day, so every employee with no punches that day is counted absent, and the CA Excel export carries it.

**How to set it up.**

1. Open the **Holidays** tab. Under **Add a holiday**, set **Date**, **Name** (for example Independence Day) and **Applies to** (**Everyone**, or **These types** and tick the employment types the holiday is for).
2. Press **Add holiday**.
3. For a whole year, press **Download template**, fill it, and upload it. The result says how many holidays were added or updated.

**Check it worked.** The holiday is in the list. The Time Summary shows the holiday against that date and does not mark anyone absent.

### A10. Employee assignments (Workforce role, shift, home site, supervisor)

**Module:** Workforce. **Not in Settings.** This is done on the Workforce employees screen.

**What it controls.** For each employee: whether they are a supervisor or an employee, which shift they work, which site they belong to, and who supervises them.

**Where to find it.** Workforce > Workforce employees. URL: `/wfm/employees`. Bulk: the Roster matrix, or Data Workbench (Employees, then Users).

**Who can change it.** Supervisors and admins.

**Why it is needed.** The shift and the home site decide whose queue an employee's corrections, leave and overtime requests land in. The employee must also have a login (A3) to punch from a phone.

**If you skip it.** The employee sees "No shift assigned yet — ask your supervisor." Their requests have no queue to land in (see A7 for the messages an approver gets).

**How to set it up.**

1. Add the employee in Employees (the code EMP-#### is made by the system and never typed).
2. Open Workforce employees. For each person set **WFM role** (Supervisor or Employee), **Shift**, **Home site** and **Supervisor**.
3. Give the login: on the employee's row press **Create login** (see A3). The matching "WFM Supervisor" or "WFM Employee" Business Role attaches automatically.

**Check it worked.** The Workforce employees table shows the WFM role, Shift, Home site and Supervisor columns filled for every person.

## A.3 Tenders and contract projects

### A11. Tender approvers

**Module:** Tenders (**GCC tender deals**). The same list also approves Contract project budgets and variations (needs **Contract projects**).

**What it controls.** Who approves a bid or no-bid proposal on a tender deal, and whether a proposer may approve their own.

**Where to find it.** Settings > Sales > Tenders. URL: `/settings/tenders`.

**Who can change it.** Admin only.

**Why it is needed.** A bid or no-bid proposal, a project budget and a variation each wait for an approver who is not the proposer.

**If you skip it.** It **ships with a default** (every workspace admin approves; self-approval off), which works when there are two or more admins. In a **one-admin workspace** the only approver is also the proposer, so the approval is refused with "You cannot approve your own proposal" (bid decisions) or "You cannot approve your own request" (project budgets and variations), and the deal stays at the approval step. A person who is not on the list is refused with "You are not an approver for bid decisions" or "You are not an approver for project budgets".

**How to set it up.**

1. Under **Approvers**, tick the people who may approve a bid or no-bid proposal. Leave all unticked and every workspace admin can.
2. Switch **Allow self-approval** on in a one-admin workspace. Otherwise no one can approve.
3. Press **Save**. (**Price validity** and **Default markup** are on the same page; see B12.)

**Options.**

| Option | What it does | Default |
|---|---|---|
| Approvers | Members who may approve a proposal. Only members of this workspace are accepted. | Empty (every admin) |
| Allow self-approval | A proposer may approve their own proposal. | Off |

**What it affects elsewhere.**

- The bid / no-bid approval step on a tender deal (Pipeline > Tenders).
- Project budget and variation approvals on a Contract project.
- Change History records the change.

**Check it worked.** Raise a test bid proposal as one person and approve it as an approver. The deal moves on instead of showing the refusal.

Screenshot: settings-tenders.png | /settings/tenders | The approvers list, the self-approval switch, price validity and default markup.

## A.4 Estimates

### A12. Estimate templates

**Module:** Project Estimator.

**If you skip it.** The New estimate page shows "There is no estimate template yet" and offers starter buttons instead of the template cards. In Settings the list says "No estimate templates yet". Nobody can start an estimate until a template exists.

**Why it is needed.** An estimate starts from a template: its inputs, rates and rules decide the bill of materials and the cost.

**What it controls.** The templates an estimate is worked out from. A template holds inputs (questions), rates, and rule lines that turn a few answers into a bill of materials, a cost build-up and a quote. Editing a template never re-prices an estimate that already exists.

**Where to find it.** Settings > Sales > Estimate templates. URL: `/settings/estimate-templates`. A template's editor is `/settings/estimate-templates/<id>`.

**Who can change it.** Admin only. Needs the module **Project Estimator**, and the person must be able to view the Estimates area.

**How to set it up.**

1. To start from a ready-made one, press **Add the pipework, precast and civil starters** (or a single starter button). Starters are read-only.
2. Open the row menu on a starter and choose **Copy to customise**. You get your own copy.
3. Or press **+ New template** to start from a minimal one (one input, one rate, one rule).
4. In the editor, work through the tabs: **Details**, **Inputs**, **Rates**, **Rules**, **Check**. The Check tab lists what is wrong. Problem counts show on the tabs.
5. To import prices for catalogue items, press **Import rate sheet**.
6. In the row menu you can also choose **Details**, **Edit**, **Duplicate**, **Activate** or **Deactivate**, and **Delete**. A template that estimates were made from can only be deactivated.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Details: Name, Description, Trade, Quote granularity, Module | Identity, and how detailed the customer's quote is (one line per group, or every bill of materials line). Module is a coded building model for pricing beyond formulas. | Empty |
| Inputs | Key, Label, Type, Default, Minimum, Maximum, Unit, Section, Help text, and a "Paints" link for 3D choices. | One input "Quantity" in a new template |
| Rates | Key, Label, Unit, Value, optional low and high range. | One rate "Unit rate" in a new template |
| Rules | Code, Group, Description, Unit, Quantity, Waste %, Cost component, Cost comes from (a rate or a catalogue product), Element type. | One rule "Item" in a new template |
| Panel: What it is | The line under the name on the New estimate card. | Empty |
| Panel: Words an email would use | Comma-separated words the AI reads to pick a template for a pasted email. | Empty |
| Panel: Card icon | Fence, Building, Tiles, Cabin, General. | By template geometry |
| Panel: Customers may request this | Reserved for a later customer request page. No effect today. | Off |
| Version | Goes up when the template body changes. | 1 |

**What it affects elsewhere.**

- New estimate: the template cards, the Inbox "Create an estimate" template choice (see Inbox channels, A13), and the Standard Quote made from an estimate.
- The amber "illustrative rates" chip counts catalogue items still priced from a starter's placeholder cost.
- Change History records template changes.

Screenshot: settings-estimate-templates.png | /settings/estimate-templates | The template list with a starter and a custom template.
Screenshot: settings-estimate-template-editor.png | /settings/estimate-templates | A template open in the editor on the Rules tab (open any row, then Edit).

**Check it worked.** The New estimate page shows a card for the template, and an estimate made from it produces a bill of materials.

## A.5 Shared Inbox

### A13. First inbox channel

**Module:** Shared Inbox (a platform-admin module).

**If you skip it.** The Inbox shows "No address yet." and, to an admin, "Add a channel to get an address customers can write to." To anyone else it says "No address has been set up for a team you are on." Mail has nowhere to arrive.

**Why it is needed.** A channel is the address customers write to. The Inbox lists only channels that exist.

**What it controls.** The addresses customers write to, who reads and answers each one, what the **Create** button offers first, and the mailbox replies go out from.

**Where to find it.** Settings > Integrations > Inbox channels. URL: `/settings/inbox`.

**Who can change it.** Admin only. Needs the platform-admin module **Shared Inbox**. Without it the address shows "not found".

**How to set it up.**

1. Press **+ New channel**. Type a **Name**.
2. Choose the **Team**: tick Business Roles. Nobody picked means everyone with the Inbox.
3. Choose **Create offers first**: Quote, Project, Case, Estimate, Lead, Deal (Deal only with tender deals) or Nothing in particular. For Estimate, pick a **Template** or leave it to the system.
4. Choose a **Mailbox**: None (forwarding address only), Gmail or Mail server (IMAP). If it says "Not connected yet", connect it in Connectors first.
5. Set the **Reply name** and, with no mailbox, the **Reply from** address.
6. Press **Create**. Open the channel again to **Copy** the address and forward your company mail to it.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Name | The channel's name. Required. | Empty |
| Address | The forwarding address customers or your mail rules send to. **New address** makes another and stops the old one at once. | Made on creation |
| Team | Which Business Roles see and answer this channel. | Everyone with the Inbox |
| Create offers first | What the Create menu shows first for mail on this channel. | Nothing in particular |
| Template | The estimate template to use when Create offers an Estimate. | Let the system suggest one |
| Mailbox | The connected mailbox read for this channel. | None |
| Reply name, Reply from | Who replies appear to come from. | Empty |
| Take in new mail | Off pauses the channel. Its mail stays. | On |

**What it affects elsewhere.**

- The Inbox screen: which channels and which mail each team member sees.
- The Create menu on an email (Quote, Project, Case, Estimate, Lead, Deal).
- Outbound Emails log (kind "Inbox replies").
- Only a channel with no mail can be deleted. Pause it instead to keep its mail.
- Receiving by forwarding address needs the platform to have an inbound domain. A connected mailbox works without it.
- Change History records channel changes.

Screenshot: settings-inbox-channels.png | /settings/inbox | The channels table with one channel panel open.

**Check it worked.** The channel's address is shown and can be copied. A test mail forwarded to it appears in the Inbox.

## A.6 Saudi e-invoicing

### A14. Saudi e-invoicing seller details

**Module:** Saudi e-invoicing (`einvoicing_ksa`, with the scheme set to Saudi ZATCA).

**What it controls.** The seller details ZATCA needs on every invoice. An entity is the seller unit.

**Where to find it.** Settings > Company > Company > **Entities** tab, inside the entity. URL: `/settings/company?tab=entities`. Add the entity first (see B2) if there is none.

**Who can change it.** Admin only.

**Why it is needed.** Sending a draft invoice (the status change, or the email) first checks that it is ready for Saudi e-invoicing, and sending gives it its number.

**If you skip it.** The send is refused (HTTP 422) with "This invoice is not ready for Saudi e-invoicing: N things are missing." The invoice shows **Not ready · N** with each missing item. What is checked about the seller: legal name, name in Arabic, VAT number (15 digits, starting and ending with 3), commercial registration number (10 digits) and the address. Other rules: the invoice currency must be SAR (set it in A4), and a Standard invoice also needs the buyer's details on the account.

**How to set it up.**

1. Open the **Entities** tab. Open the entity, or press **+ Add entity** (B2).
2. In the Saudi e-invoicing block, fill the VAT number, commercial registration, Arabic legal name, building number, street, district, city, postal code (5 digits) and country. The block shows only with Saudi e-invoicing on.
3. Press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Saudi e-invoicing (inside an entity) | Seller details for ZATCA: VAT number (15 digits, starts and ends with 3), commercial registration, Arabic legal name, building number, street, district, city, postal code, country. Shown only with Saudi e-invoicing on. The VAT number falls back to the Tax ID. | Empty |

**Check it worked.** Open a draft invoice. The e-invoicing panel says **Ready** and sending is accepted.

## A.7 Service

The **Service** group is defined in the Settings menu, but it has no pages in it today. A group with no pages is not shown. Service areas (Cases, Inspection Reports, AMC, Work Orders, Dispatch, Technicians) have **no must-have settings**: they run on shipped defaults. They are shaped by settings that sit in other places in this guide:

- Extra fields on a case, work order or asset: **Custom fields** (B24).
- Equipment details that print on a quote: **Quote print fields** (B8).
- Who can reach Service screens: **Business Roles** (B4).
- The reply and quote emails Service uses: **Quotation templates** (B7) and **Email output** (C1).
- The Service card in Account 360: **Account 360 cards** (B14).

---

# Part B. Nice to have

These settings ship with a working default, so the workspace runs without them. Each one is noticeably better with it, and each entry says what you lose if you skip it. Do them in the order of "Setup order" at the end.

## B.1 Company and access

### B1. Company profile and letterhead

**Module:** Core. The letterhead fields appear only if the workspace has Quotations, Invoices or Standard Quotes.

**What it controls.** Your company name and the letterhead printed on quotations and invoices.

**Where to find it.** Settings > Company > Company > **Profile** tab. URL: `/settings/company`.

**Who can change it.** Admin only. No module flag.

**What you lose if you skip it.** It **ships with a default**: the company name given at creation. Printed documents then show the initials on a colour block instead of a logo, and carry no address, email, website or tax ID line.

**How to set it up.**

1. Open the **Profile** tab. Type the **Company name**. This is the name in the sidebar and, by default, on printed documents.
2. For a workspace that prints documents, upload the **Logo** (PNG, JPG or WebP, up to 2 MB), then fill **Address**, **Email**, **Website**, **Tax ID** and **Tagline**.
3. Open **More letterhead details** for the rarely used items: second email, footer line, header strip, logo background colour, phone numbers with labels, accreditation logos (top left of the quote) and partner logos (top right).
4. Press **Save**. The sidebar name and the documents update at once.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Company name | The workspace name, shown in the sidebar and on documents. Required. | The name given at creation |
| Logo | Printed on quotations and invoices. | None. The initials show on the logo background colour. |
| Address, Email, Website, Tax ID, Tagline | Letterhead details. | Empty |
| Name on printed documents | Shown only when the old letterhead already used a different name. Clear it to print the company name. | Hidden |
| Second email, Footer line, Header strip | Extra letterhead lines. | Empty |
| Logo background | Colour behind the initials when no logo is uploaded. | #378ADD |
| Phone numbers | Label and number. They print in the footer as columns. | None |
| Accreditation logos | Certification logos, top left of the quote letterhead. | None |
| Partner logos | Brand logos, top right of the quote letterhead. | None |

**What it affects elsewhere.** The sidebar header and every printed or emailed quotation, standard quote and invoice (the letterhead). The logo in the sidebar (set by the platform admin) is separate from the Company logo (verify).

**Check it worked.** A print preview of a quotation shows the logo and the letterhead lines.

Screenshot: settings-company-profile.png | /settings/company | The Profile tab with the company name, logo and the "More letterhead details" closed.

### B2. Legal entities

**Module:** Core. Needs Quotations, Invoices or Standard Quotes.

**What it controls.** One row per legal body that issues quotes. The default one is picked on new quotations.

**Where to find it.** Settings > Company > Company > **Entities** tab. URL: `/settings/company?tab=entities`. The old address `/settings/entities` opens the same tab.

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a default**: quotations use the company details until you add an entity. You lose a separate legal name, address and tax ID per issuing company, and the entity picker on a new quotation. (A Saudi e-invoicing workspace needs an entity: see A14.)

**How to set it up.**

1. Open the **Entities** tab. Press **+ Add entity**. Fill **Legal name**, **Short name**, **Address**, **Phone**, **Email** and **Tax ID**.
2. Press **Make default** on the one most quotations use. Press **Done**, then **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Legal entities | One row per legal body that issues quotes. The default one is picked on new quotations. | None. Quotations use the company details until you add one. |
| Entity fields | Legal name, Short name, Address, Phone, Email, Tax ID. More: Tagline. | Empty |

**What it affects elsewhere.** The New Quotation form (entity picker) and the letterhead of the printed document.

**Check it worked.** The New Quotation form offers the entity, and the printed quote shows its legal name.

### B3. Quotation numbering

**Module:** Core. Needs Quotations, or at least one object with a system number range.

**What it controls.** How quotation numbers are built.

**Where to find it.** Settings > Company > Company > **Numbering** tab. URL: `/settings/company?tab=numbering`. The old address `/settings/number-ranges` opens the same tab.

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a default** (`QT-2026-0001` style, restarting every year). You lose your own prefix and format.

**How to set it up.**

1. Open **Numbering**. Set **Prefix**, **Template**, **Digits** and **Restart numbering**. The line "Next quotation" shows the result.
2. Press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Quote ID: Prefix | The text at the start of the number. | QT |
| Quote ID: Template | Tokens: `{PREFIX}` `{YYYY}` `{YY}` `{MM}` `{SEQ}`. | `{PREFIX}-{YYYY}-{SEQ}` |
| Quote ID: Digits | Length of the running number, 2 to 6. | 4 |
| Quote ID: Restart numbering | Every year, or never. | Every year |
| System IDs (read-only list) | The numbers the system makes itself: ACC-0001, CON-0001, AST-0001, SUP-0001, INV-0001 (inventory), EMP-0001, SQ-2026-0001, INV-2026-0001 (invoices), PO-2026-0001, CS-2026-0001. | Fixed |

**What it affects elsewhere.** A new format applies to new quotations only. Existing numbers are never rewritten. The Numbering tab only sets the quotation format. Other objects use fixed formats. Order numbers use the prefix of the Order type (see Order types, B9).

**Check it worked.** The "Next quotation" line shows the format you set, and the next quotation made carries it.

Screenshot: settings-company-numbering.png | /settings/company?tab=numbering | The Numbering tab with the quote ID format and the "Next quotation" example.

### B4. Business Roles (the Roles tab)

**Module:** Core. Needs the module **Business Roles**.

**What it controls.** The roles that narrow what a Member sees: which areas, and what they may do in each.

**Where to find it.** Settings > Users & access > People > **Roles** tab. URL: `/settings/people?tab=roles`. The old addresses `/administration/business-roles` and `/settings/team` open People.

**Who can change it.** Admin only.

**What you lose if you skip it.** A Member with no Business Role keeps full access to everything and sees every sidebar item. You lose narrower menus and per-role default dashboards. Business Roles are not a data boundary, so skipping them never weakens security.

**Business Roles.**

A Business Role is a set of areas (the product calls them workcenters), such as Accounts, Quotations or Workforce. For each area you tick, you choose what the person may do: **Create**, **Edit**, **Delete**. Ticking an area gives view access.

- Roles are given to **Members** only. An Admin does not need one.
- A Member with **no** Business Role keeps full access to everything. Giving a role is an opt-in to a narrower view.
- If a Member has several roles, the access is the union. One role can only add access, never take it away.
- Each role can have its own default dashboard. People with several roles see the dashboards combined.
- Eight standard roles ship with the product: Sales User, Sales Admin, Service User, Service Admin, Marketing User, Marketing Admin, WFM User and WFM Admin. They are read-only. Duplicate one to change it. **Sync with catalog** re-applies the current definition to a standard role. Administration and Data Workbench are in none of the standard roles, because an Admin already has them. "Sales Admin" and the like are Business Roles. They are not the workspace role Admin.

Business Roles hide menu items and dashboards. They are a menu-visibility feature. They are **not** a data boundary: the product's data routes do not check them. Do not use them to keep information secret from a colleague. Business Roles also need the module "Business Roles" switched on for your workspace.

**How to set it up.**

*Make a role*

1. Open the **Roles** tab. Press **New role**.
2. Type a **Name**. Tick the areas the role opens. For each, tick **Create**, **Edit**, **Delete** as needed.
3. Open **More** for a **Description** and a **Default dashboard**. Save the role first, then press **Set up** to choose the dashboard blocks for the role.
4. Press **Save**. Use **Duplicate** to copy a role, including a standard one.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Role: Name | The role's name. Required. | Empty |
| Role: Access | Areas the role opens, with Create, Edit, Delete. | None ticked |
| Role: Description | A note about the role. | Empty |
| Role: Default dashboard | The dashboard people with this role see first. | Not set (the workspace dashboard applies) |
| Standard role | Read-only. Duplicate it to change it. **Sync with catalog** brings it up to date. | Eight shipped roles |

**What it affects elsewhere.**

- Removing a role: members who held only that role revert to full access.
- The Inbox channel "Team" choice lists Business Roles (see Inbox channels, A13).
- The Settings menu a Member reaches: an entry is tied to an area, and a role that grants Edit on it opens the page.

**Check it worked.** Give a test Member the role and sign in as them: the sidebar shows only the areas the role opens.

Screenshot: settings-people-roles.png | /settings/people?tab=roles | The Roles tab with one role panel open showing the Access list.

## B.2 Sales

The **Quotations** page has four tabs, covered as B5 to B8. It replaced five older pages (Quote statuses, Quote types, Text templates, Email templates, Asset print fields). Its address is `/settings/quotations`; the other tabs are `?tab=types`, `?tab=templates` and `?tab=print`. The old addresses `/settings/statuses`, `/settings/quote-types`, `/settings/templates`, `/settings/email-templates` and `/settings/asset-print-fields` open the matching tab.

### B5. Quotation statuses

**Module:** Quotations.

**What it controls.** The stages a quotation moves through.

**Where to find it.** Settings > Sales > Quotations > **Statuses** tab.

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a default**: Draft, Sent, Approved and Rejected. You lose stages that match how your team sells (for example "Technical review").

**How to set it up.**

1. Open **Statuses**. Press **+ New status**. Type a **Name**, pick a **Colour** (12 presets or your own), press **Add status**. A new open status lands before the closed ones.
2. Click a status to open its panel. Change the name or colour. Switch **Closed** on for an end status. Use **Earlier** and **Later** to move it. Press **Start new quotes here** to make it the starting status. Press **Remove** to delete it.
3. **Reset to defaults** puts the four standard statuses back in the draft. Press **Save** to keep it.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Status: Name | The label. A stored key is made from the name once and never changes. | Draft, Sent, Approved, Rejected |
| Status: Colour | Dot colour. | Blue, purple, green, red |
| Status: Starts here | Where new quotes begin. Exactly one. | Draft |
| Status: Closed | A closed status locks the quote and asks for an outcome (won or lost). At least one must be closed. | Approved and Rejected |

Rules the page enforces: at least one status, every status named, exactly one starting status, at least one closed status, and no two statuses with the same name.

**What it affects elsewhere.** The Quotations list, the quote form, and the pipeline of quotes (status chips, closing, outcome). Deal stages for the pipeline board have no settings screen today. They use the built-in stages (Qualify, Propose, Negotiate, Won, Lost).

**Check it worked.** A new quotation starts at the status marked **Starts here**, and closing a quote asks for an outcome.

Screenshot: settings-quotations-statuses.png | /settings/quotations | The Statuses table with the four defaults.

### B6. Offer types

**Module:** Quotations.

**What it controls.** Which offer types people can pick on a new quotation.

**Where to find it.** Settings > Sales > Quotations > **Offer types** tab (`?tab=types`).

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a default**: every type is shown. You lose a shorter picker.

**How to set it up.**

1. Open **Offer types**. Switch a type off to remove it from the New Quotation picker. Quotes already made keep their type.
2. Press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Offer types | Quotation, Technical Offer, Budgetary Offer, Supply Quotation, AMC Contract, Installation. The last two are marked "Coming soon". | All shown |

**What it affects elsewhere.** The New Quotation picker.

**Check it worked.** The New Quotation picker lists only the types switched on.

### B7. Quotation templates (saved texts and emails)

**Module:** Quotations.

**What it controls.** The saved texts and emails used while writing and sending a quotation.

**Where to find it.** Settings > Sales > Quotations > **Templates** tab (`?tab=templates`).

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a default**: without a default email of its kind, a built-in text is used. You lose your own wording for line items, notes, terms, scope of work and the emails.

**How to set it up.**

1. Open **Templates**. Pick a filter chip (All, Line item, Notes, Terms, Scope, Email) or press **+ New template**.
2. Type a **Name**, choose the **Kind**, write the **Text** (for an email, the **Subject** and **Body**). Open **Placeholders** to see the values you can insert, written as `{{name}}`.
3. For an email, switch **Default for this kind** on. Sending uses the default email of its kind. Without one, a built-in text is used.
4. Press **Save** in the panel. Templates save on their own and do not need the page Save.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Template kinds | Line item, Notes, Terms, Scope of work, Email: quotation, Email: invoice, Email: supplier RFQ. An old Email: inspection report can be listed but is not sent. | None |
| Template: Default for this kind | One default per email kind. | Off |

**What it affects elsewhere.** The "insert text" and "send email" actions on a quote. Supplier RFQ emails and invoice emails use their own kinds. Standard Quotes keep their own templates on the Standard Quotes screen, not here (verify).

**Check it worked.** Sending a quote email uses your default template of that kind.

Screenshot: settings-quotations-templates.png | /settings/quotations?tab=templates | The Templates table with the kind filter chips.

### B8. Quote print fields

**Module:** Assets. A workspace with Assets and no Quotations sees this tab alone.

**What it controls.** Which equipment fields print in the Equipment Details block of a quote.

**Where to find it.** Settings > Sales > Quotations > **Print** tab (`?tab=print`).

**Who can change it.** Admin only.

**What you lose if you skip it.** With nothing chosen, the Equipment Details section is left out of the printed quote.

**How to set it up.**

1. Open **Print**. Click the equipment fields that should print in the Equipment Details block of a quote. **Motor nameplate** holds the electrical fields.
2. Press **Save**. With nothing chosen, the section is left out.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Print: Equipment fields | Equipment name, Type, Make / OEM, Model / Frame, Rating, RPM, Serial no., Remarks, plus your Asset custom fields. | None chosen |
| Print: Motor nameplate | Frame / Type, Insulation class, Connection, Duty, Ambient temp., Output (kW), Stator voltage, Stator current, Excitation voltage, Excitation current, Frequency. | None chosen |

**What it affects elsewhere.** The printed quote (Equipment Details section).

**Check it worked.** A printed quote for an asset shows the fields you ticked.

### B9. Order types

**Module:** Sales Orders. If the database update for Sales Orders has not been applied, the page says so.

**What you lose if you skip it.** It **ships with a default**: the first time an order is made, a "Standard order" type (prefix SO, internal pricing) is created for you. If every type is switched off, the new order is refused with "Every order type is switched off. Switch one on in Settings." You lose per-type numbering, pricing mode, selection rules and PDF design.

**What it controls.** The kinds of sales order your workspace takes. Each type has its own number prefix, its pricing mode, the customers it suits, and its own PDF design.

**Where to find it.** Settings > Sales > Order types. URL: `/settings/order-types`.

**Who can change it.** Admin only. Needs the module **Sales Orders**. If the database update for Sales Orders has not been applied, the page says so.

**How to set it up.**

1. Press **+ New order type**.
2. Type a **Name**. Check the **Prefix**. Choose **Pricing**. Choose whether it is the **Default type**.
3. Open **Selection rules** and add rules if the type should be picked by itself for certain customers.
4. Open **PDF design** to choose which blocks print, their order, any block text, the accent colour and the logo position. Press **Preview with sample data**.
5. Press **Add order type**.
6. To stop using a type, open it and press **Remove**. If it has orders it is **switched off** instead of deleted. Press **Switch on** to bring it back.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Name | The type's name. Required. | Empty |
| Prefix | Orders are numbered PREFIX-0001, counted per workspace and prefix. 2 to 6 letters or digits, shown in capitals. Affects new orders only. | SO |
| Pricing | Internal: price list and pricing engine. External: supplied by the ERP and kept read-only. | Internal |
| Default type | Used when no rule matches. One type is always the default. | On for the first type |
| Selection rules | The first matching rule picks the type for a new order. Fields: Customer group, Region, Made from (Standard quote, Quotation, Deal, Lead, Email, Typed in directly). | None |
| PDF blocks | Letterhead, Order number and date, Customer / bill-to / ship-to, Intro text, Line items table, Total, Notes, Terms and conditions, Signature block, Footer text, Specifications table, Call-to-action banner. Required blocks are always shown. | The standard quote block set |
| Accent colour | Colour on the PDF. | #378ADD |
| Logo position | Left, Centre or Right. | Left |

**What it affects elsewhere.**

- The Sales Orders list, the new order form (type choice), the order PDF, and email and WhatsApp sends.
- Order numbers.
- The ERP organisation chips on the row (when Integration middleware is on).
- Change History records order type changes.

Screenshot: settings-order-types.png | /settings/order-types | The order types table with one type open in the panel.

**Check it worked.** The new order form offers your types, and an order is numbered with the type's prefix.

### B10. Pricing rate card

**Module:** Quotations (the rate card). **Pricing Engine** adds the Dynamic Pricing link.

**What you lose if you skip it.** The rate picker while pricing a quotation has nothing to pick, so people type rates by hand each time.

**What it controls.** Small Scale Pricing: a rate card of standard rates for labour, materials, testing and transport that people pick while pricing a quotation. With Dynamic Pricing on, the page also links into the Pricing workspace.

**Where to find it.** Settings > Sales > Pricing. URL: `/settings/pricing`.

**Who can change it.** Admin only. The rate card needs **Quotations**. The Dynamic Pricing link needs **Pricing Engine**. The page shows if either is on.

**How to set it up.**

1. Press **+ New rate**. Type a **Description**, choose the **Category**, type the **Unit** (for example "per job") and the **Rate**.
2. Open **More** to add **Notes**. Press **Save**.
3. Use the category chips (All, Labour, Material, Testing, Transport) to filter. Click a row to edit. Press **Delete** in the panel to remove a rate.
4. For Dynamic Pricing, press **Open Pricing setup**. That opens `/pricing/setup`, which is a workspace of its own and not a Settings page.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Description | What the rate is for. Required. | Empty |
| Category | Labour, Material, Testing or Transport. | Labour, or the chip you filtered by |
| Unit | What the rate is per. Required. | Empty |
| Rate | Amount in the workspace currency. Zero or more. | 0 |
| Notes | A free note. | Empty |

**What it affects elsewhere.**

- The rate picker while pricing a quotation. Quotes already priced keep their figures.
- Dynamic Pricing (rates, price books, history) lives under Pricing in the sidebar, not here.

Screenshot: settings-pricing.png | /settings/pricing | The rate table with category chips and the Dynamic Pricing row.

**Check it worked.** The rate appears in the rate picker while pricing a quotation.

### B11. RFQ mail and timing

**Module:** RFQ.

**What you lose if you skip it.** It **ships with a default**: BPMSquare sends and receives, five days to reply, two reminders, a 14-day reply link. You lose your own mailbox as the sender, your own timing and your standing terms on every RFQ.

**What it controls.** How requests for quotation reach suppliers and how their replies come back: your own mailbox or BPMSquare's sender, the reply window, reminders, the reply link and the terms printed on every RFQ.

**Where to find it.** Settings > Sales > RFQ. URL: `/settings/rfq`.

**Who can change it.** Admin only. Needs the module **RFQ**.

**How to set it up.**

1. Under **Mail channel**, pick **Your own mailbox** or **BPMSquare sends and receives**.
2. For your own mailbox, pick **Gmail (App Password)** or **Mail server (SMTP / IMAP)**. If it says "Not connected yet", connect it under Settings > Integrations > Connectors, then save here.
3. Set **Days to reply**, **Reminders per supplier**, **Link works for** and **Price goes stale after**.
4. Tick or untick **Attach the RFQ as a PDF**. Write the **Terms printed on every RFQ**.
5. Press **Save**.

The check lines show whether sending, receiving and the no-login reply link are ready on this platform. An amber line is set up by the platform team, not by you.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Mail channel | Your own mailbox (replies arrive in your inbox and are also filed on the right RFQ every few minutes), or BPMSquare sends and receives (each supplier gets a personal reply-to address). | BPMSquare sends and receives |
| Mailbox | Gmail or Mail server, used when you pick your own mailbox. | Gmail |
| Days to reply | Sets the reply-by date on a new RFQ. 1 to 90. | 5 |
| Reminders per supplier | At most this many per supplier. 0 to 5. | 2 |
| Link works for (days after deadline) | How long the supplier's reply link works after the deadline. 0 to 90. | 14 |
| Price goes stale after (days) | An answer with no validity date is stale after this. Stale prices show in amber and are never called the lowest. 30 to 730. | 180 |
| Attach the RFQ as a PDF | The Excel reply sheet is always attached. | On |
| Terms printed on every RFQ | Text under the line table. Up to 4000 characters. | Empty |

**What it affects elsewhere.**

- RFQs raised from quotes, deals, cases, inspections, work orders and fence projects.
- The RFQ comparison (blue lowest valid price, amber stale or expired).
- The Outbound Emails log (kind "Supplier RFQs").
- Workspaces without the RFQ module keep the older single-supplier pricing request under Pricing.

Screenshot: settings-rfq.png | /settings/rfq | The mail channel choice, the check lines and the timing fields.

**Check it worked.** The check lines on the page show sending, receiving and the reply link as ready (an amber line is set up by the platform team, not you). An RFQ sent to yourself arrives with the PDF and the Excel reply sheet.

### B12. Tender pricing defaults

**Module:** Tenders (**GCC tender deals**).

**What it controls.** How old a supplier price may be before it counts as stale, and the markup that "Award and price" starts from.

**Where to find it.** Settings > Sales > Tenders. URL: `/settings/tenders`. (The same page holds the approvers: see A11.)

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a default** (180 days, 15 percent). You lose a stale-price rule and a markup that match your trade.

**How to set it up.**

1. Set **Price validity** in days and **Default markup** in percent.
2. Press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Price validity (days) | A supplier or past-project price older than this is marked stale and never applied automatically. Whole days, 1 to 3650. | 180 |
| Default markup (%) | What an award adds to a supplier's cost when you do not type another. Cost 100 at 15% gives a rate of 115. Range 0 to 1000. | 15 |

**What it affects elsewhere.**

- Stale-price flags on Bill of quantities lines.
- The Costing step "Award and price".

**Check it worked.** A supplier price older than the validity is flagged stale on a Bill of quantities line, and "Award and price" starts from your markup.

### B13. Contract project lists and margin

**Module:** Contract projects (needs **GCC tender deals** as well).

**What you lose if you skip it.** It **ships with a default**: the first time the page is used, Resource levels, Cost codes and Justification reasons get a starter list (the other three lists start empty), and the margin is 15 percent. The starter lists are not your client's own. You lose the client's own cost codes, reasons and divisions, and a margin that matches the trade.

**What it controls.** The lists a project budget line points at (resource levels, cost codes, justification reasons, reserve types, divisions, job locations), and the margin assumed when a tender line's cost is not known.

**Where to find it.** Settings > Sales > Contract projects. URL: `/settings/contract-projects`.

**Who can change it.** Admin only. Needs both **Contract projects** and **GCC tender deals**.

**How to set it up.**

1. In the **Lists** table, press **Open** on a list. A side panel opens.
2. To load many entries, press **Import a file**. Use a CSV or Excel file with a header row: Code, Name, and optionally Parent. Format the code column as text so leading zeros stay. The result shows how many were added, updated or refused.
3. To add one entry, fill **Code**, **Name** and optionally **Parent** and press **Add**.
4. Use **Search** to find an entry. Press **Switch off** or **Switch on** on a row. Nothing is deleted.
5. Set **Default margin for estimated costs** and press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Resource levels | Cost types such as Material, Asset. | Starter list |
| Cost codes | The codes a budget line is filed under. | Starter list |
| Justification reasons | Why a budget line changed. | Starter list |
| Reserve types | Types of reserve. | Empty |
| Divisions | Company divisions. | Empty |
| Job locations | Where jobs are done. | Empty |
| Import a file | Replaces or extends a list. Entries match on list and code. A parent code not in the file or the list is dropped with a note, and the row is still stored. | None |
| Default margin for estimated costs | When a tender line's cost is not recorded, the budget starts at the rate less this margin and says "estimated". 0 to 95. | 15 |

The table shows, for each list, how many entries are active, and whether it is the starter list, from a file or entered by hand. The starter lists are not your client's own. Import a file to replace them. Only Resource levels, Cost codes and Justification reasons come with starter rows. Reserve types, Divisions and Job locations start empty.

**What it affects elsewhere.**

- The budget by resource and cost code on a Contract project, and the "estimated" flag on lines.
- A later link to ePROMIS refreshes these lists (see Connectors, C2).
- Change History records the margin change.

Screenshot: settings-contract-projects.png | /settings/contract-projects | The Lists table and the default margin.

**Check it worked.** The Lists table shows each list as "from a file" or "entered by hand", not "starter".

### B14. Account 360 cards

**Module:** Account 360 (shown to workspaces with the **Nova** experience or the **Spectacular** theme, the two that mount the drawer).

**What it controls.** Which cards the Account 360 drawer shows, and in what order.

**Where to find it.** Settings > Sales > Account 360. URL: `/settings/account-360`.

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a default**: all built-in cards, in a fixed order. You lose a shorter drawer in your own order.

**How to set it up.**

1. Under **Cards**, switch a card off to hide it. Use the arrows to move it up or down.
2. Press **Save**. (External sources are on the same page: see C7.)

**Options.**

| Option | What it does | Default |
|---|---|---|
| Built-in cards | Pipeline, Revenue, Service, People, Installed base, Contracts, In ABM programs, Sales coverage, Projects, Marketing, Buying signals, Company analysis. Some show only when their module is on (ABM, Coverage, project costing, lead scoring, Buying signals, web research). | All shown, in this order |

The rating at the top of the drawer is a weighted rubric, not an AI guess. It cannot be changed here.

**What it affects elsewhere.** The Account 360 drawer on accounts.

Note: this page still prints some explanation lines on screen.

**Check it worked.** The drawer on an account shows the cards in your order.

Screenshot: settings-account-360.png | /settings/account-360 | The Cards list with switches and arrows, and one external source open.

### B15. Coverage

**Module:** Coverage (`coverage_model`).

**What you lose if you skip it.** Nothing is assigned automatically. New accounts and leads get no owner by rule, and lead hand-over has no team to use (it falls back to the turn-taking list, B19).

**What it controls.** Who owns, supports and services which accounts, by rules instead of fixed territory lists. It has three parts: **Teams** (people who work together), **Segments** (a rule that picks a set of accounts), and **Coverage** (which team covers which segment in which role). It also drives automatic ownership, product availability and ERP routing.

**Where to find it.** Settings > Users & access > Coverage. URL: `/settings/coverage`.

**Who can change it.** Admin only. Needs the module **Coverage (coverage_model)**.

**How to set it up.**

1. Open **Teams**. Press **+ New team**. Type a **Name**. Pick a **Lead**. With lead scoring on, choose **Who gets new sales-ready leads**: The team lead, or Each member in turn. Tick the **Members**. Press **Add team**.
2. Open **Segments**. Press **+ New segment**. Type a **Code** (capitals) and a **Name**. Pick the filters and choose **Match ALL** or **Match ANY**. Optionally pin **Named accounts** that are always in, whatever the rule says. Press **Add segment**.
3. Open **Coverage**. Press **+ New coverage**. Pick the **Segment**, the **Team**, the **Role** (Owner, Overlay or Service) and a **Priority**. Choose where to **Push this coverage's accounts to** (an ERP webhook). Set **Effective from** and, if needed, **Effective to**. Press **Add coverage**.
4. Use the three-dot menu on a row to **Edit** or **Delete**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Team: Name, Lead, Members | The group and its lead. | Empty |
| Team: Who gets new sales-ready leads | The team lead, or each member in turn. Shown only with lead scoring. Used by lead hand-over (see Lead hand-over, B19). | The team lead |
| Segment: Code, Name | Identify the rule. | Empty |
| Segment: Match ALL / ANY | Whether all filters or any one filter must be true. | ALL |
| Segment: Named accounts | Accounts always included. | None |
| Coverage: Role | Owner (one team wins), Overlay and Service (all matches apply). | Owner |
| Coverage: Priority | Only for Owner. When two Owner segments match, the lower number wins. | 100 |
| Coverage: Push this coverage's accounts to | The webhook that receives the account. With the Webhooks library on, this list is the Call webhooks for accounts. Otherwise it is the tenant default endpoint or a named endpoint. | None or the default endpoint |
| Coverage: Effective from, Effective to | The dates the coverage applies. | Today, no end |

**What it affects elsewhere.**

- Account owner on new accounts and leads (auto-ownership).
- The **Sales coverage** card in Account 360 (B14).
- Lead hand-over: which team and which person receive a ready lead (Lead hand-over, B19).
- Push to ERP routing (Webhooks, C4, and Webhooks and push, C5).
- Change History records team, segment and assignment changes.

Screenshot: settings-coverage-teams.png | /settings/coverage | The Teams tab with one team.
Screenshot: settings-coverage-coverage.png | /settings/coverage | The Coverage tab with one assignment row.

**Check it worked.** A new account in a covered segment gets the team's owner automatically.

## B.3 Marketing

The Marketing group holds three pages. Consent and Leads share the marketing program switch. The marketing modules themselves (Forms, Journeys, Newsletters, WhatsApp, ABM, Events, Revenue by source) have no settings pages of their own. Their limits live in Consent > Limits.

### B16. Marketing consent

**Module:** the platform-admin module **Consent, lead scoring and hand-over (marketing_scoring)**, or **Newsletter Studio**. The "Count newsletter opens" switch appears only with Newsletter Studio.

**What it controls.** What you may email, and the topics people can agree to or refuse.

**Where to find it.** Settings > Marketing > Consent. URL: `/settings/marketing-consent`.

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a safe default**: base "Everywhere else", only people who have said yes are emailed, and four topics. You lose a country rule that matches where you trade, your own topics, and the right default for "confirm by email" on forms. Until someone says yes, nobody is emailed.

**How to set it up.**

1. Choose **Based in**. This is where your business is based. It also sets the default of "ask the person to confirm by email" on forms (on for the EU, off elsewhere).
2. Under **Rules by country**, click a country. Choose what applies to a person with no recorded answer: **Only people who have said yes**, or **Also existing customers, about similar products**. The second choice shows an amber warning. It is not offered for India.
3. Press **Show other countries** to see the rest. A relaxed rule is never hidden.
4. Under **Topics**, press **Add a topic**. Type a **Name** (up to 40 characters) and **Covers** (up to 160). Press **Done**. Use **Remove topic** to delete one.
5. Press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Based in | Saudi Arabia, United Arab Emirates, Qatar, Kuwait, Oman, Bahrain, India, European Union, Everywhere else. | Everywhere else |
| Count newsletter opens | Adds a tracking pixel to newsletters. Off by default because opens are unreliable and many countries restrict tracking. Clicks are always counted. | Off |
| Rules by country | For a person with no recorded answer: only people who said yes, or also existing customers. | Only people who said yes, in every country |
| Topics | What people can agree to separately. Up to 20. A topic people have already answered can be renamed but not removed. | Offers, New products, Service reminders, Events |

Until someone says yes, nobody is emailed unless you chose otherwise. Every yes and no is kept as a record with when and how it was given.

**What it affects elsewhere.**

- Every campaign, newsletter, journey and WhatsApp send: the consent check runs again at the moment of sending.
- Forms and the preference centre (topics, confirm by email).
- Change History records these under "Marketing settings".

**Check it worked.** Forms and the preference centre show your topics, and a campaign to a person with no recorded answer is held back.

Screenshot: settings-marketing-consent.png | /settings/marketing-consent | Based in, Rules by country and Topics tables.

### B17. Marketing limits

**Module:** Journeys or WhatsApp marketing. The **Limits** tab appears only with one of them.

**What it controls.** When and how often marketing messages may go out.

**Where to find it.** Settings > Marketing > Consent > **Limits** tab (`?tab=limits`).

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a default** (quiet 20:00 to 08:00, one email a day, one WhatsApp a week, no journey email on Friday). You lose limits that fit your customers' working days.

**How to set it up.**

1. Open **Limits**. Set **Quiet from** and **Quiet until**, **Emails a day, per person**, **WhatsApp messages a week, per person**, and tap the days on which no journey emails go out.
2. Press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Limits: Quiet from / Quiet until | Journey emails wait while it is quiet. Same hour for both means no quiet hours. | 20:00 to 08:00 |
| Limits: Emails a day, per person | The most journey emails one person gets in a day. 1 to 10. | 1 |
| Limits: WhatsApp messages a week, per person | The most marketing WhatsApp messages in any 7 days. 1 to 20. | 1 |
| Limits: No journey emails on | Days with no journey email. | Friday |
| Limits: Timezone (read-only chip) | Follows the timezone in Workforce, Rules. Shows "(default)" if none is set. | Workforce timezone, else the product default |

**What it affects elsewhere.**

- Journeys and WhatsApp (limits).

**Check it worked.** The timezone chip shows your Workforce timezone (not "(default)"), and a journey email waits during quiet hours.

Screenshot: settings-marketing-limits.png | /settings/marketing-consent?tab=limits | The Limits tab with quiet hours and day chips.

### B18. Lead scoring

**Module:** the platform-admin module **Consent, lead scoring and hand-over (marketing_scoring)**, which needs Marketing campaigns.

**What it controls.** How a lead earns points and when it is ready for sales.

**Where to find it.** Settings > Marketing > Leads > **Scoring** tab. URL: `/settings/marketing-leads`. The old address `/settings/marketing-scoring` opens it.

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a default**: eleven behaviour rules and four profile rules, Warm from 20 and Hot from 60. You lose a score that reflects what your buyers really do.

**How to set it up.**

1. Set the three lines: **Warm from**, **Hot from** and **Look back (days)**. A lead below the first line is Cold, from the first line it is Warm, and from the second it is Hot.
2. In the **Rules** table, click a rule to edit it. Press **Add: what people do** or **Add: who they are** to make a new one.
3. For a "what people do" rule: pick **When someone…**, set **Shown as** and **Points** (negative points allowed). Under **More**, set **Fades over (days)** and **Counts up to (a week)**.
4. For a "who they are" rule: set **Shown as**, **Points**, **Matches when** (every line, or any one line), and add lines with **+ Add a line**.
5. Press **Try on a sample lead** to see a score. Nothing is saved or sent.
6. Press **Save**. The rules version goes up when anything that changes a score changes.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Warm from | A lead at or above this score is showing real interest. 1 to 99. | 20 |
| Hot from | At or above this score a salesperson should call. 2 to 100, above Warm from. | 60 |
| Look back (days) | Older activity is ignored. 7 to 365. | 90 |
| Rules (behaviour) | Eleven built-in rules, for example: clicked a link in an email +10, said they are interested +30, opened a quote +20, filled in a form +30, replied on WhatsApp +25, came to an event +40, unsubscribed -40. | The built-in set |
| Rules (profile) | Four built-in rules: OEM account +10, Based in the Gulf +5, Has an active service contract +5, Buyer-type role +10. | The built-in set |
| Rule: Fades over (days) | Points halve over this time. | Per rule |
| Rule: Counts up to (a week) | Caps the points a rule can add in a week. | Per rule |

**What it affects elsewhere.**

- Scored leads and the Leads list (Cold, Warm, Hot labels and "Why this score").
- The Marketing card in Account 360.

**Check it worked.** **Try on a sample lead** gives the score you expect, and the Leads list shows Cold, Warm and Hot labels with "Why this score".

Screenshot: settings-leads-scoring.png | /settings/marketing-leads | Scoring tab with the three lines and the rules table.

### B19. Lead hand-over

**Module:** the same module as Lead scoring.

**What it controls.** How a ready lead reaches a salesperson and who hears when it is overdue.

**Where to find it.** Settings > Marketing > Leads > **Hand-over** tab (`?tab=handover`). The old address `/settings/marketing-handover` opens it.

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a default**: leads are not made automatically and nobody is told about an overdue lead. With nobody on the turn-taking list, the oldest admin has the leads. You lose automatic hand-over and overdue reminders.

**How to set it up.**

1. Switch **Make a lead when someone becomes Warm** on if you want leads made automatically.
2. Switch on **Tell the owner when a lead is overdue** and **Tell the team lead when a lead is overdue**.
3. Set **Working days to pick up a lead** and tap the **Days off**.
4. Under "When no team covers it, these people take new leads in turn", add people. Order matters.
5. Press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Make a lead when someone becomes Warm | Checked every 15 minutes, never when a page opens. | Off |
| Tell the owner when a lead is overdue | A message in the Nova inbox. Each lead is announced once. | Off |
| Tell the team lead when a lead is overdue | Needs Coverage. | Off |
| Working days to pick up a lead | After this, a ready lead shows as overdue. 0 to 30. | 1 |
| Days off | Do not count towards the response time. | Sunday |
| Turn-taking list | Used when no team covers the company. With nobody listed, the oldest admin has them. Up to 20 people. | Empty |
| Teams chip (with Coverage) | Shows how many teams hand out in turn and how many to the team lead. Change it in Coverage. | Read-only |

**What it affects elsewhere.**

- Lead ownership with Coverage (B15), and the Nova inbox (overdue messages).

**Check it worked.** A lead that becomes Warm appears as a lead within 15 minutes, and an overdue lead shows in the Nova inbox of the owner.

Screenshot: settings-leads-handover.png | /settings/marketing-leads?tab=handover | Hand-over tab with the switches and the turn-taking list.

### B20. Brand kit

**Module:** the platform-admin module **Newsletter Studio**.

**What you lose if you skip it.** It **ships with a default**: the workspace logo, a navy and gold palette and Arial. You lose newsletters in your own colours, fonts, footer address and social links.

**What it controls.** Your logo, colours and email-safe fonts for newsletters, set once and used by every newsletter design.

**Where to find it.** Settings > Marketing > Brand kit. URL: `/settings/brand-kit`.

**Who can change it.** Admin only. Needs the platform-admin module **Newsletter Studio**.

**How to set it up.**

1. Under **Logo**, upload a PNG, JPG or WebP up to 2 MB. Or press **Use the workspace logo instead**.
2. Under **Colours and fonts**, pick the **Main colour**, **Accent colour** and **Text colour**, the **Font** and the **Tone for AI writing**.
3. Under **Footer and social links**, type the **Address lines** and add social links.
4. Press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Logo | The newsletter logo. | The workspace logo |
| Main colour | The email header and the intro banner. | #16365c |
| Accent colour | Buttons and prices. | #c8892a |
| Text colour | Body words on white. Keep it dark. | #1c2733 |
| Font | Arial, Georgia or Segoe UI. Arabic uses Tahoma or Segoe UI next to it. | Arial |
| Tone for AI writing | Formal and courteous, or Warm and friendly. | Formal |
| Address lines | Shown in the footer above the unsubscribe line. Up to 400 characters. | Empty |
| Social links | Name and https address. Up to 6. Only https is kept. Shown where a design has a Social block. | None |

**What it affects elsewhere.**

- Every newsletter design. Changing the kit re-brands a design the next time it is saved. A version already used in a campaign never changes.
- AI drafts and translations (tone).

Note: the Brand kit colours are an email-only override. They do not follow the workspace accent (verify).

Screenshot: settings-brand-kit.png | /settings/brand-kit | The Logo, Colours and fonts, and Footer sections.

**Check it worked.** A newsletter preview shows your logo, colours and footer address.

## B.4 Workforce (the optional tabs and rows)

The Workforce page is described in Part A (A.2). The settings below are the other rows of the same tabs. Each ships with a default.

### B21. Punch rules

**Module:** Workforce.

**What it controls.** How attendance is counted: late marks, breaks, extra punch types, selfies, overtime rate, and how employees sign in.

**Where to find it.** Settings > Workforce > Workforce > **Rules** tab, and **More** on the same tab. URL: `/settings/workforce`.

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a default**: no overtime, no work from home, no site visit, a selfie on check in, check out, breaks and trips, employee self-service on, three late marks to a half-day. You lose overtime costing, remote working punches, alternate Saturdays and your own employment types in the payroll export.

**How to set it up.**

1. Open **Rules**. Set **Late marks per half-day** and **Take breaks off worked hours**.
2. Tick the **Extra punch types** you need. Set the **Selfie with a punch**. If you ticked Overtime, set the **Overtime rate per hour**.
3. Set **Report by location** and, if Overtime is ticked, **Minimum overtime per day (minutes)** if your payroll report needs them. Under **Employment types**, open a type to give it its own leave and weekly off rules. Open **More** for employee self-service, sign-in, the landing page and alternate Saturdays.
4. Press **Save** at the top.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Late marks per half-day | Every N late marks in a month count as one half-day in the summary. | 3 |
| Take breaks off worked hours | Breaks are always recorded. This only decides whether they come off the daily total. | On |
| Extra punch types | Overtime (own session, supervisor approves before pay), Work from home (needs an approved request), Site visit (counts as working time, no approval). | All off |
| Selfie with a punch | Check in, check out, breaks, trips / Every punch / Never. A denied camera ends the punch. | Check in, check out, breaks, trips |
| Overtime rate per hour | One flat rate on actual approved minutes. 0 tracks overtime without costing it. Shown with Overtime on. | 0 |
| More: Employee self-service | On, or Off, tablet only (no phone punching, a supervisor enrols faces). | On |
| More: Sign in with | Email address, or User ID (generated ID plus password, no personal email). Admins always use email. | Email address |
| More: After sign-in, open | Dashboard, or My Workforce. | Dashboard |
| More: Alternate Saturdays | The 1st, 3rd, 4th and 5th Saturdays use a short shift and the 2nd is a holiday, planned a month ahead. Pick the **Short-day shift**. | Off |
| Report by location | The monthly Excel export gets a sheet for each location and employment type, with Sl No, Category, Standard Hrs and Actual Hrs added. Off keeps the usual sheets. | Off |
| Minimum overtime per day (minutes) | Overtime on a day shorter than this is shown but not counted or paid. A day at or above it counts in full. 0 counts everything. Shown with Overtime on. | 0 |
| Employment types | Each type gets its own sheet in the monthly payroll export. The code is made from the label and fixed once saved. A row opens the type's own rules: which leave it is offered and paid, and its weekly off days. A type follows the workspace until you set a row to Custom, and rules apply from the day you first apply them, never to past days. | Full-time, Contractor |

**What it affects elsewhere.** My Workforce (punching), the Roster, Leave, Corrections, the Monthly Summary and the CA Excel export, which punch options employees see, and the employment type list on Employees.

**Check it worked.** My Workforce shows the punch types you ticked, and the employee's sign-in matches the "Sign in with" choice.

### B22. Location rule

**Module:** Workforce.

**What it controls.** What happens to a punch that is outside every site.

**Where to find it.** Settings > Workforce > Workforce > **Places** tab, top of the page (`?tab=places`).

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a default**: keep the punch and mark it. You lose the option to reject punches outside the fence, or to refuse a punch with no location. A mode that rejects also refuses a punch with no location at all, with "Location is required for this punch."

**How to set it up.**

1. Open **Places**. Choose what happens **Outside every site**.
2. Switch on **Require location to check in and out** if you want a location on every check in and out (hidden when you choose Reject).
3. Press **Save** at the top.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Outside every site | Keep the punch, mark it / Reject the punch / No location check. | Keep the punch, mark it |
| Require location to check in and out | Refuses check in, check out and breaks outside the area or without a location. Overtime and trips are never blocked. Hidden when you choose Reject. | Off |

**What it affects elsewhere.** Which punch options employees see and where the app lets them punch. A punch outside a fence in Reject mode is refused with "You're outside every configured site's geofence — move closer and try again."

**Check it worked.** A test punch away from the site is kept and marked, or refused, as you chose.

### B23. Workforce alerts

**Module:** Workforce.

**What it controls.** The phone reminders and the emails the supervisor and the employee receive.

**Where to find it.** Settings > Workforce > Workforce > **Alerts** tab (`?tab=alerts`). The old address `/settings/workforce/reminders` opens it.

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a default**: all emails on except late arrival, no phone reminders and no holiday digest. You lose the punch-out and break reminders and the Monday holiday digest.

**How to set it up.**

1. Open **Alerts**. Switch on the phone reminders you want and tick which email each side gets.
2. Press **Save** at the top.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Punch-out reminder | Phone push after this many worked hours (net of breaks). 1 to 24. | Off, 9 hours |
| Break reminder | Phone push when a break runs long. One per person per day. 5 to 240 minutes. A blank wording uses the standard message. | Off, 30 minutes |
| Holiday digest | One message each Monday naming holidays in the next seven days. | Off |
| Email grid | Tick which email goes to the supervisor and which to the employee. Late arrival (supervisor); Correction (supervisor on filing, employee on decision); Leave (same); Overtime or work-from-home request (supervisor); Flagged punch (employee); Clarification message (either side). | All on except Late arrival |

Phone reminders need the employee to have opened My Workforce and allowed notifications. Email needs email sending set up (see Email output, C1).

**What it affects elsewhere.** Employees, supervisors and the Outbound Emails log (kind "Workforce alerts").

**Check it worked.** A correction request filed by a test employee emails the supervisor (Outbound emails lists it).

## B.5 Data

### B24. Custom fields

**Module:** the menu entry shows if any of Accounts, Contacts, Quotations, Cases, Work Orders, Assets, Suppliers, Purchasing, Invoices or Business Roles is on.

**What you lose if you skip it.** Records carry only the standard fields. You lose fields such as a machine serial number on an account, and their columns in Data Workbench, the API and the MCP tools.

**What it controls.** Extra fields you add to any object, such as a machine serial number on an account. Each field is stored on the record and shows in the API and the MCP tools automatically.

**Where to find it.** Settings > Data > Custom fields. URL: `/settings/custom-fields`.

**Who can change it.** Admin only (the page asks the server, and every change is refused for non-admins). The menu entry shows if any of Accounts, Contacts, Quotations, Cases, Work Orders, Assets, Suppliers, Purchasing, Invoices or Business Roles is on. The tabs on the page show only objects whose module is on.

**How to set it up.**

1. Pick the object tab (for example Account).
2. Press **+ New field**. Type the **Field label**. The key is made from it, such as `cf_machine_serial_number`.
3. Choose the **Field type**. For a dropdown, type the **Options (comma-separated)**.
4. Tick **Required field** if it must be filled in. Press **Add field**.
5. Drag a row by its handle to reorder. Use the row menu for **Rename**, **Make required** or **Make optional**, and **Delete**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Object tabs | Account, Contact, Case, Quote, Standard Quote, Sales Order, Work Order, Asset, Supplier, Product, Inventory, Purchase Order, Invoice, Employee, Project (workforce), Deal (pipeline), RFQ, Estimate, Study, ABM program, ABM target account, ABM buying group member. Each needs its module. | Those your modules allow |
| Field label | The name shown on forms. Renaming is safe. The key never changes. | Empty |
| Field type | Text, Number, Date, Dropdown (select), Checkbox (yes/no), Long text. | Text |
| Options | For a dropdown only. | Empty |
| Required field | The field must be filled in. | Off |

**What it affects elsewhere.**

- The record form and detail page of that object, Data Workbench import and export columns, and the v1 API (under `custom_data`) and MCP tools.
- Deleting a field loses every value already captured in it, on every record.

Screenshot: settings-custom-fields.png | /settings/custom-fields | The object tabs and a list of fields with Required / Optional pills.

**Check it worked.** The new field shows on the record form and detail page of that object.

### B25. Products (categories and item types)

**Module:** Products or Quotations. The **Item types** tab shows only with the **Products** module.

**What you lose if you skip it.** It **ships with a default**: with no categories the product form uses free text, and all ten item types are shown. You lose a controlled category tree, filters by category, and a category code that matches your ERP key.

**What it controls.** The category tree products are filed under (two levels), and the kinds of item a product can be.

**Where to find it.** Settings > Data > Products. URL: `/settings/products`. Item types: `?tab=types`.

**Who can change it.** Admin only. The entry shows with **Products** or **Quotations**. The **Item types** tab shows only with the **Products** module.

**How to set it up.**

1. Open **Categories**. Press **+ New category**. Type a **Name** and a **Code**. Press **Add category**.
2. Click a category to add or rename **sub-categories**, or **Remove** it.
3. Press **Save**.
4. Open **Item types** (with Products). Press **+ New item type**. Type a **Name** and **What it means**. Choose **Used as** (stocked, sold, bought). Press **Add item type**.
5. Click a built-in type to rename it or turn **Shown** off.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Category: Name, Code | Records store the code and screens show the name, so you can rename any time. Match the code to your ERP key. | Empty. While empty, the product form uses free text. |
| Sub-category | One more level under a category. | None |
| Item types (built in) | Finished product, Semi-finished, Raw material, Bought-out component, Consumable, Custom / made to order, Service, Tool / equipment, Certification / document, BOM / kit. | All ten shown |
| Item type: Shown | A hidden type is not offered on new products but stays on those that have it. A type that products still carry can be hidden but not removed. | On |
| Item type: Used as | Stocked, sold, bought. Informational today. | Per type |

Only BOM / kit items can have components, whatever types you add.

**What it affects elsewhere.**

- The product form, product lists and filters, the catalogue tab on quotes, and any custom field that uses the category list.
- Quotation tenants without the Products module still use the category tree for category fields.

Screenshot: settings-products-categories.png | /settings/products | The category table and one category open.
Screenshot: settings-products-types.png | /settings/products?tab=types | The Item types table.

**Check it worked.** The product form offers a category picker, and the list filters by category.

## B.6 Appearance

The Appearance page replaced four older pages (Theme & colours, Navigation visibility, Reset layout, Dashboard content). It has three tabs, one draft and one Save. Its address is `/settings/appearance`; the other tabs are `?tab=menu` and `?tab=dashboard`. The old addresses `/settings/navigation`, `/settings/reset` and `/settings/dashboard` open the matching tab. Admin only. No module flag. Some themes show only if the platform admin switched them on.

### B26. Theme and colour

**Module:** Core.

**What it controls.** The look of the whole workspace on every device.

**Where to find it.** Settings > Appearance > Appearance > **Theme** tab.

**What you lose if you skip it.** It **ships with a default**: Classic if unset, Modern for new workspaces, Blue. You lose your own theme and accent.

**How to set it up.**

1. Click a theme tile. Pick a **Colour**. Switch **Compact sidebar** on or off. Open **More** for extra choices that depend on the theme.
2. Press **Save**. A theme change reloads the page.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Theme | Classic, Modern, Next-gen. With a platform-admin module: Nova, Enterprise, Spectacular, Spectacular Purple. | Classic if unset; Modern for new workspaces |
| Colour | One row that follows the theme: Blue, Teal, Orange, Purple, Slate for most themes; Pink, Orange, Purple, Teal, Blue or Custom for Nova; six colour mixes for Spectacular Purple. | Blue |
| Compact sidebar | Less padding between navigation items. | Off |
| More (Next-gen) | Sign-in name in the top right; Command palette on Ctrl + K; Navy sidebar in light mode. | On when never saved (verify) |
| More (Spectacular Purple) | Custom shell and accent colours; Reset to violet. | Violet |
| More (Nova, Spectacular Purple) | Accent for links and tabs. | The workspace accent |

**What it affects elsewhere.** The sidebar, the top bar, cards and the dashboard for every user and device.

**Check it worked.** The workspace reloads in the theme and colour you chose.

Screenshot: settings-appearance-theme.png | /settings/appearance | The Theme tab with theme tiles and the colour row.

### B27. Sidebar menu

**Module:** Core.

**What it controls.** Which sidebar items show for the whole workspace.

**Where to find it.** Settings > Appearance > Appearance > **Menu** tab (`?tab=menu`).

**What you lose if you skip it.** It **ships with a default**: every item shown. You lose a tidier sidebar.

**How to set it up.**

1. Switch a sidebar item off to hide it for everyone. A parent bundles its sub-items. Press **Reset to defaults** to show everything again.
2. Press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Sidebar items | Show or hide each item for the whole workspace. Hidden items can still be opened by their address. | All shown |

**What it affects elsewhere.** Hiding a menu item is for tidiness. It is not access control. Use Business Roles (B4) for who reaches what.

**Check it worked.** The hidden item is gone from the sidebar for everyone.

Screenshot: settings-appearance-menu.png | /settings/appearance?tab=menu | The Menu tab with groups and switches.

### B28. Dashboard

**Module:** Core.

**What it controls.** What the workspace dashboard opens on, and the optional news and tips cards.

**Where to find it.** Settings > Appearance > Appearance > **Dashboard** tab (`?tab=dashboard`).

**What you lose if you skip it.** It **ships with a default**: Curated on Spectacular, My layout elsewhere; news and tips off. You lose a fixed, ordered set of blocks and the news headlines.

**How to set it up.**

1. Choose what the workspace **Opens on** (Curated or My layout). Switch **Business news** and **Tips and shortcuts** on if you want them. Type up to four news topics.
2. Press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Opens on | Curated: a fixed, ordered set of blocks. My layout: the saved layout (Adapt and My layout). | Curated on Spectacular, My layout elsewhere |
| Dashboard look (tender edition only) | Bold (light) or Control room (dark). Each person can still switch it on the dashboard. | Bold |
| Business news | Headlines for your topics. Needs no accounts, so it has content on day one. | Off |
| News topics | Up to 4, comma-separated. | "business news India, industrial equipment industry" |
| Tips and shortcuts | Rotating cards on things the menu does not reveal. | Off |

**What it affects elsewhere.**

- A person's own dashboard layout is untouched. Switching Curated or My layout does not delete anyone's saved layout.
- The tenant-wide dashboard layout is adapted on the dashboard itself ("Adapt"), and a personal one with "My layout". Roles can also carry a default dashboard (Business Roles, B4).

**Check it worked.** The dashboard opens as you chose.

---

# Part C. Optional

Integrations, connectors, middleware, webhooks, API keys, email output, single sign-on, and anything only some clients need. Do these only when the client asks for them. The read-only logs you use to prove the setup are at the end of this part.

## C.1 Email output

### C1. Email output

**Module:** Core.

**What you lose if you skip it.** It **ships with a default**: a production workspace sends to the real address on the record, and a demo workspace always redirects. Nothing breaks. The risk is the other way round: a new workspace that is still being tested would email real customers. So set **Send to a specified email address** to your own inbox while you test, and switch to business partners at go-live (see "Setup order").

**What it controls.** Where quotations, invoices, campaigns and workforce notifications are actually delivered.

**Where to find it.** Settings > Integrations > Email output. URL: `/settings/email-output`.

**Who can change it.** Admin only. No module flag.

**How to set it up.**

1. Choose **Send to business partners** for a production workspace. Email goes to the real address on the account, contact or employee record.
2. Or choose **Send to a specified email address**. Type the inbox under **Redirect everything to**. Every outbound email, from any transaction, goes there instead, with the intended recipient named in the subject and body.
3. Press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Send to business partners | Uses the real address on the record. For production workspaces only. | On (for non-demo workspaces) |
| Send to a specified email address | Redirects all output to one internal inbox. | Off |
| Redirect everything to | The inbox. | Empty |

A **demo workspace** is always in redirect mode. "Send to business partners" is greyed out and only the inbox can be changed. This is enforced by the server. No test document can reach a real customer.

**What it affects elsewhere.**

- Every email the product sends for the business: quotes, invoices, sales orders, supplier RFQs, inbox replies, campaigns, workforce alerts.
- Outbound Emails (C14) logs what was sent.

Screenshot: settings-email-output.png | /settings/email-output | The two options and the redirect inbox field.

**Check it worked.** Send a test quotation. With redirect on, it arrives in the redirect inbox with the intended recipient named in the subject and body, and Outbound emails (C14) lists it.

## C.2 Integrations

### C2. Connectors

**Module:** Core (no module flag). Some tiles need a module: SAP S/4HANA needs Integration middleware, ePROMIS needs GCC tender deals.

**What you lose if you skip it.** Nothing is connected: quote emails go from BPMSquare's own sender, and RFQ and the Inbox use the platform channels. You lose sending from your own Gmail or mail server, Slack notifications, calendar events and the ERP links.

**What it controls.** Connections from BPMSquare to other systems your team already uses.

**Where to find it.** Settings > Integrations > Connectors. URL: `/settings/connectors`. Two connectors have their own pages: Dynamics 365 (`/settings/connectors/dynamics365`) and ePROMIS (`/settings/connectors/epromis`).

**Who can change it.** Admin only. No module flag. Some tiles need a module: SAP S/4HANA needs Integration middleware. ePROMIS needs GCC tender deals.

**How to set it up.**

1. Click a tile to open it. Press **Connect**.
2. Fill the fields, then press **Save & connect**.
3. Press **Test connection** to check it. Press **Disconnect** to remove it. Anything relying on it stops at once.

**Options.**

| Connector | What you enter | What it is for |
|---|---|---|
| Slack | Incoming Webhook URL | Connect and test the connection. Nothing is posted to Slack yet. |
| Google Calendar | The secret address in iCal format | Connect and test the connection. Events are not read yet. |
| Gmail | Gmail address and a 16-character App Password (needs 2-Step Verification on) | Send quote emails from your own Gmail. A quote can go as a real reply in the customer's thread. |
| Mail server (SMTP / IMAP) | Email address, username, password, SMTP server and port, IMAP server and port | Your own mailbox for RFQs and Inbox replies. |
| Microsoft Dynamics 365 | Opens its own page; with Integration middleware on, opens the middleware page | Bring customers, contacts, vendors, products and projects in; send awarded Standard Quotes back. |
| SAP S/4HANA | Managed on the Integration middleware page | Bring customers, suppliers and products in; read sales orders, deliveries and invoices; check and send Sales Orders. |
| ePROMIS | Base URL, Sign-in type (API key, bearer token or user name and password), credential, company code, Endpoint map | Read tenders, the Resource Master, cost codes and justifications; send an awarded tender's project and budget. |

A password or key is stored encrypted and is never shown again. Leaving the field blank when editing keeps the stored one.

**What it affects elsewhere.**

- RFQ (mail channel), Inbox channels (mailbox), and quote email threading (Gmail).
- Integration middleware (Dynamics 365, SAP S/4HANA).
- Contract projects lists (ePROMIS, later).

Screenshot: settings-connectors.png | /settings/connectors | The connector tiles with Connected / Not connected pills.

**Check it worked.** The tile shows **Connected**, and **Test connection** succeeds.

### C3. Integration middleware

**Module:** the platform-admin module **Integration middleware**.

**What you lose if you skip it.** Nothing syncs with your ERP. You lose awarded quotes going to the ERP, customers, suppliers and products read in, the Monitor and Resync.

**What it controls.** Everything about syncing with your ERP in one place: the connection, the links between BPMSquare objects and ERP objects, field mapping, a monitor of every message, and resync from the ERP.

**Where to find it.** Settings > Integrations > Integration middleware. URL: `/settings/middleware`. The chosen connector is kept in the address (`?connector=`). Tabs: `?tab=links|mapping|monitor|resync`.

**Who can change it.** Admin only. Needs the platform-admin module **Integration middleware**. Without it the address redirects back to Settings.

**How to set it up.**

1. Pick a connector chip at the top (Microsoft Dynamics 365, SAP S/4HANA). Click the open chip to see or change the connection.
2. If there is no connection, press **Connect <name>**. Enter the details (below). Press **Test**.
3. Follow the slim line "Set up 3 of 5 · Next: ..." It shows five checks: Connect, Choose the links, Read customers, Send a test quote, First real quote. For SAP S/4HANA only two apply: Connect and Read customers, because SAP only reads.
4. **Links** tab: each row links a BPMSquare object with one in the ERP. Switch it on. Click the Standard Quote row to choose **Create as** (what the quote becomes in the ERP), **Which webhook** (for a webhook target), a **price list** to use when the customer has none, and what to **Include**. Use **Preview** and **Send a quote now** to try it.
5. **Mapping** tab: choose which document to map, then **Fields** or **Value mapping**. Each line sends one BPMSquare field to one ERP field. Use **Fetch fields**, **Reset to standard** and **Try it**. Value lists turn BPMSquare values into the ERP's codes.
6. **Monitor** tab: filter by status, direction, document and dates. Tick lines and press **Restart**. Open a line with **View request** and **View response**.
7. **Resync** tab: set **Automatic** (Off, Hourly, Daily at 02:00 UTC), use **Sync now** or **Full resync**, narrow each entity with **Scope**, or read **Specific records** by ERP id or send one record.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Connection: Product | Dynamics 365 Dataverse, Finance and Operations, or Business Central. Decides what an awarded quote becomes. | Per connector |
| Connection: Login type | App registration with a client secret is usual. Also certificate, user account, or username and password (Business Central on-premises). | App secret |
| Connection: Address, Directory ID, Client ID | Where and who. | Empty |
| Connection: Secret and Secret expires on | Pasted once; stored sealed and shown as Stored. The page warns 30 days before it expires. | Empty |
| Connection: Company or Legal entity | The company inside the ERP that records are written to. | Empty |
| SAP: Login type, API host, Communication user, Password or API key | Communication user of an arrangement (scenario SAP_COM_0008, and SAP_COM_0009 for products), or an API key from the SAP Business Accelerator Hub sandbox. | Empty |
| Keep bodies of inbound pulls and API calls | Keeps the request and answer for 2 days, with personal data and tokens removed. | Off |
| Link switch | A quote goes to the ERP when it is awarded. A rejected quote never leaves. | Per link |
| Resync: Automatic | Off, Hourly, Daily. | Off |
| Resync: Scope | Reads only records that match every row of conditions. Records outside it stay as they are. Nothing is deleted. | No scope |

**What it affects elsewhere.**

- Standard Quotes: what is sent on award or rejection, and the ERP number shown on the quote.
- Customers, suppliers, products and projects read in from the ERP (they show an ERP id line on the record).
- Sales Orders: availability and checks with SAP, and the ERP organisation chips on Order types and Coverage.
- Webhooks (Call webhooks), Connectors (tile click goes here), the Monitor, and API call logging.
- Change History records mappings and value lists.

Screenshot: settings-middleware-links.png | /settings/middleware | The connector chips, the setup line and the Links table.
Screenshot: settings-middleware-monitor.png | /settings/middleware?tab=monitor | The Monitor with filters and the action bar.

**Check it worked.** The slim setup line reads "Set up 5 of 5" (2 of 2 for SAP S/4HANA), and a test quote shows an ERP number.

### C4. Webhooks

**Module:** the platform-admin module **Webhooks library**.

**What you lose if you skip it.** You keep the older page Webhooks and push (C5). You lose the single list of Event and Call webhooks, signing, tests and the log.

**What it controls.** Every address BPMSquare calls, in one list. An **Event** webhook sends changes in scheduled batches. A **Call** webhook sends one record when something fires it: a quote award, a button on an account, or a Coverage route.

**Where to find it.** Settings > Integrations > Webhooks. URL: `/settings/webhooks`.

**Who can change it.** Admin only. Needs the platform-admin module **Webhooks library**. Without it the address shows "not found" and you keep the older page Webhooks and push (C5).

**How to set it up.**

1. Press **New webhook**. On **Basics**, type a **Name** and choose the **Kind**: Call or Event. The kind cannot change later.
2. For a Call, choose what it **Sends** (Accounts or Standard Quotes, or whatever the server lists). For Accounts you can tick **Button on Accounts**. For an Event, pick **All objects** or tick objects.
3. On **Request**, type the **Address** (https), choose the **Method**, and choose the **Payload**: Standard (a signed record in a fixed shape), Template (your own JSON with tokens) or Body from mapping. Add **Headers** your receiver expects. Optionally set **Read the id from the answer**.
4. Press **Create**. The panel then gains **Security**, **Test** and **Log** tabs.
5. On **Security**, copy the **Signing secret**. It is shown once. **Regenerate** it if needed, then update the receiver at once.
6. On **Test**, choose a real record and send, or **Preview** the exact request without sending.
7. A webhook that failed 15 times pauses itself. Press **Resume** to start it again.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Name | Shown in lists. Up to 80 characters. | Empty |
| Kind | Call (one record when fired) or Event (every change). Fixed after creation. | Call |
| Sends | The kind of record a Call sends. Fixed after creation. | Accounts |
| Changes sent (Event) | All objects, or Quotes, Accounts, Contacts, Cases, Work orders, Invoices, Purchase orders, Inventory, Assets, Suppliers. | All objects |
| Button on Accounts | Adds a "Send to this webhook" entry to the menu on every account page. | Off |
| On / Off | Off stops calls but keeps the set-up. | On |
| Address | The https address. Tokens allowed in the path or query, never personal data. | Empty |
| Method | GET (no body), POST, PUT, PATCH. | POST |
| Payload | Standard, Template, or Body from mapping (mapping is built on the Integration middleware Mapping tab). | Standard |
| Headers | Extra headers such as an API key. After saving a value is hidden and can only be replaced. | None |
| Send personal data | Switch on only if the receiver needs email, phone or tax numbers. | Off |
| Wait for an answer (seconds) | How long to wait before the call counts as failed. A failed call is tried once more after 2 seconds. | 15 |
| Read the id from the answer | Where the receiver's own number sits in its answer, such as `$.data.number`. Kept and shown on the quote. | Empty |
| Signing secret | Every call is signed so the receiver can check it came from BPMSquare. | Made on creation |

**What it affects elsewhere.**

- Integration middleware > Links: the "Which webhook" choice for an awarded quote (Integration middleware, C3).
- Coverage: the "Push this coverage's accounts to" choice (Coverage, B15).
- The account page menu (record button).
- The Monitor on the Integration middleware page shows calls for 2 days.
- A webhook that is in use cannot be deleted. The panel says where it is used.
- Change History records webhook changes.

Screenshot: settings-webhooks-list.png | /settings/webhooks | The webhooks list with Kind, State, Last call and Used by.
Screenshot: settings-webhooks-panel.png | /settings/webhooks | A webhook open on the Request tab.

**Check it worked.** The **Test** tab sends a real record and the **Log** tab shows the answer.

### C5. Webhooks and push

**Module:** Core (no module flag). Hidden when the Webhooks library is on.

**What you lose if you skip it.** No event webhooks and no "Push to ERP" action on an account.

**What it controls.** The older way to send data out: Event webhooks, and pushing one record to your ERP on demand with the "Push to ERP" action on an account.

**Where to find it.** Settings > Integrations > Webhooks & push. URL: `/settings/push`.

**Who can change it.** Admin only. No module flag. This entry is hidden when the Webhooks library is on. The address then redirects to Webhooks (C4).

**How to set it up.**

1. Under **Webhooks**, press **+ New webhook**. Type a **Name** and an **Endpoint URL**. Choose **All objects** or tick objects. Press **Create webhook**. Use **Pause** or **Resume** on a row, and **Delete**.
2. Under **Push to external systems**, type the **Receiving URL**.
3. Under **Signing secret**, press **Generate** (or **Regenerate**, which stops the old one at once). The real value appears only once, right after Generate or Regenerate, with a **Copy** button: "Copy it now. It is not shown again." Copy it to the receiving end. Afterwards the screen only shows **Set**.
4. Press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Webhook: Name, Endpoint URL | Where each create, update or delete is sent, signed with HMAC-SHA256 in the `X-BPMSquare-Signature` header. Only events after registration are sent. | Empty |
| Webhook: objects | All objects, or Quotes, Accounts, Contacts, Cases, Work Orders, Invoices, Purchase Orders, Inventory, Assets, Suppliers. | All objects |
| Receiving URL | The ERP or other system that receives a pushed record. | Empty |
| Signing secret | Signs pushes so the receiver can verify them. Write-only: the screen shows **Set**, and the value is shown once, right after Generate or Regenerate. Without one, pushes are unsigned. | Not generated |

Push is live today on Accounts only.

**What it affects elsewhere.**

- The "Push to ERP" action on an account.
- Coverage routing to named endpoints (Coverage, B15).
- Replaced by Webhooks (C4) when that module is on.

Screenshot: settings-push.png | /settings/push | The Webhooks list and the Push to external systems section.

**Check it worked.** "Push to ERP" on an account is accepted by the receiver, which verifies the signature.

### C6. API keys and developer

**Module:** Core (no module flag).

**What you lose if you skip it.** No key exists until you generate one. You lose any integration that calls `/api/v1`, the change feed, `/ask` and the MCP tools.

Keys belong to your workspace only, and only admins can see or manage them. A scoped token is shown once, when you create it, and only a hash is stored. A lost key can only be revoked and replaced. Regenerate the full-access key if it leaks.

**What it controls.** Your full-access API key, scoped keys, and the address of the API reference.

**Where to find it.** Settings > Integrations > API keys & developer. URL: `/settings/developer`.

**Who can change it.** Admins see and change keys. The menu entry is not marked admin only, so other people who can open Settings see a line asking them to ask an admin. No module flag.

**How to set it up.**

1. To make a full-access key, press **Generate key**. Copy it with **Copy key**. **Regenerate** replaces it. The old one stops at once, and anything using it (an ERP integration, an AI assistant's MCP config) needs the new one.
2. To make a narrower key, under **Scoped API keys** press **+ New key**. Type a **Name**.
3. Tick **Read** and/or **Write**. Leave **All objects** ticked, or untick it and pick objects.
4. Optionally set **Expires**. Press **Create key**.
5. Copy the token at once. It is shown once and never again.
6. Press **Revoke** on a row to stop a key. A revoked or expired key shows a label.
7. Use **Copy address** for the API reference (`/api/v1/openapi.json`). Import it into Postman or your integration tool, and send your key as a Bearer token.

**Options.**

| Option | What it does | Default |
|---|---|---|
| API key | One full-access key (read and write, every object). | None until generated |
| Scoped key: Name | A label. Required. | Empty |
| Read, Write | What the key may do. At least one is needed. | Read on, Write off |
| All objects / chosen objects | Deals, Quotations, Accounts, Cases, Inventory, Invoices, Purchase Orders, Pricing (engine), Products, Projects (workforce), RFQs (supplier prices), Estimates (quoted prices, no costs), ABM programs, Standard Quotes, Sales Orders, ABM target accounts (buying-group roles), Employees (staff data). | All objects |
| Expires | An end date. | No expiry |
| API reference address | `/api/v1/openapi.json`, listing every endpoint your keys can reach. | Fixed |

Employees, contacts, RFQs, estimates, ABM target accounts, tenders and contract projects are reached only when named. "All objects" does not include them. The picker today does not offer contacts, tenders or contract projects (verify).

**What it affects elsewhere.**

- Anything that calls `/api/v1`, the change feed, the `/ask` query and the MCP tools.
- A key sees only your workspace, and only the modules you have.

Screenshot: settings-developer.png | /settings/developer | The API key row, the Scoped API keys list and the API reference row (hide the key value).

**Check it worked.** A call to `/api/v1` with the key as a Bearer token returns your data, and nothing outside the scope you set.

### C7. Account 360 external sources

**Module:** Account 360 (shown to workspaces with the **Nova** experience or the **Spectacular** theme).

**What it controls.** External systems that supply extra cards to the Account 360 drawer.

**Where to find it.** Settings > Sales > Account 360 > **External sources**. URL: `/settings/account-360`.

**Who can change it.** Admin only.

**What you lose if you skip it.** The drawer shows only the built-in cards.

**How to set it up.**

1. Under **External sources**, press **+ Add a source**. Type a **Card title** and a **Card id**.
2. Enter the **URL** (https only). It may carry `{account_id}`, `{account_ref}`, `{account_name}`, `{gstin}`, `{city}` or `{email}`, each filled from the account being viewed.
3. Optionally set an **Auth header** (for example Authorization) and **Auth value** (for example a bearer token), and a **Root path** inside the JSON answer.
4. Under **Fields**, press **+ Add field** for each value: a label and a JSON path such as `credit.limit`.
5. Switch the source on. Press **Save**.

**Options.**

| Option | What it does | Default |
|---|---|---|
| Source: Enabled | Turns one source on or off. | Per source |
| Source: Card title, Card id, Root path | Names the card and where in the JSON to read from. | Empty |
| Source: URL | Fetched by BPMSquare's server, never the browser. Private and internal addresses are refused. | Empty |
| Source: Auth header, Auth value | Sent with the request. The value is a secret. After saving it shows as saved. Leaving it blank on a later save keeps it. | Empty |
| Source: Fields | Label and JSON path pairs. | Empty |

**What it affects elsewhere.** The Account 360 drawer on accounts. Only admins can read the saved auth value. Non-admins never receive it.

**Check it worked.** The new card appears in the drawer of an account, with a value from the external system.

## C.3 Single sign-on, Workforce extras and logs

### C8. Single sign-on (Coming soon)

**Module:** Core.

**What you lose if you skip it.** Nothing today. The page is a placeholder.

**What it controls.** Nothing yet. The entry holds its place in the menu until people can sign in through your company identity provider. The email address stays the login id, so nothing needs re-entering when it arrives.

**Where to find it.** Settings > Users & access > Single sign-on. URL: `/settings/sso`.

**Who can change it.** Admin only. No module flag.

**How to set it up.** There is nothing to set. The page shows a **Coming soon** label.

**Options.** None.

**What it affects elsewhere.** Nothing today. People sign in with their email and password.

Screenshot: settings-sso.png | /settings/sso | The page with the Coming soon label.

### C9. Face, passkey and door tablets

**Module:** Workforce.

**What it controls.** Signing in and punching by face, passkey sign-in, selfie checks and retention, and the door tablet.

**Where to find it.** Settings > Workforce > Workforce > **Rules** tab, under **More**; and **Places**, in the site panel. URL: `/settings/workforce`. The old address `/settings/workforce/kiosks` opens Places.

**Who can change it.** Admin only.

**What you lose if you skip it.** Staff punch from their phone with a selfie, with no face check and no door tablet. It **ships with a default**: all of these are off.

**How to set it up.**

1. Open **Rules** and then **More**. Set **Face punch** (Off or Door tablet), **Face sign-in**, **Check selfies against the face**, **Keep selfies for (days)** and **Passkey sign-in**.
2. Open **Places** and a site. Register a door tablet by name. Open `/kiosk` on the tablet and paste the code, which is shown once.
3. Press **Save** at the top.

**Options.**

| Option | What it does | Default |
|---|---|---|
| More: Face punch | Off, or Door tablet. | Off |
| More: Face sign-in | Sign in by face. Needs Face punch on. | Off |
| More: Check selfies against the face | Off, or Flag a mismatch (never blocks a punch). | Off |
| More: Keep selfies for (days) | Punch selfies are deleted after this. | 90 |
| More: Passkey sign-in | Phone fingerprint or Face ID unlocks sign-in. Only a public key is stored. | Off |
| Tablet: name | Register a door tablet. Open `/kiosk` on the tablet and paste the code, which is shown once. | None |

**Check it worked.** The tablet shows as registered and a punch at the tablet is recorded. With employee self-service off, a phone punch is refused: "Punching from your phone is turned off — punch in and out at the office kiosk."

### C10. Project billing

**Module:** Workforce, with **Project Costing** and **Invoices** (the **Billing** tab shows only with all three).

**What it controls.** Charging project hours to a customer, and the draft invoices raised from them.

**Where to find it.** Settings > Workforce > Workforce > **Billing** tab (`?tab=billing`). The old address `/settings/workforce/employment` opens Workforce > Rules (employment types sit under More).

**Who can change it.** Admin only.

**What you lose if you skip it.** It **ships with a default** of zero rates, which means billing is not set up: previews refuse to raise a zero invoice. You lose invoicing of project hours.

**How to set it up.**

1. Open **Billing**. Set **Bill rate per hour**, **Cost rate per hour** and **Invoice due after (days)**.
2. Switch **Draft invoices at month end** on if you want drafts raised on the 1st. Set **Rate by employment type** to override the default per type.
3. Press **Save** at the top.

**Options.**

| Option | What it does | Default |
|---|---|---|
|---|---|---|
| Bill rate per hour | Charged when neither the project nor the employment type sets a rate. 0 means billing is not set up and previews refuse to raise a zero invoice. | 0 |
| Cost rate per hour | What an hour costs the business, for margin. Internal only. | 0 |
| Invoice due after (days) | Due date on a draft invoice. | 30 |
| Draft invoices at month end | On the 1st, each active project linked to an account gets a draft for last month's hours. You still review and send each. | Off |
| Rate by employment type | Overrides the default per type. A rate on the project wins, then the employment type, then the default. | Blank |

**What it affects elsewhere.** Invoices: draft project invoices.

**Check it worked.** The billing preview for a project with hours shows a non-zero amount.

## C.4 Logs and checks (no settings)

These pages hold no settings. You use them to prove the setup worked.

### C11. Deleted records

**Module:** any of the core CRM modules.

**What it controls.** An audit log of permanently deleted quotes, cases, work orders and accounts: what was deleted, when and by whom. It is a record. You cannot restore from it.

**Where to find it.** Settings > Data > Deleted records. URL: `/settings/deletion-log`.

**Who can change it.** Admin only to view. Only a platform admin sees **Clear log**. The entry shows if any of the core CRM modules is on.

**How to set it up.**

1. Use the chips (All, Quotes, Cases, Work Orders, Accounts) to filter.
2. Read the columns: Type, Ref / Name, Account, Status / Total, Original created, Deleted at, Deleted by.
3. A platform admin can press **Clear log**, which cannot be undone.

**Options.** No settings. It is read-only for admins.

**What it affects elsewhere.** Nothing. The log fills when someone permanently deletes one of the four object types. Other changes are in Change History (C13).

Screenshot: settings-deleted-records.png | /settings/deletion-log | The log table with the type chips.

### C12. Audit and users hub

**Module:** **Administration hub**. These pages are in the sidebar item **Audit & Users**, not in Settings. They are admin only and need their own module switches.

**What it controls.** A home for audit and operations tools that do not belong in Settings.

**Where to find it.** Audit & Users. URL: `/administration`.

**Who can change it.** Admin only. Needs the module **Administration hub**. Cards: Change History (needs **Change History**), Outbound Emails (needs **Outbound Emails**) and People (needs **Business Roles**; it opens Settings > People). If no card is available the page sends you to the dashboard.

**How to set it up.** Click a card to open it. The cards you see depend on your modules.

**Options.** None. It is a menu of destinations.

**What it affects elsewhere.** Nothing. It only links to Change History, Outbound Emails and People.

Old addresses `/administration/business-users` and `/administration/business-roles` redirect to Settings > People.

Screenshot: administration-hub.png | /administration | The hub with its cards.

### C13. Change history

**Module:** **Change History**.

**What it controls.** Nothing. It is a log. It shows every create, update and delete recorded at the moment it happened.

**Where to find it.** Audit & Users > Change History. URL: `/administration/change-history`.

**Who can change it.** Admin only. Needs the module **Change History**.

**How to set it up.**

1. Choose an **Object** from the dropdown (it lists only objects your modules have).
2. Optionally type a specific record's ID.
3. Read the rows: who, when and what changed.
4. Press the download button for a CSV.

**Options.** The object filter includes records such as Accounts, Contacts, Deals, Quotes, Standard Quotes, Sales Orders and order types, Cases, Invoices, RFQs, Estimates, Leads, Inbox emails and channels, Forms, Journeys, Events, Employees, Pricing versions, Coverage teams, segments and assignments, Webhooks, Integration mappings and value lists, Marketing settings, and People and access.

**What it affects elsewhere.** Nothing. Not every setting is logged. Of the settings pages in this guide, changes to Coverage, Currency, Tenders, Contract projects, Consent and Limits, Webhooks, Integration mapping, Inbox channels and pricing versions are recorded. Changes to who can sign in and with what access (logins, roles, Business Roles, locks, password resets, validity) are recorded under "People and access". No log call was found in the code for changes to Roles themselves, Company or Quotations settings (verify).

Screenshot: administration-change-history.png | /administration/change-history | The object filter and a list of changes.

### C14. Outbound emails

**Module:** **Outbound Emails**.

**What it controls.** Nothing. It is a log of every email the product tried to send, with the recipient, subject and whether it succeeded.

**Where to find it.** Audit & Users > Outbound Emails. URL: `/administration/outbound-emails`.

**Who can change it.** Admin only. Needs the module **Outbound Emails**.

**How to set it up.**

1. Choose a channel: All channels, Quote emails, Invoice emails, Sales order emails, Supplier RFQs, Inbox replies, Campaign sends, Workforce alerts, Password resets.
2. Optionally type a Quote or campaign ID.
3. Failed rows show the error. Press the download button for a CSV.

**Options.** None. It is read-only.

**What it affects elsewhere.** Nothing. It shows what the Email output setting (C1) and each module's send routes did. Every business email goes through the Email output rule, so a demo workspace shows its redirected sends here.

Screenshot: administration-outbound-emails.png | /administration/outbound-emails | The channel filter and the sent / failed rows.

## C.5 Old addresses that still work

Several pages were folded into tabs. The old addresses still open the right place, so saved links keep working.

| Old address | Opens |
|---|---|
| `/settings/general` | Settings > Company |
| `/settings/entities` | Company, Entities tab |
| `/settings/currency` | Company, Tax and currency tab |
| `/settings/number-ranges` | Company, Numbering tab |
| `/settings/navigation`, `/settings/reset` | Appearance, Menu tab |
| `/settings/dashboard` | Appearance, Dashboard tab |
| `/settings/product-categories`, `/settings/sales` | Products, Categories tab |
| `/settings/item-types` | Products, Item types tab |
| `/settings/statuses`, `/settings/quote-types`, `/settings/templates`, `/settings/email-templates`, `/settings/asset-print-fields` | Quotations, the matching tab |
| `/settings/team`, `/administration/business-users`, `/administration/business-roles` | People (Roles tab for roles) |
| `/settings/marketing-scoring`, `/settings/marketing-handover` | Leads, Scoring or Hand-over tab |
| `/settings/workforce/attendance`, `/verification`, `/shifts`, `/sites`, `/kiosks`, `/leave-types`, `/reminders`, `/employment` | Workforce, the matching tab (employment types now sit in Rules, More) |
| `/settings/pricing-engine` | The Pricing workspace |
| `/settings/connectors/dynamics365` | Integration middleware (when it is on) |
| `/settings/push` | Webhooks (when the Webhooks library is on) |

---

# Setup order

One numbered run through all three tiers, in the order a consultant should do them. It follows the provisioning runbook. Steps 1 to 3 are done by the BPMSquare team. The rest are done by your admin or the implementation consultant. Skip a step only if its module is not in the workspace. When every A row of your modules is ticked in the master checklist, the workspace works.

**Before the workspace exists**

1. **Decide.** Shared database (the default) or a dedicated instance. The module package (for example Workforce only, or full CRM with the sold extras). The currency. A provisioning admin email, as a plus-alias of the operator's address so it makes a new login (A1, A2).
2. **Create the workspace** (A1): name, short permanent code, the domain people sign in at, accent colour, currency, plan, the first admin and the modules. The Tenant Creation Studio can draft this from a plain description. Experimental flags (Nova, Enterprise, Spectacular) are set by hand only.
3. **Connect the domain** (A1): add the domain in the hosting project, add the DNS record, wait for "Valid Configuration", and allow the address in the sign-in redirect list. The workspace is unreachable until this is done. Do not sign in while the certificate is still being made.

**First sign-in, then the Core must-haves (Part A)**

4. **First sign-in and scoping check** (A2). The first admin signs in with the initial password and is forced to choose a new one. Check that the sidebar shows only the modules you bought, the Settings menu has no pages for absent modules, and Global search lists only your objects. The dashboard starts nearly empty for a scoped workspace. That is correct. Use Adapt on the dashboard to install the module's widgets.
5. **Email output** (C1): set **Send to a specified email address** to your own inbox, so no test email can reach a real customer. Switch it at go-live (step 28).
6. **Tax and currency** (A4). Do this before you load any data.
7. **People** (A3). Add your own admin in Settings > People > Invite with role **Admin**. Then remove the provisioning alias login and any plain-email login the platform admin used. Every other person is created inside the workspace, not from Admin > Tenants. Add staff the employee-first way (Employees > add the employee > **Create login**); for many people use the Data Workbench Employees then Users imports. Copy the details from the result screen and hand them over: they are not shown again.

**The module must-haves (Part A), only the modules you bought**

8. **Workforce** (A5 to A10), in this order: timezone and weekly off days (A5), shifts (A6), sites and their supervisors (A7), leave types (A8), holidays on the Leave & Holidays screen (A9), then the WFM role, shift, home site and supervisor of each employee (A10) and their logins (A3).
9. **Tenders** (A11): choose the approvers, or switch on self-approval in a one-admin workspace.
10. **Estimates** (A12): add a starter template and copy it, or build one.
11. **Shared Inbox** (A13): add the first channel and forward the company mail to its address.
12. **Saudi e-invoicing** (A14): complete the seller details of the legal entity, and set the currency to SAR.
13. **Service**: nothing to set (A.7).

**Nice to have (Part B)**

14. **Company** (B1 profile and letterhead, B2 legal entities, B3 numbering).
15. **Sales:** Quotation statuses, offer types, templates and print fields (B5 to B8), Order types (B9), Pricing rate card (B10), RFQ (B11), Tender pricing defaults (B12) and Contract project lists (B13), then Coverage (B15) and Account 360 cards (B14).
16. **Business Roles** (B4), then tick them on each Member in People (A3).
17. **Marketing:** Consent (B16), Limits (B17), Lead scoring (B18), Lead hand-over (B19), Brand kit (B20).
18. **Workforce extras:** punch rules (B21), the location rule (B22), alerts (B23).
19. **Data:** Custom fields (B24), Product categories and item types (B25).
20. **Appearance:** theme (B26), sidebar menu (B27), dashboard (B28).

**Optional (Part C), only when asked**

21. **Connectors** (C2): Gmail or a mail server, Slack, calendar, Dynamics 365, SAP S/4HANA, ePROMIS.
22. **Integration middleware** (C3), then **Webhooks** (C4) (or the older Webhooks and push, C5).
23. **API keys** (C6): the full-access key and scoped keys.
24. **Account 360 external sources** (C7).
25. **Workforce extras:** face, passkey and door tablets (C9), project billing (C10).
26. **Single sign-on** (C8): not available yet.

**Go live and hand over**

27. **Walk the master checklist.** Every A row of your modules is ticked, and each "How to confirm it is done" is true.
28. **Email output** (C1): switch to **Send to business partners** for a production workspace.
29. **Check the logs:** Change History (C13) and Outbound Emails (C14) show what was done and what was sent.
30. **Hand over.** Make sure the provisioning alias login and any plain-email membership are gone (A2, A3). The platform admin can always re-enter for support.

# Common questions

**1. Why is a Settings page in this guide missing from my menu?**
The module behind it is not switched on for your workspace, or you are not an admin. Only the BPMSquare team can switch a module on. Ask them. The menu search will not find a page your workspace does not have.

**2. What is the difference between an Admin and a Business Role called "Admin"?**
The workspace role **Admin** is set in Settings > People. It reaches everything and is not limited by roles. Business Roles such as "Sales Admin" are sets of areas with Create, Edit and Delete. They apply to Members only and do not make anyone a workspace admin.

**3. Can I use Business Roles to keep information away from a colleague?**
No. Business Roles hide menu items and dashboards. They are not a data boundary, and the data routes do not check them. Hiding a sidebar item in Appearance is also not access control, because a hidden item still opens by its address.

**4. I gave someone a password. Will they be asked to change it?**
Yes, whenever your add created a new login with that password: Invite with a password, Employees > Create login, the Data Workbench Users import, or Reset password. They choose their own at the first sign-in. If the email already had an account on the platform, that account is linked and keeps its own password, and nobody is forced to change anything.

**5. A person left. What should I do?**
Open their row in Settings > People. Press **Lock** to stop them at once, or set **Valid to** in the Validity section. Use **Remove** to take them out of the workspace. The Changes section keeps a record of what you did. Their login is not deleted. Keep an admin in the workspace, because you cannot lock or remove yourself.

**6. I changed the currency. Did my amounts convert?**
No. The currency only relabels figures. Set it before you load data.

**7. A key leaked. What now?**
Open Settings > Integrations > API keys & developer. For the full-access key, press **Regenerate**. The old key stops at once. For a scoped key, press **Revoke** and make a new one. Then update anything that used the old key.

**8. I hid an offer type or removed a status. Did old quotes change?**
Hiding an offer type removes it from the New Quotation picker only. Quotes already made keep their type. For statuses, the page stops you removing the starting status or the last one, and it needs at least one closed status. It does not check whether quotes still use a status, so rename a status rather than remove one that is in use (verify).
