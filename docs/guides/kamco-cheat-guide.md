# KAMCO cheat guide: first week

One page of what to set up and how, in the order that works. Draft; the final one-pager is built from this and the dry-run results.

## 1. Connect your mailbox (Settings > Connectors)

Without this, BPMSquare cannot send RFQs or quotes by email, and the Inbox cannot receive tenders.

**Gmail**
1. In Google: Account > Security. Turn on **2-Step Verification**.
2. Open myaccount.google.com/apppasswords. Name it "BPMSquare" and click Create.
3. Google shows a **16-character App Password** once. Copy it. Your normal Google password does not work here: Google refuses it for any app that signs in by email protocol.
4. In BPMSquare: Settings > Connectors > Gmail > Connect. Enter the Gmail address and the App Password. Save & connect.
5. Click **Test connection**. A test email arrives in that inbox and the card shows a green message.
6. If the test shows "Application-specific password required", the password entered was not an App Password. Disconnect and enter the 16-character code.

**Company (domain) mailbox, such as purchasing@yourcompany.com**

Use Connectors > **Mail server (SMTP / IMAP)**. Your IT team or hosting provider has the server details.

1. Connectors > Mail server > Connect.
2. Enter: Email address; Username (usually the same address); Password; SMTP server and port; IMAP server and port.
3. Save & connect, then **Test connection**. It logs in to both the sending side and the receiving side. Both must pass.
4. Then Settings > RFQ > Mail channel: choose your mailbox.

| Provider | SMTP server | SMTP port | IMAP server | IMAP port | Password |
|---|---|---|---|---|---|
| Zoho Mail | smtp.zoho.com | 587 | imap.zoho.com | 993 | App-specific password if two-factor is on |
| Microsoft 365 | smtp.office365.com | 587 | outlook.office365.com | 993 | Admin must allow "Authenticated SMTP" and IMAP for the mailbox; otherwise use an app password |
| cPanel / web hosting | mail.yourdomain.com | 587 or 465 | mail.yourdomain.com | 993 | The mailbox password |
| Google Workspace | use the Gmail connector above | | | | App Password; the admin must allow it |

If the test fails:
- "Could not log in": the username or password is wrong, or the provider requires an app password.
- A timeout: the server name or port is wrong, or the provider blocks the connection.
- Receiving works only if **IMAP is switched on** for the mailbox. Ask your IT team to enable it. This is the most common reason the Inbox stays empty.
- Microsoft 365: if sign-in is refused with a correct password, the admin has switched off basic sign-in for that mailbox. Ask them to enable Authenticated SMTP for it.

If Google does not offer App passwords (a Workspace account where the admin has turned it off, or an account with Advanced Protection), use the Mail server connector or ask the Workspace admin.

## 2. Where emails go (Settings > Email output)

- **Send to business partners:** real addresses on the account, contact or supplier. Use this in production only.
- **Send to a specified email address:** every outgoing email goes to one inbox you choose. Use this while testing or demonstrating. Switch it back before real use.

## 3. Who approves a bid (Settings > Tenders)

Choose the approvers. The person who proposes a bid decision cannot approve it unless "Allow self-approval" is on. Keep that off in production.

## 4. Receive tenders by email (Settings > Inbox channels)

**Connect a dedicated mailbox (for example tenders@yourcompany.com), never a personal inbox.** A channel reads everything in the connected mailbox and copies it into the Inbox. It does not filter for tenders. Mail already in the mailbox when you switch the channel on comes in too.

1. Settings > Connectors: connect the mailbox (step 1).
2. Settings > Inbox channels > New channel. Choose the connected mailbox. Leave Team empty (everyone with the Inbox sees it). Leave "Create offers first" on "Nothing in particular": the person reading each email chooses what to create (tender, deal, RFQ).
3. **Limit what comes in.** In the channel, fill "Only from these senders" (an address like buyer@client.com, or a whole domain like @ministry.gov.sa) and/or "Subject contains" (words such as tender, RFQ, BOQ). Mail that matches either is taken in; everything else stays in the mailbox and is never copied. Leave both empty only for a mailbox used for nothing else.
4. Mail from the mailbox's own address is ignored on purpose (so BPMSquare never answers itself): send your test from a different address.
5. Send a test email to the mailbox. It appears in the Inbox within about 5 minutes (the mailbox is read every 5 minutes, or press **Read mail now** on the channel).
6. To stop receiving: untick "Take in new mail". A channel that holds mail cannot be deleted; it is paused, and mail clears itself after 90 days.

Receiving at an address on our platform (tenders@yourworkspace) is switched on by us when needed; until then the connected mailbox is the way in.

## 5. The tender path (after the October redesign)

Each tender shows one path: **Received, Decision, BOQ, Costing, Bid, Submitted, Won or lost**. The blue **Next** row says what to do now and has the main button. **Details** (amount, stage, bid decision, bid end date, guarantee) is closed until you open it. The step-by-step with pictures is in `kamco-redesign-walkthrough.md`.

- **BOQ:** columns are **Cost from**, **Cost / unit**, **Markup %**, **Rate / unit**, **Product**; each has an "i". The **Priced** tile shows "6 of 12 · 6 to price". To type your own cost, click a row, then **Cost / unit** and **Save cost**.
- **Costing:** one table, **Cost sources**, of estimates and RFQs. **Add rows** gives an estimate more BOQ rows. **Compare and award** is on a sent RFQ. An estimate opened from a tender has **Back to Costing**, not Create quote.
- **Bid:** read **Before you submit**, choose **Payment terms**, then **Submit bid**. **Send by email** sends the priced BOQ or the answer sheet through the tender and logs it under **Sent to client**.
- **Interactions:** one timeline of email with the client; **New email** writes from the tender. **Room** is internal only (Discussion, Team, Decisions, Documents).
- **Competitors:** a list of Company, Expected price, Status. **Suggest from market research** asks three questions, then proposes companies with a source for every fact; nothing is saved as yours until you accept it. It uses part of the AI allowance.

## 6. After the win: the contract project

The project appears once the tender is **Won** (**Create contract project**). It carries the contract value and the client's lines; **no cost is guessed**.

- **Budget:** choose **Allocate by** **BOQ line** or **Work package**, then type costs. **Margin so far** is the contract value less what you allocated, and reads **Not allocated yet** until you allocate. **Fill from tender costs** copies the recorded costs once.
- **Work breakdown (WBS):** group BOQ lines into work packages, each with an owner. The owner must be an employee with a login.
- **Tabs:** **Budget, Buy-out, Client changes, Client billing, Revisions, Hand over to the ERP** (the Handover tab). **Ordered** and **Spent** replace Committed and Actual.
- **Client billing:** **+ Add milestone**, or **Copy the tender's payment terms** when the bid carried a template.

## 7. Settings added or changed

| Where | What |
|---|---|
| Settings > Contract projects > **Payment terms** | A few templates (name and milestones as percent or amount, with a trigger text). Chosen on the Bid tab. |
| Settings > Contract projects > **Margin floor** | One percent. Margin turns amber under it, red when negative. Not set = never amber. |
| Settings > Contract projects | The old default margin setting is gone. |
| Settings > Tenders | Approvers, as before. |
