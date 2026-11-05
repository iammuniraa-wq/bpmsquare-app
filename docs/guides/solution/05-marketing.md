# BPMSquare solution guide: Marketing

Snapshot 5 Nov 2026

> Screen names and button words may be refined as the product improves. If a name here is slightly different on your screen, look for the same idea nearby. Anything marked "(verify)" could not be confirmed from the product and should be checked with your BPMSquare contact before you rely on it.

## About this chapter

This chapter is for marketers and the consultants who set Marketing up. For each screen it explains what it is, where it is, who uses it, how to do the common tasks, what the statuses mean, how it connects to the rest of BPMSquare, and what to watch for. It is a reference. For a gentler walk-through of setup, see the Marketing how-to guide (`docs/guides/marketing-how-to.md`).

### How Marketing is laid out

Marketing is in the left menu in two parts, each with its own heading.

| Part | Menu rows | The job |
|---|---|---|
| **Marketing** | Overview, Audiences, Email, Journeys, Forms, WhatsApp, Events | Reach people |
| **Intelligence** | Overview, Buying signals, Leads, ABM programs, Results | Know who is ready and what worked |

**Scoring rules** are not a menu row. A **Scoring rules** link on the Intelligence Overview opens **Settings > Marketing > Leads**. **Partners** sits under **Master data**. Settings that change Marketing behaviour are under **Settings > Marketing**. On a phone, the Intelligence part may sit under **More** in the bottom bar.

Earlier versions of this guide used the words Segmentation, target group, Campaigns, Newsletters as a separate screen, Scored leads and Revenue by source. They map to the new names like this:

| Earlier name | Now |
|---|---|
| Segmentation, target group | Audiences, audience |
| Campaigns and Newsletters (two menu rows) | Email, with chips Sends, Newsletters and Templates |
| Leads and Scored leads (two menu rows) | Leads, with a switch All leads or Scored |
| Revenue by source | Results (the page title stays Revenue by source) |
| "Skipped" on a send | Left out |

### The two Overview screens

Each part opens on an **Overview**: a short path of numbered steps, each with one number and one button. A step is drawn only for a module your workspace has and you may open. An empty module shows its next step instead of a zero.

**Marketing Overview** (**Marketing > Overview**, `/marketing`), subtitle "Reach people":

| Step | What it shows | Button |
|---|---|---|
| 1 Audience | The number of saved audiences, or "No saved audience yet" | Audiences |
| 2 Message | Drafts waiting, or "Write your first email" | Open Email, or New email |
| 3 Review and send | The first draft that is ready, with the note that the count and the reasons are shown before it goes | Review, or Email |
| 4 What happened | The last send: sent, left out and failed | Open, or Email |

Below the steps an **Always on** row links to **Journeys** (running), **Forms** (live), **Events** and **WhatsApp** (templates), each with a small count. Only the modules your workspace has appear. Step 1 shows the number of saved audiences, not the number of people who can be emailed, because that count needs the per-person consent check and is shown on the email itself.

**Intelligence Overview** (**Intelligence > Overview**, `/marketing/intelligence`), subtitle "Know who is ready":

| Step | What it shows | Button |
|---|---|---|
| 1 Who is in market | Accounts comparing or deciding | Buying signals |
| 2 Who is ready | Scored leads, best first | Leads |
| 3 Where to focus | Active ABM programs | ABM programs |
| 4 What worked | Which emails, forms and events started the deals | Results |

Step 2 shows the number of scored leads when the scoring program is on, and a plain link to Leads otherwise. A **Scoring rules** link under the steps goes to Settings. A workspace with none of these modules has no Intelligence part.

Screenshot: 04-marketing-overview.png | /marketing | The Marketing Overview with the four numbered steps and the Always on row
Screenshot: 04-intelligence-overview.png | /marketing/intelligence | The Intelligence Overview with its four steps and the Scoring rules link

Each screen is a separate module. The BPMSquare team switches modules on for your workspace in the platform admin console. Your own administrator cannot do it. A module that is off does not appear in the menu, and nothing is lost while it is off. Your administrator can also hide screens for a person through business roles in **Settings > People**. That only hides the screen from their menu. It is not a security lock.

### Contents

1. [Module switches and settings](#1-module-switches-and-settings)
2. [Audiences](#2-audiences)
3. [ABM programs](#3-abm-programs)
4. [Email](#4-email)
5. [Newsletters](#5-newsletters)
6. [WhatsApp](#6-whatsapp)
7. [Events](#7-events)
8. [Forms and the preference centre](#8-forms-and-the-preference-centre)
9. [Journeys](#9-journeys)
10. [Buying signals](#10-buying-signals)
11. [Leads](#11-leads)
12. [Scored leads](#12-scored-leads)
13. [Results (Revenue by source)](#13-results-revenue-by-source)
14. [Consent and unsubscribe](#14-consent-and-unsubscribe)
15. [Partners](#15-partners)
16. [Common questions](#common-questions)

Sections 2 to 13 are grouped by topic, not by menu order. Each one belongs to a part of the menu: Audiences, Email, Newsletters, WhatsApp, Events, Forms and Journeys are under **Marketing**. ABM programs, Buying signals, Leads, Scored leads and Results are under **Intelligence**.

### Not in the product

These are not in the product at this snapshot, so this chapter does not describe them as working:

- Live WhatsApp delivery. The only WhatsApp provider built in is a sandbox that logs messages and sends nothing.
- A Partners screen. The menu item opens a "coming later" placeholder.
- Branching paths in a journey. Journeys are straight lines of steps.
- An automatic confirmation or reminder email for event registrants.
- Sending one WhatsApp template to a whole audience. WhatsApp goes to one person at a time, or from a journey.
- A screen to edit all journey safety values. Quiet hours, days off, emails a day and the WhatsApp weekly cap are editable. The "company in trouble" days and the 200-person confirmation are not.
- Marketing records in the REST API. Consents and ABM can be imported and exported through Data Workbench. Newsletters, forms, journeys, events, WhatsApp, signals and Results are not in Data Workbench or the API.

---

## 1. Module switches and settings

### What it is

Each Marketing screen has a module flag. Some flags need another flag to be on first.

| Menu item | Module flag | Also needs | Business role entry |
|---|---|---|---|
| Marketing Overview | `marketing` | | Email |
| Audiences | `marketing` | | Audiences |
| Email, chip Sends | `marketing` | | Email |
| Email, chips Newsletters and Templates | `newsletter_studio` | `marketing` | Newsletters |
| WhatsApp | `whatsapp_marketing` | `marketing` | WhatsApp |
| Events | `marketing_events` | `marketing` and `marketing_forms`. The follow-up also needs `journeys` | Events |
| Forms | `marketing_forms` | `marketing` | Forms |
| Journeys | `journeys` | `marketing`. A newsletter step needs `newsletter_studio`. A WhatsApp step needs `whatsapp_marketing` | Journeys |
| Intelligence Overview | any of `buying_signals`, `leads`, `abm`, `marketing_attribution` | | any of Buying signals, Leads, ABM programs, Results |
| Buying signals | `buying_signals` | `marketing` | Buying signals |
| Leads | `leads` | | Leads |
| Leads, view Scored | `marketing_scoring` | `marketing` and `leads` | Leads |
| ABM programs | `abm` | `marketing` | ABM programs |
| Results | `marketing_attribution` | `marketing`. Revenue figures need `pipeline` | Results |
| Partners | `partners` | | Partners |

In the business role editor (**Settings > People > Roles**), the entries are grouped under two headings, **Marketing** and **Intelligence**. A button beside each heading reads **Grant all**, or **Clear all** once everything under that heading is ticked. It is shown when you can edit the role (a standard role is read-only). The entries and their saved grants are the same as before. Only the names changed: Email (was Marketing Campaigns), Audiences (was Segmentation) and Results (was Revenue by source).

### Where to find the settings

| Setting | Menu path | URL path | Needs |
|---|---|---|---|
| Consent: topics, rules by country, counting opens | Settings > Marketing > Consent | `/settings/marketing-consent` | `marketing` (also opens with `marketing_scoring` or `newsletter_studio`) |
| Limits: quiet hours, days off, emails and WhatsApp per person | Settings > Marketing > Consent, tab **Limits** | `/settings/marketing-consent?tab=limits` | `marketing`. Shown only when `journeys` or `whatsapp_marketing` is on |
| Leads: scoring rules and hand-over | Settings > Marketing > Leads, tabs **Scoring** and **Hand-over** | `/settings/marketing-leads` | `marketing_scoring` |
| Brand kit: logo, colours, fonts, footer | Settings > Marketing > Brand kit | `/settings/brand-kit` | `newsletter_studio` |
| Who gets new sales-ready leads | Settings > Coverage, field **Who gets new sales-ready leads** | `/settings/coverage` | Coverage |
| Email output: where email really goes | Settings > Integrations > Email output | `/settings/email-output` | Always available |
| Inbox channels | Settings > Integrations > Inbox channels | `/settings/inbox` | `inbox` |

Settings pages are for administrators only.

### Rules that apply to every screen below

- Emails, newsletters, journeys and WhatsApp check the consent record for each person at the moment of sending.
- Before a plain email goes, **Review and send** shows who will receive it and who is left out, with the reason for each. Nothing is sent without it.
- A demo workspace never reaches a real customer. All email is redirected to one internal inbox, and WhatsApp is only logged.
- Most explanations on screen sit behind a small **i** icon. Tap it for the reason behind a setting.
- The app keeps up to 20 pages open as tabs. When you open a 21st, the oldest tab closes and a notice names it ("20 tabs were open, so ... was closed to make room"). Nothing is lost.

---

## 2. Audiences

### What it is

An audience is a saved list of the people you email, described by rules about accounts, for example "Account type is OEM / Vendor and City contains Mumbai". You can reuse it in emails, newsletter sends and ABM programs. The screen is **Audiences**. The words "Segmentation" and "target group" are no longer used on screen.

### Where to find it

**Marketing > Audiences** (`/marketing/segments`). New audience: **+ New audience** (`/marketing/segments/new`). An audience opens at `/marketing/segments/<id>`.

### Who uses it and which module switches it on

Marketing and sales staff who build audiences. Module: `marketing`. You need edit rights on the **Audiences** role entry to create or change one, and view rights to see the list.

### How to use it

**Create an audience**

1. Open **Marketing > Audiences** and select **+ New audience**.
2. In **Audience name**, type a name your team will recognise, for example "OEM accounts, Mumbai".
3. On the left, find an attribute. Click it, or drag it onto the canvas. Attributes are grouped as Account info, Location, Business, Engagement and Coverage. Two more groups appear only when their module is on: Lead scoring (`marketing_scoring`) and Buying signals (`buying_signals`). An ABM group is always offered.
4. For each condition, choose how to compare (is, is not, contains, is greater than, is less than, is before, is after, is set, is not set) and type or pick the value.
5. With two or more conditions, choose **Match ALL** or **Match ANY**.
6. Read the line under the canvas. It shows "→ N recipients" and, in brackets, how many are opted out and how many have no email on file.
7. Select **Create audience**.

**Add or remove single accounts, or loose addresses**

1. In the card **Manual overrides (optional)**, use **Add or remove specific accounts** to force an account in or keep one out.
2. Use **Add an email address** to add a loose address. Only a contact who agreed to the topic is emailed. Any other address is left out and listed with a reason when you send.

**Use an audience**

1. In a new or draft email, the **Audience** list offers **Everyone we can email**, each saved audience, and **One-off (changed here)** once you change something. See [Email](#4-email).
2. On the Audiences list, select **Use in campaign** on a row. A new email opens with that audience loaded.
3. In the newsletter **Send...** panel, pick the audience in **Audience**.
4. When you create an ABM program, choose **An audience** under **Source**.

**Save a one-off as an audience**

1. In an email, change the audience (for example tick other account types or add a typed address). The list switches to **One-off (changed here)**.
2. Select **Save as audience** beside it and name it. The list then shows the new audience.
3. A saved audience that you have not changed shows **Edit audience** (opens the builder) and **Delete**.

**Change or delete an audience**

1. Click the name in the list, change the rules and select **Save changes**.
2. To remove an audience, select **Delete** on its row and confirm. Emails already built from it are not affected.

### Statuses

An audience has no status. The preview line counts three things.

| Count | Meaning |
|---|---|
| recipients | Accounts, and typed addresses, that would be targeted |
| opted out | Accounts whose marketing opt-out flag is set |
| no email on file | Accounts with no email address |

The count in the audience builder is a quick count of accounts. The count on an email (**Who will receive it**) is the real one: it also checks each person's contact and consent (see [Email](#4-email)).

### How it connects

- The rules read the **account**, not the contact. The address used is the account's email, or its second email.
- Emails and newsletter sends use an audience. ABM can copy an audience into its target list. The copy does not change when the audience changes.
- Lead score, buying stage and ABM fields let you target by what people did, not only who they are.
- The field **Marketing opt-out** filters on the company-level opt-out flag.
- An audience does not decide who may be emailed. Consent is checked later, at the moment of sending (see [Consent and unsubscribe](#14-consent-and-unsubscribe)).

### Good to know

- If an audience has conditions, the email form shows it as **Rule-based audience** with **Edit audience** and **Clear**, instead of the account-type boxes.
- An account you removed by hand is never included. An account you added by hand is always included, even when it does not match the conditions.
- A typed address that already belongs to a matched account is not added twice.
- Lead score and lead stage conditions only match accounts that have a scored lead.
- ABM conditions are offered even in a workspace without ABM, but never match there (verify).
- Audiences and plain emails are the oldest Marketing modules, so they may already be in daily use at your company.

Screenshot: 04-audiences-list.png | /marketing/segments | The list of audiences with the Conditions column, the Use in campaign link and the + New audience button
Screenshot: 04-audience-builder.png | /marketing/segments/new | The Audience name field, the attribute palette on the left and the conditions canvas

---

## 3. ABM programs

### What it is

Account-based marketing (ABM) means working a chosen list of companies as a team instead of mailing everyone. A program holds the target accounts, the people at each company (the buying group), the progress of each company, and the results.

### Where to find it

**Intelligence > ABM programs** (`/marketing/abm`). New program: **+ New program** (`/marketing/abm/new`). A program opens at `/marketing/abm/<id>`. A company inside a program opens at `/marketing/abm/<id>/accounts/<targetId>`.

### Who uses it and which module switches it on

Account owners and marketers. Module: `abm` (needs `marketing`). Optional: `buying_signals` adds each company's buying stage.

### How to use it

**Create a program**

1. Open **Intelligence > ABM programs** and select **+ New program**.
2. Under **The program**, fill in **Name**, **Kind** (New business or Expansion), **Owner**, **Goal** (one plain sentence), **Measured in** (Deals won, Deals opened, Accounts responding or Revenue), **Target**, **Starts on** and **Ends on**.
3. Under **How each company is worked**, choose **Default tier**: 1:1 (its own plan, worked personally), 1:few (a small cluster sharing content) or 1:many (the program's standard plays). Under **Roles every company needs**, tick the roles. Decision maker and Influencer are the standard.
4. Under **Start the target list from**, choose **Start empty**, **An audience** or **A Coverage segment**.
5. Save the program, then select **Go live**. **Pause** and **Resume** are in the same place.

**Add target accounts**

1. Open the **Target accounts** tab and select **+ Add accounts**.
2. Choose **By name**, **From an audience** or **From a Coverage segment**. For an audience or segment, select **Preview** first.
3. Pick **Tier for these companies** and select **Add accounts**.
4. The list is a copy. To see what changed in the source, select **Refresh from source**. Nothing changes until you tick the changes and select **Apply**.

**Build the buying group**

1. Click a company and open the **Buying group** tab.
2. Select **Add person**. Pick a **Person at this company** and a **Role in this program** (Decision maker, Influencer, User, Blocker or Unknown). You can also set **Our owner for this person**. The person must already be a contact of that company.
3. Use **Call first** to mark who to phone first.
4. A missing role shows as a grey row with an **Add one** button. On the program, the **Buying groups** tab lists every company with a gap.

**Move progress**

1. Select **Check progress**, on the program or on one company. It reads quotes, emails, forms, WhatsApp and deals, and moves companies forward by fixed rules.
2. To set progress by hand, open the company and select **Update progress**. A reason is required.
3. On the company's **Plan** tab, set **What happens next**, **Due on**, **Who does it**, **Tier**, **Owner for this program** and **Deal this program is pursuing**. Then select **Save plan**.

**Read the results**

1. Open the **Results** tab. It shows the funnel (Targets, Reached, Responding, In talks, In a deal, Won), the goal sentence, money from linked deals, and results by tier.

### Statuses

Program:

| Status | Meaning |
|---|---|
| Draft | Being set up |
| Live | Running |
| Paused | Stopped for now |
| Done | Finished. Menu: **Mark as done** |
| Archived | Hidden from the default list. Menu: **Archive** |

Company progress inside a program:

| Progress | Meaning |
|---|---|
| Planned | In the program, nothing has happened yet |
| Reached | An email, WhatsApp message or quote was delivered to someone in the buying group |
| Responding | Someone in the buying group clicked, opened or accepted a quote, filled in a form, replied on WhatsApp or viewed a page |
| In talks | A meeting happened. Only a person can set this |
| Deal open | A deal is linked |
| Won / Lost | Follows the linked deal |
| Dropped | You stopped pursuing it. A reason is required |

Select any progress pill to open **Why this status?**. It names the rule and the events behind it.

### How it connects

- Target lists come from audiences or Coverage segments.
- Progress reads the shared event stream: emails, WhatsApp, quotes, forms and web visits.
- A linked deal from the Pipeline moves a company to Deal open, then Won or Lost.
- Buying stage from Buying signals shows beside progress.
- ABM conditions (in program, progress, tier) can be used in Audiences.
- Programs, targets and members can be imported and exported through Data Workbench.

### Good to know

- Only events from people named in the buying group count toward progress.
- By default a company is not marked **Responding** until every required role is filled. The pill then says it would be Responding, but a required role is missing.
- Rules only move a company forward. Going back, **Dropped** and **In talks** are a person's choice. Each needs a reason, saved with your name and the date.
- **Check progress** does not run by itself.
- With fewer than 20 targets the results carry a "Small sample" note. Read them as a list, not a trend.

Screenshot: 04-abm-programs-list.png | /marketing/abm | The program list with status chips and the target progress bars
Screenshot: 04-abm-program-targets.png | /marketing/abm/<id> | A live program on the Target accounts tab with progress pills
Screenshot: 04-abm-buying-group.png | /marketing/abm/<id>/accounts/<targetId> | The Buying group tab with a missing-role row and an Add one button

---

## 4. Email

### What it is

Email is the one place for everything you send by email. A **plain email** is one you type here: a festival or service message from a template, or free text. A **newsletter** is a design you built in Newsletter Studio (see [Newsletters](#5-newsletters)). Either way, each send leaves a record that lists every recipient and what happened to them. Some places, such as change history and the web addresses, still call that record a campaign.

### Where to find it

**Marketing > Email** (`/marketing/email`). Chips: **Sends** (the history of every email, with a **Type** column showing Plain or Newsletter), and, in a workspace with Newsletter Studio, **Newsletters** and **Templates**. Buttons: **+ New email** (`/marketing/new`) and, with the Studio, **+ New newsletter**. A send opens at `/marketing/<id>`.

The old campaign list and the old Newsletters list redirect to Email. The address `/marketing` is now the Marketing Overview, so a stored link to the old campaign list opens the Overview, one click from Email.

### Who uses it and which module switches it on

Marketers. Module: `marketing`. You need edit rights on the **Email** role entry to create or send. The **Newsletters** and **Templates** chips need `newsletter_studio` and the **Newsletters** role entry.

### How to use it

**Send a plain email**

The screen follows the order Audience, Message, Review and send.

1. Open **Marketing > Email** and select **+ New email**. The page is still titled **New Campaign** at this snapshot (verify).
2. Type a **Campaign name (internal)**. Only your team sees it.
3. Under **Audience**, pick from the list: **Everyone we can email** (the starting choice), a saved audience, or **One-off (changed here)**, which appears once you change something. Select **More** to tick account types, add or remove specific accounts, or **Add an email address**. **Save as audience** keeps a one-off. **Edit audience** and **Delete** appear beside a saved audience you have not changed.
4. Read **Who will receive it**. It shows, for example, "8 will receive" and "105 left out", then a count by reason ("68 no email address, 24 not a contact, 13 no consent"). The first five people left out are listed with the reason and a link that fixes it. **Show all** lists the rest. This count runs the same checks as the send, without sending.
5. A typed address shows a chip: **Ready**, **Not a contact** (with **Create contact**) or **No consent**.
6. Under the count, the **Consent** chip shows the topic (**Any topic**) and a **Change in Settings** link. Topics and rules are not changed on this screen.
7. Either open **Start from a template**, choose a folder and then a design, and write your words in the custom message, or skip templates and write the **Subject** and **Message** yourself. The folders are Christmas, Diwali, Eid, Ganesh Chaturthi, Holi, Independence Day, Makar Sankranti and Pongal, Navratri and Dussehra, New Year, Raksha Bandhan, Republic Day and Service Reminder. In the subject you can use `{{account_name}}` and `{{company_name}}`. Each is replaced for every recipient.
8. Select **Save draft**. "Draft saved" appears and the saved draft opens. Selecting **Save draft** again changes the same draft. It does not make a copy.
9. On the draft, select **Review and send**. A side panel (a bottom sheet on a phone) opens with the real count, who is left out and why, and the button **Send to N**. Nothing is sent until you select **Send to N**. Select **Close** to go back. If nobody can be emailed, the button is off and the panel says so.
10. After **Send to N**, the panel shows how many were sent, left out and failed. Select **See who it went to** to open the record.

**Change a draft**

1. Open the email from **Sends**, edit it and select **Save changes**.

**Read the result**

1. Open the email. The facts bar shows **Sent**, **Failed**, **Left out** and **Leads**.
2. While the send is running, the page shows **Sending… 4 of 8** and refreshes by itself every few seconds, so you do not need to reload. It stops when the status is no longer Sending. If it takes longer than about 20 minutes, the page tells you to reload.
3. The **Recipients** list shows each recipient. A person left out shows a reason and a link to fix it.
4. For a send of a newsletter, a card shows results by language and clicks per link.

**Send the rest**

1. If some emails failed, the page says so. If the cause was the email service's daily limit, it reads "The email service has reached its daily limit. The rest can be sent later." Select **Send the rest** when the limit has reset.
2. **Send the rest** goes only to people whose email failed or was never tried. It never emails anyone already sent, and people who were left out stay left out. It runs the same consent check as the first send, updates the failed rows (no duplicates) and does not repeat the "email sent" event. Selecting it twice in a row sends nothing the second time.
3. It is offered for plain emails only. A newsletter is sent again from the Studio.

**Keep the audience for later**

1. In the Audience card, select **Save as audience** (see [Audiences](#2-audiences)).

### Statuses

Email:

| Status | Meaning |
|---|---|
| Draft | Not sent. You can edit it |
| Sending… | The send is running. The page follows it |
| Sent | The send finished. Failed and left-out counts are on the record |
| Failed | The label exists, but no step that sets it was found (verify) |

Recipient:

| Status | Meaning |
|---|---|
| Sent | Handed to the email service |
| Failed | The email service refused it. The reason is shown |
| Pending | Waiting |
| Left out | Not emailed. The reason is one of the rows below |

Reasons a person is left out. Each one has a sentence and, where there is a fix, a link.

| Label | Sentence | Link |
|---|---|---|
| No email address | This account has no email address. | Open the account |
| Not a contact | This address is not a contact yet, so we cannot check consent. | Create contact |
| No consent | This person has not agreed to this topic. | Open the contact, or Open Consent settings |
| Unsubscribed | The account unsubscribed. | Open the account |
| Address bounced | This address bounced, so it is blocked. | Open the contact |
| Marked as spam | This person reported a message as spam, so the address is blocked. | Open the contact |
| Blocked | This person is on the do-not-contact list. | Open the contact |
| Withdrew consent | This person withdrew consent for this topic. | Open the contact |
| No language version | There is no version in this person's language (newsletter sends). | none |

### How it connects

- **Audiences.** An email picks an audience. See [Audiences](#2-audiences).
- **Consent.** Every person is checked for the topic at the moment of sending. The count, the Review and send panel and the record all use the same decisions and the same sentences. See [Consent and unsubscribe](#14-consent-and-unsubscribe).
- **Accounts and contacts.** A plain email goes to the email on the account, and the person must be a contact with consent.
- **Leads.** Each plain email carries an **Interested? Tell us more** button. When the recipient opens the link and presses the button, a lead is created. Its title is "Interest from campaign: <name>" and its source is Campaign. There is one lead per company per email. The Leads list shows the name as a link back.
- **Unsubscribe.** The footer has an **Unsubscribe** link (see [Consent and unsubscribe](#14-consent-and-unsubscribe)).
- **Newsletters.** The **Send...** button in Newsletter Studio creates a record named after the newsletter and the date, and sends it. It appears in **Sends** with the type Newsletter.
- **Email log.** Every send is logged against the record.
- **Results.** Emails are one of the items you can see revenue for.

### Good to know

- An email is sent once to each person. To send the same message to everyone again, create a new email. **Send the rest** only completes a send that was cut short.
- A typed address is emailed only if it is a contact who agreed to the topic. Whether such a person gets the unsubscribe link and the interest button was not confirmed (verify).
- Sending is one email at a time with a short pause. A single send is sized for roughly 150 to 200 recipients, because it must finish within about a minute (verify). Split a larger audience into several audiences.
- On a demo workspace, every email goes to the internal inbox set in **Settings > Integrations > Email output**. The subject starts with "[Redirected · for …]" and the body names the intended recipient. With no inbox set, nothing is sent and the screen says why. A normal workspace can also choose redirect mode there.
- Emails are sent from your workspace's address on BPMSquare's sending domain. Replies go to the email in your company information (verify).
- The email service has a daily limit. When it is reached, the rest of the send fails with that reason, and **Send the rest** finishes it later.

Screenshot: 04-email-sends.png | /marketing/email | The Email page with the chips Sends, Newsletters and Templates, the two buttons and the Sent, Failed and Left out counts
Screenshot: 04-email-compose.png | /marketing/new | The Audience list, the Who will receive it count with reasons and the Consent chip
Screenshot: 04-email-review-panel.png | /marketing/<id> | The Review and send panel with the count, who is left out and the Send to N button
Screenshot: 04-email-record.png | /marketing/<id> | A sent email with the four tiles and the Send the rest line

---

## 5. Newsletters

### What it is

Newsletter Studio is where you design an email once in English, add Arabic or another language on top, check it against fixed rules, and send each person their own language. The email is built from blocks.

### Where to find it

**Marketing > Email**, chips **Newsletters** and **Templates** (`/marketing/email?view=designs` and `?view=templates`; the old address `/marketing/newsletters` redirects there). New: **+ New Newsletter** on the Newsletters chip, or **+ New newsletter** on Sends (`/marketing/newsletters/new`). A newsletter opens at `/marketing/newsletters/<id>`. The brand kit is at **Settings > Marketing > Brand kit** (`/settings/brand-kit`).

### Who uses it and which module switches it on

Marketers write and send. An administrator sets the brand kit. Module: `newsletter_studio` (needs `marketing`).

### How to use it

**Set up once (administrator)**

1. Open **Settings > Marketing > Brand kit**. Set the logo (or **Use the workspace logo instead**), colours, **Font**, **Tone for AI writing**, the footer **Address lines** and social links. Every newsletter uses it.
2. Open **Settings > Marketing > Consent**. Check the **Topics** list. Leave **Count newsletter opens** off unless you need it.

**Write a newsletter**

1. Open **Marketing > Email**, choose the **Newsletters** chip and select **+ New Newsletter**. The options on the left are in four tabs: **Start**, **Blocks**, **Languages** and **Health**.
2. In **Start**, give it a **Name**. Pick a **Category** (Newsletter, Offer, Event, Announcement or Festival) and a **Consent topic**, or **Any consent topic**.
3. Choose how to begin:
   - **Write it for me.** Answer **What is this newsletter about?** (at least 10 characters). Optionally tick **Use my recent products** and **Use my recent campaigns**. Select **Write it for me**.
   - **Start from a design.** Pick one of your templates or a built-in design: Blank, Monthly update, Offer, Event invitation, Announcement, Eid greeting or Diwali greeting.
   - **Blank.** A brand header and footer only.
4. In **Blocks**, click a block to edit its words, drag to reorder, and use **Add** for text, image, button, columns, product card, event, divider or social. Under text you can select **Shorter**, **Friendlier** or **More formal**, and **Undo rewrite**.
5. Write the **Subject** and **Preheader** (the line next to the subject in the inbox) below the preview. Use **Desktop**, **Phone**, **Light** and **Dark** to preview.
6. Select **Save**. The menu has **Duplicate**, **Save as template**, **Versions**, **Email HTML**, **Export HTML**, **Brand kit**, **Archive** and **Delete**.

**Add another language**

1. Open **Languages**. Pick the language and select **Translate with AI**, or **I'll write it**. Available languages are English, Arabic, Hindi, Urdu and French.
2. Lines the AI was unsure about show **Check this**. Select **Accept** or **Edit**, or **Accept all N lines**.
3. A language can be sent only when every line is checked.
4. Select **Compare languages** to read two languages side by side.

**Check the Health tab**

1. Open **Health**. Amber items say what to change. Green items are fine. These are fixed rules, not a score. Fix the amber items before sending.

**Send it**

1. Select **Send...**. A copy of the design is kept automatically, so editing it later never changes what already went out.
2. In **Audience**, keep **Everyone we can email** or pick a saved audience. Select **More** for a one-off: tick account types or use **Add email addresses**.
3. The panel shows "N of M people will receive it", how many get each language, and who is left out and why. Each reason has an **i** with the fix. Nothing is sent yet.
4. Select **Send to N** and confirm. Emails go out at once and cannot be recalled.
5. Select **See what was sent** to open the send record. It appears in **Email > Sends** with the type Newsletter.

### Statuses

Newsletter:

| Status | Meaning |
|---|---|
| Draft | Being written |
| Ready to use | Marked ready |
| Archived | Not offered for sending |

Language on a newsletter:

| Label | Meaning |
|---|---|
| Written first | The English base |
| N to check | That language still has lines marked Check this |
| Ready | Every line is checked. It can be sent |

A newsletter send creates a send record, so it also shows the email statuses in [Email](#4-email).

### How it connects

- **Consent.** Each recipient is matched to a contact. The consent record is checked for the newsletter's topic at the moment of sending.
- **Languages.** A person gets the contact's preferred language, else the account's, else the fallback language.
- **Email.** Every send is a row in **Sends** with the recipient list, results by language and clicks per link.
- **Journeys.** The **Send a newsletter** step uses a saved newsletter.
- **Leads.** Built-in designs such as Monthly update include an **Interested? button**. A click creates a lead, as in plain emails (verify).
- **Preference centre.** The footer link **Manage preferences** opens the preference centre when Forms is on. Otherwise it opens the unsubscribe page.
- **Scoring and signals.** Clicks are always counted and add to lead scores and buying signals.
- **Results.** Newsletters are one of the items you can see revenue for.

### Good to know

- AI is optional. If the workspace has no AI set up, the screen says "AI is not set up for this workspace" and you write everything yourself. AI only suggests. Nothing is saved until you select **Save**.
- The header and footer cannot be removed. The footer carries the unsubscribe line.
- A person who has not agreed to the topic is left out. A typed address that does not match a contact is left out. A language with lines still to check is not sent, and those people get the fallback language.
- With **Any consent topic**, a person needs a yes that covers every topic (verify).
- Opens are not counted unless an administrator turns on **Count newsletter opens**. Clicks are always counted.
- The same pacing and size limits apply as for plain emails.
- A demo workspace is redirect-only, as described under Email.

Screenshot: 04-newsletter-studio.png | /marketing/newsletters/<id> | The Studio with the four option tabs on the left and the phone preview on the right
Screenshot: 04-newsletter-send-panel.png | /marketing/newsletters/<id> | The Send... panel showing "N of M people will receive it" and the who-is-left-out list
Screenshot: 04-newsletter-languages.png | /marketing/newsletters/<id> | The Languages tab with an Arabic row and Check this lines

---

## 6. WhatsApp

### What it is

WhatsApp marketing lets you write message templates, mark them approved, and send them one person at a time or from a journey, to people who agreed to hear from you on WhatsApp. It also receives replies and delivery updates, and records STOP and START.

**Important:** the only provider built in today is a **sandbox**. It sends nothing to anyone. Every message is a logged dry run. A real provider has not been connected yet. Do not promise live WhatsApp delivery until it is.

### Where to find it

**Marketing > WhatsApp** (`/marketing/whatsapp`, chips **Open**, **Approved**, **Draft**, **Archived**). New: **+ New Template** (`/marketing/whatsapp/new`). A template opens at `/marketing/whatsapp/<id>`. The number page is at `/marketing/whatsapp/setup`, from the menu item **Number and messages** on the list page.

### Who uses it and which module switches it on

Marketers write templates. Only an administrator can mark a template approved or change the number. Module: `whatsapp_marketing` (needs `marketing`). The journey step needs `journeys` too.

### How to use it

**Write a template**

1. Open **Marketing > WhatsApp** and select **+ New Template**.
2. Under **Basics**, give it a **Name (only your team sees it)**, a **Language** and a **Kind of message** (Marketing, Utility or Authentication).
3. Under **The message**, write the **Message**, up to 1,024 characters. Use **Add a detail** to insert Contact name, Company name, Your company, Quote number or Amount.
4. Under **Who may receive it**, pick the **Consent topic**, or **Any consent topic**.
5. Select **Save**.

**Approve it (administrator)**

1. Under **Approval**, optionally enter **Name at your provider (optional)**.
2. Select **Mark approved** (or **Mark rejected**, with a reason). Changing the words of an approved template sends it back to **Draft**.

**Send a test to one person**

1. On an approved template, open **Send it to one person**.
2. Type a name in **Who**, pick the person and select **Send**.
3. The result line says whether it was sent, only logged, or refused and why.

**Set up the number (administrator)**

1. Open **Number and messages**. Under **Number and provider**, choose the **Provider**, enter the **Business number** and any credentials, and select **Set up** (or **Save**).
2. Under **Replies and delivery updates**, copy the **Address for your provider to call**. Select **Make a new signing secret** when needed. The secret is shown once.
3. Under **Match my contacts' numbers**, select **Match numbers** so a START from someone you never messaged can be matched.
4. **Recent messages** lists what went out and came back.

**Set the weekly limit (administrator)**

1. Open **Settings > Marketing > Consent**, tab **Limits**. Set **WhatsApp messages a week, per person**, from 1 to 20. The standard is 1.

### Statuses

Template:

| Status | Meaning |
|---|---|
| Draft | Not approved. Cannot be sent |
| Approved | Can be sent |
| Rejected | Marked rejected, with a reason |
| Archived | Not offered |

### How it connects

- **Consent.** The consent check on the WhatsApp channel and the template's topic comes first, before anything else is looked at.
- **Journeys.** The step **Send a WhatsApp template** uses an approved template.
- **Replies.** A reply becomes an event that adds to the lead score and to ABM progress, and counts as a touch in Results.
- **STOP and START.** A message that is only STOP (or the Arabic words) records a withdrawal. START records the opt-in again. A longer message is treated as a reply.
- **Contacts.** The contact's Consent card records WhatsApp consent.

### Good to know

- Once approved, a template can go at any time. Free text can go only within 24 hours of the person's last message, and only from a person, never from a journey. There is no free-text screen yet.
- A marketing template is limited to one per person per 7 days by default. Dry runs count toward the limit too.
- A number that would have to be guessed is refused. Numbers need a `+` or `00` and a country code.
- A demo workspace never reaches a real number. It goes to the workspace's test number if one is set, otherwise it is only logged.
- A reply from a number that cannot be matched to a contact creates nothing.

Screenshot: 04-whatsapp-templates.png | /marketing/whatsapp | The template list with status chips
Screenshot: 04-whatsapp-template-studio.png | /marketing/whatsapp/<id> | A template with the message bubble on the right and the Approval group on the left
Screenshot: 04-whatsapp-setup.png | /marketing/whatsapp/setup | Number and provider, the callback address and the Recent messages table

---

## 7. Events

### What it is

A marketing event is a webinar, exhibition, roadshow or site visit. People register through an existing Form, staff check them in on the day, and you can start a follow-up journey for the people who came or the ones who did not.

### Where to find it

**Marketing > Events** (`/marketing/events`, chips **All**, **Registration open**, **Draft**, **Completed**). New: **+ New Event** (`/marketing/events/new`). An event opens at `/marketing/events/<id>` with tabs **Details**, **Attendees**, **Follow-up** and **Results**.

### Who uses it and which module switches it on

Marketers and event staff. Module: `marketing_events` (needs `marketing` and `marketing_forms`). The follow-up also needs `journeys`.

### How to use it

**Plan and open an event**

1. Open **Marketing > Events** and select **+ New Event**.
2. Under **The event**, fill in **Name**, **Kind** (Webinar, Exhibition, Roadshow, Site visit), **Status**, **Date**, **Starts**, **Ends (optional)**, **Capacity (optional)**, **Venue**, **Link** (https only), **Owner** and **About it**.
3. Under **Registration**, pick the **Registration form**. Make sure that form is **Live**.
4. Under **Follow-up**, pick a **Journey** and **For** (people who came, or people who did not).
5. Save. On the event, select **Open registration**.

**Check people in**

1. Open the **Attendees** tab. Type in **Search by name or company**.
2. Select **Check in** on a row. Use **Did not come**, **Cancel** or **Register again** as needed.
3. To add a walk-in, use **Add someone**: find the person and select **Register**, or **Register and check in** to do both.
4. After the event starts, **Mark everyone left as not coming** marks the rest.

**Start the follow-up**

1. Turn the chosen journey on first (see [Journeys](#9-journeys)).
2. Open the **Follow-up** tab and select **Start the follow-up for N people**.
3. The result says how many started, how many were already in, and how many were skipped because there was no person to contact.

**Read the results**

1. Open the **Results** tab for Registered, Came, Did not come, Not marked yet, Cancelled and the show rate.

**Move the event along**

1. The main button moves the event on: **Open registration**, then **Close registration**, then **Mark completed**. **Cancel the event** is in the menu.

### Statuses

Event:

| Status | Meaning |
|---|---|
| Draft | Not announced. A linked form does not register anyone |
| Registration open | People who fill in the linked form are registered |
| Registration closed | No more registrations |
| Completed | Finished |
| Cancelled | Stopped. The people who registered stay on the list |

Attendee:

| Status | Meaning |
|---|---|
| Registered | Signed up |
| Attended | Checked in. This is final |
| Did not come | Marked as a no-show. Can still be changed to Attended |
| Cancelled | Can register again |

### How it connects

- **Forms.** Registration is a form submission. The form finds or creates the contact, records consent exactly as the form says, files a lead, and then registers the person. An event never records consent itself.
- **Journeys.** The follow-up puts people into a journey you built. The journey keeps its own consent, quiet-hours and daily-limit rules.
- **Coverage.** Each attendee row shows the company's owner, for the first 60 companies.
- **Scoring and revenue.** "Attended" adds to lead scores. Registration and attendance are touches in Results.
- **Change history.** Each check-in is logged with who did it.

### Good to know

- Nothing is sent to a registrant by the event itself: no confirmation and no reminder (verify). Use the form's thank-you email or a journey.
- Capacity is not enforced. The page shows "N over capacity".
- Attendance is final. A mistaken check-in cannot be taken back.
- A form can belong to one running event at a time.
- The follow-up is a button, not automatic. A person is stamped when started, so the button cannot enrol anyone twice. Someone who already went through that journey is not put through it again.
- The show rate counts only people marked as came or did not come.

Screenshot: 04-events-list.png | /marketing/events | The events list with the Registered and Came counts
Screenshot: 04-event-attendees.png | /marketing/events/<id>?tab=attendees | The Attendees tab with Check in and Did not come buttons
Screenshot: 04-event-results.png | /marketing/events/<id>?tab=results | The Results tab with the show rate sentence

---

## 8. Forms and the preference centre

### What it is

A form is a page, or a box on your website, where a visitor leaves their details. Each submission finds or creates a contact, records consent if the visitor ticked the box, and files a lead. The preference centre is the page each person opens from an email to choose their topics or stop all emails.

### Where to find it

**Marketing > Forms** (`/marketing/forms`, chips **Open**, **Live**, **Archived**). New: **+ New Form** (`/marketing/forms/new`). A form opens at `/marketing/forms/<id>`, with the form and an **Answers** tab.

Public pages: the form at `<your workspace address>/f/<slug>` (add `?embed=1` for the embedded version), the preference centre at `/marketing/preferences/<contactId>/<token>` and the confirm page at `/marketing/confirm/<contactId>/<token>`. People reach the last two from links in emails.

### Who uses it and which module switches it on

Marketers. Module: `marketing_forms` (needs `marketing`). The workspace needs a web address (domain). Without one, a form has no public address.

### How to use it

**Build a form**

1. Open **Marketing > Forms** and select **+ New Form**.
2. **Basics:** **Name** (internal), **Web address**, **Heading**, **Introduction**, **Button words**.
3. **Fields:** email is always asked. Tick name, company, phone, message and up to three questions of your own (**Your own question 1** to **3**). Tick **Required** where needed.
4. **Consent:** write **The words shown next to the box**. Pick **Consent topics** (none means every topic). Decide **The box must be ticked to send**. The box is never pre-ticked.
5. **After sending:** choose **Show a message** (a thank-you on the form) or **Go to a page** (an https page on your own domain). Then choose the emails:
   - **Send a thank-you email** (on by default) and **Words in the email**.
   - **Ask the person to confirm by email** (double opt-in).
   - **Tell someone about each new answer**, then choose **Who** (a workspace member).
6. **Share:** set **Status** to **Live - visitors can send it**. Select **Save**.

Use **Desktop** and **Phone** above the preview to check both layouts.

**Put it on your website**

1. Open the form, go to **Share**, and select **Copy embed code** (for your web team) or **Copy address**.

**Read the answers**

1. Open the **Answers** tab. It shows When, Name, Email, Company and Agreed to emails, with **Previous** and **Next**.

**What a visitor does to confirm**

1. If the form asks for confirmation, the thank-you email carries a link. The person opens it and presses **Yes, confirm**. The link works for 7 days.

### Statuses

Form:

| Status | Meaning |
|---|---|
| Draft | Only your team can see it. Visitors get "not found" |
| Live | Visitors can open and send it |
| Archived | Switched off |

Consent from a form, as shown on the contact's Consent card:

| State | Meaning |
|---|---|
| Agreed | The box was ticked and no confirmation is needed |
| Waiting for confirmation | Ticked, but the person has not pressed the link. Does not count as a yes |
| Did not confirm | Seven days passed without the link |
| Nothing recorded | The box was not ticked |

### How it connects

- **Contacts and accounts.** A new email creates a prospect account and a contact. An existing contact is never changed by a form.
- **Leads.** One open lead per person per form. A second submission refreshes the same lead.
- **Consent.** The exact words shown are stored with the consent. See [Consent and unsubscribe](#14-consent-and-unsubscribe).
- **Events.** An event registers people through its linked form.
- **Newsletters.** The **Manage preferences** footer link opens the preference centre when Forms is on.
- **Scoring, signals and revenue.** A form submission adds to lead scores and counts as a touch in Results.

### Good to know

- Answers are kept for 180 days. The contact and the lead stay.
- One visitor can send a form 5 times an hour. After that the page says "Too many tries."
- An unticked box records nothing. It never cancels an earlier yes.
- The thank-you email goes out even if the box was not ticked, because it confirms what the person just did. The same person is not emailed twice in an hour.
- **Ask the person to confirm by email** starts on for a workspace based in the European Union and off elsewhere. Change the base country in **Settings > Marketing > Consent**, field **Based in**. You can override it on each form.
- On a demo workspace, the thank-you email and the staff notice are redirected to the test inbox, never to the visitor.
- Opening the preference centre changes nothing by itself. A person marked do not contact, or who used an old unsubscribe link, cannot switch topics back on from a link. They are told to get in touch.

Screenshot: 04-form-studio.png | /marketing/forms/<id> | The form builder with option groups on the left and the live preview on the right
Screenshot: 04-form-answers.png | /marketing/forms/<id> | The Answers tab with the Agreed to emails column
Screenshot: 04-preference-centre.png | /marketing/preferences/<contactId>/<token> | The person's topics as switches with Save my choices and Unsubscribe from all

---

## 9. Journeys

### What it is

A journey is a short automation. It starts when something happens, for example "a quote is sent". Then it waits, sends a newsletter or a WhatsApp template, creates a task for the owner, or notifies the owner. Consent and quiet hours are always respected.

### Where to find it

**Marketing > Journeys** (`/marketing/journeys`, chips **Journeys** and **Archived**). New: **+ New Journey** (`/marketing/journeys/new`). A journey opens at `/marketing/journeys/<id>` with tabs **Build**, **Test** and **Running** (plus **Setup** on a phone). Limits are at **Settings > Marketing > Consent**, tab **Limits**.

### Who uses it and which module switches it on

Marketers. Module: `journeys` (needs `marketing`). The send steps also need `newsletter_studio` or `whatsapp_marketing`.

### How to use it

**Create the Quote follow-up journey**

1. Open **Marketing > Journeys** and select **+ New Journey**.
2. Under **Template**, pick **Quote follow-up** (or Blank) and select **Create journey**.
3. The template does this: a Standard Quote is sent, wait 3 days, send a newsletter, create a task to call.
4. Under **Name and start**, check the **Name**, **It starts when** (a quote is sent) and **But only if** (a kind of quote, or **Amount at least**).
5. In the **Send a newsletter** step, pick a saved newsletter under **Newsletter**.
6. Under **Rules**, review **One person per company**, **Pause when the company is in trouble** and the **Quiet hours and limits** chips.

**Check it before it runs**

1. On **Build**, read **Who would enter today**. It gives a count and warns about people with no consent.
2. Open the **Test** tab. Under **Try it on one person**, type at least two letters of a name, pick a person and select **Show the path**. Nothing is sent and nothing is saved.
3. Select **Save**.

**Go live**

1. Select **Go live**. If more than 200 people would enter, a message asks you to confirm the count.
2. **Include the last (days)** decides how many days of past events are picked up when you go live. Use 0 for new events only.
3. While the journey is live, the steps are locked. Select **Pause** to change them.

**Watch it**

1. Open the **Running** tab. See **Entered**, **Where they are**, **What happened**, **Skipped, by reason**, **Tasks for the owner** (with **Mark done**) and the **Run log**. Select **Refresh**.

### Statuses

Journey:

| Status | Meaning |
|---|---|
| Draft | Not running |
| Live | Running |
| Paused | Not sending. People keep their place |
| Archived | Finished. The log stays readable |

Why a step was skipped or held:

| Reason | Meaning |
|---|---|
| No consent | The person has not agreed to the topic. The journey carries on without that message |
| Quiet hours | Waiting for the quiet hours or the weekly day off to end |
| Daily limit | The person already had a journey message in the last 24 hours (or a WhatsApp message this week) |
| Open urgent case | The company has an old open case or an overdue invoice |
| Nobody to contact | No contact person, or no email address or usable phone |
| Needs setting up | No newsletter or WhatsApp template chosen, or the module is off |
| Stuck | A step is far overdue or failed after retries. The log says why |

### How it connects

- **Triggers:** a quote is sent or accepted, a deal is created or closed, a case is closed, an invoice is paid, an AMC contract is close to expiring, a lead is created, or someone fills in a form.
- **Steps:** wait, send a newsletter, send a WhatsApp template, create a task for the owner, notify the owner, end. A journey can have up to 12 steps.
- **Newsletters and WhatsApp.** The send steps go through the same send path and consent check as a normal send.
- **Owner.** Tasks and notices go to the company's owner from Coverage. A notice appears in the Nova inbox.
- **Events.** An event's follow-up starts people in a journey.
- **Results.** Journeys are one of the items you can see revenue for.

### Good to know

- Standard limits: no sends from 20:00 to 08:00, Friday off, at most one journey email per person a day, a pause when a case has been open over 30 days or an invoice is overdue, and a confirmation above 200 people. An administrator can change the quiet hours, days off, emails a day and the WhatsApp weekly cap under **Settings > Marketing > Consent**, tab **Limits**. The case days and the 200-person line cannot be edited on screen.
- Quiet hours follow the timezone set in **Settings > Workforce**, Attendance rules (verify the exact path). If none is set, the product default is used.
- Messages wait for the next allowed time. They are never dropped.
- Steps run within about five minutes.
- Re-entry is "never": a person goes through a journey once.
- A loop guard stops a journey from starting from its own emails.
- On a demo workspace, journey email is redirected like any other.

Screenshot: 04-journeys-list.png | /marketing/journeys | The journey list with status and People in it
Screenshot: 04-journey-studio.png | /marketing/journeys/<id> | The journey as sentences on the Build tab with the Rules group open
Screenshot: 04-journey-try-it.png | /marketing/journeys/<id>?tab=test | Try it on one person showing the Day 0 and Day 3 path

---

## 10. Buying signals

### What it is

Buying signals shows which companies look close to buying. It adds up what each company did with you (asked for a quote, clicked a link, has a contract about to end) and gives a stage in plain words. It uses only your own data. It is never an AI guess.

### Where to find it

**Intelligence > Buying signals** (`/marketing/signals`), with tabs **In market**, **Did it work?** and **Interests**.

### Who uses it and which module switches it on

Salespeople and account owners read it. An administrator sets interests and selects **Rescore now**. Module: `buying_signals` (needs `marketing`).

### How to use it

**Set up once (administrator)**

1. Open the **Interests** tab. Under **New interest**, give a name and **Keywords**, then select **Add interest**. Add the subjects you sell.
2. Select **Rescore now** the first time so scores appear at once.

**Find companies to call**

1. Open **In market**. The highest score is at the top.
2. Use **Filters** (a button at the top on a phone). Choose a stage (**All**, Deciding, Comparing, Looking, Silent or **Moved up this week**), **Interest**, **Owner** or **Account name**.
3. Read each row: the stage, the score with an eight-week line, a one-line reason, the owner and a suggested next step.
4. Click a row to open the company. Read **How this is worked out** and the **Signals timeline**.
5. Select the suggested next step, **Open account** or **Analyse**. Select **Not in market** if the company is not buying. **Clear "not in market"** undoes it.

**Check whether a send worked**

1. Open **Did it work?** and pick a sent campaign or newsletter. It compares each recipient's stage in the 14 days before and after.

**Use the stage in an audience**

1. In **Audiences**, add a condition from **Buying signals**: **Buying stage**, **In-market score**, **Days in current stage** or **Engaged with topic**.

### Statuses

| Stage | Meaning |
|---|---|
| Silent | Nothing recent to go on |
| Looking | Has shown some interest |
| Comparing | Asked you for something, or is clearly engaged |
| Deciding | Asked you for something and is very engaged |

Suggested next step: Deciding is Call. Comparing is Follow up or Start a quote. Looking is Add to a campaign.

### How it connects

- **Sources:** quotes, deals, three cases on one asset in 90 days, contracts ending within 60 days, "I am interested" leads, and clicks on campaign and newsletter links.
- **Audiences.** Stage, score, days in stage and topic are conditions for audiences.
- **ABM.** The stage shows beside each program company.
- **Account.** An Account 360 card shows the score and recent signals.
- **Owner alert.** When a company moves up to Comparing or Deciding, the company's owner gets a note on the account. In a Nova workspace it appears in the inbox.
- **Scoring.** Buying signals, the lead score and the account health rating stay separate numbers.

### Good to know

- Older signals count for less: full for 14 days, then half, a quarter, an eighth, and gone after 60 days.
- Scores refresh by themselves about every three hours.
- The first run for a workspace sets a baseline and alerts nobody.
- A company with nothing recorded is Silent. Only what is recorded in BPMSquare counts.

Screenshot: 04-signals-in-market.png | /marketing/signals | The ranked list with stage pills, scores and sparklines
Screenshot: 04-signals-company.png | /marketing/signals | One company open with How this is worked out and the Signals timeline
Screenshot: 04-signals-did-it-work.png | /marketing/signals?tab=didit | A sent campaign compared before and after

---

## 11. Leads

### What it is

A lead is an enquiry or an interested company that has not yet become a deal. There is one **Leads** list. You add leads by hand, and leads also arrive from forms, from email interest buttons and from the Inbox. In a workspace with the lead scoring program, a switch above the list, **All leads | Scored**, shows the same leads two ways. **All leads** is the simple list described in this section. **Scored** is described in the next section. Without the scoring program there is no switch.

### Where to find it

**Intelligence > Leads** (`/leads`). The switch **Scored** is at `/leads?view=scored`.

### Who uses it and which module switches it on

Sales and marketing. Module: `leads`. The **→ Deal** button needs `pipeline`.

### How to use it

**Add a lead**

1. Open **Intelligence > Leads** and select **+ New Lead**.
2. Search and pick the **Account**. Type a **Title**, for example "Ring-frame motor burnt, rewind enquiry". Pick the **Source**: Direct, OEM Referral or AMC.
3. Select **Save**.

**Find leads**

1. Use the status chips (**New**, **Inspecting**, **Quoted**, **Won**, **Lost**) and the search box ("Search lead title or account…").

**Turn a lead into a deal**

1. On a lead row, select **→ Deal**. A deal is created in the Pipeline from the lead and you land on it. The lead becomes **Converted to deal**.

### Statuses

| Status | Meaning |
|---|---|
| New | Just arrived |
| Inspecting | Being looked at |
| Quoted | A quote was sent (verify) |
| Won | Bought |
| Lost | Not pursued |
| Converted to deal | A deal was created from it |

Sources shown on the list: OEM Referral, AMC, Direct, Campaign, Form and Inbound. A campaign lead shows the campaign name as a link.

### How it connects

- **Accounts.** Every lead belongs to an account.
- **Emails and forms.** An interest click or a form submission creates a lead, with the email or form recorded as its source.
- **Inbox.** In the Inbox, an email can be turned into a Lead (verify the button wording).
- **Pipeline.** **→ Deal** creates the deal with the lead's title, account and source. If the lead already has a deal, it opens that one.
- **Scored view.** The same leads are scored and staged there (see the next section). **All leads** and **Scored** are two views of the same leads.
- **Change history.** Creating a lead is logged.

### Good to know

- Leads added by hand can only have the sources Direct, OEM Referral or AMC. The other sources are set by the product.
- **All leads** shows the simple statuses. The eight stages are on the **Scored** view.
- **New lead** stays on **All leads**.

Screenshot: 04-leads-list.png | /leads | The Leads list with status chips and the → Deal button
Screenshot: 04-lead-new.png | /leads | The New lead dialog with Account, Title and Source

---

## 12. Scored leads

### What it is

The **Scored** view of Leads adds a score and eight stages to the same leads. The score is worked out from what the person did (clicked an email, opened a quote, filled in a form) and who they are (their company and role). When it is high enough, the lead becomes **Ready for sales** and goes to a salesperson, who has a deadline to respond. The score comes from fixed rules. It is never an AI guess.

### Where to find it

**Intelligence > Leads**, then the switch **Scored** (`/leads?view=scored`). The old address `/marketing/leads` redirects there and keeps the search, stage, sort and page. A lead opens at `/marketing/leads/<id>`. The rules are at **Settings > Marketing > Leads** (`/settings/marketing-leads`).

### Who uses it and which module switches it on

Salespeople work the leads. Marketing administrators set the rules. Modules: `marketing_scoring` and `leads` (both need `marketing`). Without `marketing_scoring` the switch does not appear for your workspace and `?view=scored` shows the plain list.

### How to use it

**Set up once (administrator)**

1. Open **Settings > Marketing > Leads**, tab **Scoring**. Set **Warm from**, **Hot from** and **Look back (days)**. In **Scoring rules**, click a rule to change **Points**, **Fades over (days)** and **Counts up to (a week)**, or the profile lines (kind of company, country, role).
2. Open **Settings > Coverage** and pick **Who gets new sales-ready leads**: **The team lead** or **Each member in turn**.
3. Open **Settings > Marketing > Leads**, tab **Hand-over**. Set **Working days to pick up a lead**, **Days off**, **When no team covers it, these people take new leads in turn**, and the switches **Tell the owner when a lead is overdue** and **Tell the team lead when a lead is overdue**.
4. Switch on **Make a lead when someone becomes Warm** if you want leads made by themselves. It is off by default.

**Work the list (salesperson)**

1. Open **Intelligence > Leads** and select **Scored**. The best score is at the top.
2. Use the chips: **All**, a stage, or **Overdue**. Search by lead, company or person.
3. Open a lead. The card **Why 72?** (your number will differ) lists each reason with its points and how many points remain to the next stage.
4. On a **Ready for sales** lead, select **Pick this up**. It becomes yours and moves to **Working**.
5. Use **Stage** to move it, add an optional note, and select **Move to <stage>**. Use **Owner** or **Take this lead** to assign it.
6. Select **Score again** to work out the score now.

### Statuses

| Stage | Meaning |
|---|---|
| New | Just arrived |
| Engaged | Showing real interest, not ready for a call |
| Ready for sales | A salesperson should call now |
| Working | A salesperson has taken it |
| Deal | Turned into a deal |
| Customer | Bought from you |
| Not now | Not the right time |
| Not a fit | You will not pursue it |

Other labels: **Respond by** (time left), **Overdue** (still Ready for sales and past the deadline), **Needs an owner**, and a note when no team covered the company, so an administrator or the next person on your list took it.

Default scoring: Warm from 20 and Hot from 60. Default points include 10 for clicking a link, 30 for saying they are interested, 20 for opening a quote, 30 for filling in a form, 25 for replying on WhatsApp, 40 for coming to an event, and minus 40 for unsubscribing.

### How it connects

- **Events.** Email clicks, quote openings, form submissions, WhatsApp replies and event attendance all add points.
- **Coverage.** The company's team and its assignment mode decide who gets a Ready lead. If no team covers the company, the **Hand-over** list is used, then the oldest administrator.
- **Nova inbox.** An owner is told when a lead becomes Ready, and when it is overdue (each lead once).
- **All leads.** The same lead appears there with its simple status. A stage move keeps the simple status in step.
- **Audiences.** Lead score and lead stage are conditions for audiences.
- **Account 360.** A lead card shows on the account.

### Good to know

- Scores are refreshed about every 15 minutes, and points fade as actions get older.
- Scoring moves a lead up through New, Engaged and Ready for sales by itself. It never moves it down, and never touches a lead a person has taken on.
- The response clock starts when a lead becomes Ready for sales and stops when it becomes Working.
- Automatic leads only look at what people did after you switched the setting on.
- Older text calls this screen "Lead scores" or "Scored leads". It is the Scored view of Leads now, and the Intelligence Overview step **Who is ready** counts it.

Screenshot: 04-scored-leads-list.png | /leads?view=scored | The list with score meters, Lead stage pills and Respond by chips
Screenshot: 04-scored-lead-why.png | /marketing/leads/<id> | The Why score card with reasons and the Pick this up button
Screenshot: 04-settings-leads-scoring.png | /settings/marketing-leads | The Scoring tab with Warm from, Hot from and the rules table

---

## 13. Results (Revenue by source)

### What it is

Results shows how many deals, how much open pipeline, how much won revenue and how much money received each campaign, newsletter, form, journey, WhatsApp template or event started or touched. It shows where deals came from. It does not prove why they were won.

### Where to find it

**Intelligence > Results** (`/marketing/attribution`). The page is titled **Revenue by source**.

### Who uses it and which module switches it on

Marketing and sales managers. You need the **Results** role entry. An administrator can select **Refresh figures**. Module: `marketing_attribution` (needs `marketing`). The revenue figures need `pipeline`.

### How to use it

1. Open **Intelligence > Results**.
2. Under **What to look at**, choose Emails, Newsletters, Forms, Journeys, WhatsApp templates or Events.
3. Under **Who gets the credit**, choose **First touch**, **Last touch** or **Shared evenly**.
4. Under **What counts as a touch**, choose **The person did something** (a click, reply, form or registration) or **Also people only sent something**.
5. Read the four figures: **Won, where it started**, **Open, where it started**, **Deals started** and **Deals in all**. Then read the table: Companies, Deals started, Open, Won, Paid, Deals touched and Won touched.
6. Select **Refresh figures** (administrator) to recompute now. The header says when the figures were last updated.
7. To share a view, copy the web address. Every choice is in the address.

### Statuses

There is no status. The page uses these terms.

| Term | Meaning |
|---|---|
| Started | The touches before the deal was created share the credit. Started figures add up to one deal per deal, so they can be added |
| Touched | Every item that touched the deal from 90 days before it was created until it closed. These overlap. Do not add them up |
| Paid | Money received on invoices raised from the deal's quotes, shared in the same proportion |

### How it connects

- **Events used:** email clicks and interest, emails sent, form submissions, journey entry, WhatsApp sent, read and replied, and event registration and attendance.
- **Deals** come from the Pipeline. **Paid** comes from invoices made from the deal's quotes. Standard quotes are not invoiced in the product, so they add nothing to Paid.
- Nothing is changed in deals, quotes or invoices. The page only reads them.

### Good to know

- The look-back window is fixed at 90 days.
- Figures are recomputed about every three hours.
- A company that clicked may have bought anyway. A deal with no touch may have come from a phone call that is not recorded.
- A WhatsApp dry run reached nobody and is ignored.
- With fewer than 20 deals, read the table as a list, not a rate.
- The menu says Results. The page title is "Revenue by source".

Screenshot: 04-revenue-by-source.png | /marketing/attribution | The choices on the left and the four figures and table on the right
Screenshot: 04-revenue-how-to-read.png | /marketing/attribution | The How to read this card

---

## 14. Consent and unsubscribe

This is not a menu item. It runs through every sender, so it is described once here.

### What it is

Consent is a person's recorded "yes, you may contact me about this." Every yes and every no is kept as a record with the date, the channel (email, WhatsApp, SMS or phone), the topic and how it was given. A new answer never erases an old one.

### Where to find it

- Rules and topics: **Settings > Marketing > Consent** (`/settings/marketing-consent`). This is the only place that sets them. The email screens show a **Consent** chip and a **Change in Settings** link to it.
- One person: **Contacts**, open the person, **Marketing** tab, **Consent** card.
- Bulk: **Data Workbench**, Import or Export, **Consents**.
- Public pages: the unsubscribe page (`/marketing/unsubscribe/<accountId>/<token>`), the preference centre and the confirm page.

### Who uses it and which module switches it on

Administrators set the rules. Anyone who edits contacts can record an answer. The Consent page and its Limits tab open for any workspace with `marketing`. **Scoring** and **Hand-over** under Settings > Marketing > Leads still need `marketing_scoring`. The Marketing tab on a contact is unchanged (verify).

### How to use it

**Set the rules (administrator)**

1. Open **Settings > Marketing > Consent**. Choose **Based in** (your country group).
2. Under **Rules by country**, click a country. Under **Without a recorded yes**, choose **Only people who have said yes** (the safe default) or, where allowed, **Also existing customers, about similar products**. Ask your legal adviser before relaxing it.
3. Under **Topics**, click a topic to change its **Name** and **Covers** line. Use **Add a topic** for a new one. A topic people have already answered can be renamed but not removed.
4. Leave **Count newsletter opens** off unless you need it.

**Record an answer from a phone call**

1. Open the contact, go to the **Marketing** tab and find the **Consent** card.
2. Select **Record consent** or **Record withdrawal**.
3. Pick the **Channel**, the **Consent topic** (or **Any consent topic**) and the **Basis** (**They agreed**, or **Existing customer** where allowed).
4. In **How you got it**, write a sentence, for example "Agreed by phone on 20 Oct". It is required.
5. Select **Save consent**. Nothing is sent to the person.

**Bring in a list of people who already agreed**

1. Open **Data Workbench**, choose Import, then **Consents**.
2. Use one row per answer. The columns are Email (the person must already be a contact), Channel, Consent topic, Answer (`granted` or `withdrawn`), Basis (`consent` or `existing_customer`, required for granted rows), Date they agreed and Note.
3. An import never creates a contact and never edits an old answer. Rows that cannot be matched are listed as skipped.

**Set sending limits (administrator)**

1. Open **Settings > Marketing > Consent**, tab **Limits**. Set **Quiet from**, **Quiet until**, **Emails a day, per person**, **WhatsApp messages a week, per person** and **No journey emails on**.

### Statuses

| State | Meaning |
|---|---|
| Agreed | They said yes for this channel and topic |
| Withdrawn | They said no, or asked to stop. Kept as history |
| Waiting for confirmation | Ticked on a form that needs confirming. Not counted as a yes |
| Did not confirm | Seven days passed without confirming |

Country groups are Saudi Arabia, United Arab Emirates, Qatar, Kuwait, Oman, Bahrain, India, European Union and Everywhere else. Every group starts strict: a person must have said yes. India never allows the existing-customer option.

### How it connects

- **Sending.** Emails, newsletters, journeys and WhatsApp ask "may we contact this person, on this channel, about this topic, right now?" at the moment of sending. The most recent answer wins. On a tie, a withdrawal wins. A "do not contact" mark, a suppressed address (bounced or reported as spam) and the company's opt-out flag all refuse email.
- **Forms.** A ticked box records consent with the exact words shown. A preference centre change adds a new answer.
- **WhatsApp.** STOP and START replies update the record.
- **Email health.** A hard bounce or a spam complaint suppresses the address. It is not emailed again until the address is fixed or consent is recorded again.
- **Lead scores.** Unsubscribing takes points off.
- **Email screens.** The count, the Review and send panel and the record show the same plain reasons, with a link to the Consent page or the contact. The pickers for a topic on a form, a WhatsApp template or a journey step stay where they are: they choose a topic for that item. The list of topics, the country rules and the limits are defined only in Settings.

### Good to know

- **The unsubscribe link opts out the whole company.** In a plain email, and in a newsletter sent by a workspace without Forms, the footer **Unsubscribe** opens a page titled "Unsubscribe from marketing emails". Its button sets the company's marketing opt-out. It does not stop quotes, invoices or other account mail. The page waits for the button so that mail scanners cannot unsubscribe someone.
- With Forms on, a newsletter's **Manage preferences** link opens the preference centre, where each person chooses topics or **Unsubscribe from all**. Each change is a new record.
- No screen was found that clears a company's opt-out flag (verify).
- If someone chose **Unsubscribe from all**, only they can come back. They ask you, and you record their consent on the contact.
- A demo workspace redirects all email and WhatsApp, whatever the consent says.

Screenshot: 04-settings-consent.png | /settings/marketing-consent | Based in, the Rules by country table and the Topics table
Screenshot: 04-settings-consent-limits.png | /settings/marketing-consent?tab=limits | The Limits tab with quiet hours and the per-person limits
Screenshot: 04-contact-consent-card.png | /contacts/<id> | The Consent card on the Marketing tab with Record consent
Screenshot: 04-unsubscribe-page.png | /marketing/unsubscribe/<accountId>/<token> | The public unsubscribe page with its confirm button

---

## 15. Partners

The menu has a **Partners** item (**Master data > Partners**, `/partners`, module `partners`). In this version the page is a placeholder. It is titled "Partners, Marketing · OEM referral sources" and says "Coming in a later slice". It has no records, no buttons and no connections. Do not demonstrate it as a feature.

What exists today that relates to partners:

- An account can have the type **OEM / Vendor**, and Audiences can filter on it.
- A lead can have the source **OEM Referral**.
- A customer account can store **Referred by** (the OEM account's ID) when it is created.

Screenshot: 04-partners-placeholder.png | /partners | The placeholder page, to show the module is not built yet

---

## Common questions

**Why did my email or newsletter reach fewer people than the audience showed?**
The audience builder counts accounts. The email checks each person. People are left out when they have not agreed to the topic, have opted out, have no matching contact, have a bounced address, or would get a language that is not ready. **Who will receive it** and **Review and send** list each reason with a fix before you send. After sending, open the send record to see who was left out and why.

**When someone selects Unsubscribe, does the whole company stop?**
Yes, for the unsubscribe link used in plain emails and in newsletters from a workspace without Forms. It sets the company's marketing opt-out. It does not affect quotes or invoices. With Forms on, a newsletter links to the preference centre, where each person chooses topics.

**Why can't I see a Marketing or Intelligence menu item?**
Either the module is not switched on for your workspace, or your business role hides it. A workspace with none of the Intelligence modules has no Intelligence part. Only the BPMSquare team can switch modules on. Your administrator can change business roles.

**I sent a WhatsApp template and nothing arrived. Is it broken?**
No. The only WhatsApp provider built in today is a sandbox. It logs the message and sends nothing. A real provider has to be connected first.

**Why did our test email go to a different inbox?**
A demo workspace always redirects email to one internal inbox, set in **Settings > Integrations > Email output**. The subject starts with "[Redirected · for …]" and the body names who it was for. This cannot be switched off on a demo workspace.

**A lead has a good score but is not Ready for sales. Why?**
The score is below the **Hot from** line (default 60) in **Settings > Marketing > Leads**, tab **Scoring**. Open the lead and read **Why <score>?**. It shows how many points remain.

**Someone filled in our form but is not in the newsletter audience. Why?**
They did not tick the consent box, or the form asks for confirmation and they have not pressed the link yet. An unticked box records nothing. Check their Consent card for **Waiting for confirmation**.

**Can I send the same email again?**
Not to everyone. An email is sent once to each person. Create a new email to send again. Sending a newsletter again with **Send...** creates a new send record each time.

**Part of my email failed. What do I do?**
Open the email. If the email service reached its daily limit, the page says so. Select **Send the rest** later: it sends only to people whose email failed or was never tried, never to anyone already sent.

**Where did Segmentation, Campaigns and Scored leads go?**
Segmentation is **Audiences**. Campaigns and Newsletters are **Email**, with chips. Scored leads is the **Scored** switch on **Leads**. Revenue by source is **Results**. See "How Marketing is laid out".
