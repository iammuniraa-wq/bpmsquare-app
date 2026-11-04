# BPMSquare solution guide: Sales and tenders

Snapshot 4 Nov 2026

> Screen names and button words may be refined as the product improves. If a name here is slightly different on your screen, look for the same idea nearby. Anything marked "(verify)" could not be confirmed from the product and should be checked with your BPMSquare contact before you rely on it.

## About this chapter

This chapter is for sales managers, bid managers, buyers, finance staff and the consultants who set Sales up. It follows two journeys. The first is an ordinary sale: a deal becomes a quote, an order and an invoice. The second is the GCC tender edition: a tender arrives, the team decides to bid, prices a bill of quantities, submits and revises the bid, wins it, runs the contract project and buys out the work.

The examples use a made-up customer, Example Trading LLC. In the sales journey it buys equipment. In the tender journey it invites tenders for site works.

### How Sales is laid out

Sales lives in the left menu under **Sales**. It has ten items: Pipeline, Estimates, Fence Projects, RFQs, Quotations, Standard Quotes, Sales Orders, Purchase Orders, Contract Projects and Invoices. Tenders are not a menu item. They are a tab inside **Pipeline**. Buy-out is a tab inside a **Contract Project**. The tender blocks on the home screen are part of the **Dashboard**.

Accounts, contacts, suppliers, products and inventory sit under **Master data**. They are in Chapter 6. Service is in Chapter 3. Marketing is in Chapter 5. Every setting named here is explained in Chapter 1.

Each screen is a separate module. The BPMSquare team switches modules on for your workspace in the platform admin console. Your own administrator cannot do it. A module that is off does not appear in the menu. Your administrator can also hide screens for a person through business roles in **Settings > People**. That only hides the screen from their menu. It is not a security lock.

The whole tender edition hangs on one switch, **GCC tender deals**. Three more switches add parts of it: **Deal Room** (the Room tab), **Contract projects** (the project after the award) and **Shared Inbox** (tenders that start from an email).

### Contents

1. [Deals and Pipeline](#1-deals-and-pipeline)
2. [Tenders](#2-tenders)
3. [Bill of quantities](#3-bill-of-quantities)
4. [Costing a tender](#4-costing-a-tender)
5. [Bid, versions and outcome](#5-bid-versions-and-outcome)
6. [Room, calls and competitors](#6-room-calls-and-competitors)
7. [Tender blocks on the Dashboard](#7-tender-blocks-on-the-dashboard)
8. [Estimates](#8-estimates)
9. [RFQs and supplier quotes](#9-rfqs-and-supplier-quotes)
10. [Quotations](#10-quotations)
11. [Standard Quotes and templates](#11-standard-quotes-and-templates)
12. [Sales Orders and order types](#12-sales-orders-and-order-types)
13. [Purchase Orders](#13-purchase-orders)
14. [Contract projects](#14-contract-projects)
15. [Buy-out packages](#15-buy-out-packages)
16. [Invoices](#16-invoices)
17. [From enquiry to invoice](#17-from-enquiry-to-invoice)
18. [Common questions](#common-questions)

### Not in the product

These are not in the product at this snapshot, so this chapter does not describe them:

- A settings page for deal stages or tender stages. Tender stages are fixed. Deal stages are the five standard ones unless BPMSquare loaded others for your workspace (verify).
- Sending a bid to a tender portal such as Ariba. **Submit bid** saves a numbered version inside BPMSquare. You upload the priced Excel or copy the answer sheet yourself.
- Raising a purchase order from a buy-out package. The package gives you an Excel. The purchase order is raised in ePROMIS or your ERP. The **Send to ePROMIS** button on the project Handover tab is switched off.
- Email, PDF or WhatsApp for a Purchase Order. A Purchase Order can only be marked as sent.
- A "Create sales order" button on a deal or in the Inbox. The button exists on an accepted Standard Quote and on a won Quotation only.
- An internal or external pricing switch on a quote. That choice lives on the order type (Sales Orders).
- Assistant "create" cards for deals, tenders, quotes, orders or invoices. At this snapshot the assistant can propose only an account and a contact (see Chapter 6).
- Sending a Saudi e-invoice to ZATCA. Only the data checks and the bilingual document exist.
- Fence Projects, the Process Design Studio and the Inbox screen itself. They are not described in this chapter.

---

## 1. Deals and Pipeline

### What it is

A deal is one sale you are chasing with one account. Pipeline shows every deal as a card in a stage, with its value and its chance of winning. A deal holds the lines you plan to sell and the quotes made from them.

### Where to find it

**Sales > Pipeline** (`/pipeline`). New deal: **+ New Deal** (`/pipeline/new`). A deal opens at `/pipeline/<id>`.

### Who uses it and which module switches it on

Sales representatives and sales managers. Module: **Pipeline**. Business role entry: **Pipeline**. When the tender edition is on, the page has two tabs, **Deals** and **Tenders**. The Deals tab never shows tender deals (see section 2).

### How to use it

**Create a deal**

1. Select **+ New Deal**.
2. Enter a **Title** and choose the **Account**. Both are required.
3. Optionally choose the **Contact** (it lists the account's contacts), the **Stage**, the **Expected close** date, the **Owner**, the **Source** and the **Competitor**. Add a **Description** if you want.
4. Select **Save**. The deal opens with a reference like `OPP-0001`. You are the owner unless you chose someone else.

**Work the board**

1. The top line shows **Open** (the value of all open deals) and **Weighted** (value times chance).
2. Each stage is a column. A card shows the title, the account, the amount, the chance in percent, the days spent in the stage and the owner's initials.
3. Drag a card to another column to change its stage. Dropping a card on a closed stage opens the close dialog (see Close a deal).
4. Use **Every owner** and **Every account** to filter. Tick **Show closed** to see the closed columns. **Board** and **List** switch the drawing.

**Work one deal**

1. On the **Overview** tab you can change the title, contact, expected close date, owner, source, competitor and description. **Probability override %** replaces the stage's chance. If you override it, fill in **Why the override**.
2. Under **Team** select **+ Add someone**. Pick a person and a role: Owner, Sales, Technical or Knows the customer.
3. On the **Lines** tab, add lines from **Catalog**, **Previous quotes** or **Free text**. The add panel asks whether to include quantity breaks and alternatives. Select **Save lines**. The tab shows "Unsaved changes" until you do.
4. On the **Quotes** tab, read the quotes made from this deal. The newest is marked "latest".
5. When the RFQ module is on, the **Related** tab lets you ask suppliers for prices on the deal's lines.
6. The **Activity** tab shows every change.

**Turn a deal into a quote**

1. Save the lines first. The quote is made from the saved lines.
2. Select **Convert to Standard Quote**. The lines are copied and product lines are priced again on today's date. The new quote opens.
3. Section 11 continues from there.

**Close a deal**

1. Change the **Stage** in the header, or drag the card. Or use **Mark won** or **Mark lost** (**More** menu on the deal).
2. In the dialog choose **Won**, **Lost** or **Dropped**.
3. For Lost and Dropped, choose a reason and add a note if you want.
4. Select **Confirm**. A closed deal can be opened again from **More > Reopen**.

### Statuses

Default stages. A workspace can have its own list (verify).

| Stage | Chance shown | Meaning |
| --- | --- | --- |
| Qualify | 20% | First stage. Is it a real opportunity? |
| Propose | 50% | An offer is being made |
| Negotiate | 75% | Terms are being discussed |
| Won | 100% | Closed. Outcome Won |
| Lost | 0% | Closed. Outcome Lost |

A closed deal also carries an outcome: Open, Won, Lost or Dropped. Reasons for Lost and Dropped are Price too high, Went silent, Chose competitor, Budget cut, Bad timing and Other.

### Links to other records

- **Account** and **Contact**.
- **Standard Quotes** and **Quotations**: the Quotes tab. A Standard Quote can also be linked from its own page (**Link to a deal**) or can start a deal (**Create deal from this quote**).
- **RFQs**: the Related tab.
- The connected system's record, when an ERP is linked (shown as a read-only line under the facts).

### Good to know

- The deal **Amount** is the pre-tax subtotal of the latest linked quote. With no quote it is the total of the deal's lines.
- Accepting a linked Standard Quote closes the deal as Won, but only if the deal is still open. Rejecting the quote changes nothing on the deal. Marking a Quotation Won does not close the deal (verify).
- If a Bill of quantities upload changes the lines while you are editing them, the Lines tab says so and offers **Load the current lines**. Your unsaved edits cannot be saved over the new lines.
- **Delete** (More menu) removes only the deal. Linked quotes stay.
- Deals can be imported, exported and updated in Data Workbench (a Record ID from an export is needed for updates). The v1 API has a read-only deals endpoint.

Screenshot: sales-pipeline-board.png | /pipeline | The deals board with the Open and Weighted figures and the Owner and Account filters.
Screenshot: sales-deal-new.png | /pipeline/new | The New Deal form.
Screenshot: sales-deal-lines.png | /pipeline/<id>?tab=lines (a deal with lines) | The Lines tab with the add-line panel open.
Screenshot: sales-deal-close.png | /pipeline/<id> (select Mark lost) | The close dialog with the loss reason list.

---

## 2. Tenders

### What it is

A tender is a deal with extra facts: the tender number, who issued it, how it came in, the bid end date, a bid decision that a manager approves, and a bid guarantee. Tenders have their own stages and their own deal page with six tabs. They are kept apart from ordinary deals.

### Where to find it

**Sales > Pipeline**, tab **Tenders** (`/pipeline?tab=tenders`). New tender: **+ New tender** (`/pipeline/new/tender`). A tender opens at `/pipeline/<id>`, the same address pattern as a deal. In the Inbox, **Create from this email > Deal** makes a tender.

### Who uses it and which module switches it on

Bid managers, estimators, sales directors and the people who approve bids. Module: **Pipeline** plus **GCC tender deals**. Business role entry: **Pipeline**. A person needs edit access to Pipeline to change a tender. Who approves a bid is chosen in **Settings > Sales > Tenders** (Chapter 1, section 5.3).

### How to use it

**Start a tender**

1. Open **Pipeline**, choose the **Tenders** tab and select **+ New tender**.
2. Choose the **Account**. It is the only required field.
3. Optionally fill in **Tender number** (it must be unique in your workspace), **Issuer**, **Portal** (Ariba, Email, Excel or Other), **Bid end date** (date and time) and **Source**.
4. Select **Save**. The tender opens in the first stage, Received. Its title is built from the tender number, the issuer and the account name.

**Read the Tenders tab**

1. **Bids ending soon** lists open tenders whose bid ends within 14 days, soonest first. A tender already past its end date comes first. Five rows show. Select **Show all** for the rest.
2. The chip on a row is red when two days or fewer are left or the date has passed, amber under seven days, otherwise plain.
3. Below it, the board works like the Deals board, with tender stages. A card shows the bid end chip, the tender number and "N new in Room" when the Deal Room has unread messages.
4. Links from the Dashboard open this tab already filtered. The chips above the board say what is filtered (a stage, "Closing in 14 days", one client, Won or Lost, a month). **Show all tenders** clears them.

**Decide: bid or no bid**

1. On a new tender the main button reads **Propose bid decision**.
2. Choose **Go** or **No-go**, type the reason (required) and select **Ask for approval**.
3. While a proposal waits, the button reads **Review bid decision** and the marker beside the stage reads "Awaiting approval". An approver opens it and selects **Approve** or **Reject**. A rejection needs a comment. The proposer can **Withdraw proposal**.
4. An approved Go moves the tender to Estimating by itself. An approved No-go closes it as No-bid. A rejection returns it to Bid/No-bid.
5. The person who proposed cannot approve, unless the workspace allows self-approval in Settings.

**Fill in the Overview**

1. A strip at the top shows the bid end countdown, the decision, the guarantee, the open questions and the overdue next steps.
2. **What the client asked for** holds the title, tender number, issuer, issuer account, portal, bid end date, contact, owner, source, description and team. Select **Save**.
3. **Documents** shows the email the tender came from and its files (when it came from the Inbox). **Change requests** counts the addenda the issuer has sent. Use **+** each time one arrives, then **Save**.
4. **Open work** shows three buttons: open Room questions, overdue next steps and lines without a price. Each opens the place to deal with it.
5. **Bid guarantee** holds **State**, **Amount**, **Currency** and **Valid until**. Select **Save**. Select **Release** when the issuer hands the guarantee back.

**Follow the main button**

The one big button in the header follows the stage. It always says what comes next.

| Stage | Main button |
| --- | --- |
| Received | Propose bid decision, or Review bid decision while one waits |
| Bid/No-bid | Review bid decision while one waits, otherwise Propose bid decision |
| Estimating | Submit bid, or Revise bid once a version exists |
| Submitted, Clarifications | Record the outcome |
| Awarded | Create contract project, or Open contract project once it exists |
| Lost, No-bid | None |

The header **More** menu holds **History**, **Mark won**, **Mark lost**, **Reopen** and **Delete**.

### Statuses

Tender stages are fixed.

| Stage | Chance shown | Meaning |
| --- | --- | --- |
| Received | 10% | Arrived, not yet decided |
| Bid/No-bid | 15% | A decision is being proposed or approved |
| Estimating | 25% | Pricing the bill of quantities |
| Submitted | 40% | A bid version has gone in |
| Clarifications | 50% | The issuer is asking questions |
| Awarded | closed | Won. Outcome Won |
| Lost | closed | Outcome Lost |
| No-bid | closed | Decided not to bid. Outcome Dropped |

The bid decision shows as Go or No-go, with the proposal states Waiting, Approved, Rejected and Withdrawn.

The bid guarantee has four states: **Requested** (asked from the bank), **Issued** (the bank has issued it), **Submitted** (handed in with the bid) and **Released** (handed back). Within 30 days of its valid-until date, an unreleased guarantee turns amber, and red once expired.

### Links to other records

- **Account** and **Issuer account** (the Overview offers **Open <account>**).
- **Inbox email** the tender came from, with its files.
- The **Bill of quantities** file and the **Estimates** and **RFQs** that price it.
- **Bid versions** and the **Standard Quotes** made from them.
- The **Contract project** made after the award.
- **Suppliers**: a client's approved supplier group limits every supplier list (Chapter 6, section 9).

### Good to know

- Reminders go by email to the owner and the team 7, 3 and 1 days before the bid end date and on the day. They stop when the bid is submitted or the tender is closed. Changing the bid end date restarts them. They appear under **Outbound emails**.
- The stage drop-down in the header can move a tender by hand. Two rules hold. Going to No-bid needs an approved No-go. Going from an early stage into Estimating or later needs an approved Go.
- A decision saved before approval existed is shown as "Recorded before approval was required". It does not unlock the next stage.
- The tender number is checked for duplicates when you save it.
- Tender deals have no Lines, Quotes, Related or Activity tab. Lines are the Bill of quantities, quotes are made on the Bid tab, and Activity is **History**.

Screenshot: sales-tenders-tab.png | /pipeline?tab=tenders | The Bids ending soon list above the tender board.
Screenshot: sales-tender-new.png | /pipeline/new/tender | The New tender form.
Screenshot: sales-tender-overview.png | /pipeline/<id> (a tender) | The header with stage, bid decision, bid end date and bid guarantee, and the Overview blocks.
Screenshot: sales-tender-decision.png | /pipeline/<id> (select Propose bid decision) | The bid decision panel with Go, No-go and the reason box.

---

## 3. Bill of quantities

### What it is

The bill of quantities (BOQ) is the client's price list for the tender: one row per item. BPMSquare reads the client's Excel, keeps their item numbers and shows every row with its source, cost, markup, rate and amount in one table.

### Where to find it

**Sales > Pipeline**, open a tender, tab **Bill of quantities** (`/pipeline/<id>?tab=boq`).

### Who uses it and which module switches it on

Estimators and bid managers. Module: **Pipeline** plus **GCC tender deals**. Business role entry: **Pipeline**. Cost and markup are internal. They never appear in anything sent to the client.

### How to use it

**Upload the client's file**

1. Select **Upload BOQ (.xlsx)**. The file may be up to 15 MB.
2. The card **How the file was read** shows the sheet, the header row and a column for each field. Change any of them. The choice is remembered for the next upload.
3. If the file has no rate or amount column, the system adds them after the last column and says so.
4. Select **Create the deal lines**. Nothing is created until you do. **Cancel** throws the file away.

**Update after a revised file**

1. Select **Upload revised BOQ**.
2. The card shows what changed compared with the BOQ on the deal. Lines are matched by item number.
3. Select **Update the deal lines**. A priced line that is no longer in the file is kept and flagged. An unpriced one is removed.

**Read the table**

1. The tiles show **Lines** (with the file name and version), **Priced** (in percent) and **Total** (at cost plus markup).
2. The columns are Item, Description, Qty, Unit, Source, Cost, Mk (markup), Rate, Amount and Linked.
3. The filter buttons **All**, **Unpriced** and **Stale** show their counts. **Show N more** pages the table.
4. A line with a price older than your limit is marked stale in amber.

**Match rows to products**

1. If rows have no product, a chip reads "N lines without a product". Open it.
2. Each row lists up to three suggestions. Accept one, search for another product or leave the row as free text.
3. **Accept N strong matches** links only the clear ones in one go.

**Price the rows**

1. Check the **Markup on cost %** box. It starts from the workspace default.
2. Select **Price all lines**. Rows that have no rate get one from the first fresh source: a supplier price, then a bill of materials, then a past project.
3. Rows it cannot price are listed under **Left unpriced** with the reason.
4. To price one row, select it. The panel lets you change **Description**, **Quantity** and **Rate**, and shows where the cost came from. **Open in Costing** jumps to the Costing tab.
5. The panel lists the price sources found for the row. A stale one can be used only if you choose it knowingly.
6. **Price from estimate** and **Build up this rate** start from an estimate when the Project Estimator is on (section 4).

**Group the lines into a WBS**

A WBS (work breakdown structure) groups BOQ lines into the parts of work you will run, in your own order instead of the client's. It is built here, on the tender, and the contract project takes a copy when the tender is won.

1. Above the table choose **WBS** next to **BOQ**. **BOQ** shows the client's order. **WBS** shows the same lines grouped the way you will run the work. The choice survives a reload and a shared link.
2. Select **New WBS item**. The **Name** is the only required field. **Code** numbers itself (1, 1.1, 1.1.1); type your own, for example your ERP's code, and it is kept. **Parent** is optional, and an item can sit up to three levels deep. **Owner** is optional while bidding. If the parent already holds lines, they move into the new item and the panel says so.
3. Back on the **BOQ** view, tick the lines. A bar shows how many are ticked. Select **Group into WBS**, then choose an existing bottom-level item, or **New WBS item...** to make one and group the lines in one step.
4. To share one line across items, tick it and select **Split...** (every row also has a **Split** button). Choose a WBS item for each part and type its share. The panel shows the quantity and amount each share gives, and **Share as** switches between percent and quantity. **Save split** stays grey until the shares add up to 100 % and every part has an item. **Unsplit** puts the whole line back in its first item.
5. A split line shows a chip such as **Split 2** in the WBS column. It opens the parts under the row, each with its item, percent, quantity and amount.
6. On the **WBS** view the tree lists **Item**, **Owner**, **Lines**, **Client amount** and **Cost**. A parent adds up its own lines and its sub-items, so nothing is counted twice. One bar for each top-level item shows its share of the client amount. The arrow in front of an item opens the lines it holds, and folds are remembered in your browser. Cost is shown only to people who may see internal cost.
7. The three-dot menu on an item has **Rename**, **Code**, **Add sub-item**, **Move to...**, **Set owner** and **Remove**. **Remove** asks first: its lines go to Unassigned and its sub-items move up one level.
8. **Renumber** numbers the codes again in order. It asks first, and codes you typed are kept.
9. **Unassigned** lists the lines that sit in no item, in amber, five at a time with **Show all**. Tick lines there and use the same **Group into WBS** bar. A split line whose item was removed shows what is left unassigned, and **Edit split** fixes it.
10. When you upload a revised file the grouping is kept: lines are matched by item number. New lines land in **Unassigned**. A priced line that is no longer in the file stays in its item and is flagged **no longer in the file**.

### Statuses

A row has no status of its own. It has a price source:

| Source | Meaning |
| --- | --- |
| Client's rate | The rate that came in the client's file |
| BOM / estimate | A bill of materials roll-up or a line of an estimate |
| Past project | The rate on an awarded tender of yours with the same cost code, product or wording |
| Supplier | An awarded RFQ price, or the product's own cost price |
| Tender estimate | A cost set from an estimate made for this tender |
| Manual | A rate you typed. The source it replaced is kept |

Row chips also show Estimate, RFQ, Unpriced and Stale.

### Links to other records

- **Products**: the "Linked" column (Chapter 6, section 10).
- **Estimates** and **RFQs**: shown as chips on the row.
- The deal's own **lines**: a tender's lines are its BOQ rows. A tender with no uploaded file shows its lines for editing by hand.
- The **WBS** you build here is copied to the contract project when the tender is won (section 14).

### Good to know

- A line normally sits in one WBS item. Splitting it across items is an option, not the normal path. A supplier still prices the whole BOQ line, whatever its split.
- A WBS item has no price of its own and no markup per item. Its figures are roll-ups of its lines.
- An item with sub-items holds no lines itself. Lines and splits go on the bottom-level items.

- A supplier or past-project price older than **Price validity** (180 days unless changed) is stale. It is never applied by itself. Set it in **Settings > Sales > Tenders** (Chapter 1, section 5.3).
- "Price all lines" starts from the **Default markup** in the same page. A markup you type here is kept in your browser for this tender only.
- A supplier is awarded only on the Costing tab. The row panel shows the result but cannot change it.
- Rows keep the client's item numbers and cost codes exactly as written.
- The downloads of the priced Excel and the answer sheet are on the Bid tab (section 5).
- A comment in the product calls this screen a "Prices tab". There is no such tab. Prices are on the Bill of quantities and Costing tabs.

Screenshot: sales-boq-upload.png | /pipeline/<id>?tab=boq (after choosing a file) | The How the file was read card with the column choices.
Screenshot: sales-boq-table.png | /pipeline/<id>?tab=boq | The tiles for lines, share priced and total, with the upload and price-all actions.
Screenshot: sales-boq-match.png | /pipeline/<id>?tab=boq (open the product chip) | The match panel with a strong suggestion.
Screenshot: sales-boq-row.png | /pipeline/<id>?tab=boq (select a row) | The row panel with Where the cost came from.

---

## 4. Costing a tender

### What it is

Costing is the place where BOQ rows get their cost. It lists every estimate and every RFQ made for the tender, shows which rows each one prices, and holds the compare-and-award screen where a supplier's price becomes a row's cost.

### Where to find it

**Sales > Pipeline**, open a tender, tab **Costing** (`/pipeline/<id>?tab=costing`).

### Who uses it and which module switches it on

Estimators and buyers. Module: **Pipeline** plus **GCC tender deals**, and at least one of **Project Estimator** or **RFQ (supplier quotations)**. The tab is hidden if neither is on or your role cannot view Estimates or RFQs. Business role entries: **Pipeline**, **Estimates**, **RFQs**.

### How to use it

**Read the tab**

1. The tiles show **Rows priced**, **Still need a cost**, **RFQs out** and **Replies in**.
2. If rows still need a cost, **Show them in the Bill of quantities** opens the table filtered to them. Old prices have a **Show them** link too.
3. **Estimates and RFQs** is one list. A row shows its type (Estimate or RFQ), a state, the BOQ rows it prices, its total and its age. **Show all N** pages the list.

**Build up a price with an estimate**

1. Select **New estimate**, choose a **Template** and select **Start estimate**. The estimate opens linked to this tender (section 8).
2. Back on the Costing tab, select **Price the BOQ rows** on the estimate. In the panel choose **Match by**: "Cost code and wording" or "Spread one part over the rows". Choose **Share by** BOQ amount or BOQ quantity. Set the **Markup %**.
3. Tick the rows. The panel shows Allocated and Unallocated cost. Nothing is saved until you confirm.
4. From a single BOQ row, **Build up this rate** starts an estimate with that row's quantity filled in.
5. If the estimate changes later, the row shows "Changed, re-price". Select **Re-price**.

**Ask suppliers for prices**

1. Select **New RFQ**. The items come from the rows without a rate.
2. Choose the suppliers, a reply date and a note. If the client has an approved supplier group, only its members are offered.
3. Send. Each supplier gets an email with a link to answer without logging in.
4. When replies arrive, select **Compare and award** on the RFQ row.

**Compare and award**

1. The screen shows one column per supplier and one row per line. The lowest valid price is marked **Lowest valid**. An expired or old answer is marked **Expired or stale**.
2. Select **Award and price** on a supplier's price, or award several lines to one supplier.
3. In the panel set the **Markup %** (it starts from the workspace default) and, for a foreign currency, the **Exchange rate**. If the price is not the lowest valid one, **Why this supplier?** is required.
4. Select **Award and price**. The supplier's price becomes the row's cost, the markup is added, and the source is set to the RFQ. A cost of 38.00 at 15% gives a rate of 43.70.
5. If lines were awarded but their rows carry no price yet, **Price awarded rows** writes cost, markup and source.

### Statuses

Estimate rows show one of: Changed, re-price; N costs missing; Quoted; Won; Applied; Not used yet.

RFQ rows show one of: Draft; Sent; N of M replied; N of M awarded; Awarded; Closed; Cancelled; No suppliers.

### Links to other records

- **Estimates** (section 8) and **RFQs** (section 9). Each row opens its record.
- **BOQ rows** that the item prices.
- **Suppliers** and the client's **approved supplier group** (Chapter 6, section 9).

### Good to know

- A tender RFQ is awarded here only. The RFQ's own page says so and links back.
- Once a bid has been submitted, awarding or re-pricing asks "The bid is already in". The new rate goes on the row. The submitted version stays as it was.
- Cost and markup are internal. They are never in the priced Excel, the answer sheet, a bid version or a quote.
- A supplier without an email address cannot be sent a request. The message names the supplier.
- The RFQ mail channel, reply days and reminders are set in **Settings > Sales > RFQ** (Chapter 1, section 5.6).

Screenshot: sales-costing-tab.png | /pipeline/<id>?tab=costing | The four tiles (rows priced, still need a cost, RFQs out, replies in) and the Estimates and RFQs list.
Screenshot: sales-costing-price-rows.png | /pipeline/<id>?tab=costing (select Price the BOQ rows) | The allocation panel with ticked rows.
Screenshot: sales-costing-compare.png | /pipeline/<id>?tab=costing (select Compare and award) | Two suppliers side by side with Lowest valid marked.
Screenshot: sales-costing-award.png | /pipeline/<id>?tab=costing (select Award and price) | The award panel with markup and reason.

---

## 5. Bid, versions and outcome

### What it is

The Bid tab saves each bid you send as a numbered version that never changes, compares versions, produces the documents you send to the client and ends with the outcome: awarded, lost or no bid.

### Where to find it

**Sales > Pipeline**, open a tender, tab **Bid** (`/pipeline/<id>?tab=bid`). The tab shows the number of versions.

### Who uses it and which module switches it on

Bid managers. Module: **Pipeline** plus **GCC tender deals**. Business role entry: **Pipeline**. Making a Standard Quote also needs **Standard Quotes**.

### How to use it

**Submit the bid**

1. Price the lines first (sections 3 and 4).
2. Open the **Bid** tab. **Before you submit** lists what is open: lines without a price, old prices, no approved Go, a guarantee not yet marked Submitted. These are warnings. You can always go on.
3. Select **Submit bid**. For version 1 nothing else is asked. From version 2, **Why is the bid revised?** is required. **Note** is optional.
4. Select **Submit version N**. The lines and the total are saved. The tender moves to Submitted.

**Revise the bid**

1. After talking to the client, select **Revise bid**. The tender goes back to Estimating.
2. Change the lines, then submit the next version with its reason.

**Compare versions**

1. Under **Compare versions** choose **From** and **To**, then select **Compare**.
2. The result shows the total, the change in amount and percent, and the lines added, removed and changed.

**Send documents to the client**

Under **Documents we send**:

1. **Download priced BOQ** writes your rate and amount into the client's own Excel and keeps their layout. If some lines have no rate, you are asked to confirm.
2. **Export answer sheet** gives a plain Excel list of the lines with your rates, for copying into a portal form. Nothing is sent anywhere.
3. **Make a Standard Quote from this version** takes the version you pick (the latest by default). The quote keeps the client's item numbers and links back to the tender.

**Record the outcome**

1. After Submitted, the main button reads **Record the outcome**.
2. Choose **Won**, **Lost** or **Dropped**. For Lost, choose the reason and who won. For Won, you can select **Create contract project now**.
3. On the Overview the **Outcome** block holds the **Awarded value** (or **Winning price**), **Won by**, **Why we lost**, **Award date** and a **Note**. Select **Save outcome**. It compares our last total with the awarded price.

### Statuses

A bid version has a number and a reason. It has no status. The tender stage moves Estimating, Submitted, then Awarded, Lost or No-bid (section 2).

### Links to other records

- **Standard Quotes** made from a version (listed under Documents we send, newest first).
- **Contract project**, created from the winning version.
- **Competitors** (section 6): the winner is picked from this list.

### Good to know

- A saved version is never edited or deleted. Cost and markup are not in a version. A private cost record is kept with it, so the contract project can start from the bid that won.
- A bid can be submitted only from Estimating or Clarifications. Revise is offered from Submitted or Clarifications.
- Client item numbers show as an **Item** column on the Standard Quote lines and on its PDF.
- A lost tender needs the reason. The winner you pick is also saved as the deal's competitor.
- Accepting a Standard Quote that was made from a bid may also close the tender as Won, using the standard stage list instead of the tender stages (verify).
- A bid with no BOQ file can still be submitted from hand-made lines (verify).

Screenshot: sales-bid-tab.png | /pipeline/<id>?tab=bid | The tiles, the Before you submit warning and the Submit bid button.
Screenshot: sales-bid-compare.png | /pipeline/<id>?tab=bid (after Compare) | The comparison of two versions.
Screenshot: sales-bid-documents.png | /pipeline/<id>?tab=bid | The Documents we send block.
Screenshot: sales-tender-outcome.png | /pipeline/<id> (a closed tender) | The Outcome block with our total against the awarded value.

---

## 6. Room, calls and competitors

### What it is

Three small tools that sit around the bid. The **Room** is the team's private place to discuss the bid. **Calls and visits** records contact with the client. **Competitors** lists who else is bidding.

### Where to find it

**Sales > Pipeline**, open a tender: tab **Room** (`/pipeline/<id>?tab=room`, and `/pipeline/<id>/room` as a page of its own), tab **Competitors**, and **More > History** for calls.

### Who uses it and which module switches it on

The bid team. Module: **Pipeline** plus **GCC tender deals**. The Room also needs **Deal Room**. Business role entry: **Pipeline**.

### How to use it

**Use the Room**

1. Write a message and select **Send**. Type `@` or use the **Mention** list to mention a colleague.
2. Select **Attach** to add files: PDF, Office, DXF, CSV, text or pictures, up to 5 per message and 15 MB each.
3. To ask a question, tick **Question** before sending, then choose an **Owner** and a **Due** date. It stays an open question until someone selects **Mark answered**. You can **Reopen** it.
4. **Reply** answers a message. **Remove** deletes your own message (an admin can remove any).
5. Use **All** and **Open questions (N)** to filter.
6. Under **Decisions**, type a line and select **Pin**. Pinned decisions show in the order they were agreed.
7. **Members** lists who follows. The owner and team are added by themselves. Use **Add** to add a colleague.
8. On a phone the tab shows the question count and **Open the room**.

**Log a call**

1. In the Room header select **Log a call**.
2. Choose the **Kind**: Call, Meeting, Site visit or Note. Set **When** and **With whom**.
3. Write **What was discussed** (required) and the **Outcome**.
4. Add a **Next step** and a **Due** date if there is one. Select **Save**.
5. Open **More > History** to read the calls and visits, newest first. Tick a next step as done. It counts as overdue in **Open work** until you do.

**Track competitors**

1. Open the **Competitors** tab and select **+ Add competitor**.
2. Fill in **Company** (required), **Website**, **Country**, **Expected price** (Below us, Similar or Above us), **Strengths** and **Note**. Select **Save**.
3. On a competitor card use **Edit**, **Mark as winner** or **Remove**. **Company insights** researches the company on the public web. **Analyse all** does it for every competitor.
4. The tiles show **Competitors**, **Expect to be cheaper** and **Winner**.

### Statuses

A Room question is Open, Open and overdue, or Answered. A competitor has an expected price position and may carry "Won this tender".

### Links to other records

- The tender it belongs to.
- **Outbound emails**: the Room sends a summary email to followers, at most every 15 minutes.
- The tender's **History**, which also lists the changes to the tender and its competitors.

### Good to know

- Company insights uses part of your AI allowance. A saved card shows again at no cost. On a demo workspace the answer may be thin (verify).
- The winner can be picked from the competitor list when the tender is decided. It is saved as who won.
- Expected price is your own judgement, not a recorded figure.

Screenshot: sales-room.png | /pipeline/<id>?tab=room | The team room: open questions, the discussion, decisions and files.
Screenshot: sales-log-call.png | /pipeline/<id>?tab=room (select Log a call) | The Log a call panel.
Screenshot: sales-competitors.png | /pipeline/<id>?tab=competitors | The three tiles and the Competitors list, ready for the first competitor.

---

## 7. Tender blocks on the Dashboard

### What it is

Thirteen blocks for the home screen that show the tender business at a glance: pipeline value, bids closing, win rate, what needs attention and buy-out against budget.

### Where to find it

**Dashboard** (`/`). The blocks are part of the normal dashboard. To place them use **Adapt dashboard** (see Chapter 6, section 1).

### Who uses it and which module switches it on

Directors and bid managers. Module: **GCC tender deals** plus **Pipeline**. The two buy-out blocks also need **Contract projects**. The attention item "Supplier reply overdue" also needs **RFQ**.

### How to use it

1. Open the **Dashboard**. In a tender workspace the tender blocks lead the default layout.
2. Use **Adapt dashboard** to add, move, resize or hide blocks. The **Tenders** bundle in Quick add brings them all.
3. The **look** switch in the toolbar has two settings: **Bold** (the light dashboard) and **Control room** (the whole page dark). Your choice is remembered for you.
4. Select a tile, a stage bar, a column, a slice or a row. It opens the Tenders tab already filtered, or the record itself.

The blocks are:

- Small tiles: **open pipeline**, **weighted by chance**, **closing in 14 days**, **win rate**, **buy-out committed**.
- Half-width blocks: **pipeline by stage**, **bids closing soonest**, **won and lost by month**, **open value by client**, **needs you today**, **open pipeline trend**.
- Full-width blocks: **bid deadlines** (a timeline of bid end dates) and **buy-out against budget**.

**Needs you today** lists up to five items, most urgent first: a bid decision waiting, a supplier reply overdue, a bid guarantee close to expiry, old prices on a bid, and tenders closing soon with unpriced lines.

### Statuses

Colours follow the days left: red is three days or fewer, amber is ten days or fewer, green is later.

### Links to other records

- The **Tenders tab** (filters: stage, closing, client, outcome, month).
- Single **tenders**, and a project's **Buy-out** tab.

### Good to know

- The default look for the workspace is set in **Settings > Appearance > Dashboard** (Chapter 1, section 11.1). A person's own choice wins.
- The open pipeline trend is rebuilt from created and closed dates. Later edits to an amount are not replayed.
- A block shows only when the modules it reads are on. Business roles hide or show blocks like any other dashboard block.

Screenshot: sales-dashboard-bold.png | / (Bold look) | The tender tiles and the pipeline by stage block.
Screenshot: sales-dashboard-control.png | / (Control room look) | The same blocks in the dark look, with Needs you today.

---

## 8. Estimates

### What it is

An estimate works out a price from a template. You pick the kind of work, enter the inputs (sizes, materials, quantities) and the price updates as you type. The estimate also gives a bill of materials, a cost build-up and a work breakdown. For some templates (precast, fences, floors, cabins) it draws a 3D model from the same pieces the price is added up from.

### Where to find it

**Sales > Estimates** (`/estimates`). New: **+ New Estimate** (`/estimates/new`). An estimate opens at `/estimates/<id>`. The templates themselves are in **Settings > Sales > Estimate templates** (Chapter 1, section 5.7).

### Who uses it and which module switches it on

Estimators and sales engineers. Module: **Project Estimator**. Business role entry: **Estimates**. Turning an estimate into a quote also needs **Standard Quotes**.

### How to use it

**Start an estimate**

1. Select **+ New Estimate**. The page asks "What are you estimating?" and shows the templates as cards.
2. Choose a template. You can paste the customer's email on the next page; the page reads it for you.
3. If you have no template yet, the page offers a starter (for example a chain-link fence) to begin from.
4. Enter the **inputs**. The price panel follows them.
5. Choose the **Account** and **Contact**, and a **Margin**. Select **Save as draft**.

**Turn it into a quote**

1. Select **Create quote**. A Standard Quote is made from the estimate (section 11).
2. The button then reads **Open quote <ref>**. If your role cannot create quotes, or Standard Quotes is off, the page says why.

**Work the record**

The estimate page is one long page with folds you open and close.

1. **Price built up** shows how the price is added up. For a template with a build schedule, a **schedule** fold shows the risk.
2. **Bill of materials** is for your team and the factory. A warning shows if you have unsaved changes.
3. **Send to your ERP** has the downloads. Choose the **ERP layout** and **Lines to include**, then take the **Bill of materials** or the **Work breakdown** as Excel or CSV.
4. **Details** holds the status, notes and custom fields.
5. The **More** menu has **Duplicate**, **Download bill of materials**, **Download work breakdown** and **Delete**. A deleted estimate can be undone for a few seconds. The quote made from it is kept.

**Use an estimate inside a tender**

1. From the Costing tab, **New estimate** starts one kept on the tender (section 4).
2. A strip at the top of such an estimate says which tender it is for. It shows the BOQ lines linked, the lines priced, the ones that need a re-price and the costs missing.
3. **Price the line from this estimate** and **Re-price** write the estimate's cost onto the BOQ row. **Raise RFQ for missing costs** asks suppliers about lines with no cost.

### Statuses

| Status | Meaning |
| --- | --- |
| Draft | Being worked on |
| Quoted | A quote was made from it |
| Won | Marked won on the Details fold |
| Lost | Marked lost on the Details fold |

The list has a chip for each status with a count.

### Links to other records

- **Account** and **Contact**.
- The **Standard Quote** made from it.
- The **tender** it prices, and the **BOQ rows** it is linked to.
- The **Inbox email** it was started from, when it came from one.
- **Products**: lines of the bill of materials that name a product.

### Good to know

- The cost the bill of quantities takes from a tender estimate includes the overhead line and leaves out margin and VAT.
- Editing a template never re-prices an estimate already made. The estimate says when its template is out of date.
- "Send to your ERP" is a download at this snapshot. The page says sending straight into an ERP comes later.
- A saved estimate that has been quoted is locked in part (verify which fields).
- Estimates can be imported, exported and updated in Data Workbench (header records). The v1 API has a read-only estimates endpoint without cost fields.

Screenshot: sales-estimates-list.png | /estimates | The status chips and the estimate list.
Screenshot: sales-estimate-new.png | /estimates/new | The template cards.
Screenshot: sales-estimate-detail.png | /estimates/<id> | The inputs, the price panel and the Create quote button.

---

## 9. RFQs and supplier quotes

### What it is

An RFQ (request for quotation) asks suppliers for a price on items you cannot price yet. Each supplier gets their own email, link and reply sheet. You compare the answers and award a line, or a whole request, to one supplier. The awarded price becomes a cost you can use in a quote or a tender.

### Where to find it

**Sales > RFQs** (`/rfqs`). New: **+ New RFQ** (`/rfqs/new`). An RFQ opens at `/rfqs/<id>`. Suppliers answer on a page that needs no login.

### Who uses it and which module switches it on

Buyers, estimators and sales staff. Module: **RFQ (supplier quotations)**. Business role entry: **RFQs**. Suppliers are in Chapter 6, section 9.

### How to use it

**Raise an RFQ**

1. From **RFQs** select **+ New RFQ**. Or use **Request quotation** from a place where a price is missing: the lines of a deal, a Standard Quote or a Quotation (there is also one for a single line), a case, a work order, or the Costing tab of a tender.
2. Enter a **Title** (it is taken from the first line if left blank). Add lines: a product or free text, a specification, a quantity and a unit.
3. Choose the **Suppliers**. The form suggests past winners.
4. Set **Reply by**, **Needed by**, **Delivery terms**, **Note to suppliers** and an **Internal note**. The internal note is never sent.
5. Select **Save as draft**, or **Send to N suppliers**.

**Collect the answers**

1. Each supplier gets an email with a personal reply link. An RFQ PDF and an Excel reply sheet can be attached, depending on the setting.
2. The supplier opens the link and gives a price and a lead time per line. They can offer an alternative, decline or ask a question. They can answer again until the deadline.
3. On the **Suppliers** tab, each supplier shows a state. Use **Enter reply** to key in a reply, **Upload reply sheet**, **Copy reply link**, **New link**, **Change email** or **Remove**. **Read prices** uses AI to read a reply sheet. Nothing is saved until you confirm.
4. The **Conversation** tab holds every message. Choose **Email supplier** or **Internal note**.
5. **More > Remind N** chases suppliers who have not replied.

**Compare and award**

1. Open **Compare & award**. The lowest valid price is marked.
2. Select **Award** on a price, or **Award all** under a supplier. Foreign currency asks for the exchange rate. A price that is not the lowest asks for a reason.
3. The award stores a confirmed cost for a catalog product, so the next Price uses it.
4. If the RFQ belongs to a tender, the page says to award it on the tender's Costing tab instead.

**Turn awards into purchase orders**

1. With **Inventory & Purchasing** on, a **Purchase orders** block appears under the comparison once lines are awarded.
2. Select **Create purchase orders**. One draft PO is made per awarded supplier at the awarded cost.
3. Check and mark them in **Purchase Orders** (section 13).

### Statuses

| Status | Meaning |
| --- | --- |
| Draft | Not sent |
| Sent | Sent, no reply yet |
| Partly replied | Some suppliers have replied |
| All replied | Every supplier has replied |
| Awarded | Lines are awarded |
| Closed | Finished |
| Cancelled | Stopped |

A supplier on an RFQ is Not sent, Sent, Opened, Replied, Declined, Expired or Removed. A line is open, awarded, no award or cancelled.

The list chips are **Open**, **Waiting on suppliers**, **Ready to award**, **Awarded**, **From a quote** and **All**.

### Links to other records

- The **record it was raised from** (the "From" line and the Quote column): a Standard Quote, Quotation, Deal, Case, Work order, Estimate or Tender.
- **Suppliers** and **Products**.
- **Purchase Orders** made from the awards.
- A tender's **BOQ rows**.

### Good to know

- The header **More** menu has **Edit**, **Print / PDF**, **Remind N**, **Close**, **Reopen**, **Cancel RFQ** and **Delete** (a draft only).
- The RFQ PDF and the supplier page carry no customer name and never show another supplier's price.
- The mail channel (your own mailbox, or BPMSquare), days to reply, reminders, link life and terms are set in **Settings > Sales > RFQ** (Chapter 1, section 5.6). With the BPMSquare channel, supplier replies by email are filed by their reply address.
- A supplier with no email address cannot be sent a request.
- The reference is `RFQ-<number>`.
- RFQs can be exported and updated in Data Workbench but not imported. The v1 API and the MCP server have read-only RFQ endpoints.
- Several approved suppliers per product, and supplier performance reports, are not built.

Screenshot: sales-rfq-list.png | /rfqs | The chips, the Replies column and the status pills.
Screenshot: sales-rfq-new.png | /rfqs/new | The form with lines, suppliers and reply date.
Screenshot: sales-rfq-compare.png | /rfqs/<id> | Compare & award with two suppliers and the Purchase orders block.
Screenshot: sales-rfq-suppliers.png | /rfqs/<id>?tab=suppliers | The Suppliers tab with states and the reply actions.

---

## 10. Quotations

### What it is

A quotation is a priced offer to a customer, with a scope of work, line items, terms and a PO value check. It is the original quote object of the product and it carries versions, an outcome (won or lost), and links to assets and cases.

### Where to find it

**Sales > Quotations** (`/quotations`). New: **+ Create quote** (`/quotations/new`). A quotation opens at `/quotations/<id>`. Edit: `/quotations/<id>/edit`.

### Who uses it and which module switches it on

Sales staff and service coordinators. Module: **Quotations**. Business role entry: **Quotations**. A quotation can also start from a service case (Chapter 3, section 7).

### How to use it

**Create a quotation**

1. Select **+ Create quote**. Choose the offer type: **Quotation**, **Technical Offer** (scope and quantities, no prices), **Budgetary Offer** or **Supply Quotation** (with HSN codes and tax per line). **AMC Contract** and **Installation** show as "Coming soon". Your administrator can hide types in **Settings > Sales > Quotations** (Chapter 1, section 5.1).
2. Under **Account & Contact** choose the customer.
3. Under **Quote details** set the **Quote name**, **Valid until**, **Inquiry date**, **Ref no.**, **Customer PR no.**, **Customer PO no.** and the **Issuing entity**. The **Quote ID** is made for you.
4. Write the **Scope of work**. Link the customer's **assets** if the work is on equipment.
5. Add the lines under **Particulars**. **Price with engine** suggests a rate from the pricing engine and you can still edit it. **Price all lines** does it for every line that names a product.
6. Add **Terms & Conditions**. The Summary shows subtotal, discount, tax and deductions (salvage credited back). The **Customer PO** block compares the PO value with the quote.
7. Select **Save as draft**.

**Send and track it**

1. Open the quotation. The header has a **status** drop-down and an **outcome** drop-down (Open, Won, Lost, Dropped).
2. **More > Email quote** opens a compose window. **More > WhatsApp** opens WhatsApp with a link to the PDF. **More > Download PDF** and **Download CSV** take it away.
3. Set the status to the stage it is at (default: Draft, Sent, Approved, Rejected).
4. When the customer agrees, set the outcome to **Won**. The page may offer to move the status to the approved one too.
5. For **Lost** or **Dropped** the page asks why, with a reason list and an optional note.

**Change a quotation**

1. **Edit quote** opens the form. It is offered until the quotation reaches a closed status.
2. **Create new version** makes an editable copy. This version becomes read-only and points to the newer one. The **Versions** tab lists every version.
3. **More > Copy quote** makes a new draft from it. **More > Create standard quote** makes a Standard Quote from it (needs Standard Quotes).
4. **More > Adapt layout** lets an administrator reorder sections and add custom fields on the page.

**After a win**

1. With the outcome Won and Invoices on, select **Convert to Invoice**. The button then reads **View invoice**.
2. With Sales Orders on, a strip shows **Create sales order**, or the order already made.

**Find quotations**

1. The list opens with tiles: Total quotes, Overall value, Won value, In pipeline and Overdue. Others can be added: Lost value, Awaiting approval, From cases, Standalone.
2. Filter by status, search the account, use **Advanced filters**, or search by column.
3. Tick rows to see **Copy quote** (one row) and **Delete**.

### Statuses

Quotation status is a workspace list. The default is below. Outcome is separate and fixed.

| Status | Meaning |
| --- | --- |
| Draft | Being written. The starting status |
| Sent | Sent to the customer |
| Approved | Closed |
| Rejected | Closed |

| Outcome | Meaning |
| --- | --- |
| Open | No result yet |
| Won | The customer accepted |
| Lost | The customer chose otherwise |
| Dropped | Went cold, no decision |

### Links to other records

- **Account**, **Contact** and **Assets** (Chapter 6).
- **Service case** and **Work orders**, when it came from a case.
- **Invoice** and **Sales order**.
- **Standard Quote** made from it, and **RFQs** raised from its lines.
- Earlier **versions**.

### Good to know

- The reference follows the workspace's quote ID format (default `QT-<year>-<number>`). It is set in **Settings > Company > Numbering** (Chapter 1).
- A closed status locks the quotation and asks for an outcome.
- The tile named **Awaiting approval** counts quotations in a status that is neither the starting status nor a closed one. There is no separate approval step (verify).
- A line below the margin floor can block sending until it is re-priced (Chapter 6, section 14).
- **Convert to Invoice** works on a Won quotation, once, and only on its latest version.
- "WhatsApp (embedded)" shows as "Coming soon".
- Quotations can be imported, exported and updated in Data Workbench. The v1 API and the MCP server list quotations.
- Custom fields can be added in **Settings > Data > Custom fields**.

Screenshot: sales-quotations-list.png | /quotations | The tiles, the status filter and the list.
Screenshot: sales-quotation-type.png | /quotations/new | The offer type picker.
Screenshot: sales-quotation-detail.png | /quotations/<id> | The status and outcome drop-downs, the More menu and the scope of work.

---

## 11. Standard Quotes and templates

### What it is

A Standard Quote is a plain quote for an account: line items, a discount, tax and shipping. It is the quote that deals, tenders and estimates produce. It has its own PDF layouts, called templates. Alternatives and quantity breaks can sit on its lines.

### Where to find it

**Sales > Standard Quotes** (`/standard-quotes`). New: **+ New Standard Quote** (`/standard-quotes/new`). A quote opens at `/standard-quotes/<id>`. Templates: **More > Manage Templates** on the list (`/standard-quotes/templates`, administrators only).

### Who uses it and which module switches it on

Sales staff. Module: **Standard Quotes**. Business role entry: **Standard Quotes**. Pricing help on lines also needs **Pricing Engine** and its quote option.

### How to use it

**Create a quote**

1. Select **+ New Standard Quote**. The form has three steps: **Details**, **Lines** and **Files**.
2. On **Details** choose the **Account** (required) and **Contact**. Set the **Inquiry date**, **Valid until** and the **Template** (the default template is used if you leave it).
3. Write **Notes** and **Terms**. The **Intro text** overrides the template's intro block. **Generate with AI** writes a cover note.
4. Select **Next: line items**. On **Lines**, add lines from **Catalog**, **Previous quotes** or **Free text**. **Draft with AI** writes lines from a description.
5. On a product line you can add **quantity breaks** and **alternatives**. Only the chosen quantity and the chosen option count in the total.
6. Set **Discount %**, **Tax %** and **Shipping / Handling**. The total shows at the top.
7. Select **Create quote**. The reference is `SQ-<year>-<number>`.

**Price the lines**

1. With the pricing engine on, **Price with engine** on a line and **Price all** on the editor suggest rates. The price trace shows how.
2. A line below the margin floor is flagged. If the policy is "block", the quote cannot be sent until it is re-priced or approved.
3. **Request quotation** on a line (or at the top for all lines without a cost) asks suppliers for a price (section 9).

**Add files and lines from a file**

1. Open the **Files** step, or **Related > Attachments** on a saved quote. Upload the customer's file (up to 15 MB).
2. For an .xlsx or .csv file, select **Create line items**. A preview shows the rows. Choose **Add N lines**, **Append all**, **Append, skip duplicates** or **Replace the existing**.

**Send and close it**

1. On a draft the main button is **Email to customer**. It sends the PDF at once to the contact's email, or the account's email if the contact has none.
2. The email does not change the status. To move the quote on, choose **More > Mark as sent**.
3. On a Sent quote the main button is **Mark accepted**. **More > Mark rejected** closes it the other way. **Resend email** sends again.
4. On an Accepted quote, **Create invoice** appears with Invoices on, and **Create sales order** with Sales Orders on.
5. **More > Print / PDF** gives the PDF. **Edit** and **Delete** are for drafts only.

**Link it to a deal**

1. In the right-hand column, **Create deal from this quote** starts a deal, or **Link to a deal** picks an open one (Pipeline must be on).
2. **Unlink** takes it off again.

**Design the PDF (administrators)**

1. Open **Manage Templates**. Type a name and select **+ Create & open builder**.
2. In the builder, **Design with AI** sets colours and blocks from a style description. Check the result before saving.
3. Under **Template settings** set the **Name**, the **Accent color**, the **Logo position** and **Default template for new quotes**.
4. Under **Layout blocks** switch blocks on or off and set their order and text: letterhead, quote number and date, quote for, intro text, line items table, total, notes, terms, signature block, footer text, specifications table and call-to-action banner. Required blocks stay on.
5. Select **Save**. The list shows which template is the default. **Set as default** and **Delete** are on the list. A quote whose template is deleted falls back to the default layout.

### Statuses

| Status | How it is set |
| --- | --- |
| Draft | New quote |
| Sent | **Mark as sent** |
| Accepted | **Mark accepted** |
| Rejected | **Mark rejected** |
| Expired | No button or timer in the app (verify). Import or the API only |

The list has a tile for each of Draft, Sent, Accepted and Rejected with a count and a value. Select a tile to filter.

### Links to other records

- **Account** and **Contact**.
- The **Deal** it belongs to.
- The **Invoice** made from it, and the **Sales order**.
- **RFQs** raised from its lines.
- A **tender bid version** or an **estimate**, when it came from one.
- The **Inbox email** it started from (right-hand column).

### Good to know

- Pricing choice. The internal or external pricing choice is not on the quote. It lives on the order type (section 12). On a quote, price comes from the lines, the pricing engine and your price lists.
- A quote made from a tender bid keeps the client's item numbers in an **Item** column on the Lines tab and on the PDF, in the client's order.
- An accepted quote can be billed once. The invoice link replaces the button.
- Only drafts can be edited or deleted. To change a sent quote, copy it into a new one (verify).
- Accepting the quote closes its deal as Won, if the deal is still open.
- If the Integration middleware is on, the accepted or rejected quote can also go to your ERP (see Chapter 1, section 10.2).
- Custom fields can be added in **Settings > Data > Custom fields**. Standard Quotes and their lines can be imported, exported and updated in Data Workbench. The v1 API and the MCP server list and read them.
- Quotation templates for text and email are in Settings (Chapter 1, section 5.1). The PDF templates here are separate.

Screenshot: sales-sq-list.png | /standard-quotes | The four status tiles and the list.
Screenshot: sales-sq-form-details.png | /standard-quotes/new | The Details step.
Screenshot: sales-sq-form-lines.png | /standard-quotes/new (Lines step) | The line editor with the Add a line panel open.
Screenshot: sales-sq-detail.png | /standard-quotes/<id> | The header actions, the Lines tab and the deal card.
Screenshot: sales-sq-template-builder.png | /standard-quotes/templates/<id> | The settings, the layout blocks and the preview.

---

## 12. Sales Orders and order types

### What it is

A sales order records what a customer bought. It is made from an accepted quote, or typed in directly. It follows a path across the top of the page: Draft, Confirmed, Delivered, Invoiced, Paid. The last three fill in when your ERP reports them. An order type decides the order numbers, how the lines are priced and how the PDF looks.

### Where to find it

**Sales > Sales Orders** (`/sales-orders`). New: **+ New Sales Order** (`/sales-orders/new`). An order opens at `/sales-orders/<id>`. Order types: **More > Order types** on the list, or **Settings > Sales > Order types** (Chapter 1, section 5.2).

### Who uses it and which module switches it on

Sales administrators and order desks. Module: **Sales Orders**. Business role entry: **Sales Orders**. The module needs a database update that your administrator applies by hand. Without it the page says so.

### How to use it

**Create an order**

1. From an accepted Standard Quote select **Create sales order**. From a won Quotation use the strip at the top of the quotation. The lines, prices, discount, tax, contact, customer PO and notes are copied. One tap.
2. Or select **+ New Sales Order**. Choose the **Customer** (required) and **Contact**. **Order type** starts as "Automatic": your rules pick the type, else the default type applies.
3. Enter the **Customer PO** and the **Requested date**. Under **More** set **Ship to**, **Ship-to address** and **Notes**.
4. Add the lines. Select **Create order**.
5. If an order already exists for the quote, the page tells you the number and asks you to confirm before making another.

**Work an order**

1. The tabs are **Overview**, **Lines**, **Availability**, **ERP**, **Documents and files** and **History**.
2. On **Overview** read the customer, bill-to and ship-to, the total with tax, the expected delivery and the customer PO.
3. On **Lines** edit quantity, unit price, discount, tax and a **Printed text** per line. Only a draft can be edited.
4. **Availability** shows what was asked against what is confirmed. The source is the ERP or master data (stock and lead time, labelled an estimate). **Refresh availability** reads it again.
5. Select **Confirm order**. It needs at least one line. A confirmed order is locked. **More > Reopen** makes it a draft again.
6. **PDF**, **Email** and **WhatsApp** are in the header. The WhatsApp button opens WhatsApp with the message ready. You press send.
7. **More > Edit details** changes the header. After confirming, only the notes, the customer PO and files stay open.
8. **More > Cancel order** asks for a reason. **More > Delete** works on a draft only.

**With an ERP connected**

1. **Check with ERP** reads the customer's credit and each product's price and stock. Nothing is saved in the ERP. The result is Passed, Warning or Failed for credit, price and stock.
2. **Send to ERP** creates the order in the ERP. It lists any check that did not pass first and asks you to confirm. After the ERP accepts it, the order is read-only here.
3. The **ERP** tab shows the transfer log, the deliveries and invoices read from the ERP, and **Refresh**.
4. An order that comes from the ERP is read-only here and is marked ERP in the list.

### Statuses

| Status | Meaning |
| --- | --- |
| Draft | Open for editing |
| Confirmed | Locked. Lines cannot change |
| Cancelled | Closed, with a reason |

An order from the ERP shows the ERP's own status words. The path adds Delivered, Invoiced and Paid once the ERP reports them. A line shows "short" or "late" when the confirmed quantity or date falls behind.

### Links to other records

- **Account** and **Contact**.
- The **source**: Standard Quote, Quotation, Deal or an earlier order. The Documents tab draws a flow: source, order, deliveries, invoices.
- **Files and links** on the order: Customer PO, Drawing or Other.
- The ERP's order number, shown read-only.

### Good to know

- Pricing mode is a company decision per order type, not a switch on the order. **Internal** prices lines from your price list and pricing engine. **External** takes prices from the ERP and keeps them read-only. A quiet line under the header says which one applies and where the prices came from.
- An order made from a quote uses that quote's prices. There is no internal or external toggle on the quote or the order.
- Order numbers are `<prefix>-<number>`, counted per prefix. The prefix belongs to the order type.
- Order types can be switched off but not deleted once they have orders.
- The list has chips for Draft, Confirmed and Cancelled. If an ERP has put orders in, it adds BPMSquare and ERP chips and an ERP no. column.
- A deal can be the source of an order through the API, but the deal page has no button for it. Neither does the Inbox (verify).
- Sales orders can be imported, exported and updated in Data Workbench, and read through the v1 API and the MCP server.

Screenshot: sales-orders-list.png | /sales-orders | The status chips and the list.
Screenshot: sales-order-new.png | /sales-orders/new | The form with customer, order type and lines.
Screenshot: sales-order-detail.png | /sales-orders/<id> | The path across the top, the Overview tab and the header buttons.
Screenshot: sales-order-erp.png | /sales-orders/<id>?tab=erp | The ERP tab with the checks and the transfer log.

---

## 13. Purchase Orders

### What it is

A purchase order (PO) orders stock or goods from a supplier. You record what arrives against it, and stock levels go up.

### Where to find it

**Sales > Purchase Orders** (`/purchase-orders`). New: **+ New Purchase Order** (`/purchase-orders/new`). A PO opens at `/purchase-orders/<id>`.

### Who uses it and which module switches it on

Buyers and store keepers. Module: **Inventory & Purchasing**. Business role entry: **Purchase Orders**.

### How to use it

**Create a PO**

1. Select **+ New Purchase Order**.
2. Choose the **Supplier** (required). Set the **Order date** and **Expected delivery date**.
3. Optionally link a **quote** and a **case**.
4. Add lines with **+ Add line**. For each line pick an item **From inventory** (it fills in the rest) or type a **Description**. Set the unit, the quantity and the rate.
5. Add **Notes** and **Terms**. Select save. The reference is `PO-<year>-<number>`.

**Send and receive**

1. Open the PO. On a draft the main button is **Mark as sent**. It changes the status only. Nothing is emailed.
2. When goods arrive, select **Receive stock**. The Lines tab shows a **Receive stock** card.
3. Type the quantity received on each line. Select **Record receipt**. A line cannot receive more than is outstanding.
4. Lines tied to an inventory item add the quantity to stock on hand.

**Cancel**

1. **More > Cancel order** is offered once the PO is sent. It asks for confirmation. The PO stays on record as cancelled.

**Create POs from an RFQ**

1. On an awarded RFQ, select **Create purchase orders** (section 9). One draft PO is made per supplier.

### Statuses

| Status | How it is set |
| --- | --- |
| Draft | New PO |
| Sent | Mark as sent |
| Partially received | Some quantity received |
| Received | Every line fully received |
| Cancelled | Cancel order |

The list has a chip for each status with a count.

### Links to other records

- **Supplier** (Chapter 6, section 9).
- **Quotation** and **Service case**, when linked.
- **Inventory items** on the lines (Chapter 6, section 11).
- The **RFQ** whose award made it.

### Good to know

- A PO has no PDF, email or WhatsApp button at this snapshot. The RFQ screen says "check and send from Purchase Orders", but this page can only mark it sent.
- Status is worked out from the quantities received. You cannot set Received by hand.
- Only a draft can be deleted.
- Purchase orders can be imported, exported and updated in Data Workbench. The v1 API and the MCP server list and read them.
- Purchase orders from a contract buy-out are raised in your purchasing system, not here (section 15).

Screenshot: sales-po-list.png | /purchase-orders | The status chips and the list.
Screenshot: sales-po-form.png | /purchase-orders/new | The form with a line from inventory.
Screenshot: sales-po-receive.png | /purchase-orders/<id>?tab=lines | The Receive stock card.

---

## 14. Contract projects

### What it is

A contract project is what a won tender becomes. It holds the contract value, a cost budget split by resource type and cost code, numbered budget revisions, client changes (variations), the billing schedule and an Excel handover for your purchasing system. A project can also be made by hand.

### Where to find it

**Sales > Contract Projects** (`/contract-projects`). New by hand: **+ New Contract Project** (`/contract-projects/new`). A project opens at `/contract-projects/<id>`. From a tender: **Create contract project** on the awarded tender. The lists the budget uses (cost codes, resource levels and so on) are in **Settings > Sales > Contract projects** (Chapter 1, section 5.4).

### Who uses it and which module switches it on

Project managers, finance and the people who approve budgets. Module: **Contract projects**. The project page also needs **GCC tender deals** (see Good to know). Business role entry: **Contract Projects**. Approvers are the same people as for a bid decision (**Settings > Sales > Tenders**).

### How to use it

**Create it from the tender**

1. Win the tender: select **Record the outcome**, choose **Won**, then **Create contract project now**. Or open an Awarded tender and select **Create contract project**.
2. The project starts with the contract value from the award (or the final bid total if no award value was recorded). The tender's lines become the baseline budget. A line with a recorded cost uses it. The rest start at the rate less your default margin and are marked "estimated".
3. If a project already exists for the tender, the button reads **Open contract project**.
4. If the tender had a WBS (section 3), the project starts with a copy of it: the items, their owners, the lines in them and any splits. The Overview and the page header say how many items, lines and unassigned lines came across, for example "WBS 6 items - 14 lines - 2 unassigned". The project keeps its own copy, so a change on the project never touches the tender.

**Create it by hand**

1. Select **+ New Contract Project**. Enter the **Name** (required), the **Customer** and the **Contract value**. Select **Save**.
2. Add the budget lines yourself.

**Read the Overview**

1. The tiles show **Contract value**, **Budget**, **Planned margin** and **Lines**.
2. **Budget against contract value** compares the two bars. **Budget by cost type** splits the budget by resource.
3. **Needs attention** lists lines with only an estimated cost and lines with no cost code.
4. **Details** holds the customer, manager, planned start and end, the tender and the ERP id. Managers can edit them.
5. For a tender project, **Came from** links the tender, the winning bid version, the BOQ file and the estimates. **Bid against budget** compares the cost in the winning bid with the budget now.

**Build and approve the budget**

1. Open the **Budget** tab. Lines are grouped by resource type. Select **+ Add line**. Fill in the description, resource, cost code, quantity, unit and unit cost. Tick **Reserve** for money held back for risk.
2. Select **Save budget**.
3. On the Overview, select **Ask for approval**. The project shows "Baseline waiting".
4. An approver selects **Approve** or **Reject** (a reason is required). The proposer can withdraw. On approval the budget is locked and the project becomes Active.

**Allocate the budget by BOQ line or by WBS**

1. On the **Budget** tab choose **Allocate by**. **BOQ line** means you type a cost on each line. **WBS** means you type one cost on each bottom-level WBS item and its lines follow. Switching clears the typed costs and keeps your WBS.
2. The tiles show **Contract value**, **Allocated** and **Margin so far**. Margin is the contract value less what you have allocated, live as you type.
3. By WBS, the Budget table is the tree. Bottom-level items carry the input, and a parent shows the total of its sub-items and cannot be typed. A split line's budget amount is the sum of its parts.
4. **Fill from tender costs** copies the costs recorded on the tender once. Lines without one are listed.
5. Select **Save allocation**.

**Group lines into a WBS (the WBS tab)**

1. Open the **WBS** tab, next to **Budget**. The number on it is how many items the project has.
2. A project made from a tender that has a WBS starts with a copy of it. When the tender had none, the tab reads "No WBS was copied from the tender. Add the first item."
3. Select **New WBS item**. The **Name** is required. Leave **Code** empty and it numbers itself (1, 1.1, 1.1.1), or type your ERP's code and it is kept. **Parent** nests the item, up to three levels. **Renumber** sits next to the button once the project has items.
4. Choose an **Owner**. The owner runs this part of the work, and only an employee with a login can own an item. Employees without one are listed under **No login yet**. Pick one and the panel offers **Create login**. The item cannot be saved until the login exists. Items with no owner are counted in an amber line, and the Overview lists "n WBS items without an owner".
5. Tick the **Lines** the item holds. A line already in another item is greyed and shows which one. A line sits in one item, or you can split it across items with **Split**, in the same panel as on the tender.
6. **Unassigned** lists the lines in no item, in amber. Tick lines, choose an item in the bar that appears and select **Group into WBS**.
7. The tree shows **Owner**, **Lines**, **Client amount**, **Allocated** and what is left. When several people own items, owner buttons above the tree show one person's items.
8. After the baseline is approved the WBS tab says "Allocation locked: baseline approved. Structure and owners can still change." Names, codes, parents, owners and new items can still change. The typed costs are fixed, and when you allocate by WBS the lines also stay where they are.
9. To move lines or costs after approval, start a revision on the **Revisions** tab (below). The new revision is a draft, so costs and line moves open up again.

**Change the budget after approval**

1. Open the **Revisions** tab. Under **Start a revision** choose the **Reason** and add a note (required for the reason "Other"). Select **Start revision**.
2. Edit the new revision on the Budget tab and ask for approval again. The older one is marked Superseded.
3. **Compare** opens a revision against the approved one: lines added, removed and changed, and the change in total.

**Record a client change (variation)**

1. Open the **Variations** tab and select **+ Add variation**.
2. Enter a **Title**, the **Change in contract value** (a minus sign for something taken out), the **Change in cost**, the **Change request** it answers and a description.
3. Select **Send for approval**. An approver selects **Approve** or **Reject**. You cannot approve your own unless the workspace allows it.
4. Approval changes the contract value and opens a budget revision for the cost.

**Bill the client**

1. Open the **Invoicing** tab. Select **+ Add milestone**.
2. Enter the **Title**, **Due date** and the amount as **Percent of contract value** or **Fixed amount**. Percent milestones are worked on the contract value as it stands now. Totals over 100% warn, they do not stop you.
3. When a milestone is ready, select **Create invoice**. A draft invoice is made for that milestone and linked back. The amount is before tax, and the tax is shown under it.
4. On a phone each milestone is a card.

**Hand over and close**

1. The **Handover** tab gives **Download Excel**: the project, its budget lines by resource and cost code, and the material list.
2. **More > Close project** closes an Active project. **Reopen project** opens it again. **Delete** works on a Draft project whose budgets are all drafts.

### Statuses

| Project status | Meaning |
| --- | --- |
| Draft | Budget not yet sent for approval |
| Baseline waiting | The baseline budget waits for an approver |
| Active | Baseline approved |
| Closed | Finished |

| Budget revision | Meaning |
| --- | --- |
| Draft | Being edited |
| Waiting for approval | Sent to an approver |
| Approved | Locked |
| Superseded | Replaced by a later revision |

Revision 0 is called the Baseline. A variation is Draft, Waiting for approval, Approved or Rejected. A milestone is Planned, Ready to invoice, Invoiced or Paid.

### Links to other records

- The **tender** it came from, and its **bid version**, **BOQ** and **estimates**. A WBS item that came from the tender says "From tender item" with its code.
- **Customer** (account).
- **Invoices** made from milestones.
- **Buy-out packages** (section 15).
- **Settings lists**: resource levels, cost codes, justification reasons, reserve types, divisions and job locations.

### Good to know

- The list opens with tiles for Active projects, Contract value, Budget and Margin below 10%. Chips filter by status.
- The Contract Projects menu item shows when only **Contract projects** is on, but the project page returns "not found" unless **GCC tender deals** is on too (verify).
- **Item no.** on a budget line is the client's item number from their BOQ. It is a reference only. The word **WBS** is used only for the tree on the WBS tab.
- Committed and Actual cost columns on the Budget tab are not typed in. Committed comes from buy-out awards. Actual will come from the ERP later.
- The starter lists are not your client's own. Replace them in Settings.
- The reference is `CPR-<number>`. A variation is `VAR-<number>`.
- **Send to ePROMIS** is always switched off at this snapshot. The Excel is the handover.
- The project's ERP id line is filled by an integration and cannot be edited here.

Screenshot: sales-cp-list.png | /contract-projects | The four tiles, the status chips and the project list.
Screenshot: sales-cp-overview.png | /contract-projects/<id> | The tiles, Budget against contract value and Needs attention.
Screenshot: sales-cp-budget.png | /contract-projects/<id>?tab=budget | The budget grid grouped by resource type.
Screenshot: sales-cp-variation.png | /contract-projects/<id>?tab=variations (open a variation) | The variation panel with value and cost changes.
Screenshot: sales-cp-invoicing.png | /contract-projects/<id>?tab=invoicing | The billing schedule with Create invoice.

---

## 15. Buy-out packages

### What it is

Buy-out is the step after the award. The project groups its budget lines into packages, asks the client's approved suppliers for one price per package, compares the prices, awards each package to one supplier and hands it over as an Excel. The purchase order itself is raised in ePROMIS or your ERP.

### Where to find it

**Sales > Contract Projects**, open a project, tab **Buy-out** (`/contract-projects/<id>?tab=buyout`). The tab sits after Budget. The project **Overview** carries a **Buy-out progress** card.

### Who uses it and which module switches it on

Buyers and project managers. Module: **Contract projects** plus **GCC tender deals**. The project must have been made from a tender. Business role entry: **Contract Projects**. Suppliers and the client's approved group are in Chapter 6, section 9.

### How to use it

**Check the set-up**

1. At the top, the tab names the group in use ("Suppliers from: <group>") or says there is no approved list for this client.
2. If the client accepts only its own vendors, make a group for it under **Suppliers**, tab **Groups**, before sending anything. The supplier lists then show only its members, and the server refuses anyone else.

**Read the tab**

1. Four tiles: **Budget in packages**, **Committed**, **Best quotes vs budget** and **Needs a decision**.
2. Filter buttons: **All**, **Not sent**, **Out**, **Ready to award**, **Awarded**, **Handed over**.
3. The table shows each package with its budget, best quote, committed amount, position against budget, status and an ePROMIS state. On a phone it becomes cards.

**Make a package**

1. Select **+ New package**.
2. Enter a **Name** (required) and a **Kind**: Supplier (goods) or Subcontract (work). The kind is only a label for now.
3. Tick the budget lines to include. A line sits in one package at most. Lines already used are not offered. The panel shows how many lines are chosen and what they add up to.
4. Select **Create package**.

**Ask for prices**

1. Open the package. Select **Send request**.
2. Tick the suppliers (only the client's approved group is shown). Set **Reply by** and a **Note to suppliers**.
3. Select **Send request to N suppliers**. Each supplier gets an email with a link and answers on a page without logging in: a price and a lead time per line, with room for an alternative or a refusal.

**Compare and award**

1. Under **Quotes in the current round** the replies sit side by side. The lowest valid price is marked.
2. Select **Award package** on a quote. Confirm with **Confirm award**. A reason is asked for when the quote is not the lowest valid one or has expired. A package over its budget shows a warning. It is never blocked.
3. **Against the budget** draws budget, best quote and committed as bars.

**Run another round**

1. If the best price is not good enough, select **Send a new round**.
2. Each round is its own request and none is ever deleted. **Rounds kept for audit** lists every round with its request number, date and result.

**Take back an award**

1. Select **Un-award**, type the reason (required) and confirm. This is possible until the handover is marked as sent.

**Hand over**

1. On an awarded package, select **Download Excel**: supplier, lines, quantities, awarded rates and cost codes.
2. Optionally type the **ERP reference**. Select **Mark as sent to ePROMIS**. It records who, when and the reference, and ends the right to un-award.

**Delete a package**

1. **Delete package** puts its budget lines back in the list of lines without a package.

### Statuses

| Package status | Meaning |
| --- | --- |
| Not sent | No request sent |
| Out | Request sent. The pill can read "Out, 2 of 3 replied" |
| Ready to award | At least one valid reply and no award |
| Awarded | One supplier has the package |
| Handed over | Marked as sent to ePROMIS |

The handover state is Not ready, Ready or Sent.

### Links to other records

- The **contract project** and its **budget lines**. The Budget tab shows a **Committed** column.
- **RFQs**: each round creates one (reference `RFQ-<number>`).
- **Suppliers** and the client's **supplier group**.
- The package reference is `PKG-<number>`.

### Good to know

- Packages can be made only from an approved baseline budget. Reserve lines are left out.
- Awarding is per package. One supplier takes the whole package.
- The cost shown beside each line ("Cost in bid") is internal. Nothing on these screens and nothing in the handover Excel shows the bid price or markup.
- Purchase orders are not raised here. They come from the Excel.
- The Overview card **Buy-out progress** shows packages awarded and handed over, and committed against the amount in packages.
- Whether a re-tender should reuse the bid-time suppliers is not decided (verify with your BPMSquare contact).

Screenshot: sales-buyout-tab.png | /contract-projects/<id>?tab=buyout | The four tiles, the filter buttons and two packages.
Screenshot: sales-buyout-new-package.png | /contract-projects/<id>?tab=buyout (select + New package) | The new package panel with lines ticked.
Screenshot: sales-buyout-quotes.png | /contract-projects/<id>?tab=buyout (open a package) | Two quotes side by side with Lowest valid marked.
Screenshot: sales-buyout-handover.png | /contract-projects/<id>?tab=buyout (open an awarded package) | The Handover block with Download Excel and Mark as sent.

---

## 16. Invoices

### What it is

An invoice bills an account. It holds lines, discount, tax, a due date and the payments recorded against it. It is made from a quote, a work order, a project milestone, or typed in directly.

### Where to find it

**Sales > Invoices** (`/invoices`). New: **+ New Invoice** (`/invoices/new`). An invoice opens at `/invoices/<id>`.

### Who uses it and which module switches it on

Finance and billing staff. Module: **Invoices**. Business role entry: **Invoices**. Saudi e-invoicing adds checks and a bilingual layout, and needs **Saudi e-invoicing, data readiness** (see Good to know).

### How to use it

**Create an invoice**

1. From a Won Quotation select **Convert to Invoice**. From an Accepted Standard Quote select **Create invoice**. From a Completed work order select **Raise Invoice** (Chapter 3). From a project milestone select **Create invoice** (section 14). Each makes a draft.
2. Or select **+ New Invoice**. Pick **From approved quote** to fill everything below, or choose the **Account** (required), **Contact**, **Issuing entity** and **Due date**.
3. Add lines with **+ Add line**: description (required), unit, quantity and rate. Choose a discount type and value. Add **Notes** and **Terms**.
4. Select save. The reference is `INV-<year>-<number>`.

**Send it**

1. Open the draft. The main button is **Email invoice**. The **Email** tab lists recipients (add addresses by typing them), a subject and a message. The PDF is attached.
2. Sending a draft marks it **Sent** and stamps the issue date.
3. To mark it sent without emailing, use **More > Mark as sent (without emailing)**.

**Record a payment**

1. Once the invoice is sent, the main button is **Record payment**. Open the **Payments** tab.
2. Enter the **Amount**, the **Method** (free text, for example Bank transfer), a **Reference** and a **Note**. Select **Record payment**.
3. A payment for the full balance makes the invoice Paid. A smaller one makes it Partial.

**Other actions**

1. **More > Print / PDF** gives the PDF. **Edit** works on the page fields. **Adapt fields** is for administrators. **Cancel invoice** keeps the record as cancelled. **Delete** works on drafts only.
2. The right-hand column links the account, contact, quote, work order, case and contract.

**Find invoices**

1. The tiles show a count and value for Draft, Sent, Partial, Paid and Overdue. Select one to filter.
2. Search by reference or account, and set **Issued from** and **to** dates.

### Statuses

| Status | How it is set |
| --- | --- |
| Draft | New invoice |
| Sent | Email, or Mark as sent |
| Partial | A payment smaller than the balance |
| Paid | Payments reach the total |
| Overdue | No button in the app (verify). The page adds an Overdue pill to a Sent or Partial invoice past its due date |
| Cancelled | Cancel invoice |

### Links to other records

- **Account** and **Contact**.
- The **Quotation**, **Standard Quote**, **Work order**, **Service case**, **Contract** or **Project milestone** it came from.
- **Payments**.
- The connected system's record, when an ERP is linked.

### Good to know

- An overdue reminder event is raised daily for unpaid invoices past their due date. It does not change the status.
- You cannot record a payment on a Draft or Cancelled invoice.
- With Saudi e-invoicing on, an extra block on the Overview shows the document type (Standard, Simplified, Credit note, Debit note), the VAT category of each line (Standard rate, Zero rated, Exempt, Out of scope) and a readiness check. The pill reads "E-invoice ready" or "E-invoice not ready" and the issues link to what to fix. A Draft that is not ready cannot be sent. A credit note can be made from a sent invoice. Nothing is sent to ZATCA at this snapshot.
- The ERP, if connected, may carry its own invoice number on the ERP id line.
- Invoices can be imported, exported and updated in Data Workbench. The v1 API and the MCP server list and read them.

Screenshot: sales-invoices-list.png | /invoices | The five status tiles and the list.
Screenshot: sales-invoice-detail.png | /invoices/<id> | The facts (Total, Paid to date, Balance due, Due) and the right-hand column.
Screenshot: sales-invoice-payment.png | /invoices/<id>?tab=payments | The payment form.
Screenshot: sales-invoice-einvoice.png | /invoices/<id> (Saudi e-invoicing on) | The e-invoice block with the readiness list.

---

## 17. From enquiry to invoice

### What it is

This is the path a sale takes through BPMSquare. There are three routes. Pick the one that matches the work.

### Where to find it

It starts at **Sales > Pipeline** (route A and C) or **Sales > Quotations** (route B). It ends in **Sales > Invoices**.

### Who uses it and which module switches it on

Sales, bid, finance and project staff. Modules: **Pipeline**, **Standard Quotes**, **Quotations**, **Sales Orders**, **Invoices**. Route C also needs **GCC tender deals** and **Contract projects**.

### How to use it

**Route A: a deal and a Standard Quote**

1. Create a deal for Example Trading LLC (section 1). Add lines.
2. Select **Convert to Standard Quote**. Price the lines and **Email to customer**. Choose **Mark as sent**.
3. When the customer agrees, select **Mark accepted**. The deal closes as Won.
4. Select **Create sales order** if you use orders (section 12), and **Create invoice** (section 11 and 16).

**Route B: a Quotation**

1. Select **+ Create quote**, choose the type and write the scope and lines (section 10).
2. Email it and set the status. When the customer agrees, set the outcome to **Won**.
3. Select **Convert to Invoice**, or **Create sales order** first.

**Route C: a tender**

1. A tender arrives. Make a tender (section 2). Propose the bid decision and get it approved.
2. Upload the BOQ (section 3). Match rows to products and price all lines.
3. Fill the gaps in Costing with estimates and RFQs (section 4).
4. Submit the bid, revise it as needed, and make a Standard Quote from the winning version (section 5).
5. Record the outcome as Won and create the contract project (section 14).
6. Approve the baseline budget. Handle client changes as variations. Bill by milestone.
7. Buy out the packages and hand them over (section 15). Raise purchase orders in your purchasing system.

### Statuses

Each record keeps its own statuses. They are listed in its own section.

### Links to other records

- A deal holds its quotes. A quote links to its deal, order and invoice. An order links to its quote and invoices.
- A tender holds its bid versions, the Standard Quote made from a version, and the contract project. A milestone links to its invoice.

### Good to know

- Choose one route per job. A Standard Quote can be billed once, and a Quotation can be converted to an invoice once. A work order's **Raise Invoice** does not look for an invoice already made from the same quotation (Chapter 3, section 7).
- Accepting a Standard Quote that came from a tender bid also tries to close the tender deal. Check the tender stage afterwards (verify).
- References you will see: `OPP-` (deal), `SQ-` (Standard Quote), the quote ID format (Quotation), the order type prefix (Sales Order), `PO-`, `INV-`, `RFQ-`, `EST-`, `CPR-` (contract project) and `PKG-` (package).

Screenshot: sales-flow-quote-to-invoice.png | /standard-quotes/<id> (an Accepted quote with an invoice) | The header with the invoice and sales order facts.
Screenshot: sales-flow-tender-to-project.png | /pipeline/<id> (an Awarded tender) | The Open contract project button.

---

## Common questions

**1. Why can I not see the Tenders tab?**
The tender edition is off for your workspace. Pipeline must be on, and **GCC tender deals** must be switched on by the BPMSquare team. Without it the Pipeline page is the plain deals board.

**2. I proposed a bid decision but I cannot approve it. Why?**
The person who proposes cannot approve it, unless the workspace allows self-approval. An administrator chooses the approvers and the self-approval setting in **Settings > Sales > Tenders**. If nobody else can approve, the page says so and asks for an approver or self-approval.

**3. Where do I award a supplier for a tender RFQ?**
On the tender's **Costing** tab, with **Compare and award**. The RFQ's own page links you there. Awarding there also puts the price on the BOQ row.

**4. I emailed a Standard Quote but it is still Draft. What do I do?**
Emailing a Standard Quote does not change its status. Choose **More > Mark as sent**. Then **Mark accepted** appears when the customer agrees. Emailing an invoice is different: it marks a draft invoice Sent.

**5. Why is there no "Create sales order" button?**
The button is on an **Accepted** Standard Quote and on a **Won** Quotation, and only when **Sales Orders** is on. A deal and the Inbox have no such button. You can also start an order with **+ New Sales Order**.

**6. Can I send a purchase order to the supplier from BPMSquare?**
No. A purchase order can be marked as sent, and goods can be received against it, but it has no PDF, email or WhatsApp action at this snapshot. Send it from your own mail.

**7. Can I raise purchase orders from a buy-out package?**
No. A package gives you an Excel with the supplier, lines, quantities, awarded rates and cost codes. The purchase order is raised in ePROMIS or your ERP. **Mark as sent to ePROMIS** records that you did it.

**8. Why is there no Costing tab, Room tab or Buy-out tab?**
Each is a separate switch. **Costing** needs the Project Estimator or the RFQ module and a role that can view Estimates or RFQs. **Room** needs **Deal Room**. **Buy-out** needs **Contract projects**, and the project must have come from a tender. Ask your BPMSquare contact to check which modules your workspace has.
