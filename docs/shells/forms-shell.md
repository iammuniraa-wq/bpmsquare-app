# Forms and the Preference Centre: the shell (phase M4)

Written 2026-10-20. Source design: `docs/marketing-platform-architecture.md` 5.1 (forms), 5.5
(preference centre), 1.3 (consent ledger), 6.0 (studio screens). This is a **shell**: a thin,
end-to-end slice that works and can be demonstrated, on a foundation that later features build
on. Everything below the "To enhance later" line is deliberately not here.

## What the owner can do with it

1. A platform admin switches on `marketing_forms` for a workspace (needs `marketing`).
2. In **Marketing, Forms** an admin makes a form, picks the fields, writes the consent words, picks the
   topics they cover, chooses what happens after sending, and sets it **Live**.
3. The form is at `https://<the workspace's own domain>/f/<slug>`, and the **Share** group on the form
   gives an `<iframe>` snippet to paste into the client's website.
4. A visitor fills it in. The server records the answers, finds or creates the contact (and a prospect
   account), writes the consent rows if the box was ticked, files a lead, and emits `form.submitted`.
5. Every newsletter's **Manage preferences** link opens the person's own preference centre, where they
   change or withdraw each topic; every change is a new row in the consent ledger.

## Built in the shell

- **Form object** (`forms`, FRM-####): name, web address, public key, status draft / live / archived,
  heading, introduction, button words, fields from a fixed set (name, company, email, phone, message and
  up to three questions of your own; email is always asked and required), a consent block (exact words,
  the topics it covers, whether the box must be ticked), an after-submit action (a thank-you message or a
  redirect to an https page **on the workspace's own domain**, query string dropped).
- **List and record screens**: `/marketing/forms` on the shared list template; `/marketing/forms/new` and
  `/marketing/forms/[id]` in the studio layout (options in collapsible groups on the left, each with a
  one-line hint; the form as the visitor sees it on the right, updating live; desktop / phone preview;
  an optional English "Show me how" walkthrough; the panel above the canvas on a phone). The record
  carries the hosted address, the copyable embed snippet and the latest answers.
- **Hosted page** `<tenant origin>/f/<slug>` and the **embed**: `?embed=1` is the same form without page
  chrome inside an iframe. The tenant comes from the host the page is served on and the form from that
  tenant's slug; a draft, another workspace's slug, or a workspace without the flag all answer 404.
- **Public submit** `POST /api/f/<public key>`: the key is the credential and the tenant is the one on that
  form's row (the body is never read for a tenant, form, contact or account id). In order: size cap,
  honeypot, signed minimum time-to-submit, in-process burst limiter and a per-visitor-hash database limit
  (5 kept submits an hour), then field validation and sanitising (every text is plain text; tags and
  control / direction-override characters are removed), find contact by `contacts.email_hash` (an
  existing contact is never changed by a form) or create prospect account + contact, **consent rows**,
  the lead, the kept answers, `form.submitted` (and `lead.created`).
- **Consent**: only a ticked box writes anything. One `consent_events` row per topic the form names (or a
  single all-topics row if it names none), `source = form`, `basis = consent`, evidence = form id and
  reference, the form's version, **the exact words shown**, the topics, a keyed hash of the visitor's
  address and a browser family. No raw address is stored anywhere. An unticked box records nothing (it
  never withdraws an earlier yes). A form can require the tick.
- **Lead**: one open lead per person per form (`source = form`, `source_form_id`); a second submit only
  refreshes its last activity. While migration 0172 is pending the lead is filed as `direct`.
- **Answers kept 180 days** in `form_submissions`, personal values encrypted like contacts, select-only
  for members, deleted past their date (opportunistically, on submits).
- **Preference centre** `<tenant origin>/marketing/preferences/<contactId>/<token>`: a per-contact link
  signed like the unsubscribe link (same secret, no expiry). Opening it changes nothing. It shows the
  workspace's topics as switches (the person's current answer, from the ledger), a Save button, a one-tap
  "Unsubscribe from all", and the person's last choices. Each change appends a ledger row
  (`source = preference_centre`) with a browser family and hashed address; "all" also mirrors the legacy
  `accounts.marketing_opt_out` flag when every contact of the account has withdrawn, so today's campaign
  send honours it. A person marked do-not-contact, or who opted out through the old link, cannot switch
  topics back on from a link (they are told to get in touch).
- **Newsletter Studio link**: "Manage preferences" in a newsletter now points here for a workspace that
  has `marketing_forms`; otherwise it still opens the unsubscribe page (own commit).
- **Flag and surfaces**: `marketing_forms` (platform-admin only, default off, needs `marketing`) in
  TenantFeatures, TenantEditor, NewTenantForm, `moduleDependencies`, capability catalogue (experimental)
  and facts; nav item under Marketing behind the flag; workcenter `marketing_forms`; `OBJECT_FEATURE.forms`;
  change history (create / update / delete, plus the filter option); FRM references.
- **Demo seed** `scripts/seed-marketing-forms-demo.sql` (is_demo only, idempotent).
- **Safety net**: tests cover consent rows with evidence, honeypot / too-fast / rate-limit / size
  rejection, find-by-hash and no cross-tenant match, tenant from the key, flag-off 404, XSS-safe
  rendering, preference changes appending history, and the public-path allowlist.

## Added after the first shell (2026-10-21): the thank-you email and double opt-in

Settings on the form's **After sending** group, all kept in the form's own `after_submit` JSON (a form saved
earlier reads with the defaults; nothing to migrate):

- **Thank-you email** (on by default, with default words `defaultThankYouText()` that the form can rewrite).
  A confirmation of the visitor's own submission, so it is sent whether or not the consent box was ticked.
  Built in `forms/emails.ts`, sent through `resolveOutbound()`: a demo workspace is redirect-only (to its one
  internal inbox, the intended person named) and with no inbox set it sends nothing. Never throws; the
  submission is already kept. Logged in `email_log` (kind `campaign`, related object the form). Not sent a
  second time to the same person within an hour (otherwise a form is a way to mail-bomb an address).
- **Tell someone about each new answer** (off by default): one workspace member, chosen from a list, gets a short
  email with the answers. The person is checked against `tenant_users` of this workspace when the form is saved
  and again when sending. Also through `resolveOutbound()`.
- **Ask the person to confirm by email** (double opt-in). Its default follows `config.marketing.consent.jurisdiction`
  (Settings, Marketing, Consent and topics, "Where you are based"): on for the EU, off elsewhere; a form can
  override it either way (`null` means "follow the workspace"). When on, each ticked topic is recorded as a
  `pending` row in the consent ledger (migration 0197) instead of `granted`, with the same evidence. `pending`
  lives only in `consent_events`; `consent_state` keeps its two values, so `canContact()` cannot read it as a
  yes and it cannot cover an earlier real answer. The thank-you email carries a signed link
  (`/marketing/confirm/<contactId>/<token>`, HMAC with the same secret as the unsubscribe link, 7 days, the
  expiry inside the signed text). Opening the page changes nothing (mail scanners); the **Yes, confirm** button
  POSTs, appends a `granted` row through `recordConsent` and emits `consent.confirmed`. An expired or invalid
  link shows a plain sentence. A person who unsubscribed after ticking is not switched back on. A form that asks
  for confirmation always sends the link, even with the thank-you words off.
- The contact's **Consent** card shows a pending tick as "Waiting for confirmation" (and "Did not confirm" after
  seven days), never as a yes.

While 0197 is pending: a double-opt-in form records no consent at all (and logs it) rather than a yes nobody
gave; the thank-you email is still sent.

## To enhance later (in the order I suggest)

1. ~~**Thank-you email through the consent gate**~~ **Done 2026-10-21** (see above): thank-you email, notify the
   owner, double opt-in. Still open from the same design: a "resend the confirmation" button on the contact,
   and a reminder email before the link expires.
2. **Call the existing contact "also at Acme" and show it on the lead**; let a form update empty fields
   of a known contact once the visitor is identified another way (never from an anonymous post).
3. **Languages**: English first, then labels, consent text and thank-you per language, following the
   Newsletter Studio rule; the preference centre in the contact's language (Arabic right-to-left).
4. **Form actions**: enter a journey, add to a target group, assign the lead's owner through Coverage,
   notify the owner in Nova. Needs the journey engine (M2) and lead scoring on.
5. **Regenerate / revoke the public key**, plus an optional allow-list of embedding sites
   (`frame-ancestors`) so a form cannot be framed anywhere else; auto-resize of the iframe.
6. **A scheduled purge** of answers past 180 days (today they are removed opportunistically on submits)
   and the 24-month retention for events.
7. **More field types**: choice and rating questions, country / role from `FIELD_REGISTRY`, the
   workspace's own custom fields, file upload; multi-step forms.
8. **Landing pages** (`/p/<slug>`, M4 part two) and the website tracking snippet, so a submit also
   identifies the visitor's earlier page views (`web.identified`).
9. **Channels beyond email** in the consent block and the preference centre (WhatsApp, with M6), the
   preferred-language and "pause for 90 days" controls, and the contact record's Consent card.
10. **Admin polish**: a submissions screen with filters and export, spam review, duplicate-contact
    handling ("same email in two accounts"), conversion funnel per form, submissions as a v1 / MCP
    object, Data Workbench for forms, global search and the palette entry.

## Decisions worth knowing

- **Why the redirect is limited to the workspace's own domain.** The design says so; it also means a
  submit cannot be turned into an open redirect. A client's marketing site on another host is a later,
  explicit allow-list (item 5).
- **Why an unticked box records nothing.** Absence of a tick is not a withdrawal; writing one would erase
  an earlier yes given elsewhere.
- **Why a form never edits an existing contact.** An anonymous post must not be able to rewrite a
  customer's name, phone or company.
- **Why submissions fail with "try again later" if the consent ledger is missing.** A consent that cannot
  be written must not be silently dropped.
- **Surfaces deliberately skipped in the shell** (reasons in the commit and final report): field registry
  and custom fields, Data Workbench, v1 API and MCP, global search, palette entry, Nova timeline,
  analytics tile and report metric, saved queries. A form is a configuration document edited in the
  builder, not a record people look up by name or report on yet.
