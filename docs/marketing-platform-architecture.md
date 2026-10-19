# Marketing Platform — integrated architecture v0.1 (2026-10-19)

> **Status: design only, nothing built, no SQL written.** Written for the
> owner to validate before any code. The interactive mock-up of the two
> screens that matter most (the journey builder and the lead view) is
> `docs/design/marketing-automation-mockup.html` — open it; it is the visual
> and behavioural spec, works at 375 px, in both colour modes, with GCC
> industrial sample data labelled as sample.
>
> **Read first, every time:** `bpmsquarecore.md` (§1 extension boundary,
> §3 record identity, §3b new-object checklist — four new objects here, the
> whole list applies to each; §10 Nova doctrine; §10a the explainable-rating
> rule, which this design extends to every number it shows),
> `MULTI_TENANT_GUARDRAILS.md`, `docs/ui-restructure-spec.md` (screen
> contract), `docs/ai-vision.md` (the one AI discipline), and the two plans
> whose event model this design **reuses rather than duplicates**:
> `docs/sales-engine-architecture.md` §5 and `docs/nova-crew-architecture.md`
> §4 Piece A. The owner's words that govern every section: *"none of the
> processes should be standalone, everything correctly integrated"* and
> *"simple, plain words, one clear flow, details tucked away"*
> (`docs/estimator-architecture.md` §15).

---

## 0. What this is, and the siblings it binds together

Four marketing designs are being written at the same time. This one is the
**umbrella**: it defines the foundations the other three stand on and the
order in which all of them are built so that no phase ships an island.

| Design | File | Status when this was written | What it owns |
|---|---|---|---|
| **Newsletter Studio** | `docs/newsletter-studio-architecture.md` | **done** (its §12 names the integration with this platform; its §12.1 event names are adopted verbatim in §1.2 here) | multilingual email designs, templates, versions, brand kit, asset library, click links, `preferred_language`, the one email send path |
| **Signals** | `docs/signals-architecture.md` | **does not exist yet** | account-level intent and buying stage (6sense-style) |
| **Process Design Studio** | `docs/process-design-studio-architecture.md` | exists (v0.1) | AI fit analysis against a generated capability catalogue; the shared AI usage meter |
| **This document** | `docs/marketing-platform-architecture.md` | — | identity, event stream, consent, scoring framework, audiences, asset library, journeys, lead lifecycle and assignment, forms / pages / tracking / preference centre, WhatsApp, attribution, events |

Where a sibling does not exist yet (Signals), §1 states the foundations it
**must** use, so that whoever writes it starts from the same stream, the same
score shape and the same consent rules. Nothing below is optional for a
sibling; if a sibling needs something this document does not provide, the
foundation is extended here, not re-invented there.

### 0.1 What exists today (read 2026-10-19, `develop`)

| Piece | Where | Reality |
|---|---|---|
| Campaigns | `marketing_campaigns` (0040–0043), `/marketing`, `send/route.ts` | one subject, one body, audience = account types + include/exclude + manual emails + segment filters; status draft → sending → sent; every send through `resolveOutbound()`; one `email_log` row per recipient (`kind='campaign'`) |
| Audience rules | `src/lib/marketingSegmentation.ts` (`SEGMENT_FIELDS`, `matchesAllFilters`), `marketing_target_groups` (0042) | a field registry + a generic evaluator, already shared with **Coverage** (`segments` table in 0101 uses the same `filters`/`match` shape) |
| Consent | `accounts.marketing_opt_out` (0040) only | account-level, email-only, no record of when / how / which jurisdiction; nothing on contacts |
| Links | `marketingUnsubscribe.ts`, `campaignInterestLink.ts` | HMAC-signed, stateless, no login, no expiry, account-scoped |
| Leads | `leads` (`account_id`, `title`, `source` oem_referral/amc/direct/campaign, `source_campaign_id`, `status` new/inspecting/quoted/won/lost/converted, `created_at`) | no `contact_id`, no owner, no score, **no last-activity timestamp** (Nova Stream dropped "stale leads" for exactly that reason, `src/lib/nova/stream.ts`); `POST /api/leads/[id]/convert` → deal |
| Deals | `opportunities` (0120): `lead_id`, `source`, `source_campaign_id`, `contact_id`, `owner_id`, `team`, stages in `config.opportunity_stages` | attribution hooks already present on the object |
| Coverage | `teams`, `team_members`, `segments`, `coverages` (0101); `src/lib/coverage/resolve.ts` | owner / overlay / service per account, computed live; `applyAutoOwnership()` writes `accounts.owner_user_id` = the owning team's **lead** (no round-robin exists) |
| Account 360 | `src/lib/account360/*` | explainable rubric rating (5 factors, 100 points), `BUILTIN_CARD_IDS` = pipeline, revenue, service, people, installed_base, coverage |
| Engagement log | `engagement_events` (0087) | **one kind only** (`silence_save`, a rep's action). Not a person-engagement stream. |
| Event bus / rules | planned in `sales-engine-architecture.md` §5 (`src/lib/events/*`, `automation_rules`, 0118) and `nova-crew-architecture.md` Piece A (`domain_event`) | **neither is built** — `src/lib/events` does not exist; migration 0118 is quote PDF options; no `automation_rules`, `quote_link_events` or `approval_policies` table exists |
| Change feed / webhooks | `change_log` (0050) → `GET /api/v1/changes` → `webhooks` (0082) + `/api/webhooks/cron` | external push of record changes, HMAC-signed, cursor-based |
| Nova | `record_comments` (0089), inbox `LABEL`/`TABLE`, comments `OBJECTS`, `NovaTimelineSlot`, ⌘K `CREATE_ACTIONS`, Nova Stream with explainable scores | the in-app notification and timeline fabric |
| Status engine | `src/lib/statusEngine.ts` (0070) | two-layer system/custom statuses with transition rules; `leads` is **not** an entity type yet |
| Outbound mail | `resolveOutbound()` (`emailOutputRules.ts`) | demo workspaces are redirect-only, always |
| Email engagement | nothing | no opens, no clicks (Newsletter Studio adds signed click links), no bounce or complaint webhook |
| Web / forms / WhatsApp | nothing | WhatsApp appears only as a `wa.me` share of a quote link |
| Scheduling | `vercel.json` crons (ten of them, some `*/5`) | the `webhooks/cron` comment about a Hobby-plan daily limit is stale; confirm the plan before adding the journey runner (§11) |

What the owner will say is missing, in his words: campaigns are one-shot;
nothing happens *because* someone opened, clicked, asked, bought or went
quiet; a lead is a title on an account with no number and no owner; consent
is a tick box on an account; and nothing marketing does shows up in Sales,
Service or Finance.

---

## 1. Shared foundations — the six things every marketing feature uses

These are built **once**, in phase M0 (§12), before any screen. Each is a
pure library plus a table, unit-tested, with no feature of its own. Every
sibling design calls them; none re-implements them.

### 1.1 One identity model

| Who | Record | Rule |
|---|---|---|
| A company | `accounts` | as today. Gains nothing new here except what Signals adds (`buying_stage`, `intent_score`, §1.4). |
| A person | `contacts` | **the person is always a contact.** Engagement is recorded against the contact and rolled up to the account. Gains `email_hash` (§1.1.1), `preferred_language` (Newsletter Studio §2.3), `do_not_contact boolean` (hard stop, every channel, set by a person or a rep, never by a rule). |
| An interest being worked | `leads` | "this person at this company is worth a salesperson's time now." Gains `contact_id uuid null` (the person, when known), `owner_user_id`, `score int`, `score_factors jsonb`, `scored_at`, `lifecycle` via the status engine (§4.2), `sla_due_at`, `last_activity_at`, `custom_data` (if absent today). A lead without a contact is still allowed (Vikas's OEM-referral leads are company-level); scoring then uses the account's people. |
| Someone we do not know yet | `visitors` (new) | a first-party cookie id, created **only after consent** (§5.3). Holds nothing personal: `id`, `tenant_id`, `first_seen`, `last_seen`, `pages int`, `identified_contact_id null`. |

**Merging, in one direction only (anonymous → known):**
- A form submit with an email: look up `contacts.email_hash` for this tenant
  → existing contact, or create account (`type: prospect`, name from the
  company field or the email domain) + contact. The visitor row (if any)
  gets `identified_contact_id`; its page views are re-attributed to the
  contact as `web.page_viewed` events and the visitor stops being counted.
- A click on an email link carries the signed recipient id (Newsletter
  Studio §7 click route) → the landing site's tracking snippet reads `?bq=`
  once, so the visitor is identified without any form.
- Never the other way: a contact is never turned back into a visitor; a
  visitor with no consent cookie is never created at all.
- Duplicates of a *contact* (same email, two accounts) are not auto-merged:
  the form picks the most recently active, and the rep sees "also at Acme"
  on the lead. A merge tool is a later, separate piece.

#### 1.1.1 Why `email_hash` is required, not optional
Contact emails are encrypted at rest with AES-256-GCM and a **random IV per
call** (`src/lib/encryption.ts`, `changeLog.ts` header). Two encryptions of
the same address differ, so no query can find a contact by email. Forms,
the preference centre, bounce webhooks and WhatsApp replies all need exactly
that lookup. So: `contacts.email_hash text` = HMAC-SHA256 over the
lower-cased, trimmed address with a server-only key (`FIELD_ENCRYPTION_KEY`
derived, never the raw key), back-filled once by a script like
`scripts/encrypt-existing-pii.mjs`, maintained by every contact write path
(`encrypt()` callers), unique per `(tenant_id, email_hash)` **not**
enforced (duplicates exist in real data; the form rule above handles them).
Same for `phone_hash` when WhatsApp arrives (§7.1). The hash is a blind
index: it reveals nothing without the key and is never exported or shown.

### 1.2 One engagement / event stream — `domain_event`

This is **Piece A** of `nova-crew-architecture.md` and §5.1 of
`sales-engine-architecture.md`, built once. The marketing platform is its
first production consumer; the three initiatives share the table, the
emitter and the catalogue, and nothing else couples them.

```
domain_event
  id, tenant_id, name (text: "<object>.<verb>"), object_type, object_id,
  actor_id (user, nullable), source (app | public_link | tracker | provider_webhook | runner | api),
  -- WHO it is about, so scoring can aggregate per person and per company:
  contact_id null, account_id null, lead_id null, visitor_id null,
  payload jsonb, depth int default 0, created_at, processed_at
```

- RLS: tenant-scoped **select only**; writes only through
  `emitEvent(tenantId, ev)` on the admin client from server code (the
  WFM lesson in the guardrails: an event stream that drives scores and
  automations is something a member must not be able to forge).
- Indexes `(tenant_id, created_at, id)` for the dispatcher cursor,
  `(tenant_id, contact_id, created_at desc)` and `(tenant_id, account_id,
  created_at desc)` for scoring, partial on `processed_at is null`.
- Retention: `payload` trimmed to a summary after 180 days, rows kept 24
  months (attribution needs them), both by a cron, cap per
  `config.marketing.retention_months`.
- `depth` is the loop guard from the Sales Engine §5.2: an action run by a
  rule or a journey emits with `depth + 1`; consumers ignore `depth > 2`.

**The catalogue** (`src/lib/events/catalog.ts`, string constants, one place).
Existing/planned names are kept exactly; marketing adds its rows.

| Module | Events | Emitted by |
|---|---|---|
| Sales (planned, §5.1 Sales Engine) | `opportunity.created / stage_changed / updated / closed`, `quote.created / updated / priced / sent / revised / status_changed / outcome_changed`, `quote.opened / accepted / change_requested` | quote and deal routes, public quote link |
| Quotes via Standard Quotes and Quotations alike | same names, `object_type = quote \| standard_quote` | both objects |
| Pricing / RFQ | `pricing.version_published`, `pricing.rfq_replied`, `rfq.sent / replied / awarded` | pricing and RFQ routes |
| Service | `case.created / status_changed / closed`, `contract.expiring` (90/30 days, by cron), `contract.renewed`, `work_order.completed` | case/AMC/WO routes + one cron |
| Finance | `invoice.sent / paid / overdue` (overdue by cron) | invoice routes + cron |
| Newsletter Studio (names fixed by that design, §12.1 there) | `newsletter.created / updated / archived`, `newsletter.language_ready`, `newsletter.version_created` | the studio's save routes |
| Email (names fixed by the Studio, §12.1 there) | `email.sent / failed / skipped / delivered / bounced / complained / opened / clicked / interest / unsubscribed` | send route, Resend webhook `/api/webhooks/resend` (Svix-verified), opens pixel (only when `track_opens`), the signed click route, the interest page, the unsubscribe page |
| Forms / web | `form.submitted`, `web.page_viewed`, `web.identified` | public form route, tracker route |
| WhatsApp (later) | `whatsapp.sent / delivered / read / replied / opted_out` | provider webhook |
| Marketing objects | `campaign.sent`, `lead.created / scored / stage_changed / assigned / sla_breached`, `journey.entered / exited`, `consent.granted / withdrawn`, `event.registered / attended / no_show` | marketing routes and the runner |
| Signals (sibling) | `signal.detected`, `account.buying_stage_changed` | the Signals engine, on this same table |
| WFM | `wfm.leave_requested`, `wfm.ot_requested` (planned) | later; no marketing use |

**Common fields on every row** (the Studio's §12.1 list, adopted as the
platform's): `tenant_id`, the person (`contact_id` and/or `account_id`, or
`email_hash` for a manual-email recipient who is not a contact),
`campaign_id`, `newsletter_id`, `newsletter_version_id`, `lang`, `topic`,
`occurred_at` (when it happened, distinct from `created_at` = when it was
recorded, since provider webhooks arrive late). Language on every email
event is what makes "Arabic readers click more" one query.

**Rule:** an action a person is told about ("3 people from Gulf Precast read
the pricing page") must be reconstructible from rows in this table. No
feature keeps a private copy of "what happened". `email_log` stays the
operational per-message log; the stream is the person-centred view, written
only through `emitEvent()`.

### 1.3 One consent and preference model

Consent is a **ledger**, not a flag. `accounts.marketing_opt_out` stays as a
legacy mirror (written whenever a withdrawal covers every channel for every
contact of the account, so today's campaign code keeps working during the
transition) and is retired from the UI in phase M4.

```
consent_events  (append-only; select-only RLS; writes via routes only)
  id, tenant_id, contact_id (or account_id for company-level legacy rows), visitor_id null,
  channel  (email | whatsapp | sms | phone | web_tracking),
  topic    (null = all topics | a key from config.marketing.topics),
  status   (granted | withdrawn),
  basis    (consent | existing_customer | contract | legitimate_interest),
  jurisdiction (SA | AE | QA | KW | OM | BH | IN | EU | other; derived from the account's country, overridable),
  source   (form | preference_centre | unsubscribe_link | import | rep | api | provider_webhook),
  evidence jsonb (form id and the exact consent text shown, ip_hash, user agent family, double-opt-in token, rep user id),
  created_at
consent_state   (a materialised current-state view or table maintained by the writer:
  tenant_id, contact_id, channel, topic → status, since, basis)
suppressions    (tenant_id, channel, address_hash, reason bounced_hard | complained | invalid | manual, created_at)
```

**The one function:** `canContact(tenantId, contact, channel, topic) →
{ ok, reason }` in `src/lib/marketing/consent.ts`, pure over
`consent_state` + `suppressions` + `contacts.do_not_contact` + the
jurisdiction rules below. Every sender calls it **at the moment of
sending** (a journey checks at the send step, never only at entry). The
campaign send route, the journey runner, the WhatsApp sender and the Growth
agent (Nova Crew Piece H) all call this and nothing else.

Jurisdiction rules (`src/lib/marketing/jurisdictions.ts`, data not code,
reviewed by a lawyer before go-live — open question 3):

| Jurisdiction | Marketing email to a new contact | Existing customer | Withdrawal | Tracking cookies |
|---|---|---|---|---|
| Saudi PDPL | opt-in required; purpose stated | allowed for similar products **with** easy opt-out in every message | honoured immediately, one click | consent before non-essential |
| UAE / Qatar / others GCC | opt-in default; existing-customer basis allowed where the tenant's counsel confirms | same | immediate | consent |
| India DPDP | notice + consent; withdrawal as easy as giving | existing-customer basis **not** assumed | immediate | consent |
| EU GDPR | opt-in (double opt-in recommended); soft opt-in for existing customers of similar goods | soft opt-in | immediate; `List-Unsubscribe` header | consent, no pre-ticked boxes |

The product does not decide the law; it records the basis it was given and
refuses to send when the basis for that jurisdiction is missing. A tenant
chooses its default basis per jurisdiction in Settings → Marketing →
Consent, with the plain sentence the law requires shown beside the choice.

**Preference centre** (§5.5) is the person's own view of this ledger.

### 1.4 One scoring framework — three questions, three numbers, one shape

The owner's §10a doctrine (a number a person acts on is explainable, stable
and never an AI output) already governs the Account 360 rating and the
Sales Engine's win rating. This design adds the lead score and defines how
Signals' intent fits, so there are never three competing numbers for the
same question.

| Number | Question it answers | Object | Built by | Shown on |
|---|---|---|---|---|
| **Account health** (exists) | *How is our relationship with this customer?* | account | `account360/rating.ts` | Account 360 |
| **Lead score** (this doc, §4.1) | *Is this person interested and worth a call now?* | lead (contact + account) | `src/lib/marketing/scoring.ts` | lead list, lead record, contact record, Nova inbox |
| **Buying stage / intent** (Signals, must follow this) | *Is this company in a buying cycle?* | account | `src/lib/signals/*` | account record, deal record, Account 360 card, Signals screen |
| Win rating (Sales Engine §7.1) | *Will this quote win?* | quote / deal | `sales/win/rating.ts` | Win tab |

Rules that keep them from competing:
1. **Same shape**: every engine returns `{ score: 0–100, label, factors:
   { label, points, detail }[] }` — `Account360Rating`'s shape, reused. The
   UI draws any of them with one component (`ScoreCard`), so a factor list
   is always one tap away from the number.
2. **Same input**: all of them read `domain_event` (plus master data). A
   click counts once, in one table, for every number that cares.
3. **One direction of influence**: account → person only. The buying
   stage may add *one* factor to a lead score ("company is in market,
   +15"); a lead score never feeds the buying stage; neither feeds
   account health. No sums, no averages across them.
4. **Deterministic, versioned**: the rubric lives in tenant config with a
   `version`; `score_factors` stores which version produced the number, so
   a rep's "why 72?" is answered with the rubric that was in force.
5. **AI may write the sentence, never the number** — same sentence as
   §10a, and the Process Design Studio's "model proposes, code decides".

### 1.5 One audience model

There is already one rule engine for "which accounts" —
`marketingSegmentation.ts` — used by campaigns (`marketing_target_groups`)
and by Coverage (`segments`). This design makes it the **only** audience
mechanism:

- `SEGMENT_FIELDS` gains the fields marketing needs, exactly as its header
  invites: `lead_score`, `lifecycle_stage`, `buying_stage`, `last_engaged_at`,
  `topic_consent:<topic>`, `preferred_language`, `in_journey:<id>`,
  `attended_event:<id>`, `has_open_quote`, `has_overdue_invoice`,
  `amc_expires_within_days`, `product_owned` (already there as
  `owned_product_skus`). Each new field has a documented loader in the
  server-side record builder, as the header requires.
- Person-level audiences: a target group gains `audience_level: account |
  contact` so a journey or newsletter can address *people* (a quote
  follow-up goes to the contact on the quote, not "one email per account").
  `resolveMarketingRecipients` grows the contact branch; the account branch
  is unchanged for Vikas.
- `marketing_target_groups` and Coverage `segments` stay two tables (one is
  a marketing audience, the other an org-model rule with ownership
  consequences and select-only RLS), but the builder UI is one component,
  and a journey can enter "everyone in Coverage segment HOSPITALS" directly.
- Audience preview counts (today's `recipients-preview` route) are reused by
  journeys ("Who would enter right now: 47 people"), forms and events.

### 1.6 One asset library

| Asset | Owner design | Used by |
|---|---|---|
| Email design + languages + versions | Newsletter Studio (`newsletters`, `newsletter_versions`) | campaigns, journey "Send email" step (always a **version** id, so a running journey never changes under its feet), event invitations, preference-centre confirmation mails |
| Brand kit | Newsletter Studio (`config.brand_kit`) | every rendered thing: emails, forms, landing pages, preference centre, event pages |
| Form | this design (§5.1) | landing pages, embedded on the client's site, event registration, newsletter "Interested?" (replaces the one-click interest link with an optional short form) |
| Landing page | this design (§5.2), rendered by the Newsletter Studio renderer with a web target | journeys, events, campaigns' "view in browser" |
| WhatsApp template | this design (§7.1), provider-approved | journey "Send WhatsApp" step |
| Text templates (exist, Settings → Sales) | existing | task titles and notify bodies in journeys |

Images are `asset_id`s from the Studio's shared library (its §3 / §12.4),
reused by forms and landing pages, with the library showing "used in: …".
One picker component, `AssetPicker(kind)`, everywhere an asset is chosen.

---

## 2. Integration points — the map (event in, action out, owner module)

> This section is the contract that makes "nothing standalone" true. Every
> row names the event that arrives on the shared stream, what marketing does
> with it (or what the other module does with marketing's event), and which
> module owns the code. A row with no owner is a defect.

### 2.1 Sales

| Touchpoint | Event in | Action out | Owner |
|---|---|---|---|
| Lead → deal | `lead.stage_changed` to *Deal* (rep presses "→ Deal", today's convert route) | `opportunities` row with `lead_id`, `contact_id`, `source`, `source_campaign_id` copied (columns exist) | Sales (convert route), Marketing emits the event |
| Score threshold → rep | `lead.scored` crossing *Ready for sales* | lead assigned (§4.3), `record_comments` kind `task` "Call <name> — <top 2 factors>" on the lead, Nova inbox row, optional email via `resolveOutbound` | Marketing |
| Assignment | `lead.stage_changed` to *Ready for sales* | `resolveCoverageForAccount()` → team → member by the team's `assignment_mode` (§4.3) → `leads.owner_user_id`; `lead.assigned` | Marketing calls Coverage |
| Quote follow-up | `quote.sent` then no `quote.opened` in N days | journey step: reminder email / WhatsApp to the quote's contact, then a task for the quote's `created_by` or the account owner | Marketing journey, template seeded per tenant |
| Deal stalled | `opportunity.stage_changed` + days in stage (from `stage_since`) | journey or rule: nudge the owner; optional "still deciding?" email | Sales rule (§5.2 Sales Engine) or marketing journey — same action registry |
| Win / loss | `quote.outcome_changed`, `opportunity.closed` | lead → *Customer* / *Not now*; attribution touch closes (§8); re-engagement journey eligibility | Marketing |
| Pipeline board | — | a small "from campaign <name>" chip and the buying stage on a deal card (read-only) | Sales UI reads marketing columns |
| Win tab (Sales Engine §7) | — | the "Customer signals" card reads `domain_event` for `quote.opened`, `email.clicked`, `web.page_viewed` of the deal's contacts — the planned `quote_link_events` table is **replaced** by `domain_event` rows (one table, not two) | Sales reads the stream |

### 2.2 Service

| Touchpoint | Event in | Action out | Owner |
|---|---|---|---|
| AMC renewal | `contract.expiring` (90/30 days) | journey: renewal email in the contact's language → if no reply, task for the service owner (Coverage `service` role) | Marketing journey; Service emits |
| New case for a prospect-stage account | `case.created` | lead score factor "has a service relationship" (small, profile) | Scoring |
| Case closed | `case.closed` | optional satisfaction form (§5.1) by email after 2 days, only with consent; the answer is `form.submitted` with `topic: satisfaction` and feeds **account health** as a later factor, never the lead score | Marketing form, Service reads |
| Suppress while in trouble | open case > 30 days or an overdue invoice | journeys with `pause_when_account_in_trouble` (default on) skip promotional sends for that account | Runner rule |
| Work order completed | `work_order.completed` | cross-sell journey eligibility (e.g. spare parts), through the audience rule `product_owned` | Marketing |

### 2.3 Finance (invoices)

| Touchpoint | Event in | Action out | Owner |
|---|---|---|---|
| Attribution | `invoice.paid` | the touch chain closes with revenue (§8): campaign → lead → deal → quote → invoice | Marketing attribution job; Finance emits |
| Overdue | `invoice.overdue` | promotional sends paused for the account (above); a *dunning* journey is **not** marketing — it is a Finance rule using the same engine, with transactional basis, no consent gate | Finance rule |
| Customer stage | first `invoice.paid` for an account | every lead of that account → *Customer* | Marketing |

### 2.4 Pricing, Quotes, RFQ

| Touchpoint | Event in | Action out | Owner |
|---|---|---|---|
| Quote opened via public link | `quote.opened` (Sales Engine §6.2) | +points on the lead score (behaviour), buying-stage input for Signals | Scoring / Signals |
| Quote accepted / change requested | `quote.accepted`, `quote.change_requested` | journey exit ("they answered"); lead → *Deal* | Marketing |
| Price book published | `pricing.version_published` | audience "customers who bought X" can be told about a new price list — a campaign, not an automation (owner decides manually) | Marketing campaign |
| RFQ | `rfq.replied`, `rfq.awarded` | supplier-side; **no marketing use**, stated | — |

### 2.5 Workforce (WFM)

No touchpoint. Attendance and payroll data never enter marketing audiences
or scores, and no journey can read a WFM table. Stated so it is not
re-asked. (Technicians as *people who know the customer* appear in the Sales
Engine's "who knows the customer" card, which is Sales, not marketing.)

### 2.6 Nova

| Surface | What marketing adds | Mechanism |
|---|---|---|
| Timeline | every `domain_event` about the record's contacts renders as a quiet grey line ("Opened *Spring price list* · 2 days ago"); `NovaTimelineSlot` on lead, journey, form, event records | `record_comments` kind `system` rows are **not** duplicated for every event — the timeline reads `domain_event` by `account_id`/`contact_id` directly, paged |
| Inbox | "Ready for sales" section (leads assigned to me, SLA countdown), "Needs a decision" (journey waiting for a human step), mentions on marketing objects | `api/nova/inbox` gains the two sections; `LABEL`/`TABLE`/`ROUTE_FOR` entries for `leads`, `journeys`, `forms`, `marketing_events` |
| ⌘K | "New journey", "New form", "New event", "Score this lead now" | `CREATE_ACTIONS`, feature-gated on `marketing` |
| Nova Stream | a `lead_ready` item kind with the explainable score (same pattern as `quote_pending`) | `src/lib/nova/stream.ts` |
| Nova Crew Growth agent (Piece H) | reads the same `canContact()`, the same journeys as *draft* proposals; never sends outside the runner | Nova Crew, later |
| Paste-to-draft | pasting a trade-show badge scan / email signature → drafted contact + lead with `source: event` | existing `api/nova/draft`, one more object |

### 2.7 Account 360

A new built-in card **`marketing`** per §10a: added to `BUILTIN_CARD_IDS`
(`account360/server.ts`), `BUILTINS` (`Account360Client.tsx`) and
`CARD_IDS` (`api/settings/account-360/route.ts`). Stats: buying stage (from
Signals, "—" until it exists), people engaged in 30 days, open leads with
best score, journeys running; rows: last five touches with links. The
rating itself is unchanged (§1.4 rule 3).

### 2.8 v1 API, webhooks, MCP

| Surface | Addition |
|---|---|
| `GET /api/v1/leads[/id]` (today only via `/ask`) | fields incl. `score`, `lifecycle`, `owner`, `source_campaign`; `EXPLICIT_SCOPE_ONLY` (personal data) |
| `GET /api/v1/journeys`, `/forms`, `/marketing-events`, `/consents?contact_id=` | read; `EXPLICIT_SCOPE_ONLY` for consents |
| `POST /api/v1/events` | lets an external system (a webinar tool, Hubilo, a web shop) **push an engagement event** into the stream — the integration point PROJECT.md §12's "Hubilo / LinkedIn / webinar" items need. Catalogue-validated name, tenant from the bearer, `source: api` |
| `POST /api/v1/consents` | import consent with evidence (basis + source required) |
| Change feed / webhooks | every marketing object logs `logChange`, so `/api/v1/changes` and `webhooks` carry them for free; additionally `webhooks.object_types` accepts `domain_event` so a tenant can subscribe to engagement events, not only record changes |
| `/api/v1` index, `SCOPABLE_OBJECTS`, Settings endpoint table, `UNDOCUMENTED_ENDPOINTS` / `API_ENTITIES`, `OBJECT_FEATURE` | per §3b, every object |
| MCP | `list_leads`, `get_lead`, `list_journeys`, `get_journey`, `list_forms`, `record_event` (the push above); version bump |

### 2.9 Data Workbench

| Object | Import | Export | Update |
|---|---|---|---|
| Leads | yes (resolve `account_name`, `contact_email` by hash) | yes, with score and stage | yes, by `id` |
| Consents | yes — the **main migration path** from a spreadsheet of opt-ins; requires `basis`, `source: import`, `evidence.file_name` | yes | no (append-only; stated in `DataWorkbenchClient.tsx`) |
| Journeys, forms | no import (a definition is a document, like RFQ); export + update of header rows by `id` | | |
| Marketing events + registrations | registrations import (badge scans), export | | |

### 2.10 Analytics and reports

`AnalyticsMetricId` + dashboard tiles + `METRIC_META`: *Leads ready for
sales*, *Journey sends this month*, *Revenue from campaigns (attributed)*,
*Consent coverage* (% of contacts with a valid email basis). A tile that
counts journeys or forms is skipped (not a number anyone acts on; stated).

### 2.11 Process Design Studio and Signals

- The Process Design Studio's capability catalogue is generated from
  `TenantFeatures`, `NAV`, `FIELD_REGISTRY`, `LIST_SOURCES`, etc. Every
  object here walks §3b, so it appears in the catalogue the day it ships;
  `docs/capabilities/marketing.md` (the hand-written `plain` file that
  design requires) is part of each phase's deliverable.
- Signals writes `signal.detected` and `account.buying_stage_changed` to
  `domain_event`, stores its score in the §1.4 shape, reads consent for any
  outbound it proposes, and uses `SEGMENT_FIELDS.buying_stage` for
  audiences. It owns `accounts.buying_stage` / `intent_score` columns.

---

## 3. The automation engine — one engine, two faces

The Sales Engine (§5.2–5.3) specifies an **immediate rule**: *when event,
if condition, then actions*, run synchronously inside the request that
emitted the event. Marketing needs the same thing **spread over time**:
waits, branches, people entering and leaving. These are not two engines.
A journey is a rule with state; both share the catalogue, the condition
evaluator and the action registry. Rules stay as specified there; this
section adds what a journey needs and nothing the rule does not already
provide is duplicated.

### 3.1 Journey model (what a person builds)

A journey is a short list of plain-language steps — the mock-up is the
spec. The stored definition (`journeys.definition jsonb`, closed union
validated by `sanitizeJourney()` on every write, same discipline as
`sanitizeStandardQuoteBlocks`):

```
{
  version: 2,
  audience: "contact" | "account" | "lead",
  trigger:  { kind: "event", name: "quote.sent", filter?: Condition }
          | { kind: "segment_enter", target_group_id }
          | { kind: "schedule", every: "day", at: "09:00", audience_rule }
          | { kind: "manual" },
  entry:    { reentry: "never" | "after_days" | "always", after_days?: 90,
              one_per_account?: boolean, pause_when_account_in_trouble: true },
  steps: [
    { id, kind: "wait",   for: { days: 3 } | { until_event: "quote.opened", max_days: 3 } },
    { id, kind: "branch", if: Condition, yes: [steps], no: [steps] },
    { id, kind: "action", action: Action },
    { id, kind: "end",    reason?: "answered" }
  ]
}
```

`Condition` is **not** typed by the user. The builder offers plain choices
("the quote was opened", "the person clicked any link", "lead score is at
least 60", "account is in Coverage segment HOSPITALS", "consent for
Offers") that compile to the Sales Engine's DSL expression over
`flattenContext(payload + subject)`. The compiled text is visible under
"Details" for the owner's IT team; a hand-typed DSL is allowed there only
for admins.

**Actions** = the Sales Engine registry (`set_field`, `set_stage`,
`notify`, `create_task`, `add_comment`, `webhook`, `start_approval`,
`create_revision`) **plus** the marketing rows, added to the same
`src/lib/events/actions.ts`:

| action | params | effect |
|---|---|---|
| `send_newsletter` | `newsletter_id`, `languages[]`, `fallback_language`, `topic` | exactly the Studio's §12.2: at run time it creates a campaign for the run's current person set, takes a version if the design has none for its content, and goes through the Studio's one send branch — `canContact()` for the topic and channel, the contact's language rule, `resolveOutbound()` always, `email_log` kind `journey`, the Studio emits `email.sent` / `failed` / `skipped`. Extra merge tokens the journey knows (the triggering quote ref, the product clicked, the owner's name) are passed to the renderer and validated against its allowlist. One send path, whether a person pressed Send or a journey did. |
| `send_whatsapp` | `template_id`, variables | §7.1; same gates |
| `add_to_segment` / `remove_from_segment` | `target_group_id` | pins/unpins the account or contact on the group's explicit lists |
| `create_lead` | `title`, `source` | if no open lead for this contact/account; emits `lead.created` |
| `set_lifecycle` | `stage` | through the status engine (validated transition) |
| `assign_owner` | `mode: coverage \| user \| team_round_robin` | §4.3 |
| `create_deal` | `title`, `stage` | the convert route's helper, never a raw insert |
| `notify_rep` | `who: owner \| team \| user`, `text` | the Sales Engine `notify` with `owner` resolved as the lead's / account's owner |
| `wait_for_human` | `ask`, `who` | the run parks until someone presses Continue / Stop in the inbox (the human-in-the-loop step; same shape as Nova Crew's approval gate) |

No scripting, no arbitrary SQL, no loops — the Sales Engine's sentence,
unchanged.

### 3.2 Safety — the rules that run before every send

| Rule | Where | Default |
|---|---|---|
| Consent and suppression | `canContact()` at the **send step** | always on, not configurable |
| Re-entry | `entry.reentry` + an index on `journey_runs (journey_id, subject)` | never |
| One per account | `entry.one_per_account` | on for `audience: contact` journeys (two people at Gulf Precast do not both get the reminder) |
| Frequency cap | `config.marketing.caps`: max promotional emails per contact per 7 days (default 2), WhatsApp per 7 days (default 1); the runner defers the step to the next allowed day | on |
| Quiet hours and days | tenant timezone via `tenantClock.ts`; `config.marketing.quiet`: no sends 20:00–08:00 local, none on the tenant's weekly off days (Friday for most GCC tenants); the step is deferred, never skipped | on |
| Account in trouble | §2.2: open case > 30 days or an overdue invoice → promotional steps deferred; transactional (`basis: contract`) steps still go | on |
| Demo workspace | `resolveOutbound()` redirect for email; WhatsApp on a demo tenant goes to `config.whatsapp.redirect_number` or is logged as `dry_run` — **never** to the real number | forced |
| Kill switch | `journeys.status = paused` checked before every step (runs keep queueing, as Nova Crew's NFR-06) ; a tenant-wide `config.marketing.paused` for incidents | — |
| Loop guard | events emitted by actions carry `depth + 1`; a journey ignores its own events; no journey may be the trigger of itself | always |
| Blast radius | a journey whose *first* run would enter more than `config.marketing.max_entry_per_tick` (default 500) subjects asks for confirmation when turned on | on |

### 3.3 Execution

- **Runner**: `GET /api/marketing/cron/journeys` every 5 minutes
  (`vercel.json`; `CRON_SECRET` bearer like `/api/webhooks/cron`;
  `maxDuration` set). Per tick: (1) read unprocessed `domain_event` rows
  per tenant from a stored cursor (`journey_cursors`), match live journeys'
  triggers, create `journey_runs`; (2) take `journey_runs` with
  `next_due_at <= now()` in batches of 200 per tenant, run **one step per
  run per tick**, write a `journey_run_steps` row, set the next due time.
  Hard caps that *throw* (performance doc R4), never an unbounded loop.
- **Idempotency**: `journey_run_steps (run_id, step_id, attempt)` unique;
  an email send stores the `email_log` id on the step row before marking
  it done, and a step that already has a log row is not re-sent on retry.
- **Failures**: three attempts with back-off, then the run is `stalled`
  with the error on the step row; the journey record shows "3 people are
  stuck at *Send WhatsApp* — provider error" and a Retry button.
- **Audit**: every step row is append-only; `logChange` on journey
  definition edits; every send is an `email_log` / `whatsapp_messages`
  row; every emitted event is in `domain_event`. Nothing happens that is
  not in one of these four places.
- **Immediate rules** (Sales Engine) keep running in-request; a journey
  trigger on the same event is picked up by the runner within 5 minutes.
  The builder shows "runs within 5 minutes" plainly, never promises
  real-time.
- **Live edits**: a running journey is edited as a new **version**; runs
  already inside continue on the version they entered; new entries use the
  new one. "Move everyone to the new version" is an explicit button with a
  count.

### 3.4 Testing a journey before turning it on

Three things on the builder page, no separate screen:
1. **Who would enter right now** — a count and the first 20 names,
   computed with the audience preview route (§1.5), with the per-subject
   reason ("quote SQ-2026-0042 sent 4 days ago, not opened").
2. **Try it on one person** — pick a contact; the runner executes the
   journey in `simulate: true` mode in-request: every send step renders
   the email (shown inline) and records a step row flagged `simulated`;
   waits are collapsed; branches show which side would be taken and why.
   Nothing is sent, no event emitted. The path appears as a vertical trace
   beside the steps (mock-up).
3. **Send test to me** — one real render to the current user's address
   through `resolveOutbound()` (so on a demo tenant it still lands in the
   redirect inbox, stamped).

---

## 4. Lead scoring, lifecycle and assignment

### 4.1 Score

`src/lib/marketing/scoring.ts`, pure, unit-tested, `computeLeadScore(rubric,
events, profile, buyingStage) → { score, label, factors }`.

- **Behaviour** points from the last 90 days of `domain_event` rows for the
  lead's contact (and, if no contact, all contacts of the account), each
  rule `{ event, points, half_life_days, max_per_week }`. Decay is applied
  per event by age: `points × 0.5^(age / half_life)`. Default rubric:
  `email.clicked` 10 (14 d; a product-card click carries its `product_id`
  so the factor can say which product), `email.interest` 30 (30 d),
  `quote.opened` 20 (14 d), `web.page_viewed` on a buying-interest path 15
  (7 d) else 2 (7 d), `form.submitted` 30 (30 d), `whatsapp.replied` 25
  (14 d), `event.attended` 40 (60 d), `email.opened` 1 (7 d, **weak**,
  Apple MPP), `email.unsubscribed` −40 (no decay), `email.bounced` → no
  points and the email channel suppressed.
- **Profile** points, no decay, from audience rules: `{ rule: SegmentFilter[],
  points }` — e.g. industry in the tenant's target list +15, account type
  OEM +10, country in GCC +5, contact role contains "procurement" or
  "manager" +10, account has an AMC +5.
- **Company in market** (Signals): `+ buying_stage_points[stage]` (0–15),
  the one cross-score factor (§1.4 rule 3).
- Score = clamp(Σ, 0, 100). Labels at thresholds (config): **New** < 20,
  **Engaged** 20–59, **Ready for sales** ≥ 60; a *negative* behaviour
  factor is listed first in the explanation.
- **Recomputed, not incremented**: the runner re-scores every lead whose
  contact or account had an event since `scored_at`, plus a nightly pass
  for decay. Stored on the lead with `score_factors` and the rubric
  version. A contact with **no lead** whose computed score would cross
  *Engaged* gets a lead created automatically (`source: inbound`,
  `lead.created`) — this is where "a lead appears when a person shows real
  interest" comes from.
- `lead.scored` is emitted only when the label changes or the score moves
  ≥ 10 points, so the stream is not flooded.

### 4.2 Lifecycle (stages in plain words)

Leads move onto the **status engine** (`StatusEntityType` gains `leads`;
system statuses seeded, tenant-renameable like every other object):

| System status | Shown as | Entered by |
|---|---|---|
| `new` | New | created (any source) |
| `engaged` | Engaged | score ≥ Engaged threshold |
| `ready` | Ready for sales | score ≥ Ready threshold **or** a rep marks it |
| `working` | Working | the assigned rep presses Accept (SLA stops) |
| `deal` | Deal | convert route (unchanged) |
| `customer` | Customer | first paid invoice for the account |
| `not_now` | Not now | rep; auto-recycles to *Engaged* if a new event arrives after `recycle_after_days` (default 90) |
| `not_fit` | Not a fit | rep; terminal, excluded from auto-creation for 12 months |

Mapping from today's values at migration: `new → new`, `inspecting`,
`quoted → working`, `converted → deal`, `won → customer`, `lost →
not_now`. Vikas uses the lead list; the visual-parity rule applies (memory:
client familiarity) — the list keeps its columns and gains score and stage
only after the owner confirms (open question 2).

**Service levels**: `config.marketing.lifecycle.sla`: *Ready → Working*
within 1 business day (default), *Working → first activity* within 3.
`sla_due_at` is set on entry; the runner emits `lead.sla_breached` →
inbox row for the rep **and** the team lead, and a rule may reassign.
SLA clocks use the tenant's working days (WFM weekly-off days when WFM is
on, else Friday–Saturday for GCC, Sunday for India — config).

### 4.3 Assignment via Coverage

When a lead becomes *Ready* (or on creation, if `assign_on: created`):
1. `resolveCoverageForAccount(tenantId, account)` → the winning **owner**
   team (priority rule as today).
2. The team's new `assignment_mode` (`teams` column, Settings → Coverage):
   `lead` (the team lead — today's behaviour, default), `round_robin`
   (next member after `teams.last_assigned_user_id`, skipping members on
   leave when WFM knows it), `least_open` (fewest *Working* leads).
3. No Coverage, or no match: `config.marketing.assignment.fallback_user_ids`
   round-robin, else the tenant admin, with a visible "unassigned — no
   coverage matched" chip so the gap is seen, not hidden.
4. Written to `leads.owner_user_id`, `lead.assigned` emitted, `logChange`
   recorded; a rep may reassign by hand (logged as override).
5. The account's own `owner_user_id` is **not** changed by a lead
   assignment (ownership of the company stays with Coverage).

---

## 5. Forms, landing pages, web tracking, preference centre

### 5.1 Forms

A standard object `forms` (FRM-####, behind `marketing`):
- **Fields** chosen from `FIELD_REGISTRY` for contact and account (name,
  email, phone, company, country, role, …) plus the tenant's custom fields,
  plus free question fields (text, choice, rating) stored in
  `form_submissions.answers`. Labels per language (same language rows idea
  as the Newsletter Studio).
- **Consent block** — mandatory on any form that collects an email or
  phone: the channels and topics offered, the exact text (per language,
  from `config.marketing.consent_texts`, with a lawful default per
  jurisdiction), never pre-ticked. The submitted text is stored in
  `consent_events.evidence`.
- **On submit** (ordered, code not model): find or create contact + account
  (§1.1) → write consent rows → create or update the lead (`source: form`,
  `source_form_id`) → `form.submitted` event → the form's own actions
  (enter journey, add to group, notify owner, send a thank-you version,
  redirect URL on the tenant's own domain or a landing page).
- **Hosted** at `<tenant origin>/f/<formSlug>` (built with
  `tenantOrigin(custom_domain)`, never `PRIMARY_HOST`), **embedded** on the
  client's website by an `<iframe>` snippet (phase M4) or a `<script>` that
  renders inline (later; the iframe is enough to start and isolates CSS).
- **Abuse**: honeypot field, minimum time-to-submit, per-IP-hash rate limit,
  a per-form public key in the URL (not a tenant id), payload size cap,
  every text sanitised, nothing rendered as HTML. A CAPTCHA is deliberately
  not in v1 (friction on a prospect form; revisit on evidence).
- `form_submissions` keeps the raw answers 180 days (PII fields encrypted
  like contacts), then only the derived records remain.

### 5.2 Landing pages

A landing page is a Newsletter Studio design rendered for the web: the
same blocks, plus a **Form** block, rendered by `render.ts` with
`target: "web"` (responsive instead of 600 px tables, real fonts allowed).
`landing_pages` (LPG-####): `slug`, `newsletter_version_id`, `form_id null`,
`status`, `visits`. Served at `<tenant origin>/p/<slug>`. Phase M4; until
then a journey's call to action links to the tenant's own site.

### 5.3 Website tracking (consented, first-party, minimal)

- One script, `<tenant origin>/m.js` (≈2 KB, no third-party code), with the
  tenant's **public tracking key** (a separate column, revocable, not the
  API key). It does nothing until a consent cookie exists — set either by
  the tenant's own banner (`window.bqConsent = true`) or by the tiny banner
  the script offers if the page has none. Honours `Do Not Track` and
  `Sec-GPC`.
- After consent: a first-party `_bq` visitor cookie (13 months), page views
  sent to `POST /api/track` (`tenant from the key`, URL path + title only,
  **no** query string except the `?bq=` identify token, no referrer
  beyond its host, no IP stored — a 30-day-salted hash for abuse limits
  only, user-agent family only). Identified when `?bq=` is present (signed
  recipient token from an email click) or after a form submit on the page.
- Stored as `web.page_viewed` / `web.identified` events against the visitor
  or contact. **Pricing / product pages** matter for scoring: the tenant
  tags paths in Settings → Marketing → Tracking ("these paths mean buying
  interest") — a list, not a crawler.
- Not built: cross-site tracking, fingerprinting, session replay, third-party
  pixels. Stated so no one asks.

### 5.4 Email engagement, privacy-safe

| Signal | Source | Stored | Note |
|---|---|---|---|
| Sent / failed | send route | `email_log` + `email.sent` | exists for campaigns; journeys add kind `journey` |
| Clicked | Newsletter Studio signed click route (index into the version's link list) | `marketing_link_clicks` + `email.clicked` | the Studio writes the row; the platform emits the event from the same route |
| Opened | pixel, **only** when `config.marketing.track_opens` (default off, Studio §7) | `email.opened` | weak signal, 1 point, decays in a week |
| Delivered / bounced / complained | the Studio's `POST /api/webhooks/resend` (Svix-verified like the inbound-mail one; tenant resolved from the `email_log` row's id carried in the message tag, never from the body) | `suppressions` + `email.delivered` / `email.bounced` / `email.complained` | hard bounce → suppressed; complaint → withdrawn for all topics, email |
| Interested | the existing interest page's confirm | `email.interest` + the lead it creates | 30 behaviour points, the strongest email signal |
| Unsubscribed | the signed link, the preference centre, `List-Unsubscribe-Post` one-click | `consent_events` + `email.unsubscribed` | account-level legacy link keeps working and now also writes the ledger |

No per-recipient IP, no location, no device model. Aggregates (opens,
clicks per link per language) show on the campaign page as the Studio
already specifies; a contact's own timeline shows the plain fact.

### 5.5 Preference centre

`<tenant origin>/marketing/preferences/<contactId>/<token>` — signed like
the unsubscribe link (same `QUOTE_PUBLIC_LINK_SECRET` family, contact
scope, no expiry) and linked from every marketing email's footer beside
"Unsubscribe". One page in the brand kit, in the contact's language:
- Topics (from `config.marketing.topics`, e.g. *Offers*, *New products*,
  *Service reminders*, *Events*) with a switch each; channels (email,
  WhatsApp when on); preferred language; "Pause everything for 90 days";
  "Unsubscribe from all" (one tap, no confirmation screen, as the law
  prefers).
- **Re-subscribe**: on the same page, a granted topic after a withdrawal
  writes a new `granted` row with `source: preference_centre`; under GDPR
  jurisdiction it sends a double-opt-in confirmation first (a signed
  confirm link, 7-day expiry — the one signed link here that expires).
- Every change is a `consent_events` row with evidence (link token, user
  agent family, timestamp); the contact record's **Consent** card shows the
  current state and the history.

---

## 6. Screens (the `ui-restructure-spec.md` contract)

### 6.0 Platform-wide UX rule for every studio-type screen (owner, 2026-10-19, from the Newsletter Studio review)

Applies to the journey builder, the form builder, the event follow-up
builder, the scoring preview in Settings and every future studio — and, by
the owner's words, to every studio-type screen in the suite:

1. **Options left, studio right.** The layout of the Fence and Estimator
   screens (`src/app/(app)/estimates/[id]/EstimateScreen.tsx`,
   `.est-grid` in `globals.css`: `330px minmax(0,1fr)`, 14 px gap;
   `docs/estimator-reference/studio-mockup-v2.html`): the choices a person
   makes live in a left panel, the thing being built (the journey as
   sentences, the form, the page) is the canvas on the right and updates as
   the options change. **On a phone the panel collapses above the canvas**
   (under 900 px the grid becomes one column, the panel first, each panel
   section a closed disclosure with a one-line summary).
2. **Every option has a one-line hint** in plain words saying what it is
   for, under the control, always visible — not a tooltip, not an icon.
   ("Re-entry — whether the same person can go through this journey again
   later.")
3. **An optional "Show me how" walkthrough** — a button in the page header;
   starts closed; step by step with **Next / Back / Skip**; each step
   highlights one panel section or canvas element and says what to do
   there; progress is remembered per person in `localStorage` only; never
   auto-opens, never blocks the page.
4. **English is the default language; other languages are added on top.**
   Every studio writes English first; "+ Add language" adds a row (Arabic,
   Hindi, Urdu, French…) as the Newsletter Studio does; a journey's
   messages, a form's labels and consent texts follow the same rule. A
   screen never asks for a language before it has English.

The mock-up implements all four; the kit gets one `StudioPage` template
(`panel`, `canvas`, `walkthrough` props) so the rule is a component, not a
convention.

Words on screen: *journey, step, when, then, wait, if, people, lead, score,
ready, form, consent, topic, event*. Not on screen: *trigger, payload,
condition DSL, run, idempotency, webhook, lifecycle stage* (say "stage"),
*MQL/SQL, attribution model* (say "where this deal came from").

| Screen | Template | Notes |
|---|---|---|
| **Marketing → Journeys** `/marketing/journeys` | `ObjectListPage` | ref, name, "When…" summary, status pill (Draft / On / Paused), people in it, sent this month, updated. `+ New Journey`. |
| **Journey** `/marketing/journeys/[id]` | `StudioPage` (§6.0), not `ObjectRecordPage` | **Left panel** (options, each with its hint): Start from (templates), Who (audience level, which people), When it starts (the trigger in plain words), Rules (re-entry, one per account, pause when in trouble, quiet hours, caps — read from Settings, shown not edited), Languages (English, + add). **Right canvas**: the steps as sentences, each editable in place with plain choices, with *Who would enter now*, *Try it on one person* and *Send test to me* above the steps. Header: title, status, **Show me how**, primary **Turn on** / **Pause**; "⋯": Edit name, Duplicate, Versions, Archive. Folded, closed by default: *Details for your IT team* (compiled conditions, version, run counts), *Activity* (Nova timeline). Templates: *Quote follow-up*, *New enquiry welcome*, *AMC renewal*, *Gone quiet*, *After an event*, *Blank*. Under 900 px the panel collapses above the canvas. |
| **Leads** `/leads` (exists) | `ObjectListPage` | gains Score (bar + number), Stage chips as quick filters, Owner, Last activity; default sort score desc. **Queue view** "Ready for me" for reps (a quick-filter chip, not a new page). |
| **Lead** `/leads/[id]` (new record page) | `ObjectRecordPage` | header facts: score, stage, owner, SLA ("accept by Tue 10:00"); primary **Accept** (Ready → Working) then **→ Deal**; "⋯": Edit, Reassign, Not now, Not a fit, Delete. Tabs: Overview (`ObjectSections`), Why this score (factor list, the §1.4 `ScoreCard`), Activity (timeline of the contact's events), Related (deals, quotes, account). |
| **Contact** record | existing `ObjectRecordPage` | Related tab gains *Consent* card (state + history, Edit opens a drawer that records a rep-given consent with the basis) and *Engagement* (last 10 events). |
| **Account** record | existing | Related tab gains *Marketing* card (people engaged, journeys running, buying stage, best lead) — the same data as the Account 360 card. |
| **Deal** record | existing | Win tab gains *Where this deal came from* (attribution chain, §8) and the Customer signals card reads the stream (§2.1). |
| **Marketing → Forms** `/marketing/forms`, `/[id]` | list + `StudioPage` (§6.0) | left panel: fields, consent block, after-submit actions, languages (English first); right canvas: the form as the visitor sees it, updating live; embed snippet under a fold; submissions tab. |
| **Marketing → Events** (M8) `/marketing/events` | list + `ObjectRecordPage` | tabs: Overview, Registrations, Follow-up (the journey), Attendance (check-in list). |
| **Settings → Marketing** (new group in `settingsMenu.ts`) | settings shell, Save top right | *Scoring* (behaviour rules, profile rules, thresholds; "Score a sample lead" preview), *Stages & assignment* (SLA, assignment fallback; links to Coverage for team modes), *Consent & topics* (topics, default basis per jurisdiction, consent texts per language), *Tracking & privacy* (tracking key, snippet, buying-interest paths, opens toggle with its note, retention), *Channels* (WhatsApp provider, templates, redirect number), *Journey limits* (caps, quiet hours, weekly off days). |
| **Nova inbox** | existing | "Ready for sales" and "Needs a decision" sections. |

Both looks, light and dark; 375 px; SVG icons; keyboard focus visible; real
empty states ("No journeys yet — start with *Quote follow-up*").

---

## 7. Later phase: WhatsApp as a marketing channel (M6)

- **Provider**: Meta Cloud API through one provider adapter interface
  (`src/lib/whatsapp/provider.ts`: `sendTemplate`, `sendSession`,
  `verifyWebhook`, `parseInbound`); the first adapter is whichever the
  owner picks (open question 5). Credentials in `tenants.config.whatsapp`,
  admin-only, redacted by `redactTenantForRole()` like the API key.
- **Templates**: marketing messages to people outside a 24-hour session
  must use **pre-approved templates**; `whatsapp_templates` mirrors the
  provider's approval state per language; the journey step picks one and
  maps variables to fields (`{{contact_name}}`, `{{quote_ref}}`,
  `{{amount}}`). Session (free-form) replies are allowed only within 24 h
  of an inbound message and only by a person from the record (not by a
  journey).
- **Consent**: channel `whatsapp` in the ledger; opt-in from a form tick,
  an inbound "START"/first message, or an imported opt-in with evidence.
  "STOP" / "إيقاف" inbound → withdrawn, `whatsapp.opted_out`.
- **Inbound**: `POST /api/inbound/whatsapp` (signature verified), matches
  the sender by `contacts.phone_hash`, writes `whatsapp_messages` and
  `whatsapp.replied`, shows the reply on the contact's and the lead's
  timeline, notifies the owner; unknown numbers create nothing (no contact
  from an unsolicited message — a person decides, via Nova paste-to-draft).
- **Demo tenants**: `config.whatsapp.redirect_number` or `dry_run`; the
  message body is stored with the intended number, like `resolveOutbound`.
- Costs: per-template-message pricing differs by country; the journey shows
  an estimate ("~SAR 0.25 × 120 people") before Turn on.

## 8. Later phase: attribution from campaign to invoice (M7)

Deals and invoices exist; the chain is: campaign / form / event / journey
→ `lead` (`source`, `source_campaign_id`, `source_form_id`,
`source_event_id`) → `opportunity` (`lead_id`, `source_campaign_id`) →
quote (`opportunity_id`) → `invoice` (`quote_id`) → `invoice.paid`.

- `marketing_touches`: one row per marketing contact with a person or
  account (`contact_id`, `account_id`, `kind` campaign/journey/form/event/
  web, `asset_id`, `at`), written by the senders and the public routes.
- Models, all computed by code and explainable, chosen per report:
  **first touch**, **last touch before the lead**, **linear**, **time-decay
  (7-day half-life)**. The deal's "Where this deal came from" card shows the
  chain and the first/last touch in words; the report *Revenue by
  campaign* shows invoiced and paid amounts per asset per model, and says
  which model it used next to the number (ai-vision's "interpretation
  line").
- Costs: optional `cost` on campaigns, events and journeys for a simple
  return figure; never a forecast.

## 9. Later phase: events — trade shows and demos (M8)

`marketing_events` (EVT-####): name, kind (trade show / demo / webinar /
training), dates, venue or link, capacity, cost, registration form
(§5.1), languages. `event_registrations`: contact, status (registered /
confirmed / attended / no_show / cancelled), source (form / import / rep),
checked_in_at. Flow: registration form → confirmation email (a Studio
version) with an `.ics` → reminder journey (2 days, morning-of) → check-in
page (a list with a search and a tap, works on a phone at the stand; QR
later) → `event.attended` / `event.no_show` → the follow-up journey
template (*After an event*: thank-you in their language → if clicked, task
for the owner → if no reply in 7 days, one more touch → end). Badge scans
import through Data Workbench. Webinars (PROJECT.md §12) are an external
tool pushing `event.*` through `POST /api/v1/events` (§2.8), not a built-in
webinar platform.

---

## 10. Data model (described; migrations when built, numbered next after 0133)

All tables: `tenant_id uuid not null references tenants(id)`, UUID `id`,
`created_at`/`updated_at`, RLS enabled **in the same migration**,
`custom_data jsonb` on user-facing objects (journeys, forms,
marketing_events, leads), ledger-style tables select-only. Pending-migration
rule: every screen hides on 42P01; the runner exits cleanly when its tables
are missing; scoring returns null and the lead list shows "—".

| Table | Rows | RLS | Phase |
|---|---|---|---|
| `domain_event` | §1.2 | select-only | M0 |
| `journey_cursors` | per tenant: last processed event (keyset `created_at, id`) | none for members (runner only) | M0 |
| `consent_events`, `consent_state`, `suppressions` | §1.3 | select-only; writes via routes | M0 |
| `visitors` | §1.1 | select-only | M4 |
| `journeys` | ref JNY-####, name, status, `definition`, `version`, `trigger_name` (denormalised for the runner's index), counts, created_by | standard `for all` (a definition is content; every write still passes the route's sanitiser — but note a member writing a definition directly through PostgREST could skip it; **select-only + routes** is therefore the choice, matching `segments`) | M3 |
| `journey_versions` | frozen definitions | select-only | M3 |
| `journey_runs` | journey, version, subject (`contact_id`/`account_id`/`lead_id`), `current_step_id`, `next_due_at`, status (active / waiting_human / done / exited / stalled), `entered_at`, `exit_reason`, `simulated` | select-only | M3 |
| `journey_run_steps` | run, step_id, attempt, action, result jsonb, `email_log_id`, error, at; unique `(run_id, step_id, attempt)` | select-only | M3 |
| `automation_rules`, `automation_runs` | Sales Engine §5.2, unchanged | as specified there | with M3 (shared) |
| `forms`, `form_submissions` | §5.1; submissions' PII fields encrypted | forms select-only + routes; submissions select-only | M4 |
| `landing_pages` | §5.2 | select-only + routes | M4 |
| `marketing_touches` | §8 | select-only | M7 |
| `marketing_events`, `event_registrations` | §9 | standard | M8 |
| `whatsapp_templates`, `whatsapp_messages` | §7 | select-only | M6 |
| Column additions | `contacts.email_hash`, `contacts.phone_hash` (M6), `contacts.do_not_contact`, `contacts.preferred_language` (Studio), `leads.contact_id`, `leads.owner_user_id`, `leads.score`, `leads.score_factors`, `leads.scored_at`, `leads.sla_due_at`, `leads.last_activity_at`, `leads.source_form_id`, `leads.source_event_id`, `leads.custom_data`, `leads.custom_status_id` (status engine), `teams.assignment_mode`, `teams.last_assigned_user_id`, `tenants.tracking_key`, `webhooks.object_types` accepts `domain_event` | — | per phase |
| Config | `TenantConfig.marketing`: `topics`, `consent_defaults`, `consent_texts`, `scoring` (rubric + version), `lifecycle` (thresholds, sla, recycle_after_days), `assignment`, `caps`, `quiet`, `track_opens` (Studio), `buying_interest_paths`, `retention_months`, `paused`, `whatsapp` (M6) | — | per phase |
| Demo | `scripts/seed-marketing-demo.sql`: three journeys (one On), six leads with scores and factors, consent rows for the Studio's demo contacts, a form, two events; idempotent; flips nothing beyond `marketing` (already on for demo) | | M2+ |

**Isolation, concretely.** Every runner query is on the admin client with
`.eq("tenant_id", …)` from the cursor row it is processing — the runner
iterates tenants, never events across tenants. Public routes (`/api/track`,
form submit, preference centre, provider webhooks) resolve the tenant from
the signed token / tracking key / `email_log` id, and reject a body that
names a tenant. Every foreign id in a journey definition
(`newsletter_version_id`, `target_group_id`, `template_id`, user ids) is
verified against the tenant on **save** and again on **execution**
(`.eq("id", x).eq("tenant_id", tenantId).maybeSingle()`), because a
definition can outlive the thing it points to. `canContact()` takes the
contact row, never an id from the request.

**Performance** (`docs/performance-and-scale.md`): events are appended,
read by keyset, never scanned per request; scoring reads one contact's
90-day window via the `(tenant_id, contact_id, created_at desc)` index;
the runner is capped per tick and per tenant; audience previews reuse the
paged preview route; the lead list sorts by a stored column, not a live
computation. Nightly: decay re-score (bounded by `scored_at`), retention
trim, `consent_state` rebuild check.

---

## 11. §3b checklist — per new object (execute all, state skips)

| Object | DB | Types / ref / registry | Custom fields | CRUD + screens + nav + flag | DW | v1 / MCP | Cross-cutting (OBJECT_FEATURE, change history, search, Nova ×4, ⌘K) | Analytics |
|---|---|---|---|---|---|---|---|---|
| Journey (JNY) | §10 | yes; registry = header fields only | column yes; tab M-late | yes; nav under Marketing, `featureKey: marketing`, workcenter `marketing_journeys`; **no new flag** | export + update header; import excluded (document) | read; `EXPLICIT_SCOPE_ONLY` | all | sends/month |
| Lead (exists, gains a record page) | columns | registry gains score/stage/owner | existing | record page new; list parity rule | all three (exist) | **new** `GET /api/v1/leads`; `EXPLICIT_SCOPE_ONLY` | Nova maps gain `leads` (missing today), ⌘K "New lead" exists? verify | leads ready |
| Form (FRM) | §10 | yes | column yes | yes; workcenter `marketing_forms` | export only | read | all | — (skipped: not actionable) |
| Marketing event (EVT) | §10 | yes | yes | yes; workcenter `marketing_events` | registrations import/export | read | all | attendance |
| Consent (ledger, not an object) | §10 | type only | no | no screen of its own (lives on the contact) | import + export | read + write | change history on withdrawals | consent coverage |
| Landing page, WhatsApp template | §10 | yes | no | inside the Studio / Settings | no | no (stated) | change history | — |

`OBJECT_FEATURE`: `journeys`, `forms`, `marketing_events`, `landing_pages`,
`consents` → `marketing`; `leads` stays `leads`. Feature dependencies:
journeys need `marketing`; assignment modes need `coverage_model`;
WhatsApp needs `marketing` + the channel configured.

---

## 12. Roadmap across all marketing designs — build order that never ships an island

Each phase ends with `tsc`, `vitest`, `next build` clean, a commit, the
migration in PROJECT.md's ledger, the §3b report with every skip, and the
owner validating on the demo tenant before the next (bpmsquarecore §10
rule 2 applies to the look). Drive guides are refreshed after validation
(memory: docs after testing).

| Phase | Builds | Why in this order / what it integrates |
|---|---|---|
| **M0 — Foundations (no screen)** | `domain_event` + `emitEvent()` + catalogue (Piece A for Sales Engine and Nova Crew too); emit from the routes that exist today (quotes sent, deals, cases, invoices paid/overdue cron, campaign sent); `contacts.email_hash` + back-fill script; consent ledger + `canContact()` + jurisdiction table; `scoring.ts` pure; lead columns; `leads` on the status engine; Settings → Marketing (Scoring, Consent & topics) | everything after this reads one stream and one consent gate; the Sales Engine's rules layer and Nova Crew start from the same table |
| **M1 — Newsletter Studio N0–N1** (sibling) | the studio, languages, signed click links **emitting `email.clicked`**, `preferred_language`, brand kit | the first real engagement events; the first asset the journey step will send |
| **M2 — Leads that score themselves (the impressive MVP)** | lead record page, score + factors, stages, SLA, assignment via Coverage with round-robin, Nova inbox "Ready for sales", Nova Stream item, Account 360 `marketing` card, contact Consent card, `GET /api/v1/leads`, demo seed | demo story: send the Studio newsletter → a demo contact clicks (redirect inbox) → score rises → lead appears as *Ready* → assigned to the rep → task and inbox row → convert to deal → the deal shows "from campaign". Sales, Nova, Account 360 and the API all show the same fact. |
| **M3 — Journeys** | builder (mock-up), runner cron, versions, the action registry (shared with `automation_rules`, which can be built in the same piece or right after), safety rules, Try-it-on-one-person, templates: Quote follow-up, New enquiry welcome, AMC renewal, Gone quiet | the first automation uses a Sales event (`quote.sent`), a Studio version (`send_email`), Coverage (owner task) and Nova (inbox) — the integration test of the whole platform |
| **M4 — Forms, preference centre, tracking** | forms object + hosted/embedded, visitors + `m.js` + `/api/track`, landing pages (web render), preference centre with topics and re-subscribe, provider bounce/complaint webhook, legacy opt-out retired from the UI | inbound side; the consent ledger becomes the person's own page |
| **M5 — Signals** (sibling, to be written) | account intent + buying stage on the stream, external sources via `assertSafeSourceUrl`, `buying_stage` in audiences and as the one cross-score factor, Account 360 stat | sits on M0's stream and M4's web events; its own doc must say so |
| **M6 — WhatsApp** | §7 | after consent (M0/M4) and journeys (M3) exist to carry it |
| **M7 — Attribution** | §8 | needs touches from M1–M6 and `invoice.paid` from M0 |
| **M8 — Events** | §9 | reuses forms (M4), Studio (M1), journeys (M3), attribution (M7) |
| **M9 — Every surface** | DW modes, MCP, remaining v1 routes, search, ⌘K, analytics tiles, `docs/capabilities/marketing.md`, Drive guides (Marketing, Sales Cloud, Admin, API) | the §3b long tail, done once for all objects; the Process Design Studio catalogue picks everything up automatically |

Nova Crew's Growth agent (its Phase 3) and the Sales Engine's rules UI
consume M0/M3 and are sequenced by their own documents.

**The impressive MVP is M2 + M3's first template**, shown on the demo tenant
with the redirect inbox: one newsletter, one click, a lead that explains
its own score, a rep who gets it within the SLA, and a quote follow-up that
sends itself and then hands the person to a human.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| A second event system appears (Sales Engine builds its own in-request table before M0) | M0 is sequenced **first** across the three initiatives; the Sales Engine doc's §5.1 names are the catalogue; Nova Crew's Piece A is this table. |
| Scores feel arbitrary to reps | factor list one tap from every number; rubric versioned; "Score a sample lead" preview in Settings; no AI in the number. |
| A journey emails a real customer from a test or a demo | `resolveOutbound()` forced on demo tenants; WhatsApp redirect/dry-run; caps; Try-it-on-one-person sends nothing; blast-radius confirmation. |
| Consent recorded without a lawful basis for the jurisdiction | the ledger requires `basis`; `canContact()` refuses; jurisdiction table reviewed by counsel before go-live (Q3). |
| Encrypted PII makes lookups impossible | `email_hash` blind index, maintained on every write, back-filled once. |
| Runner falls behind or runs away | 5-minute cron, per-tick caps that throw, cursor per tenant, stalled runs visible on the journey page with Retry. |
| Vikas's lead list changes under them | columns added only after the owner's visual-parity confirmation (Q2); statuses mapped, not renamed. |
| Web tracking becomes a privacy liability | consent-first, first-party only, no IP, no query strings, path allow-list for "buying interest", DNT/GPC honoured, retention trim. |
| Engineering words leak onto screens | the mock-up is the spec; every technical term lives under *Details for your IT team*. |
| Migration pending on production | every screen hides on 42P01; the runner no-ops; scoring shows "—". |

## 14. Open questions for the owner (concrete)

1. **Lead stages on the status engine** with the eight plain stages of
   §4.2 — or keep today's six values and add stages beside them? (Proposed:
   status engine, values mapped.)
2. **Vikas's Leads list**: may it gain Score, Stage chips and Owner now, or
   only after you have seen the mock-up on the demo tenant?
3. **Jurisdiction defaults**: which basis do you want pre-selected for a
   Saudi tenant's existing customers — *consent required* (strict) or
   *existing customer, with opt-out* (common practice)? Counsel review
   before go-live is assumed.
4. **Vercel plan**: `vercel.json` already runs `*/5` crons, so the Hobby
   limit noted in `webhooks/cron` seems gone — confirm, since the journey
   runner needs a 5-minute schedule.
5. **WhatsApp provider**: Meta Cloud API direct, Twilio, or a GCC-local
   BSP? (Affects template approval flow and pricing display.)
6. **Topics**: start with the four defaults (*Offers, New products, Service
   reminders, Events*) or let each workspace define its own from day one?
   (Proposed: defaults, tenant-editable.)
7. **Auto-created leads**: a contact crossing *Engaged* creates a lead
   automatically (proposed) — or should a person always create the lead and
   the score only sort them?
