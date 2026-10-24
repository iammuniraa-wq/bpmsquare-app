# Shared Inbox: what was built, and how it answers the rules

> Built 2026-10-24 from the owner's decisions in `docs/design/estimator-unification-and-inbox.md` and section 4 of
> `docs/design/gcc-sales-estimating-plan.md`. Capability words: `docs/capabilities/inbox.md`. Migration `0214_inbox.sql`
> (bundle 23), seed `scripts/seed-inbox-demo.sql`. Flag `inbox` (platform admin, default off).

## What is already there (6c, looked first)

- **Inbound mail.** `/api/inbound/email/[provider]` (Resend, Svix-signed, or a generic HMAC relay) already received mail for
  RFQ replies and dropped the rest. The RFQ router still goes first; a message to a channel address is now offered to the
  Inbox. No second webhook.
- **Reading a mailbox.** `lib/mail/mailbox.ts` (IMAP, read-only, UID cursor) and the cron pattern of
  `/api/rfqs/cron/mailbox`. The Inbox poller reuses `fetchNewMail`; the same inbox serves both, and mail carrying an RFQ tag is
  left to the RFQ poller.
- **Sending.** `sendViaMailbox`, `resolveOutbound` (a demo workspace never reaches a customer), `email_log`.
- **Sealed connectors.** The mailbox is the existing Gmail or Mail server connector (Settings > Connectors); the Inbox adds no
  second credential store.
- **Creating records.** Each record is made by its own create route (`/api/standard-quotes`, `/api/cases`, `/api/leads`,
  `/api/wfm/projects`, `/api/accounts`, `/api/contacts`), called in-process, so every validation, master reference, history
  entry and event of the New form applies. `POST /api/leads` gained the missing `logChange`.
- **Estimates.** The workspace's email-intake card and `POST /api/estimates` are used as they are; the Inbox adds only a
  prefilled brief, a template hint and a link back.
- **Settings pattern.** `RowTable` + `SidePanel` (a row opens a side panel, a bottom sheet on phones), the connector chip,
  `InfoTip`.
- "Project" in this repo is the **Workforce project** (`wfm_projects`, the cost object hours are booked against, admin-created).
  The Fence Projects module is being folded into Estimates, so an email does not become one.

## The twelve rules (3c)

1. **Simple.** A channel needs a name; everything else defaults. One screen to read, one menu to act.
2. **Ease of use.** Create from this email is one menu, the address's favourite first; the sender is matched to an account for you.
3. **Not crowded.** Labels, values, actions. Explanations sit behind `InfoTip` (texts in `lib/inbox/tips.ts`, held to two sentences
   and 160 characters by a test).
4. **Collapsible.** The detail's side panels are folds that remember their state; the list pages 25 rows at a time and the conversation shows "earlier
   messages" after three; the settings list is a table that becomes cards under 780 px.
5. **Pricing choice.** Does not apply: the Inbox carries no prices. A quote made from an email is priced by the Standard Quote's
   own internal/external pricing.
6. **Documents and sending.** The Inbox is not a document. It sends one thing, a reply, through the channel's mailbox or
   `resolveOutbound`, logged in `email_log` (kind `inbox`). A record made from an email shows a "From email" strip with the files.
7. **Document flow.** This object IS the start of the flow: an email becomes a Quote, Project, Case, Lead or Estimate and the
   source (sender, summary, files, a way back) is stored on the record (`record_sources`, `record_files`) and shown.
8. **AI by default.** Briefing facts and a dashboard tile, ⌘K "Open inbox", global search (sender and subject), guide ids, the
   estimate template suggestion. Deliberately **not** in the assistant's read access or Talk to data: mail is private
   correspondence and untrusted text; a model must not read or act on it. The assistant can say how to use the screens.
9. **ERP integration.** Does not apply: mail has no ERP counterpart. The records it becomes carry their own.
10. **Change log.** Status, assignment, conversion and channel changes are logged with `logChange` (labels name the channel and the
    message, never the sender or the text); the object is in the change-history filter.
11. **Types per object.** Does not apply: there is one kind of message. The "types" here are the channels (address, team, default
    action), which are data a workspace edits.
12. **Show the data.** A message opens as a conversation with its files and their quality labels (Good, Needs review, Poor) beside
    it, and a banner when no file is good enough to measure from. Mock-up: the thread view itself (conversation left, sender and
    files right on a PC; one column on a phone).

## Design decisions worth knowing

- **Service role only.** All six tables have RLS on and no policy. Mail is private, and the team rule (a channel's Business Roles)
  is enforced in code on every read, search, file link, Nova comment and mention; a test fails if a policy is added.
- **The tenant comes from the signed alias or the connector**, never the payload. The alias is `inbox-<16 random>@INBOUND_EMAIL_DOMAIN`
  and can be rotated.
- **One conversion per message.** A message links to one record; a later customer message in the thread can become another.
- **Retention.** 90 days from receipt, 30 days from conversion, then the body and files go and a stub stays. Conversion copies
  the files onto the record first, so they outlive the email.
- **Reply goes only to the sender.** The recipient is never taken from the request.
- **Not built, and why.** Reading a drawing (PDF/DXF/photo) into estimate inputs and a customer-facing "Request an estimate" page are
  the estimator's phases in the owner's plan; the Inbox stores the files, labels them, and asks for a better one.
