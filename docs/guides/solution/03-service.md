# BPMSquare solution guide: Service

Snapshot 4 Nov 2026

> Screen names and button words may be refined as the product improves. If a name here is slightly different on your screen, look for the same idea nearby. Anything marked "(verify)" could not be confirmed from the product and should be checked with your BPMSquare contact before you rely on it.

## About this chapter

This chapter is for service managers, coordinators and the consultants who set Service up. It follows one job from the first call to the final invoice. A customer reports a fault. You log a **case**, inspect the equipment, quote the repair, send a technician on a **work order**, and bill the work.

The examples use a made-up customer, Example Trading LLC.

### How Service is laid out

Service lives in the left menu under **Service**. It has five screens: Cases, AMC contracts, Work orders, Dispatch and Technicians. Equipment records (**Assets**) sit under **Master data**. Quotations and Invoices sit under **Sales**.

Each screen is a separate module. The BPMSquare team switches modules on for your workspace in the platform admin console. Your own administrator cannot do it. A module that is off does not appear in the menu. Your administrator can also hide screens for a person through business roles in **Settings > People**. That only hides the screen from their menu. It is not a security lock.

### Contents

1. [Cases](#1-cases) (including inspection reports, photos and response times)
2. [AMC contracts](#2-amc-contracts)
3. [Work orders](#3-work-orders)
4. [Dispatch](#4-dispatch)
5. [Technicians](#5-technicians)
6. [Assets, including loaner units](#6-assets-including-loaner-units)
7. [From case to quote, work order and invoice](#7-from-case-to-quote-work-order-and-invoice)
8. [Common questions](#common-questions)

### Not in the product

These are not in the product at this snapshot, so this chapter does not describe them:

- A setting for service response times (SLAs). There is no Service page under Settings.
- A way to email an inspection report. "Send report to customer" only changes the case stage (see Cases).
- A scheduling board with drag and drop. Dispatch is a read-only list.
- Creating or editing AMC contracts in the app.
- A button that lends a loaner unit to a case (see Assets).

---

## 1. Cases

### What it is

A case is one repair or service job, from intake to delivery. It holds the complaint, the equipment, the technician, the inspection report, the photos and the linked quotation.

### Where to find it

**Service > Cases** (`/cases`). New case: **+ New Case** (`/cases/new`). A case opens at `/cases/<id>`.

### Who uses it and which module switches it on

Service coordinators and workshop supervisors. Module: **Cases**. Business role entry: **Cases**. A case can also be created from the shared Inbox ("Create from this email > Case") when your workspace has the Inbox module.

### How to use it

**Log a new case**

1. Open **Service > Cases** and select **+ New Case**. From an account page you can start a case with the account already filled in.
2. Choose the **Account** (required) and the **Case type** (required): Adhoc, Direct or AMC (contract).
3. Tick the customer's equipment under **Assets (customer equipment)**. These appear once you pick an account. The **Equipment label** fills in by itself from the first asset. You can overwrite it. The label is required.
4. Write the **Complaint** (required). Add the **Symptom** if you know it.
5. Optionally choose **Assign technician**, then select **Save**. The case opens as **Intake** with a reference like `CS-2026-0001`.

**Move a case through its stages**

The action card at the top of the case page changes with the stage. Use its buttons to move forward.

1. Intake: add **Internal notes** and intake photos, then select **Start Inspection →**.
2. Inspection: fill in the report (next task), then **Send report to customer →**. If the customer needs no report, select **Skip report — Create Quotation**.
3. Report sent: when the customer agrees, select **Customer approved →**. This moves the case to Report approved. You can also select **Create Quotation** here.
4. Report approved: select **Create Quotation →**, or **Skip quote — Start Repair** if no quotation is needed.
5. Quote sent or Quote approved: when the customer accepts, select **Start Repair →**.
6. In repair: keep **Repair notes**, then select **Move to QA →**.
7. QA: select **QA passed — Mark Ready →**, or **Failed — Back to Repair**.
8. Ready: select **Close — handed to customer ✓**. The other two buttons end the case differently: **Buyback — customer sold unit** and **Scrap unit**.

**Write an inspection report**

1. While the case is in **Inspection**, fill in **Findings** (required) and **Recommendations** (required).
2. Optionally enter the **Estimated cost**.
3. Add inspection photos.
4. Select **Save draft** to keep working, or **Send report to customer →** to mark it sent.
5. After the inspection stage, the report is read-only on the case's **Inspection** tab.

**Add photos**

1. In the Intake or Inspection action card, choose **Add photos**. On a phone you can use the camera or the gallery.
2. Add a caption if you want, then upload.
3. Photos show on the case's **Photos** tab, grouped as Intake, Inspection and Final / delivery. While the case is still in Intake or Inspection they show inside the action card instead.

**Find a case**

1. Use the chips at the top of the list: Open, In repair, Awaiting, Closed, All. Each shows a count. The list opens on **Open**.
2. Search by case reference, equipment, account or complaint.
3. Sort by clicking a column heading. Add the optional **Complaint** column from the list menu.

### Statuses

Case statuses are fixed. A workspace cannot rename or add to them.

| Status | Stage group on the case page | How it is set |
| --- | --- | --- |
| Intake | Intake | New case |
| Inspection | Inspection | Start Inspection → |
| Report sent | Report | Send report to customer → |
| Report approved | Report | Customer approved → |
| Quote sent | Quote | Saving a quotation made from the case |
| Quote approved | Quote | No button in the app (verify). Import or integration only. |
| In repair | Repair | Start Repair →, or Failed — Back to Repair |
| QA | Repair | Move to QA → |
| Ready | Close | QA passed — Mark Ready → |
| Closed | Close | Close — handed to customer |
| Buyback | Outside the flow | Buyback — customer sold unit |
| Scrapped | Outside the flow | Scrap unit |

On the list, **Open** means every status from Intake to Ready. **In repair** is that one status. **Awaiting** means Report sent or Quote sent. **Closed** means Closed, Buyback or Scrapped.

Inspection report statuses are Draft, Sent to customer, Customer approved and Customer rejected. In the app you can only reach Draft and Sent. Approving the report moves the case, not the report's own status (verify).

### Links to other records

- **Account** and **Contact**: shown in the right-hand panel.
- **Assets**: one or more, shown in the panel. Use **+ Add asset** to link more.
- **Technician**: chosen at creation.
- **Quotation**: appears on the **Related** tab and as **View quotation** at the top. See chapter 7.
- **Work orders**: the **Work orders** card in the right panel, with **Create work order**.
- **AMC contract** and **Loaner dispatched**: shown in the panel when linked (see AMC contracts and Assets).
- **Sub-cases**: listed on the **Related** tab when a case has children. The app has no button to create one (verify).
- **Supplier quotations (RFQs)**: the **Related** tab can request parts quotes from suppliers when the RFQ module is on.
- **Email it came from**: shown on the Overview tab when the case was created from an Inbox message.

### Good to know

- The case reference is `CS-<year>-<number>`. Numbers count up for your workspace.
- **Case type** cannot be changed after the case is created. The guide cannot tell you how your business defines Adhoc and Direct. The product only labels them (verify with your team's own definitions).
- **Send report to customer →** only marks the report as sent and moves the case. The screen says no email is delivered. Contact the customer yourself. **More > WhatsApp the customer** opens WhatsApp with a short follow-up message about the case. It does not attach the report, and it needs a phone number on the contact or account.
- A technician can be chosen when the case is created and again when a work order is raised. There is no technician picker on the case page itself (verify).
- Photos must be JPEG, PNG, WebP, HEIC or HEIF, up to 10 MB each. The **Final / delivery photos** group only displays photos that already exist. The case page has no uploader for that group (verify).
- Response times: there is no SLA setting for cases. The Dashboard **Cases open** tile counts a case as "past SLA" when it is in Report sent or Quote sent and 3 or more days have passed since intake. The count starts at the intake date, not the date the report or quote went out. This rule is fixed.
- The **Closed** date on a case is not stamped when you close it in the app (verify). It shows only when it was imported.
- Custom fields: an administrator can add fields to cases in **Settings > Custom fields**. **More > Adapt fields** on the case changes how the fields are laid out.
- Every change is recorded on the **Activity** tab.
- Data Workbench can import, export and update cases (a Record ID from an export is needed for updates). The v1 API has a read-only cases list.
- When the Nova experience is on for your workspace, the Cases list also offers Field, Lanes and List views. The Lanes view marks cases as Stuck (open more than 30 days) or Unassigned.

Screenshot: service-cases-list.png | /cases | The Cases list with the status chips, search box and the + New Case button.
Screenshot: service-case-new.png | /cases/new | The New Case form with the optional assets list open.
Screenshot: service-case-inspection.png | /cases/<id> (a case in Inspection) | The stage tracker and the inspection report card with Findings, Recommendations and Estimated cost.
Screenshot: service-case-detail.png | /cases/<id> (a case In repair) | The full case page with the right-hand panel and the Work orders card.

---

## 2. AMC contracts

### What it is

AMC means annual maintenance contract. This screen lists your maintenance contracts with their dates and value, and flags the ones about to end.

### Where to find it

**Service > AMC contracts** (`/amc`). The page title reads "AMC contracts".

### Who uses it and which module switches it on

Account managers and service managers who watch renewals. Module: **AMC**. Business role entry: **AMC Contracts**.

### How to use it

This screen is read-only. You cannot add, edit or open a contract in the app (verify how contracts get into your workspace, for example by an integration).

**Check what is coming up for renewal**

1. Open **Service > AMC contracts**.
2. Read the three tiles: **Active**, **Expiring ≤60 days** and **Active Value**.
3. Select the **Expiring ≤60 days** tile to filter the list to active contracts with 60 days or fewer left. Select it again to clear.
4. Check the **Days left** column. It turns amber when an active contract has 60 days or fewer left. It reads "Expired" once the end date has passed.

**Find a contract**

1. Type a contract reference or an account name in the search box.
2. Optionally choose a status in the **All statuses** list.

### Statuses

| Status | Meaning |
| --- | --- |
| Active | In force |
| Expired | Past its end date |
| Draft | Not yet in force. Shown as "draft" in plain lowercase text (verify) |
| Pending, Cancelled | Offered in the status filter, but the database only stores Active, Expired and Draft (verify) |

### Links to other records

- The list shows the **Account** by name only. Rows do not open.
- A case can show its **AMC contract** reference in the right-hand panel.
- A work order can be authorised by a contract. It then shows as **AMC** instead of **Billable**.

### Good to know

- A contract is not linked to a case from inside the app. The only in-app way to authorise a work order is a quotation (chapter 7). For an AMC case, the work order step needs a contract already linked to the case (verify how).
- Data Workbench has no AMC import, export or update. The v1 API has no contracts endpoint.
- No automatic renewal email or reminder comes from this screen.

Screenshot: service-amc-list.png | /amc | The three tiles and the contract list with the Days left column.

---

## 3. Work orders

### What it is

A work order is one visit or job for a technician, on site or in the workshop. It records the account, the equipment, the technician, the date and the scope, and it is what you complete and then bill.

### Where to find it

**Service > Work orders** (`/work-orders`). The page title reads "Work orders". A work order opens at `/work-orders/<id>`.

### Who uses it and which module switches it on

Service coordinators (to raise and complete) and finance (to raise the invoice). Module: **Work Orders**. Business role entry: **Work Orders**. Raising one from a case also needs the **Cases** module and the create permission on Work Orders.

### How to use it

**Raise a work order from a case**

1. Open the case. In the right-hand panel find the **Work orders** card.
2. Select **Create work order**. A side panel opens.
3. Choose the **Scheduled date**. It starts as today.
4. Optionally choose the **Technician**. It starts as the case's technician. Inactive technicians are not offered.
5. Select **Create work order**. The new work order opens with status **Scheduled**.
6. If the case already has a Scheduled or In Progress work order, the panel names it. Select **Create another** only if a second visit is needed.

If the card says "Link a quotation or an AMC contract to this case before raising a work order", create the quotation from the case first (chapter 7).

**Complete the job**

1. Open the work order and select **Mark Complete**. It works from Scheduled or In Progress.
2. Add the **Technician notes** and **Scope of work** through **More > Edit** if needed.
3. If your workspace has Workforce, the **Attendance** tab shows the technician's punches for the scheduled day and the net hours. When the quotation has a labour line in hours, it also shows the variance against the quotation.

**Bill the job**

1. When the status is **Completed**, select **Raise Invoice**.
2. A draft invoice opens. The work order becomes **Invoiced**.
3. Review and send the invoice from **Sales > Invoices**.

**Find a work order**

1. Use the status chips: Scheduled, In Progress, Completed, Invoiced, All.
2. Search by reference, account or asset.
3. Switch between table and cards from the list menu (**Card view** or **Table view**).

### Statuses

Work order statuses are fixed.

| Status | How it is set |
| --- | --- |
| Scheduled | New work order |
| In Progress | No button in the app (verify). Import or integration only. |
| Completed | Mark Complete |
| Invoiced | Raise Invoice |

### Links to other records

- **Service case**: the right-hand panel and the Ref column both link back to the case.
- **Authorization** panel: **Billable** with the quotation reference and value, or **AMC** with the contract reference.
- **Account**, **Asset under service** and **Technician**.
- **Loaner dispatched**: a card appears when a loaner is linked.
- **Invoice**: created by Raise Invoice. See "Good to know" for what it contains.
- **Materials**: the **Related** tab can request supplier quotations for parts when the RFQ module is on.

### Good to know

- The reference is `WO-<year>-<number>`.
- The list has no **+ New** button. Work orders are created from a case, or brought in by Data Workbench import or an integration.
- Account, asset and authorisation are copied from the case. They cannot be picked on the create panel.
- An AMC case prefers its contract. Any other case prefers its quotation. If the case has only one of the two, that one is used.
- No work order can be raised for a case that is Closed, Buyback or Scrapped.
- A quotation-authorised work order creates an invoice with the quotation's lines and total, contact and legal entity.
- A contract-authorised work order creates a draft invoice with no lines and a zero total, because a contract is billed as a period value. One labour line is added automatically only when Workforce is on, the work order has a technician and a date, logged hours exist for that day, and a Labour rate is set in **Settings > Pricing**.
- After creation, the scheduled date and the technician cannot be changed on the work order page (verify). Decide them in the Create work order panel.
- Raise Invoice does not check whether the same quotation already has an invoice from **Convert to Invoice**. Use one route per job (chapter 7).
- Data Workbench import of work orders needs the authorising quotation reference. Contract-authorised work orders cannot be imported yet. Data Workbench can also export and update work orders.
- Custom fields can be added to work orders in **Settings > Custom fields**.

Screenshot: service-work-orders-list.png | /work-orders | The Work Orders list with status chips and the Type column showing Billable and AMC.
Screenshot: service-create-work-order-panel.png | /cases/<id> (select Create work order) | The Create work order side panel with date and technician.
Screenshot: service-work-order-detail.png | /work-orders/<id> (a Completed work order) | The work order page with the Raise Invoice button and the Authorization panel.

---

## 4. Dispatch

### What it is

Dispatch is a read-only list of all active work orders, soonest first, so a coordinator can see who is doing what and when.

### Where to find it

**Service > Dispatch** (`/dispatch`).

### Who uses it and which module switches it on

Service coordinators. Module: **Dispatch**. Business role entry: **Dispatch**.

### How to use it

**See the open jobs**

1. Open **Service > Dispatch**.
2. Read the two tiles: **Scheduled** and **In Progress**.
3. Read the table: Ref, Account, Technician, Status, Scheduled, Case and Scope. Jobs with no date show "TBD". Jobs with no technician show "Unassigned".
4. If you have more jobs than fit one page, use the pager at the bottom.

**See who is at work**

1. If your workspace has the Workforce module, a badge shows next to each technician's name: On duty, On break, Off duty or On overtime.
2. Use it to decide who to send. It comes from the technician's punches.

### Statuses

Dispatch shows only work orders in **Scheduled** or **In Progress**. See Work orders for the full list.

### Links to other records

Each row shows the work order reference, the account name, the technician name and the case reference as plain text. The rows are not links (verify). To open a record, go to **Work orders** or **Cases**.

### Good to know

- You cannot assign, move or reschedule jobs here. There are no controls on the page.
- Rows are in scheduled-date order. The page has no filters or search, and it is not limited to today.
- The empty state reads "No active work orders to dispatch."
- Dispatch has no Data Workbench or API object of its own. It reads work orders.

Screenshot: service-dispatch.png | /dispatch | The two tiles and the table with the On duty badge next to a technician.

---

## 5. Technicians

### What it is

Technicians are your field and workshop people. A technician record holds contact details, skills, certifications, leave, daily capacity and a monthly work summary.

### Where to find it

**Service > Technicians** (`/technicians`). New: **+ New Technician** (`/technicians/new`). A technician opens at `/technicians/<id>`.

### Who uses it and which module switches it on

Service managers and coordinators. Module: **Technicians**. Business role entry: **Technicians**.

### How to use it

**Add a technician**

1. Open **Service > Technicians** and select **+ New Technician**.
2. Enter the **Full name** (required). Phone, Email and **Skills / specialisations** are optional.
3. Under **Field settings** enter the **Base location** and **Max visits / day**. The starting value is 3. Allowed values are 1 to 10.
4. Select **Save**. The technician starts as **Active**.

**Check the team's capacity**

1. Open the list and read the tiles: **Active today**, **On leave**, **Slots used** and **Slots free**.
2. In the **Free today** column, a figure like `2/3` means 2 of 3 daily visits are still open.
3. Use the status list and the search box (name, phone or skill) to narrow the list.

**Review one technician**

1. Select a technician. The top figures are Visits this month, Completed, Km travelled and Avg work time.
2. **Overview** shows skills, certifications (with a warning for any that expire within 90 days) and upcoming work orders.
3. **Schedule** is a month calendar. Use the arrows to change month. Colours mean Done, WO, Leave and Conflict. Leave entries are listed below.
4. **Visits** lists recent visit logs, with a time bar for travel, work, break and return.

**Edit a profile**

1. On the technician page select **More > Edit**.
2. The **Edit profile** page has Personal information, Status (Active, On leave, Inactive), Skills (comma separated), Certifications (name and expiry date) and Leave schedule.
3. Select **Save**. The changes are written, and the change is logged under **Technicians** in change history.

### Statuses

| Status | Meaning |
| --- | --- |
| Active | Can be assigned. Counted in the capacity tiles. |
| On Leave | Shown with "Back <date>" when a leave entry covers today. Not counted for free slots. |
| Inactive | Hidden from the technician pickers on the New Case page and the Create work order panel. |

### Links to other records

- **Work orders**: the Overview tab lists upcoming ones, with links.
- **Cases**: a technician can be set on a case. It shows in the case panel and the Cases list.
- **Accounts**: the Visits tab links each visit to its account and work order.
- **Workforce** (if on): the live badge, and the work order Attendance tab.

### Good to know

- The **Free today** figure counts work orders whose scheduled time is exactly the start of today. Work orders raised from a case are stored at midday, so they may not be counted (verify).
- Visit logs, certifications and leave entries cannot be added from the screens. They are read from the data (verify how your workspace loads them).
- The New Case page offers only Active technicians. The Create work order panel offers every technician who is not Inactive.
- Technician records cannot be imported, exported or updated in Data Workbench, and have no v1 API endpoint.
- Technicians are separate from Employees. Attendance and leave for the workforce are handled in the Workforce module.

Screenshot: service-technicians-list.png | /technicians | The capacity tiles and the list with Free today and the certificate warning.
Screenshot: service-technician-schedule.png | /technicians/<id>?tab=schedule | The month calendar with work orders and leave.

---

## 6. Assets, including loaner units

### What it is

An asset is a piece of equipment: a motor, transformer, pump, generator or panel. Customer assets record what your customers own and what you service. Loaner units are your own spare equipment that you can lend while a customer's unit is in repair. Each asset shows its service history.

### Where to find it

**Master data > Assets** (`/assets`). New: **+ New Asset** (`/assets/new`). An asset opens at `/assets/<id>`.

### Who uses it and which module switches it on

Service coordinators, quotation writers and account managers. Module: **Assets**. Business role entry: **Assets**.

### How to use it

**Register a customer asset**

1. Open **Master data > Assets** and select **+ New Asset**. From an account page you can start with the account already chosen.
2. Enter the **Asset name** (required) and the **Kind** (required): Motor, Transformer, Pump, Generator or Panel / Switchgear.
3. Add Make / brand, Model, Serial number, Rating / specs and Notes / history.
4. Choose the **Customer account** under **Ownership**.
5. Select **Save**. The asset gets an ID like `AST-0001`.

**Register a loaner unit**

1. Select **+ New Asset** and fill in the equipment details.
2. Under **Ownership** leave **Customer account** at "None (loaner / workshop stock)".
3. Tick **This is a loaner unit** and select **Save**. The unit starts as Available.

**Find an asset's history**

1. Open the asset and select the **Service history** tab. It shows when the Cases module is on.
2. Open cases are listed first, then closed ones. Select **+ New Case** to start a case for the same account.

**Check loaner stock**

1. On the Assets list, read the **Loaner Stock** card above the table. It shows how many units are on loan and how many are available.
2. Each unit shows Available (marked "Ready for dispatch") or On Loan (with the account and case it is with).
3. Choose **Loaner stock** in the type list to show only that card.

### Statuses

Assets have no workflow status. Loaner units carry a loan state.

| Loaner state | Meaning |
| --- | --- |
| Available | In stock and ready to lend |
| On Loan | Lent to a customer's case |

### Links to other records

- **Account**: the owner. Loaners have none.
- **Cases**: the Service history tab, and the **Open cases** column on the list.
- **Quotations**: assets can be attached to a quotation, and a Settings choice decides which asset fields print on it.
- **Work orders**: the **Asset under service** card.

### Good to know

- Nameplate fields (speed, frame type, insulation class, connection, duty, ambient temperature, output kW, stator and excitation voltage and current, frequency) show only when the Kind is **Motor**.
- The case form lists customer assets only, never loaner units.
- The app has no button that lends a loaner to a case or marks it On Loan (verify). When a loaner is linked to a case by import or integration, it appears as "Loaner dispatched" on the case and the work order, and the Loaner Stock card shows it On Loan.
- Data Workbench can import, export and update assets. A blank account on import makes the unit company-owned loaner stock.
- The Analytics screen has a Loaner availability gauge.
- Custom fields can be added to assets in **Settings > Custom fields**.

Screenshot: service-assets-list.png | /assets | The Loaner Stock card above the customer assets table.
Screenshot: service-asset-detail.png | /assets/<id>?tab=cases | An asset with open and closed cases on the Service history tab.

---

## 7. From case to quote, work order and invoice

### What it is

This is the path a repair takes through BPMSquare. Two routes lead to an invoice.

### Where to find it

It starts at **Service > Cases**. It continues in **Sales > Quotations**, **Service > Work orders** and **Sales > Invoices**.

### Who uses it and which module switches it on

Service coordinators and sales or finance staff. Modules: **Cases**, **Quotations**, **Work Orders** and **Invoices**.

### How to use it

**Route A: quote the repair, then convert to an invoice**

1. On the case, select **Create Quotation** (or **Create Quotation →**). It is offered at the Inspection, Report sent and Report approved stages.
2. The New Quotation form opens. A blue box says "Creating quotation from case …". Select **Yes, carry over** to take the account, the assets and the findings and recommendations into the quotation notes, or **Start fresh**.
3. Add the lines and save the quotation. The case now holds the quotation and moves to **Quote sent**.
4. When the customer accepts, set the quotation's outcome to **Won**.
5. On the quotation select **Convert to Invoice**. A draft invoice opens. The button changes to **View invoice** after that.
6. Back on the case, select **Start Repair →**.

**Route B: send a technician, then bill the work order**

1. On the case, select **Create work order** in the **Work orders** card (see chapter 3). The case must already have a quotation.
2. After the visit, select **Mark Complete** and then **Raise Invoice** on the work order.

### Statuses

| Record | Statuses |
| --- | --- |
| Case | Intake to Closed (see chapter 1) |
| Quotation | Draft, Sent, Approved, Rejected by default. A workspace can change these in **Settings > Quotations**. |
| Quotation outcome | Open, Won, Lost, Dropped |
| Work order | Scheduled, In Progress, Completed, Invoiced |
| Invoice | Draft, Sent, Partial, Paid, Overdue, Cancelled |

### Links to other records

- The case holds the quotation and shows it on the **Related** tab.
- The work order holds the case, and an authorisation (the quotation or the AMC contract).
- A work order invoice keeps links to the work order, the case and the quotation or contract.

### Good to know

- A work order needs a quotation (or an AMC contract) on the case. Creating the quotation from the case is the in-app way to link one.
- The quotation is linked to the case when the quotation is saved, not when you open the form. A quotation made separately in Quotations is not linked to a case.
- Saving a quotation made from a case moves the case to **Quote sent**. Marking the quotation Won does not move the case. Move it yourself with **Start Repair →**.
- Convert to Invoice works only on a Won quotation, once, and only on the latest version. It needs the Invoices module.
- **Raise Invoice** on a work order does not look for an invoice already made from the same quotation. Choose one route per job, or you may bill twice (verify).
- Standard Quotes are not part of this flow. Cases create Quotations (verify for your workspace if you use Standard Quotes for service work).

Screenshot: service-quote-from-case.png | /quotations/new (opened from a case) | The blue "Creating quotation from case" box with Yes, carry over and Start fresh.
Screenshot: service-case-related-tab.png | /cases/<id>?tab=related | The Related tab with the linked quotation.

---

## Common questions

**1. Why can't I find a "New work order" button?**
Work orders are raised from a case. Open the case and use **Create work order** in its Work orders card. The Work Orders list has no new button.

**2. The Work orders card says to link a quotation or an AMC contract. What do I do?**
A work order needs something that authorises the work. For a repair, create a quotation from the case (**Create Quotation**) and save it. The quotation is then linked and the card shows **Create work order**.

**3. I selected "Send report to customer". Why did the customer get nothing?**
That button only marks the report as sent and moves the case to Report sent. Nothing is emailed. Contact the customer yourself.

**4. Can I set a service response time (SLA)?**
No. There is no SLA setting. The Dashboard shows "past SLA" for cases in Report sent or Quote sent when 3 or more days have passed since intake. That rule is fixed.

**5. Can two work orders exist for one case?**
Yes. If one is already Scheduled or In Progress, the panel names it and asks you to confirm with **Create another**. This also stops an accidental double click from making two.

**6. Why is my contract-based work order invoice empty?**
A contract is billed as a period value, so the invoice starts with no lines. Add the lines before you send it. If Workforce is on and the technician logged hours that day, one Labour line is added for you, based on the Labour rate in **Settings > Pricing**.

**7. Can I change the date or technician on a work order after creating it?**
Not on the work order page (verify). Decide them in the Create work order panel.

**8. How do I add AMC contracts?**
The AMC screen is read-only. Ask your BPMSquare contact how contracts are loaded for your workspace.
