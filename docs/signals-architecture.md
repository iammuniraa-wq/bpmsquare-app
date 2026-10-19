# Buying Signals — architecture v0.1 (2026-10-19)

> **Who this is for.** The engineer (human or model) building the "6sense
> for BPMSquare" the owner asked for: *"in marketing have signals from
> customers from available market sources to validate and give indication
> when they do marketing."* This is a design, not code. It is grounded
> against what exists on `develop` today, says plainly what is possible in
> the GCC and India, and what we deliberately do not copy from 6sense.
>
> **Read first, every time:** `bpmsquarecore.md` §1 (extension boundary),
> §3 (record identity), §3b (new-object checklist — executed in full, §10
> below), §10 (Nova doctrine) and §10a (Account 360: the rating is an
> explainable rubric, never an AI score; tenant URLs go through
> `assertSafeSourceUrl`); `MULTI_TENANT_GUARDRAILS.md`;
> `docs/newsletter-studio-architecture.md` (the sibling design — Signals
> reads its click data rather than collecting its own);
> `docs/sales-engine-architecture.md` §5.1 and `docs/nova-crew-architecture.md`
> Piece A (the shared event stream Signals consumes and feeds);
> `docs/ui-restructure-spec.md` (every screen below follows its templates).
>
> **Mock-up:** `docs/design/signals-mockup.html` is the visual and behavioural
> spec for the screens in §4. Open it at 375 px and at desktop, light and dark.
>
> **Owner rule (2026-10-19): nothing standalone.** Signals is designed as a
> consumer and a feeder of the shared marketing platform, not as its own
> island. §9 "Integration points" is the contract. The integrated marketing
> blueprint, `docs/marketing-platform-architecture.md`, did not exist when
> this was written; §9.0 lists what this design assumes it provides, and
> the terms here are chosen so they can be aligned to it without re-design.

---

## 0. The answer in eight lines

1. **Name:** the module is called **Buying signals** in the product (nav item,
   feature flag `buying_signals`). The page is titled **"Who is in market"**.
   "Intent data", "orchestration" and "predictive" never appear on a screen.
2. **What a user gets:** a ranked list of accounts that are in market this
   week, each with a **stage** in plain words (Quiet · Looking · Comparing ·
   Deciding), a **score with its working** (every point named and sourced),
   **next steps** (call, add to a segment, start a campaign, open a deal),
   alerts in the Nova inbox and on Account 360, and a **"Did it work?"** view
   on every campaign and newsletter.
3. **Score = rubric, not AI.** Same contract as Account 360's rating: a
   weighted, decaying, deterministic rubric that returns `{label, points,
   detail}` factors. Identical on every reload. AI only (a) classifies news
   and tender text into the tenant's topics with a citation, and (b) writes
   the two-sentence "why this account, this week". AI never moves a point.
4. **Sources in three honest phases.** Phase 1 is almost entirely data we
   already hold or can collect for free with consent: quotes, RFQs, cases,
   contracts, campaign and newsletter clicks, interest clicks, quote-link
   opens, identified website visits from the platform's one snippet, Google
   News, public tender listings. Phase 2 adds company-level website
   identification (reverse-IP connector), job postings and company-registry
   changes. Phase 3 adds paid intent providers (Bombora, G2, or a tenant's
   own 6sense) as connectors — we read them, we never resell them.
5. **One event stream, one snippet, one consent model, one scoring
   framework** (§9). Signals does not build a second click tracker, a second
   web beacon or a third kind of score. Where a collector exists it is
   reused; where it does not (news, tenders, jobs, registry, intent
   providers) Signals owns it and publishes what it finds onto the same
   stream for everyone else.
6. **Isolation:** every table carries `tenant_id` + RLS; external fetches go
   through `assertSafeHttpsUrl`; third-party keys are stored exactly like
   every other connector secret (`tenant_connectors`, encrypted, admin-only);
   every run is metered per tenant per day and stops at the budget.
7. **False positives are the product risk, not privacy.** Matching a news
   item or tender to the right account is the hard part. Anything below the
   match threshold lands in a "Check these" queue and never scores.
8. **MVP that impresses honestly:** Phase 1 on the demo tenant shows a real
   ranked list, real tender and news items with citations, and a real campaign
   "Did it work?" — all from data a client already generates by using the
   product. No paid data, no scraping of private sources.

---

## 1. Vocabulary

| Term (on screen) | Meaning |
|---|---|
| **Signal** | One dated, sourced thing that happened that makes an account more (or less) likely to buy soon. Readable as a sentence: *"Opened quote QT-2026-0142 twice (12 Oct)"*, *"Tender: Riyadh Municipality — precast boundary walls, closes 28 Oct (Etimad)"*. |
| **Source** | Where a signal came from: Quotes, RFQs, Cases, Contracts, Campaigns, Newsletters, Website, News, Tenders, Jobs, Registry, or a named provider. Each signal carries exactly one. |
| **Topic** | A tenant-defined subject, e.g. "Precast", "HVAC maintenance", "Fire safety", with English and Arabic keywords. News, tenders, jobs and newsletter links are classified into topics; segments and campaigns can target a topic. Shared with Newsletter Studio (§9.4). |
| **Score** ("In-market score") | 0–100, from the rubric in §5, with decay. Shown with its working. |
| **Stage** | Quiet · Looking · Comparing · Deciding. Derived by fixed rules from the score and the kind of signals present (§5.3). Never from a model. |
| **Check these** | Items the matcher could not attach to an account with confidence (a tender naming a company we don't have, a news item with an ambiguous name). A person confirms, creates the account, or dismisses. |
| **Did it work?** | Per campaign/newsletter: how the recipients' scores and stages moved in the 14 days after the send, against the same accounts' movement before and against non-recipients. Counts and names, not a p-value. |

---

## 2. What 6sense actually does, and what we match

6sense sells "Revenue AI": it de-anonymises website traffic to companies,
buys and co-ops third-party intent (which companies are researching which
keywords across a publisher network), scores accounts into buying stages
with predictive models, and "orchestrates" — pushes audiences into display
advertising, web personalisation, email and sales alerts, with contact data
on top. Contracts are enterprise-priced (tens of thousands of USD a year
upward) and its intent network is North-America- and Europe-heavy; GCC and
Indian industrial buyers are thinly covered, and reviewers report
inconsistent intent accuracy even where coverage is good.

### 2.1 6sense feature map: what we match, how, and what we deliberately do not do

| 6sense capability | BPMSquare Buying signals | How | Phase |
|---|---|---|---|
| Account identification from anonymous web traffic | **Partly** | Identified visits: the platform's one website snippet + a signed token on every link in our own emails/newsletters, so a known contact's visit is attributed with consent. Company-level: a reverse-IP connector (Dealfront/Leadfeeder/Snitcher class), company only, never person. | 1 (identified), 2 (company) |
| Third-party intent network (co-op keyword surges) | **Not built, connectable** | No co-op exists in our markets and we will not scrape one. Bombora / G2 / a tenant's own 6sense export become connectors a tenant pays for directly. | 3 |
| Keyword / topic intent | **Yes, our way** | Tenant topics (EN + AR keywords). News, tenders, job postings, newsletter links are classified into topics; first-party activity is tagged by product category. | 1 |
| Buying stages | **Yes, explainable** | Four plain stages from fixed rules over the score and signal kinds (§5.3). | 1 |
| Predictive account scoring (ML) | **Deliberately not** | A weighted, decaying rubric with its working shown (bpmsquarecore §10a doctrine). We trade a few points of lift for a number a rep can defend. | — |
| Orchestration (audiences → ads, email, web, sales) | **Yes, inside the suite** | Score/stage/topic are Segment fields → target groups → campaigns and newsletters; automation rules fire on `signal.*` events; tasks to the Coverage owner; Nova inbox alerts. | 1 |
| Display advertising / retargeting | **Deliberately not** | We are not an ad network. A segment can be exported (Data Workbench) for a tenant's own ad platform. | — |
| Web personalisation | **Later, via the platform** | Belongs to the marketing platform's landing pages, keyed on stage/topic from Signals. | later |
| Contact data / enrichment | **Deliberately not** | We hold the tenant's own contacts only. No purchased person data; PDPL/DPDP/GDPR make that the wrong bet for us. | — |
| Sales alerts and "hot accounts" | **Yes** | Weekly ranked list, Nova inbox, Account 360 card and suggestion, ⌘K. | 1 |
| Reach / engagement reporting | **Yes, as "Did it work?"** | Per campaign and newsletter, and a module-level "Marketing moved N accounts this month". | 1 |
| Conversational AI assistant (RevvyAI) | **Covered elsewhere** | `/api/v1/ask` and the AI assistant already query LIST_SOURCES; Signals joins LIST_SOURCES so *"who is in market for precast this week?"* works with no new chat. | 1 |
| Government tenders as intent | **Our addition** | 6sense does not do this. In KSA and Qatar a published tender is the loudest buying signal there is. | 1 |

---

## 3. Sources — what is realistic, what it costs, how it connects

Every source is a **collector** that produces signals in one shape (§7.1).
Collectors run on Vercel crons like `/api/rfqs/cron/mailbox` (bounded per
run, least-recently-run tenant first, per-tenant budget — §8). Secrets live
in `tenant_connectors` through the existing connector registry
(`src/lib/connectors/registry.ts`, fields marked `secret` are encrypted by
`src/lib/connectors/server.ts`). Every tenant-typed URL goes through
`assertSafeHttpsUrl`; providers we integrate are fixed hosts in code.

### 3.1 Phase 1 — first-party and public, no data cost

| Source | Signal examples | Where it already is | Refresh | Privacy |
|---|---|---|---|---|
| **Quotes / Standard Quotes / Deals** | New inquiry, quote sent, revised, public link opened/accepted/change requested (`quote_link_events`, sales-engine §7.4), outcome | `quotes`, `standard_quotes`, `opportunities`; `domain_event` once Piece A lands | Event-driven; nightly backfill | Internal business data |
| **RFQs / Estimates** | Customer asked for a price (estimate created from an email), RFQ raised for their job | `estimates`, `rfqs` | Event-driven | Internal |
| **Cases / Work orders / Assets** | Repeated breakdowns of an ageing asset, inspection report with "replace" recommendation, open case > 30 d | `service_cases`, `work_orders`, `assets` | Event-driven | Internal |
| **Contracts (AMC)** | Expiring within 60 d (renewal window), lapsed | `contracts` | Nightly | Internal |
| **Campaign engagement** | Clicked a link (topic-tagged), clicked "Interested" (= attributed lead), unsubscribed (negative) | `marketing_link_clicks`, `leads.source_campaign_id`, `accounts.marketing_opt_out` | Event-driven | Clicks are the recipient's own action on our link. Opens stay behind `config.marketing.track_opens` (default off, newsletter doc §7) and score 1 point at most. |
| **Newsletter engagement** | Clicked a block with topic *Precast* | `marketing_link_clicks.link_index` → the version's link list → block `topic_id` (§9.4) | Event-driven | Same as above |
| **Website visits (identified)** | Visited /precast-walls twice this week | The platform's one snippet (§9.2). Only a visit that started from a signed link in our own email is attributed to the contact; everything else is counted anonymously. | Real-time beacon | Snippet is first-party, cookieless by default; attribution requires the contact's existing marketing consent and the email footer disclosure. PDPL and GDPR treat identified tracking as consent territory; this design never identifies without it. |
| **News** | "Najd Precast wins SAR 120 m housing package" → topic Precast, tone positive | `src/lib/data/news.ts` (Google News RSS, unofficial, free) extended with per-topic queries and account aliases; AI classification (§6) | Hourly per tenant, cached 30 min as today | Public |
| **Public tenders** | Etimad: "Supply and installation of precast boundary walls, Riyadh Municipality, closes 28 Oct"; Monaqasat: "Ashghal — pump station refurbishment" | New collector. Etimad has a developer portal (apiportal.etimad.sa) with an Open Data product; Monaqasat (monaqasat.mof.gov.qa) is a public HTML listing. Phase 1 reads the public listing pages by topic keyword with a polite fetch (identified user agent, ≤ 1 request/5 s, daily) and offers a **paste/forward** path for tender alert emails. | Daily | Public |
| **Analytics-free first-party counters** | Nothing new — they are the above | | | |

### 3.2 Phase 2 — company identification, hiring, registry (low cost)

| Source | What it gives | Connector | Cost tier (third-party figures, verify) | Refresh | Privacy |
|---|---|---|---|---|---|
| **Reverse-IP company identification** | Anonymous visit → company name/domain/city; match to an account by domain | New `reverse_ip` connector type in the registry: provider choice (Dealfront/Leadfeeder, Snitcher, KickFire, or any that offers an IP→company API), API key (secret). Our server calls the provider from the beacon's server side; the browser never talks to the provider. | A few hundred USD/month for SMB tiers; match rates 30–65 %, worse for remote workers and mobile carriers; GCC coverage must be tested before it is sold | Real-time at beacon | Company-level only — a legal entity, not a person. We never ask a provider for person-level data. EU visitors: the beacon respects the platform consent banner; company lookup runs only on consented sessions. |
| **Job postings** | "Hiring 3 precast QC engineers" → topic Precast, points for expansion | `job_signals` connector: TheirStack or Coresignal API key; query by account domains + topic keywords | ~USD 50–500/month self-serve tiers | Weekly | Public postings; we store the posting title, URL and date only |
| **Company registry** | KSA: Wathq (developer.wathq.sa) — CR status, activity changes, capital increase, new branches; India: MCA master data; Qatar: MOCI lookups are manual | `registry` connector: Wathq API key; per-call pricing from about SAR 2 (free basic package exists) | Pay per call | Monthly, and on demand from the account page | Business registry data; owner/manager names are **not** stored (we read status and activity only) |
| **Tender API** | Replaces the HTML listing read with Etimad's Open Data product | `etimad` connector (API key) | Per the developer portal; free/low tier expected | Daily | Public |

### 3.3 Phase 3 — paid intent providers (tenant-paid)

| Provider | What it gives | Realism in our markets | Cost (third-party estimates) |
|---|---|---|---|
| **Bombora Company Surge** | Topic surge scores per company domain, weekly | Good for enterprise and multinational accounts; thin for GCC SMEs | ~USD 25–30 k/yr entry, 50–100 k mid-market |
| **G2 Buyer Intent** | Companies researching software categories on G2 | Only relevant to tenants selling software | ~USD 15–60 k/yr |
| **A tenant's own 6sense** | CSV/API export of stage + intent | A tenant that already pays for 6sense keeps it; we show their data next to ours | Tenant's existing contract |

Each is a connector with a secret, a weekly pull, a fixed host, and a
budgeted row count. Provider data lands as ordinary signals with source =
the provider name, and scores under the "Market" group with a hard cap
(§5), so no provider can dominate the first-party truth.

### 3.4 Legal limits that shape the design (not legal advice — counsel reviews before sale)

- **Saudi PDPL (SDAIA):** direct marketing by email/SMS needs prior opt-in;
  cookie-based tracking that collects personal data (IP, device, behaviour)
  is governed by the PDPL and its regulations; legitimate interest is read
  narrowly. Consequence: opens off by default, identified web visits only
  with consent, company-level IP lookup only, no purchased person data.
- **Qatar Law 13/2016:** electronic direct marketing needs prior explicit
  consent, easily withdrawable. Same consequences; the unsubscribe link and
  preference centre must stay one click.
- **India DPDP Act 2023 + Rules 2025:** notice must be separate and itemised;
  consent specific and unbundled; withdrawal as easy as giving it.
  Consequence: the preference centre lists "marketing emails", "click
  tracking", "identified website visits" as separate choices.
- **GDPR / ePrivacy (EU contacts of a tenant):** cookies/fingerprinting need
  consent before they are set; company-level reverse-IP is widely treated as
  legitimate interest but person-level is personal data. Consequence: the
  snippet sets no identifier before consent; attribution uses the signed
  link token, which is only ever created for a consented recipient.
- **Tenders and news:** public information; we store title, issuer, URL,
  dates and our own classification, never a copy of the document.

---

## 4. What a user sees (the mock-up is the spec)

Everything follows `docs/ui-restructure-spec.md`: `ObjectListPage` for the
list, kit `Tabs`, `Card`, `Button`, `StatusPill`, `EmptyState`; ≤ 7
columns; cards under 780 px; one primary action per screen; no engineering
words.

### 4.1 "Who is in market" — the list (`/marketing/signals`)

```
Who is in market  (14 this week)                    [⋯]  [+ New topic]
[search ……………] [Deciding] [Comparing] [Looking] [New this week] [Check these 3]
┌──────────────────────────────────────────────────────────────────────────┐
│ Account            │ Stage      │ Score │ Why (top signals)        │ Owner │ Next step │
│ Najd Precast Co.   │ Deciding   │ 82 ▮▮▮│ Opened quote twice ·     │ Faisal│ Call ▸    │
│  Riyadh · Precast  │            │       │ Tender closes 28 Oct     │       │           │
└──────────────────────────────────────────────────────────────────────────┘
```

- Default sort: score desc, then last signal. Chips filter by stage; "New
  this week" = first signal in the last 7 days; "Check these" opens the
  unmatched queue (§4.4). Topic filter in the Advanced filter panel.
- "Why" is two signals in words, newest first, each with a source pill.
- "Next step" is one quiet button chosen by rule: Deciding → **Call** (opens
  the primary contact's phone/WhatsApp), Comparing with no open quote →
  **Start a quote**, Looking → **Add to campaign**; "⋯" on the row: Add to
  segment, Create deal, Open account, Snooze 30 days, "Not in market"
  (negative feedback that is stored and shown).
- Header "⋯": Export (Data Workbench export of the current list), Settings
  → Buying signals, Rescore now (admin).
- Empty state on day one: *"No signals yet. Signals appear as your team
  sends quotes and campaigns, and as news and tenders mention your
  accounts. Add a topic to start watching news and tenders today."* with a
  **+ New topic** action — real content on day one from news/tenders even
  before a tenant has used the rest of the product (same reasoning as the
  business-news dashboard block).

### 4.2 The account — a tab and a card

- **Account record page, tab "Signals"** (between Related and Activity):
  the score card (number, stage pill, "how this is worked out" expander
  listing every factor with points and detail — exactly the Account 360
  rating pattern), the "This week" sentence written by AI and labelled
  *"Summary by AI — the score is not"*, then the signal timeline: one row
  per signal with date, source pill, sentence, link to the evidence (the
  quote, the tender page, the article), and for AI-classified items the
  citation and "why this topic". Next steps as quiet buttons at the top.
- **Account 360 card `buying_signals`** (built-in card, `kind: "internal"`):
  stats = Score, Stage, Last signal; rows = the latest 5 signals. Added to
  `BUILTIN_CARD_IDS`, `BUILTINS` and `CARD_IDS` per bpmsquarecore §10a.
- **Account 360 suggestion** `in-market`: *"In market now — Deciding (82).
  Opened the quote twice and a matching tender closes in 9 days."* urgency
  high, href to the Signals tab. The **health rating is untouched**: health
  answers "how is the relationship", intent answers "are they buying now"
  (§9.3). Two numbers, two questions, one framework, shown side by side.

### 4.3 Campaign and newsletter — "Did it work?"

A tab on the campaign record (and the newsletter's campaign side):

```
Did it work?                      Sent 2 Oct to 148 accounts
Moved up a stage: 11 accounts     Replied or clicked: 23     Now Deciding: 4
Before the send these 148 averaged 18 · two weeks after: 31  (non-recipients: 17 → 19)
┌ Account ───────── Before → After ── What happened ─────────────────────┐
│ Najd Precast Co.  Looking → Deciding  Clicked "Precast walls", opened quote │
└────────────────────────────────────────────────────────────────────────┘
```

Rules, not statistics: the window is 14 days before and 14 days after the
send; "moved" means the stage went up; "non-recipients" is every other
account of the same account types in the same window. Shown as counts and a
list of names, with a one-line honest note when the sample is tiny (*"Fewer
than 20 recipients — treat this as a list, not a trend."*). A module-level
version sits at the top of the list page as one line: *"Marketing moved 19
accounts up a stage in the last 30 days."*

### 4.4 "Check these" — the unmatched queue

A sub-view of the list (chip). One card per item: the headline, source,
date, the best account guesses with their match reasons (*"name 78 %
similar: 'Najd Precast Company' vs 'Najd Precast Co.'"*), and three buttons:
**It's this account** (picks a guess, remembers the alias), **Create
account** (prefilled name, city, industry from the item), **Not relevant**
(dismiss; the dedupe key is remembered so it never returns). Nothing in this
queue scores until a person decides.

### 4.5 Nova

- **Inbox:** stage changes up to Comparing/Deciding and new tender matches
  post a `record_comments` row of kind `system` on the account mentioning
  the Coverage owner (the existing notify mechanism; sales-engine §5.3), so
  the inbox renders and links it with no new inbox code. `LABEL`/`TABLE` in
  `api/nova/inbox/route.ts` already know `accounts`.
- **⌘K:** "Who is in market" (opens the list), "New topic".
- **Timeline:** signals are rendered in the account's Nova timeline as
  system items (via the same comment rows, deduplicated per signal).

### 4.5b Layout rule (owner, 2026-10-19, set while reviewing Newsletter Studio)

Every studio and workspace screen uses the Fence/Estimator layout
(`src/app/(app)/estimates/[id]/EstimateScreen.tsx`,
`docs/estimator-reference/studio-mockup-v2.html`): **options in a left
panel, the workspace on the right**; on a phone the left panel collapses
into a "Options" disclosure above the workspace. For Buying signals:

- **Left panel (options):** Show (stage chips), Topic, Owner, Source, Time
  window, "Include accounts marked not in market" — each option carries a
  one-line plain-words hint under its label (*"Stage — how close to buying
  they look, from their own actions and the market"*). The panel also holds
  "Show me how" (§4.7) and the module line "Marketing moved N accounts".
- **Every option group collapses** (owner rule from the Newsletter review,
  "leaner"): a header row with the label, its one-line hint, the current
  value and a chevron; the group in use starts open, the rest collapsed;
  the header is a button with `aria-expanded`/`aria-controls`, so it works
  from the keyboard.
- **Workspace (right):** the ranked list; clicking a row opens the account's
  signals in the workspace (not a new page) with Back; "Did it work?" and
  the "Check these" queue open in the same workspace.
- Settings pages keep the two-pane settings shell (left menu, right
  content) — that is already the same shape.
- English is the default language of every label and hint; Arabic follows
  the platform's language rule when it exists.

### 4.6 Settings → Marketing → Buying signals (admin)

Three settings pages in the two-pane shell, Save top right:
1. **Topics** — list-type page: name, English keywords, Arabic keywords,
   product categories it maps to, on/off. "+ New topic".
2. **Sources** — one row per source with a toggle, a status line (*"Last run
   2 h ago · 14 items · 3 matched"*), and Connect for the ones that need a
   key (links to Settings → Connectors). Website: shows the platform
   snippet and a check mark when it has reported in. Email: shows the
   `track_opens` state (owned by the platform's consent settings; read-only
   here with a link).
3. **Scoring** — read-only view of the rubric with its weights and the four
   stage thresholds, and two admin dials only: *decay half-life (days)* and
   *daily budget (items classified by AI)*. No per-factor editing in v1 —
   the rubric is a product, not a spreadsheet (open question 2).

### 4.7 Guided walkthrough ("Show me how")

Optional, starts closed, one button in the left panel. A small card
anchored to the element it explains, with **Back · Next · Skip** and a step
counter; Skip closes it and remembers (per user, `localStorage` key
`signals.walkthrough.done`, re-openable from the same button). Reduced
motion respected (no slide, just a fade). Steps, in English by default:

| # | Anchored to | Words |
|---|---|---|
| 1 | The list | "This is who looks ready to buy this week. The highest score is at the top." |
| 2 | Stage pill | "Stage is plain words for how close they look: Quiet, Looking, Comparing, Deciding." |
| 3 | Score | "The score is a sum of named signals with their points — open it to see every line. It is not a guess by AI." |
| 4 | Why column | "Why shows the two newest signals and where each came from — your quotes, your campaigns, the news, a tender." |
| 5 | Next step | "One suggested next step per account. Call, add to a campaign, start a quote." |
| 6 | Left panel: Topic | "Topics are the subjects you sell. Add one and we start watching news and tenders for it today." |
| 7 | "Check these" | "Items we could not match with confidence wait here. Nothing scores until you decide." |
| 8 | "Did it work?" | "After a campaign or newsletter, see which of these accounts moved up a stage." |

The same walkthrough component is intended for Newsletter Studio and the
Estimator; it lives in the shared kit (`src/components/ui/Walkthrough.tsx`,
steps as data), not in this module.

---

## 5. Scoring — the rubric and its working

`src/lib/signals/rubric.ts`, pure, unit-tested, same factor shape as
`src/lib/account360/rating.ts` (`{label, points, detail}`) so both render
through one component. Input: the account's live signals (already decayed).
Output: `{score, stage, factors, topSignals}`.

### 5.1 Points per signal kind (before decay)

| Group (cap) | Signal kind | Points | Detail text pattern |
|---|---|---|---|
| **They asked us** (cap 40) | Quote/estimate/RFQ inquiry created | 25 | "Asked for a quote on 12 Oct (QT-…)" |
| | Quote sent, awaiting decision | 10 | "Quote QT-… open for N days" |
| | Quote revised at customer's request | 15 | "Asked for a revision" |
| | Inspection recommends replacement / 3rd breakdown of one asset in 90 d | 15 | "Asset X failed 3 times since Jul" |
| | AMC expires within 60 days | 12 | "Contract ends 30 Nov" |
| **They responded** (cap 25) | Clicked "Interested" (lead created) | 15 | "Said they're interested in campaign …" |
| | Opened the public quote link | 8 per day (max 2 days) | "Opened quote QT-… twice" |
| | Accepted / requested change on the link | 20 / 12 | |
| | Clicked a campaign or newsletter link | 6 (topic-tagged) · 3 (untagged) | "Clicked 'Precast walls' in October newsletter" |
| | Opened an email (only if opens are on) | 1 (max 2) | |
| | Replied to a quote/RFQ email (inbound mailbox) | 10 | |
| | Unsubscribed | −15 (floor 0 on the group) | "Unsubscribed on 3 Oct" |
| **They are moving** (cap 20) | Tender published matching a topic, issuer = the account | 14 | "Tender: … closes 28 Oct (Etimad)" |
| | Tender published matching a topic, account named as a bidder/contractor | 8 | |
| | News: project award, expansion, funding, new plant | 8 (max 2 items) | "Won SAR 120 m housing package (Arab News, 9 Oct)" |
| | News: risk (layoffs, default, closure) | −6 | |
| | Hiring in a topic role | 5 (max 2) | |
| | Registry: new activity / capital increase / new branch | 5 | |
| | Paid intent provider surge | 6 (max 1 per provider per week) | "Bombora: surge on 'precast concrete' (62)" |
| **They visited** (cap 15) | Identified visit to a product/pricing page | 5 per distinct day (max 3) | "Visited /precast-walls on 2 days" |
| | Company-level visit (reverse-IP) | 3 per distinct day (max 3) | "Someone at Najd Precast viewed the catalogue" |

Caps per group keep one noisy source from swamping the rest; a provider can
never push an account past Looking on its own.

### 5.2 Decay (stated on screen, no maths exposed)

A signal counts in full for 14 days, half for the next 14, a quarter for
the next 14, and is gone after 60 days — except negative signals, which
hold for 90 days. The half-life is an admin dial (7–30 days). Decayed
points are what the factor rows show, with *"(half, 20 days old)"* in the
detail.

### 5.3 Stage rules (fixed, in order)

1. **Deciding** — score ≥ 65 **and** at least one "They asked us" signal in
   the last 30 days (an open quote, inquiry, tender they issued).
2. **Comparing** — score ≥ 40, or any "They asked us" signal in the last 30
   days.
3. **Looking** — score ≥ 15.
4. **Quiet** — otherwise (including "Not in market" marked by a user, which
   also zeroes the score for 30 days and is listed as a factor).

Stage changes are events (`signal.stage_changed`) and only *upward* changes
alert anyone. The list, the card, the API and the segment field all read the
same stored row (`account_intent`, §7.3) so no surface computes its own.

---

## 6. AI — where it is allowed, and the budget

Mirrors `src/lib/nova/marketIntel.ts` (client, error mapping) but with
structured output and no web search:

| Task | Input | Output | Rule |
|---|---|---|---|
| **Classify** a news item / tender / job posting | Title, snippet, issuer, the tenant's topic list, the tenant's account names + aliases | `{topic_id \| null, matched_account_id \| null, confidence 0–1, reason, tone}` | Cached by content hash per tenant; runs once per item; confidence < 0.7 → "Check these"; the citation (URL, title, date) is stored with the signal; the model is told to return `null` rather than guess. |
| **Summarise** an account's week | Its signals (text) | Two sentences, plain words | Labelled "Summary by AI". Regenerated only when the signal set changes. Never reads or writes the score. |
| **Extract** a company name from a pasted tender alert | The pasted text | `{issuer, title, closes_on, url}` | Same path as the estimator's "start from the customer's email" intake. |

Budget: `signal_runs.ai_units` per tenant per day with a default cap (e.g.
300 classifications; enterprise tiers raise it). When the cap is reached
items queue until tomorrow and the Sources page says so. Model choice is
the same as the existing AI routes unless a cheaper model passes the
classification eval in `src/lib/signals/classify.test.ts` — do not assume.

---

## 7. Data model (described, migration `0135_buying_signals.sql`, next free number — verify)

All tables: `tenant_id uuid not null references tenants(id)`, RLS enabled
in the same migration. Policy convention: **select for tenant members, no
write policy** — all writes go through server code on the admin client
with `.eq("tenant_id", tenantId)` (pricing/WFM convention; these rows drive
who gets called first and must not be forgeable from a session token).

### 7.1 `account_signals` — the one shape every source produces

`id`, `tenant_id`, `account_id` (nullable while unmatched), `contact_id`
(nullable; only for first-party actions by a known contact), `source`
(enum text: quotes, rfqs, cases, contracts, campaigns, newsletters,
website, news, tenders, jobs, registry, provider:<id>), `kind` (the rubric
row key), `topic_id` (nullable), `points int`, `tone` (positive, neutral,
negative), `occurred_at`, `expires_at`, `headline text` (the sentence),
`evidence jsonb` (`{url, title, publisher, published_at, snippet ≤ 300
chars, citation, ai_reason, confidence}`), `object_type` / `object_id`
(the quote, case, campaign… it came from), `dedupe_key text` (unique with
`tenant_id`: e.g. `quote_opened:<quote_id>:<yyyy-mm-dd>`, `news:<url hash>`),
`match_status` (matched, unmatched, confirmed, dismissed),
`match_candidates jsonb` (for the queue), `created_at`.
Indexes: `(tenant_id, account_id, occurred_at desc)`, `(tenant_id,
match_status)`, unique `(tenant_id, dedupe_key)`.
No `custom_data`, no business ref: signals are system-generated rows, not
user records (stated skip, §10).

### 7.2 `signal_topics`

`id`, `tenant_id`, `name`, `name_ar`, `keywords text[]`, `keywords_ar
text[]`, `product_category_ids uuid[]`, `enabled`, `custom_data jsonb`,
`created_at`, `updated_at`. User-managed → change history on every
mutation. Shared with Newsletter Studio (§9.4).

### 7.3 `account_intent` — the stored score (one row per account)

`tenant_id`, `account_id` (pk pair), `score int`, `stage text`, `factors
jsonb`, `top_signal_ids uuid[]`, `summary text` (AI), `summary_hash`,
`stage_changed_at`, `snoozed_until`, `marked_not_in_market_at`,
`computed_at`. Recomputed on every new signal for that account (event) and
nightly for decay. This is the row every surface reads.

### 7.4 `signal_runs` — cost control and the status line

`id`, `tenant_id`, `source`, `started_at`, `finished_at`, `items_seen`,
`items_new`, `items_matched`, `items_queued`, `ai_units`, `provider_calls`,
`error`. Daily totals per tenant drive the budget gate.

### 7.5 `account_aliases`

`tenant_id`, `account_id`, `alias text`, `lang` — learnt from "It's this
account" decisions and admin edits; the matcher reads account name +
aliases + domain. Unique `(tenant_id, alias)`.

### 7.6 Not owned by Signals (read only)

`marketing_link_clicks` (newsletter doc §3), `quote_link_events`
(sales-engine 0118), `leads`, `domain_event`, `web_visits` (the platform's
snippet table, §9.2), `tenant_connectors` (secrets). Config:
`TenantConfig.signals = { half_life_days?, daily_ai_units?, sources?:
Record<source, {enabled}> , tender_portals?: ("etimad"|"monaqasat")[] }`.

### 7.7 Degrade cleanly

A missing table (42P01) renders the list page as its empty state, hides
the Account 360 card and the account tab, and makes the segment fields
evaluate false — the migration is applied by hand and may be pending.

---

## 8. Isolation, SSRF, rate limits, cost

- `requireTenantUser()` first on every route; `tenantId` only from it.
  Collectors run from crons with the admin client and iterate tenants
  explicitly, every query `.eq("tenant_id", tenantId)`.
- Every `account_id`, `contact_id`, `campaign_id`, `topic_id` taken from a
  request body is verified with `.eq("id", x).eq("tenant_id", tenantId)`
  before use (guardrails: unverified foreign ids are the recurring bug).
- Fetches: provider hosts are constants in code; tender portals are a fixed
  allow-list; the only tenant-typed URL (a pasted tender link) goes through
  `assertSafeHttpsUrl` and is stored, never fetched server-side in v1.
  Redirects are never followed (`redirect: "manual"`), 6 s timeout, 1 MB
  body cap, `cache: "no-store"`.
- Rate limits per tenant per day: news queries ≤ 4 topics + 50 accounts;
  tender pages ≤ 20 fetches; provider calls per the connector tier; AI
  units per §6. Per-run bounds: 200 items, 25 s wall clock, continue next
  run (the mailbox poller's shape).
- `unstable_cache` keys always include `tenantId` (news does already).
- Public beacon route: no auth, but it accepts only a signed token or an
  anonymous session, rate-limited per IP, writes through the admin client
  with the tenant resolved from the snippet's site key (a per-tenant random
  id, not a guessable slug), and never echoes anything back.
- API: `signals` goes in `EXPLICIT_SCOPE_ONLY` (`api/v1/_auth.ts`) — it is
  behavioural data about named contacts; existing `objects: ["*"]` keys must
  not gain it silently.
- Money and margin never appear in a signal headline or evidence (quote
  totals are referenced by ref, not amount, so the v1 API and MCP can expose
  signals without leaking pricing).

---

## 9. Integration points (owner rule: nothing standalone)

### 9.0 What this design assumes the marketing platform blueprint provides

`docs/marketing-platform-architecture.md` is being written in parallel.
Until it lands, Signals assumes — and will be aligned to — these platform
pieces, with the names used here as placeholders:

| Platform piece (assumed) | Signals' relationship |
|---|---|
| **Shared identity model** incl. anonymous visitors (`visitor_id` → `contact_id` → `account_id` resolution, with the signed email-link token as one resolver) | Signals never resolves identity itself; it reads the resolved ids. Company-level reverse-IP is contributed by Signals' connector *into* the identity model as a resolver, not kept privately. |
| **One engagement/event stream** (`domain_event` from Piece A, extended with `email.clicked`, `newsletter.clicked`, `form.submitted`, `web.visited`, `quote.opened`, `rfq.created`, `case.created`, `invoice.overdue`) | Signals is a **consumer**: one subscriber maps events → signals (§7.1). It is also a **producer**: `signal.observed`, `signal.stage_changed`, `signal.unmatched` for everyone else. |
| **One consent model** (`consent` records per contact: marketing email, click tracking, identified web, with the preference centre) | Signals reads consent before scoring any person-level signal; no consent → the event is counted anonymously and scores nothing person-level. |
| **One scoring framework** (`src/lib/scoring/` factor contract) | Intent score, Account 360 health and lead score are three rubrics on one contract (§9.3). |
| **One audience model** (Segments / target groups) | Score, stage, topic are segment fields (§9.1). |
| **Automation journeys** (rules layer, sales-engine §5) | Signals fires events; journeys act (§9.5). |
| **One website snippet + consent banner** | Signals adds nothing to the page (§9.2). |
| **Forms / landing pages** | A form submit is a "They asked us" signal (15) with the form's topic. |

If the blueprint names these differently, rename here — the shapes are
designed to fit.

### 9.1 Segments and target groups (audience)

Three fields are added to `SEGMENT_FIELDS` (`src/lib/marketingSegmentation.ts`
— the file's own extensibility point): `intent_score` (number: gt/lt),
`buying_stage` (select: Quiet/Looking/Comparing/Deciding), `signal_topic`
(select from the tenant's topics: "has a signal on topic X in the last 30
days"). The recipient resolver computes them from `account_intent` and
`account_signals` the same way `computeAccountSignals` computes
`has_active_amc`. Result: *"Comparing + topic Precast + Riyadh"* is a saved
target group, usable by campaigns, newsletters and Coverage with no new UI.
"Add to segment" on the list is a shortcut that creates/extends a target
group with explicit `include_account_ids`.

### 9.2 One website snippet, one consent banner

The platform's snippet (`<script src="…/s.js" data-site="<site key>">`) is
the only code a tenant installs. Signals consumes `web.visited` events and
the identity resolution; it contributes the reverse-IP resolver (Phase 2)
as a server-side enrichment of the visitor record, behind the same consent
state the banner sets. The Sources page shows the snippet status but links
to the platform's web-tracking settings rather than hosting a copy.

### 9.3 One scoring framework, three questions

| Number | Question | Owner | Inputs | Where it shows |
|---|---|---|---|---|
| **Account health** (Account 360 rating) | How is the relationship? (past/present) | `account360/rating.ts` | recency, win rate, payment, service, depth | Account 360 header |
| **In-market score + stage** (this doc) | Are they buying soon? (next 90 days) | `signals/rubric.ts` | the signals in §5 | List, account tab, Account 360 card, segments |
| **Lead score** (platform blueprint) | Is this person's lead ready for sales? | platform | lead fields + **the account's stage as one factor** (Deciding +20, Comparing +10) + the person's own clicks | Leads list |

All three return the same `Factor` shape and render through one "how this
is worked out" component. None folds into another: a healthy account that
is Quiet and a troubled account that is Deciding are both true and both
actionable. There is no fourth number.

### 9.4 Newsletter Studio and campaigns

- `signal_topics` is the shared topic list: a newsletter block (and any
  campaign link) carries an optional `topic_id`; the click route already
  records `link_index` → the version's link list → topic. Signals reads
  `marketing_link_clicks` and never installs a second click tracker.
- Audiences: Newsletter Studio's recipient picker offers the three segment
  fields of §9.1, so "send the Precast issue to everyone Comparing on
  Precast" is one target group.
- "Did it work?" (§4.3) is the same component on campaigns and newsletters,
  fed by `account_intent` history (a nightly `account_intent_history` row
  per account per day for 90 days — small, and it is what the before/after
  reads).

### 9.5 Automation journeys, tasks, Coverage, Nova

Events Signals emits on the shared stream: `signal.observed` (payload: the
signal row), `signal.stage_changed` (from, to, score, factors),
`signal.unmatched` (queue item). Consumers:
- **Automation rules** (sales-engine §5.2–5.3) — e.g. *on
  `signal.stage_changed` to Deciding → `create_task` for the owner, due 2
  days; `notify` the team; `add_comment`*. Seeded defaults per tenant, off
  until an admin turns them on.
- **Coverage** — "the owner" is resolved through
  `resolveCoverageForAccount` (owner team) when the account has no explicit
  owner, so the task and the Nova mention land with the right team.
- **Nova inbox / timeline** — via the `notify` action's `record_comments`
  row (§4.5); no bespoke inbox code.
- **Nova Crew (Growth agent)** — a future consumer of `signal.stage_changed`
  that drafts an outreach for approval; nothing in Signals is written for
  it specifically.
- **Segment membership** — recomputed on `signal.stage_changed` for saved
  target groups that use the three fields, so journeys keyed on "entered
  segment" fire without polling.

### 9.6 Feedback into "did marketing move these accounts"

Every campaign/newsletter send writes `campaign_id` onto the recipient's
first-party signals that follow (click, interest, quote opened within 14
days carry `object_type: campaign` as attribution), so "Did it work?" can
say *what happened* per account, not just that the score rose. The
module-level line and the campaign tab read the same history.

### 9.7 Sales, Service, Nova — where a signal plugs in

- Quote/deal record: a "Signals" fact in the header strip when the account
  is Comparing or Deciding (*"In market · Deciding"*).
- Case record: when a replacement signal fires, the case shows *"Possible
  sale — open a quote"* as a quiet action.
- Estimator: "start from the customer's email" also creates the inquiry
  signal (via the existing event, not a new call).
- Dashboard tile: "In market this week" count with the top three names.

---

## 10. §3b checklist — executed in full (skips stated)

| # | Item | Decision |
|---|---|---|
| 1 | DB | Tables §7, RLS select-only + no write policy, migration 0135, ledger entry pending both DBs, degrade on 42P01, `scripts/seed-signals-demo.sql` (topics Precast/HVAC/Fire safety, ~40 signals over 60 days for the demo accounts, flips `buying_signals` on for `is_demo`). `custom_data` on `signal_topics` only — **skip on `account_signals`** (system rows). |
| 2 | Types & registry | `AccountSignal`, `SignalTopic`, `AccountIntent` in `types.ts`. **Master ref: skip** for signals (not a document anyone quotes); `signal_topics` get `TOP-####` so they can be referenced in exports. `PilotObjectType` + `PILOT_OBJECT_TYPES` + `FIELD_REGISTRY` for **topics**; signals are listed read-only. |
| 3 | Custom fields | `signal_topics` in `VALID_OBJECTS` + tab (featureKey `buying_signals`); PATCH accepts `cf_`. Signals: **skip**, stated. |
| 3½ | CRUD + screens | `/api/signals` (GET list, POST = paste a tender/news item), `/api/signals/[id]` (PATCH match/dismiss/snooze only, no DELETE — dismissed rows are kept for dedupe), `/api/signal-topics` + `[id]` (full CRUD, admin), `/api/signals/intent/[accountId]` (GET), `/api/signals/campaign/[id]` ("Did it work?"), `/api/signals/cron/{news,tenders,jobs,registry,providers,rescore}`. Pages: list (§4.1), topics settings, account tab, campaign tab. `ROUTES`, `NAV` item "Buying signals" in the Marketing group with `featureKey: buying_signals`, `workcenterKey: signals` + catalog entry. Flag in `TenantFeatures`, `TenantEditor` FEATURES, `DEFAULT_FEATURES` off. |
| 4 | Data Workbench | **Export** signals and intent (with real ids). **Import/Update of signals: skipped** — they are generated, and a hand-typed signal would corrupt the score; the comment in `DataWorkbenchClient.tsx` says so. Topics: import/export/update in full (match on `id`). |
| 5 | v1 API | `LIST_SOURCES` `signals` and `account_intent` (field whitelist, no amounts); `GET /api/v1/signals`, `/api/v1/signals/[id]`, `/api/v1/accounts/[id]/intent`; feature gate; `API_ENTITIES` defs (OpenAPI); `/api/v1` index, `SCOPABLE_OBJECTS`, Settings endpoint table; **`EXPLICIT_SCOPE_ONLY` += signals, account_intent**; internal-only: `match_candidates`, `ai_reason` excluded from every select. |
| 6 | MCP | `list_signals`, `get_account_intent`, `list_signal_topics`; version bump. |
| 7 | Cross-cutting | `OBJECT_FEATURE`: `signals`, `account_intent`, `signal_topics` → `buying_signals`. Change history on topics and on match/dismiss/snooze decisions; dropdown entries. Global search: **topics only** (people look topics up; signals are found through the account). Advanced filter + saved queries on the list. Nova timeline: via comment rows (§4.5); `OBJECTS`/`LABEL`/`TABLE`/`ROUTE_FOR` need **no** new entry because the object mentioned is the account. ⌘K: "Who is in market", "New topic". |
| 7½ | Analytics | `AnalyticsMetricId` `accounts_in_market` (count of Comparing+Deciding) and `marketing_moved_accounts` (30-day); labels; dashboard tile; `METRIC_META`. |
| 7¾ | Cross-object | §9 — segments, campaigns, newsletters, Coverage, rules, Account 360, quote/case/deal headers, estimator. Deferred: web personalisation, ad export beyond DW. |
| 8 | Docs | Marketing Guide (new chapter "Buying signals"), Admin & Setup (topics, sources, consent), API guide (three endpoints, explicit scope). After the owner validates (memory: docs after testing). |
| 9 | Prove it | `tsc`, `vitest` (rubric, decay, stage rules, matcher thresholds, classifier eval, objectFeatures test), `next build`; commit lists the SQL files. |

---

## 11. Phases (each ends: tests + build clean, demo tenant, owner validates before the next)

| Phase | Delivers | Impressive, honestly |
|---|---|---|
| **1a — Spine** | Tables, rubric, stage rules, `account_intent`, the list page with first-party signals only (quotes, RFQs, estimates, cases, contracts, interest clicks, unsubscribes), Account 360 card + suggestion, account tab, Nova alerts via rules, segment fields, feature flag, demo seed. | A ranked "Who is in market" list that is right on day one for a tenant that already quotes and services — nothing bought, nothing scraped. |
| **1b — Market** | Topics, news collector + AI classification with citations, tender collector (Etimad/Monaqasat public listings + paste), "Check these" queue, aliases. | Tenders and news with the article linked under the account that is about to buy. The 6sense moment, from public sources. |
| **1c — Did it work?** | Campaign/newsletter engagement from `marketing_link_clicks` (needs Newsletter Studio phase 1 or the campaign click route), intent history, the "Did it work?" tab and the module line. | Marketing can show the owner names, not open rates. |
| **2** | Website identified visits via the platform snippet; reverse-IP connector; jobs; Wathq/MCA registry; Etimad API connector. | "Someone at Najd Precast looked at the catalogue yesterday." |
| **3** | Bombora / G2 / own-6sense connectors; weekly pull; provider cap. | Enterprise tenants plug in what they already pay for. |

Gates: `buying_signals` is a sold-module flag (default off). Phase 2's
reverse-IP and Phase 3 connectors additionally require the admin to accept
the provider's terms in Settings (stored with who/when).

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| **Wrong account matched** (a tender for "Al Najd Trading" lands on "Najd Precast") | Threshold 0.7 with name + city + domain evidence; below it → queue; aliases learnt; "Not relevant" remembered; every matched item shows its reason and a one-click "wrong account". |
| **Noise inflates scores** (one newsletter click = Deciding) | Group caps, decay, stage rule 1 requires a first-party ask. |
| **Privacy** (identified web, opens, person data) | Consent model first; opens off by default; company-level IP only; no purchased person data; PII never in evidence text; `EXPLICIT_SCOPE_ONLY`. |
| **Data cost runs away** (AI classification, provider calls) | Per-tenant daily budgets in `signal_runs`, content-hash cache, bounded runs, visible on the Sources page. |
| **Unofficial feeds break** (Google News RSS, tender HTML) | Same stance as `news.ts`: degrade to empty, status line says "not reachable since …", paste path remains. |
| **Three competing numbers** | §9.3 — one framework, three questions, cross-referenced, never folded. |
| **Looks like old CRM** | Mock-up first; plain words; no provider names on the main screens; the rubric is a collapsed "how this is worked out". |
| **Reps distrust the list** | "Not in market" feedback is stored, shown, and reported monthly as a precision number (how many Deciding accounts were marked wrong). |

---

## 13. Open questions for the owner (few, concrete)

1. **Name:** "Buying signals" / "Who is in market" — or "Radar"? (This doc
   assumes the former; a rename touches labels only.)
2. **Rubric editing:** read-only weights with two dials (recommended), or let
   an admin edit points per signal kind?
3. **Tender portals in v1:** read the public listing pages (works today,
   unofficial) or wait for the Etimad API connector in Phase 2?
4. **Opens:** stay off by default everywhere (recommended) — same question
   as Newsletter Studio's #2; one answer for both.
5. **Reverse-IP provider:** which one to trial on the demo tenant's own
   site for GCC match-rate before it is sold?

---

## 14. Sources used for this design

Codebase: `src/lib/account360/{types,rating,server,externalSource}.ts`,
`src/lib/net/safeHost.ts`, `src/lib/data/news.ts`, `src/lib/nova/marketIntel.ts`,
`src/components/NovaAccountMarketSignals.tsx`, `src/lib/marketingSegmentation.ts`,
`src/lib/coverage/resolve.ts`, `src/lib/campaignInterestLink.ts`,
`src/lib/emailLog.ts`, `src/lib/connectors/{types,registry,server}.ts`,
`src/lib/objectFeatures.ts`, `src/app/api/v1/_auth.ts`,
`src/app/api/nova/inbox/route.ts`, `src/app/api/marketing/campaigns/[id]/send/route.ts`,
`docs/newsletter-studio-architecture.md`, `docs/sales-engine-architecture.md`
§5 and §7.4, `docs/nova-crew-architecture.md` Piece A, `docs/rfq-architecture.md`,
`docs/estimator-architecture.md` §15, `docs/ui-restructure-spec.md`, `vercel.json` crons.

Web (read 2026-10-19; third-party pricing is directional, verify before quoting):
- 6sense capabilities and 2026 updates: https://www.usergems.com/blog/6sense-review-2026 · https://www.demandgenreport.com/industry-news/6sense-reveals-new-ai-platform-teases-upcoming-product-innovations/7320/ · https://reply.io/blog/6sense-pricing/ · https://www.uplead.com/what-is-6sense/
- Bombora pricing: https://docket.io/resources/research/bombora-pricing · https://www.vendr.com/marketplace/bombora · https://www.enginy.ai/blog/bombora-pricing
- G2 Buyer Intent: https://documentation.g2.com/docs/de/buyer-intent · https://www.costbench.com/software/sales-intelligence/g2-buyer-intent/ · https://abmatic.ai/blog/g2-pricing-too-expensive-alternatives-2026
- Reverse-IP identification, accuracy and pricing: https://abmatic.ai/blog/website-visitor-identification-pricing-guide-2026 · https://happierleads.com/blog/reverse-ip-lookup-accuracy-benchmark-2026 · https://www.kwanzoo.com/blog/b2b-website-visitor-identification-tools-2026
- GDPR / ePrivacy and visitor identification: https://abmatic.ai/blog/is-website-visitor-identification-gdpr-compliant · https://mojoauth.com/blog/anonymous-website-visitor-identification-gdpr-ccpa-tools · https://happierleads.com/blog/gdpr-website-visitor-identification-eu-rules-2026
- Saudi PDPL, cookies and direct marketing: https://resourcehub.bakermckenzie.com/en/resources/global-data-and-cyber-handbook/emea/saudi-arabia/topics/cookies-online-tracking-and-direct-marketing · https://www.cookiehub.com/pdpl · https://flexyconsent.com/blog/saudi-arabia-pdpl-cookie-consent-guide/
- Qatar Law 13/2016 direct marketing: https://www.clydeco.com/es/insights/2021/03/new-regulatory-guidelines-on-the-qatar-persona-1 · https://www.mondaq.com/privacy-protection/544052/new-national-privacy-law-in-qatar · https://consentstack.io/regulations/qa-pdppl
- India DPDP Act and Rules 2025: https://ca.hoganlovells.com/en/publications/indias-digital-personal-data-protection-act-2023-brought-into-force- · https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/ · https://www.seclore.com/fundamentals/dpdp-rules-2025-compliance-guide/
- Etimad (Saudi tenders) and its developer portal: https://noqta.tn/en/blog/etimad-api-government-procurement-saudi-2026 · https://www.hrsd.gov.sa/en/ministry/about-ministry/competitions-and-purchases · https://openopps.com/blog/how-to-win-government-contracts-and-tenders-in-saudi-arabia-2026
- Monaqasat (Qatar tenders) public listing: https://monaqasat.mof.gov.qa/TendersOnlineServices/SearchTenders/1222
- Wathq (Saudi commercial registry API): https://mc.gov.sa/en/mediacenter/News/Pages/02-11-19-01.aspx · https://noqta.tn/en/blog/maroof-wathq-api-business-verification-saudi-2026 · https://businessdataguide.com/blog/jurisdictions/saudi-arabia-company-search-guide
- Job-posting data providers: https://crustdata.com/blog/best-apis-for-job-posting-data · https://theirstack.com/docs · https://pipeline.zoominfo.com/sales/coresignal-review
- Resend open/click tracking and webhooks: https://resend.com/blog/open-and-click-tracking · https://hookdeck.com/webhooks/platforms/guide-to-resend-webhooks-features-and-best-practices.md · https://svix.com/blog/using-resend-webhooks-for-email-status-alerts
