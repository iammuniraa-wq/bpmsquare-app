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

**Company mailbox (Zoho, cPanel, Exchange IMAP):** use Connectors > Mail server with the SMTP and IMAP details and the mailbox's normal password.

If Google does not offer App passwords (a Workspace account where the admin has turned it off, or an account with Advanced Protection), use the Mail server connector or ask the Workspace admin.

## 2. Where emails go (Settings > Email output)

- **Send to business partners:** real addresses on the account, contact or supplier. Use this in production only.
- **Send to a specified email address:** every outgoing email goes to one inbox you choose. Use this while testing or demonstrating. Switch it back before real use.

## 3. Who approves a bid (Settings > Tenders)

Choose the approvers. The person who proposes a bid decision cannot approve it unless "Allow self-approval" is on. Keep that off in production.

## 4. Receive tenders by email (Inbox > Add a channel)

To be completed after the dry run.
