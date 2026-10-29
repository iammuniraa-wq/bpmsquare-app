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
3. Send a test email to the mailbox. Within a minute or two it appears in the Inbox.
4. To stop receiving: untick "Take in new mail". A channel that holds mail cannot be deleted; it is paused, and mail clears itself after 90 days.

Receiving at an address on our platform (tenders@yourworkspace) is switched on by us when needed; until then the connected mailbox is the way in.
