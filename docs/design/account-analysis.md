# Company analysis — BPMSquare's own "what is this company doing, and do they want business?"

Design 2026-10-22 (Fable). Owner ask, verbatim intent: he saw 6sense's company analysis through its
MCP in an AI tool — what the company is doing, which websites they visit, who the contact person is,
whether they want business — and asked *"Why can't we have something like that? I want BPMSquare's OWN
analysis, not 6sense's MCP."* Addition the same day: it must be a **first-class ability of the AI
slider** (analyse any company by name or domain, consent first, follow-ups in the chat, start from the
cached analysis on an account page), not only an Account 360 card.

Rules applied: bpmsquarecore 3b, 6b, 6c, 10, 10a (a score is an explainable rubric, never an AI
number; tenant-typed URLs only through `assertSafeHttpsUrl`/`fetchPublic`); MULTI_TENANT_GUARDRAILS;
`docs/signals-architecture.md` (what we match of 6sense and what we do not); `docs/design/assistant-smarter.md`
(consented research WP4, confirm cards WP5); `docs/design/ux-simplification.md`.

**One sentence:** the analysis is one card, built from three things we already have — the tenant's
own records, the Buying signals score, and the consented web research call — plus one new cache table;
AI classifies and phrases, every claim carries a source and a date, no number comes from the model.

## Owner corrections 2026-10-22 evening (these OVERRIDE the card sections below wherever they differ)
1. **Summary and highlights, not web pages.** The user reads a short written summary and a few highlight lines. No source links are shown, no "Sources" block at the end of the card. Source URLs and dates are still stored with the analysis (audit, QA, "what changed") but are not drawn on screen.
2. **Less about the company, more about what they are doing and whether to follow up.** No company profile paragraph (what they make, size, history) beyond one line of identity. The card leads with a verdict and why.
3. **Say what we have about this account in our own system.** A short block from our data: the account (type, owner, since), contacts and roles known, open quotes/deals and their value, open cases, invoices due, last contact and what happened, and what is missing (for example no procurement contact). For a company that is not an account yet: "Not in your system yet" plus similar existing accounts.
4. **Card layout (replaces the section list):** (a) **Verdict**: "Worth following up: Yes / Not now / Unclear" with one sentence of reason and the explainable Fit and Timing factors behind an expandable line; (b) **What they are doing**: 3 to 5 highlight bullets, newest first, each one line, dated in words ("last month"), classified to the client's topics; (c) **What we have**: the in-system block above; (d) **Next steps**: the confirm-card actions. Nothing else on the card. No sources block, no website-visit block unless there were visits (then one line), no long "who to talk to" list: contacts appear only inside "What we have" with the gaps.
5. **Display**: the analysis is returned as structured fields and rendered by the card; model text is never shown with raw markdown markers (the dock resolves bold/lists before display, see the dock fixes).

## 0. What is already there (checked on `develop` before designing)

| Looked at | What it gives | Reused as |
|---|---|---|
| `src/lib/nova/marketIntel.ts` + `api/nova/market-intel` + `NovaAccountMarketSignals.tsx` | **web research about an account already works on our key**: Anthropic server tool `web_search` (max 4), JSON `{summary, signals[], sources[]}`, account id tenant-verified before the name goes out, user-action only, sessionStorage cache, Nova-gated | the "What is happening" section is this call, re-prompted for structured, sourced claims; the button and component are **retired into** the analysis (rule 6c: one implementation, not two) |
| `docs/design/assistant-smarter.md` WP4 (`assistant/research.ts`, `propose_web_search`, consent chips, `webQueryAllowed`, `ai_assistant_web` flag, `assistant_actions` audit, migration 0204) | consented, isolated, metered research; the query must come from the user's words or the record's title | the slider ability is one more proposal kind on the same chips and the same isolated call |
| assistant-smarter WP5 (action registry, `ConfirmCard`, `POST /api/ai/act`) | writes only through a card the person presses | every "next step" of the analysis |
| `src/lib/signals/*` (built: rubric, stage, `account_intent` 0176, `account_intent_history` 0177, `signal_runs` 0178, `signal_topics` 0175, list page, Account 360 card `buying_signals`, `nextStep`, `movement`, `reasonLine`) | the **timing** half: score 0–100 with factors, stage Quiet/Looking/Comparing/Deciding, first-party sources quotes/deals/cases/contracts/campaigns/newsletters/team; group "They are moving" (cap 20) and "They visited" (cap 15) exist in `GROUPS` but **no collector feeds them yet** (sources today: 7 first-party kinds) | timing is read from `account_intent`, never recomputed here; web triggers found by the analysis **feed the empty "They are moving" group** (§6) |
| `src/lib/account360/{types,rating,server}.ts`, `Account360Drawer.tsx` | card contract (`stats`, `rows`, `empty`, `error`, `spark`), rating rubric with factors, suggestions, `BUILTIN_CARD_IDS` | a summary card `company_analysis` in the drawer; the full card lives in the dock |
| `src/lib/abm/{types,roles,account360}.ts` (`ABM_ROLES` decision_maker/influencer/user/blocker, `roleGaps`, buying-group members per target) | "who to talk to" gaps for accounts in a program | the Contacts section reads these; no second role model |
| `src/lib/marketing/scoring.ts` (`LeadScoreFactor` = `Account360Factor` + kind, market factor from the buying stage) | one factor shape across health / in-market / lead | the fit label's factors use the same shape |
| `src/lib/data/news.ts` (Google News RSS per account name, `unstable_cache` keyed by tenant) | free news lookup | dropped for the analysis: the research call cites real articles with dates; news.ts keeps serving the dashboard block |
| `src/lib/net/safeHost.ts` (`assertSafeHttpsUrl`, `fetchPublic`) | the only way our server fetches a tenant-typed URL | the company website fetch (`website` field, §5.1) |
| `src/lib/connectors/{types,registry,server}.ts`, `tenant_connectors` (0199: member SELECT, admin writes) | connector with encrypted secret, Test, Settings tile | the reverse-IP provider adapter (§5.3) |
| `src/lib/ai/structured.ts` (`askStructuredMetered`, `ai_usage_log`, `allowanceFor`), `assistant/meter.ts`, `config.ai_assistant.monthly_token_budget` | metering and the monthly allowance | every analysis call metered under `surface: company_analysis` |
| `src/lib/coverage/resolve.ts` (`resolveCoverageForAccount`), `accounts.owner_user_id` | who owns the account | the "Next steps" owner |
| `src/lib/marketing/consent.ts` (`CONSENT_CHANNELS` incl. `web_tracking`), `contacts`, `change_log`, `record_comments` | consent, people, last touch | the Contacts section (CRM contacts only) and "what changed" inbox note |
| `Account` type: `name, website, city, country, industry, employee_count, annual_revenue` | the only fields that may ever describe a company to the web | the query whitelist (§7) |

**Not there** (said so to avoid a second search): a website snippet / `web_visits` table (signals §9.2 is
design only), reverse-IP, tender/jobs/registry collectors (signals 1b/2 not built), a `company_key` on
accounts, WP4/WP5 code (designed 2026-10-22, in build).

## 1. The honesty table — what the owner saw, and what BPMSquare can do

| 6sense showed | Can we? | How (ours) | What we cannot do, and why |
|---|---|---|---|
| **What the company is doing** | **Yes** | Consented web research (one isolated call, `web_search` max 4): news, press, projects, tenders, hiring, expansions, funding, leadership changes, the company's own website. Each claim: `{text, kind, source_url, source_title, published_on, confidence}`; classified into the tenant's `signal_topics` and product categories; older than 180 days flagged *stale*; AI synthesises, a claim without a source is dropped by the validator. | Nothing behind paywalls or logins; small GCC/Indian SMEs often have no press — the card says *"Little public information"* rather than padding. No number (revenue, headcount) is written by the model: only a sourced figure with its date, or nothing. |
| **Which websites they are visiting** | **Partly — our own sites only** | (a) Visits to the tenant's **own** website, landing pages, forms, quote links and newsletters: signed-link attribution exists today (quote link events, `marketing_link_clicks`, form submits); the platform snippet (signals §9.2) adds page visits once built. (b) Company-level identification of anonymous visits through a **reverse-IP connector** the tenant licenses (§5.3): realistic match 30–65 %, worse on VPN, mobile carriers, shared offices and remote work; GCC coverage must be tested before it is sold. | **Their browsing on other sites.** That is a third-party data network (6sense/Bombora co-op publishers) we do not own and will not scrape. A tenant that pays for one plugs it in as a connector (signals Phase 3) and we show *their* data labelled with the provider's name. |
| **Who is the contact person** | **Yes, from the tenant's own data and the company's own publications** | (a) Contacts already in the CRM for the account: role, last touch (comments, quotes, emails logged), consent state. (b) Buying-group roles typical for the tenant's products (ABM `required_roles` where in a program, else a default set per account type: decision maker · procurement · engineering/technical · project lead · user) mapped to existing contacts, with **gaps** (*"No one in procurement yet"*). (c) Public leadership and functions the company **itself publishes** (its website, its press releases): name and title only, labelled *Public · from the company's website*, organisation-level, never stored as a contact until a person creates one. | **No bought person data, no social-network scraping, no personal emails or phones from the web** (PDPL, Qatar 13/2016, DPDP, GDPR). A tenant with a licensed person-enrichment provider can connect it later (§11); the analysis never does it for them. |
| **Whether they want business** | **Yes, as an explainable rubric** | **Fit** (to the tenant's segments, products, geography; §6.1) and **Timing** (the Buying signals score and stage, extended by the sourced web triggers; §6.2), each factor named and sourced, shown as *Fit: Strong · Timing: Comparing (58)* with "how this is worked out". The AI writes only the two-sentence *"why now"* and the next-step wording. | No predictive "likelihood to buy" from a model (bpmsquarecore 10a). We trade a few points of lift for a number a rep can defend to the owner. |
| **Next steps** | **Yes, through confirm cards** | Call / email draft / add to segment or campaign / create account / create deal or quote / name a buying-group member — each a WP5 `ConfirmCard` the person presses; nothing runs on its own. | Never automatic, never outward without a press. |

## 2. The analysis card

One card, the same on every surface. Sections in fixed order; a section with nothing says so in one
line (never hidden, never padded). Every line carries a **source pill** (Quote QT-0042 · Newsletter ·
Web ↗ Arab News, 9 Oct · Company website ↗ · Your team) and, for web lines, a confidence mark
(**found** / **unsure**) and *stale* when older than 180 days. Explanations behind `i` (`InfoTip`),
texts in `src/lib/analysis/tips.ts` held by `tipTextProblems`.

```
┌ Company analysis · Najd Precast Co.                 Refreshed 2 h ago · Refresh  (i) ┐
│ Riyadh · Precast concrete · ~450 staff ↗ found (company website, 2026-03)              │
│ Fit  Strong   Timing  Comparing (58) ▲ warming       Worth a call this week  (how? ▾)   │
│ "Why now": Won a SAR 120 m housing package on 9 Oct and asked us for a quote on 12 Oct. │
│                                                                   Summary by AI (i)     │
│ ▸ What they do            3 lines   Web ↗ · Company website ↗                           │
│ ▸ What is happening       4 lines   award · hiring · tender · leadership   (2 stale)    │
│ ▸ Engagement with us      5 lines   Quotes · Newsletters · Cases                        │
│ ▸ Who to talk to          2 contacts · 1 gap (no one in procurement)                     │
│ ▸ Sources                 7 links                                                        │
│ [Call Faisal Al-Harbi] [Draft email] [Add to segment ▾] [Start a quote]  ⋯              │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

| Section | Lines (label · value · source) | Empty / uncertain state |
|---|---|---|
| **Header** | name, city/country, industry, size (only a sourced figure with its date), website | no website: *"Website unknown — add it to the account to improve the research"* |
| **Fit · Timing · verdict** | labels with "how this is worked out" (factors, §6); the verdict is one of *Worth a call this week · Worth watching · Not a fit now · Not enough to say* | not an account: Timing from web triggers only, labelled *"Timing from public sources only — no history with us"* |
| **Why now** | two sentences by AI from the rubric factors only, labelled *Summary by AI* | AI off / allowance spent: the top two factor details verbatim |
| **What they do** | ≤ 3 lines: business, markets, notable customers/projects — each sourced | *"Little public information found"* |
| **What is happening** | ≤ 6 dated lines, kinds: award · project · tender · hiring · expansion · funding · leadership · risk; each classified to a tenant topic when one matches | *"Nothing dated in the last 12 months"*; items > 180 days carry *stale* |
| **Engagement with us** | the latest 5 lines of the Buying signals timeline (quotes, deals, cases, contracts, campaigns, newsletters, team) + open quotes/deals count + last touch | not an account: *"No history — not an account yet"* with **Create account** |
| **Who to talk to** | CRM contacts (name, title, role in buying group, last touch, consent chip); **gaps** per required role; public leadership from the company website (name · title · *Public*), with **Add as contact** (a confirm card; the person types email/phone, never the web) | no contacts: *"No contacts yet"* + gaps list |
| **Our websites they visited** | identified visits (signed links, forms) and, with a reverse-IP connector, company-level visits — *"Someone at Najd Precast viewed the catalogue, 3 days"*; otherwise the line says which of the two is not set up | *"Website visits need the site snippet (Settings → Marketing → Website)"* |
| **Sources** | every URL used, title, date; https only, new tab | — |
| **Next steps** | confirm-card buttons chosen by rule from stage and gaps (§8) | — |

**Where it appears (no new page):**

- **AI slider (dock)** — the full card as a message card (`reply.analysis`), §3. The primary surface.
- **Account page header** — one button **Analyse company** (replaces *Get market signals*); opens the
  dock on the cached card (or starts the consent flow if none). Works on every theme, not Nova only.
- **Account 360 drawer** — built-in card `company_analysis` (summary: stats Fit · Timing · Refreshed;
  rows: the top 5 lines with hrefs; `empty`: *"Not analysed yet — Analyse company"*). Per 10a: added to
  `BUILTIN_CARD_IDS`, `BUILTINS`, `CARD_IDS`. Row click opens the dock card.
- **Buying signals** — the account view in the workspace gets the same **Analyse** button; the list
  row's ⋯ menu gets *Analyse company*.
- **375 px:** the dock is already full screen; sections are disclosures (first two open), buttons wrap
  into a sticky row at the bottom, 44 px targets, no horizontal scroll. Desktop: 400 px dock, or the
  Account 360 summary card at its usual width.

## 3. First-class ability of the AI slider

**Tool:** `analyse_company` in the assistant loop (`src/lib/ai/assistant.ts`), offered when
`ai_assistant_web` is on and the caller may view the Accounts workcenter.

```ts
analyse_company({
  account_id?: string;      // an account on screen or named by the user (tenant-verified before use)
  name?: string;            // "Tesla Germany", "Siemens" — only words from the user's own messages
  domain?: string;          // "siemens.com" — same rule
  country?: string;         // "Saudi Arabia" — same rule
  refresh?: boolean;        // true = ignore the cache (rate-limited, §4)
})
```

**Flow (reuses WP4 and WP5, adds nothing to the loop's rules):**

1. The model calls `analyse_company`. The server resolves the subject: `account_id` → the account's
   `name, website, city, country, industry` (tenant-verified); else the typed name/domain/country through
   `webQueryAllowed` (every word must be in the user's turns or the open record's title).
2. **Cache first.** A fresh row in `company_analyses` for `(tenant_id, company_key)` (§4) → the card
   is returned at once, with *Refreshed 2 h ago · Refresh*; no consent needed, no search, no cost.
3. **Consent chips** (WP4's row, one new kind): *"Analyse Najd Precast Co. with web research? 3
   searches · about 1 % of this month's AI allowance"* · **Yes** · **No** · **Without the web**.
   *Without the web* builds the card from internal data only (sections What they do / What is
   happening read *"Needs web research"*). Yes → the ask is re-sent with `allow_web: "once"`.
4. **One isolated research call** (`assistant/research.ts`, mid model, `web_search` max 4, nothing
   else), prompt = the subject fields + the tenant's topic names + a JSON schema; output validated
   (§7); then the engine (§6) adds engagement, contacts, fit, timing; the AI phrasing call writes
   "why now" (small model, `askStructuredMetered`, factors only as input).
5. The reply carries `analysis: AnalysisCard`; the dock renders `AnalysisCardView` (one component,
   also used by the Account 360 row click). `assistant_actions` gets a row (`kind: analyse_company`,
   subject, sources, tokens, searches).
6. **Follow-ups** work because the card's compact data (≤ 1.5 k tokens: header, factors, lines with
   source ids, contacts by id and title, gaps) is kept in the volatile prompt block as
   `<company_analysis id=…>` data for the rest of the chat. *"Who in procurement?"* → an answer from
   the data (*"No one yet; the company website lists a Procurement Director, Khalid …; shall I add
   him as a contact?"*). *"Draft an email"* → WP5 outward card (draft to a CRM contact with consent;
   never to a public name). *"Add to the Q4 segment"* → `segment.add_accounts` card (only for an
   account; for a non-account the chip offers **Create account** first).
7. **On an account page** the dock's opening chips include **Analyse company** (cached → instant;
   stale → *Refresh?* consent). The `<open_record>` block states whether an analysis exists and its age,
   so "what's new with them?" answers from the cache and offers refresh instead of searching again.

Contract additions to `POST /api/ai/ask` reply: `analysis?: AnalysisCard`, `consent?.kind` gains
`"analyse_company"` with `{ subject, searches, cost_hint }`. `AnalysisCard` (shared type,
`src/lib/analysis/types.ts`):

```ts
type AnalysisCard = {
  id: string; companyKey: string; accountId: string | null; name: string;
  header: { city?: string; country?: string; industry?: string; size?: SourcedValue; website?: string };
  verdict: { fit: FitLabel; timing: { stage: Stage; score: number | null; from: "signals" | "web_only" };
             label: VerdictLabel; factors: Factor[] };        // Factor = signals' {group,label,points,detail}
  whyNow: { text: string; byAi: boolean };
  doing: Claim[]; happening: Claim[]; engagement: Line[]; contacts: ContactLine[]; gaps: Gap[];
  publicPeople: { name: string; title: string; source: SourceRef }[]; visits: Line[] | { unavailable: string };
  sources: SourceRef[]; nextSteps: NextStepCard[];
  refreshedAt: string; stale: boolean; changes?: Change[];     // "what changed since last time"
};
type Claim = { text: string; kind: ClaimKind; topic?: string; source: SourceRef; publishedOn?: string;
               confidence: "found" | "unsure"; stale: boolean };
type SourceRef = { id: string; url: string; title: string; publisher?: string; fetchedAt: string };
```

## 4. Data model, cache and cost

**Migration `0206_company_analysis.sql`** (0204 assistant-smarter and 0205 assistant actions are
claimed; verify the next free number at build time; the owner runs SQL by hand; code degrades while
pending — a 42P01 means "not analysed yet", the research still runs and the card is returned uncached
with *Not saved — database update pending*).

```sql
create table company_analyses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  company_key text not null,          -- normalised domain, else normalised name + country (§5.4)
  account_id uuid references accounts(id) on delete set null,
  name text not null, domain text,
  data jsonb not null,                -- the AnalysisCard minus engagement/contacts (those are rebuilt live)
  previous_data jsonb,                -- last version, for "what changed"
  changes jsonb,                      -- computed diff: new claims, gone claims, verdict moves
  sources jsonb not null,             -- SourceRef[] snapshot (url, title, publisher, fetched_at); never page bodies
  version int not null default 1,
  searches int not null default 0, input_tokens int not null default 0, output_tokens int not null default 0,
  requested_by uuid, computed_at timestamptz not null default now(), expires_at timestamptz not null,
  unique (tenant_id, company_key)
);
-- RLS: members SELECT; NO write policy (service role only) -- the row steers who gets called.
```

- **TTL:** 7 days (`expires_at`); after that the card shows *stale* and offers Refresh; nothing
  refreshes on its own (no cron in v1; §11). **Refresh** at most once per hour per company per tenant;
  a refresh keeps `previous_data` and writes `changes`.
- **Engagement and contacts are never cached** — read live from the tenant's own tables on every
  render (they change daily and cost nothing). Only the web half and the verdict snapshot are stored.
- **Change detection:** `changes = diff(previous_data, data)` by claim `source.url + kind`: *new* ·
  *gone* · verdict/stage moves. Shown as a *"Since last time"* strip at the top of the card and, for an
  account, posted as one `record_comments` system row mentioning the owner (the inbox mechanism Buying
  signals already uses) — only when something new was found.
- **Metering:** `ai_usage_log` rows with `surface: company_analysis` (research call + phrasing call,
  plus WP4's flat 5 000-token surcharge per search); counts against `config.ai_assistant.monthly_token_budget`
  through `allowanceFor`. **Per-tenant daily cap** `config.company_analysis.daily_limit` (default 30
  analyses/refreshes a day; `TenantConfig` type updated); over it: the cached card still shows, the
  consent chip says *"Daily limit reached — tomorrow"*. Both numbers appear on Settings → AI usage
  (assistant S4) as two lines, nowhere else (rule 6c, one place).
- **Retention:** rows for companies that are not accounts are deleted after 90 days unused
  (`computed_at`), in the nightly signals rescore cron (one extra delete, tenant-scoped).

## 5. Collectors and sources, per phase

### 5.1 Phase 1 (this design) — public web through the research tool; one fixed fetch
- **Web research** = the Anthropic `web_search` server tool only. We never fetch search results
  ourselves (no SSRF, no robots, no HTML parsing). The prompt asks for: company profile, 12 months of
  dated items, public leadership from the company's own site, tenders naming the company, job postings
  — each with URL, title, date; *return nothing rather than guess*.
- **Company website** (`accounts.website` or the typed domain): one `fetchPublic` GET of the home page
  and `/about`-like links found on it (≤ 3 fetches, 1 MB cap, 6 s timeout, redirects manual) through
  `assertSafeHttpsUrl` — to confirm the domain, read the published description and leadership page.
  Stored: text excerpts ≤ 300 chars per claim, never the page.
- **Tenders / jobs / registries** (Etimad, Monaqasat, Wathq, MCA, Indian/German registers) are **not
  fetched by the analysis**; they reach the card the day the Buying signals collectors (signals §3.1–3.2)
  land, as "They are moving" signals. Until then the web research may cite a tender page it found.
- **Internal:** `account_intent` + timeline (`loadAccountSignals`), `contacts`, `abm_*`, `quotes`,
  `opportunities`, `service_cases`, `contracts`, `record_comments`, `change_log` — all through the
  session client or admin client with `.eq("tenant_id", tenantId)`.

### 5.2 Phase 2 — the tenant's own web traffic
Needs the platform snippet (signals §9.2, not built). The analysis only *reads* `web_visits` once it
exists; it adds nothing to the page. Identified visits require the contact's `web_tracking` consent
(exists in `CONSENT_CHANNELS`).

### 5.3 Reverse-IP provider — a connector adapter, provider chosen by the tenant
```ts
// src/lib/analysis/reverseIp/types.ts
type ReverseIpProvider = {
  id: "snitcher" | "dealfront" | "ipinfo_company";   // fixed hosts in code
  lookup(ip: string, ctx: { tenantId: string; secret: string }): Promise<{
    domain: string | null; name: string | null; city?: string; country?: string;
    confidence: number;            // provider's own, normalised 0–1
    isp: boolean;                  // carrier/ISP/VPN ranges are never matched to a company
  } | null>;
};
```
Registered as `ConnectorDef` `reverse_ip` (api_key, `testable`, admin-only, secret encrypted by
`connectors/server.ts`); called server-side from the beacon route only; the browser never sees the
provider. Matched to an account by **domain equality** (then alias), confidence ≥ 0.7, `isp: false`;
else the visit stays anonymous. Candidates (verify pricing, test GCC match rate on the demo site
before selling): **Snitcher** (self-serve, GDPR-minded, EU/US-strong); **Dealfront/Leadfeeder**
(largest B2B database, pricier); **IPinfo Company API** (cheapest, broad IP→org data, weaker on
"which company is behind this office IP" than the two above). Not chosen blindly: open decision 4.

### 5.4 Matching, false positives, "check these"
`company_key` = normalised domain when known (`najdprecast.com`); else `slug(name) + "|" + country`.
Research results are matched to the subject by **domain** first, then name similarity + city; a claim
about a same-named other company (a *"Najd Trading"* for *"Najd Precast"*) is kept out when the model
marks `about_subject: false` **and** the validator finds neither the domain nor the full name in the
source title/snippet. Claims the validator cannot attach stay in a collapsed *"Check these (2)"* fold
on the card with *"It's them"* / *"Not them"*; nothing in that fold scores or feeds signals until a
person decides (the signals doc's queue rule, kept on the card instead of a second screen).

### 5.5 Consent and privacy
- Stored: claims, sources (url/title/date), public leadership name + title, the verdict snapshot.
  Never: page bodies, personal emails/phones from the web, social profiles, anything about a named
  individual beyond title and employer as published by the employer itself.
- Who sees it: members with the Accounts workcenter view; the Account 360 summary follows the drawer's
  own rules; the v1 API only with an explicit scope (§8).
- Lawful basis note (counsel reviews before sale): company-level public information and the tenant's
  own first-party records; identified visits need `web_tracking` consent; reverse-IP is company-level
  only and runs on consented sessions in the EU; India DPDP and Saudi PDPL — no person-level data is
  collected from the web, so no notice beyond the existing marketing consent is created by this feature.
- Deletion: a deleted account sets `account_id` null; "Not them" removes the claim; the 90-day sweep.

## 6. Scoring — a fit label and the existing timing score, never a third number

### 6.1 Fit (`src/lib/analysis/fit.ts`, pure, tested) — a label with factors, not a 0–100
| Factor | Points | Detail pattern | Source |
|---|---|---|---|
| Industry matches a tenant segment / product category | +3 | "Precast concrete matches your segment 'Precast'" | account.industry or web claim, topic match |
| Country / city inside a Coverage area | +2 | "Riyadh is covered by Central team" | coverage rules |
| Size in the tenant's sweet spot (admin-set band, default any) | +1 | "~450 staff (company website, Mar 2026)" | sourced size only |
| Web claims classified into ≥ 1 tenant topic | +2 (max) | "2 items on 'Precast'" | research + topics |
| Already a customer (won quote / live contract) | +2 | "Customer since 2024" | quotes, contracts |
| Marked "Not in market" by the team (≤ 30 d) | −3 | | account_intent |
| Risk claims (default, closure, layoffs) | −2 | "Layoffs reported (Gulf News, Aug)" | research |
Label: **Strong** ≥ 6 · **Partial** 3–5 · **Weak** ≤ 2 · **Unknown** when fewer than two factors have
data. Weights are defaults in code, stored per tenant in `config.company_analysis.fit_weights`
(editable later from Settings → AI usage; no UI in v1, stated).

### 6.2 Timing — reuse, then extend the Buying signals score
- For an account, Timing **is** `account_intent` (score, stage, factors, movement) — read, not
  recomputed. No new number.
- **Extension (the real gain):** sourced web claims of kind award/project/tender/hiring/expansion/
  funding (confidence found, not stale, `about_subject`) are written as `RawSignal`s with a new
  `SignalSource` **`web`** and kinds in the empty **"They are moving"** group using the points the
  signals doc already fixed (tender issued 14 · tender named 8 · award/expansion/funding 8 max 2 ·
  hiring 5 max 2 · risk −6), key = `web:<source url hash>`, `occurredAt` = the item's date. The
  recompute reads them from `company_analyses.data` for matched accounts; decay and caps apply as for
  every other signal. Result: an analysis of an account can lift its stage, visibly, with the article
  linked under the factor — and "They are moving" stops being an empty group.
- For a non-account, Timing is computed by the same rubric over the web signals only and labelled
  *"from public sources only"*; the stage rule needing a first-party "asked" signal means it can
  never read Deciding — correct: we have no history with them.

### 6.3 Verdict (fixed rules, in order)
1. **Worth a call this week** — Fit Strong/Partial **and** stage Comparing/Deciding, or a dated trigger
   ≤ 30 days with Fit Strong. 2. **Worth watching** — Fit Strong/Partial and stage Looking, or any
   trigger ≤ 90 days. 3. **Not a fit now** — Fit Weak. 4. **Not enough to say** — Fit Unknown.
"How this is worked out" lists the fit factors and the timing factors in one `Factor` list through
the existing "how this is worked out" component. AI never changes a point or a label.

## 7. Prompt-injection and tenancy safety

- **Web text is data.** It enters only through the isolated research call and comes back as JSON
  validated by `validateResearch()` (pure, tested): every claim needs an https `source_url` from the
  call's own citation blocks; unknown keys dropped; text ≤ 300 chars, no markup; dates parsed or
  removed; a claim whose text contains an instruction-like pattern is kept but never summarised to the
  model that writes "why now" (that call receives **factors only**, never claim text). The main loop's
  rule stands: no navigate/open/action because web text says so.
- **What leaves the workspace:** only `name, website domain, city, country, industry` of the one
  account the user analyses (tenant-verified by `.eq("id", x).eq("tenant_id", tenantId)`), or the words
  the user typed (`webQueryAllowed`). Never notes, contacts, emails, phones, custom data, amounts.
  Topic **names** go out (they are the tenant's product words, not personal data); the test
  `analysis.prompt.test.ts` asserts the prompt contains nothing else.
- **Every read tenant-scoped**; the cache key is `(tenant_id, company_key)` — two tenants analysing the
  same company hold separate rows (their engagement differs and one tenant's row must never tell another
  the company was analysed). No module-level cache.
- **Permissions:** tool offered and routes answer only for callers with the Accounts workcenter view
  (`canViewWorkcenter`); Refresh and non-account analysis for the same; budget settings admin-only;
  `ai_assistant_web` off → tool absent, routes 403, the Account 360 card reads *"Web research is off"*.
- **Actions:** every next step is a WP5 card with its own tier (outward: email; write: create/segment);
  one execution per card id; the card restates the act. Public people become contacts only through a
  card the person completes.
- **Fetch guard:** the only server-side fetch of a tenant-typed URL (the website) is `fetchPublic` after
  `assertSafeHttpsUrl`; providers are fixed hosts.

## 8. Integration points (nothing standalone)

| Area | What the analysis does there |
|---|---|
| **AI slider** | `analyse_company` tool, consent chip kind, card render, follow-up context, account-page start-from-cache + Refresh (§3) |
| **Account 360** | built-in summary card `company_analysis`; a suggestion *"Analysis found a new trigger: … (9 Oct)"* when `changes` has new claims ≤ 7 days |
| **Buying signals** | web claims feed the "They are moving" group (§6.2); `SignalSource` gains `web` (label *Web*); the account view's Analyse button; list ⋯ *Analyse company*; the Sources settings row *Web research* shows on/off and the daily limit (read-only, links to AI usage) |
| **ABM** | required roles → the gaps list; *Name a buying-group member* card prefilled with target id; a program's target table gets a *Fit* column read from the cache (no recompute) |
| **Campaigns / newsletters / segments** | *Add to segment* and *Add to campaign* cards; the fit label is **not** a segment field in v1 (stated; `buying_stage` already is) |
| **Coverage / owners** | next steps address the resolved owner; the "since last time" comment mentions them |
| **Nova inbox / timeline** | one system comment per refresh with new claims (dedupe key `analysis:<id>:<version>`), via `record_comments` — no new inbox code |
| **Assistant ask / guide / create / briefing** | ask: from the cache; guide: *"how do I analyse a company?"* step on the account manifest; create: *Create account* card prefilled from the header (website, industry, city — never email/phone); briefing: *"2 analysed accounts moved up a stage"* line (WP7 rule, later) |
| **Data Workbench** | **Export** `company_analyses` (id, account id, name, fit, timing, verdict, refreshed, source count); no import/update (system rows; comment in `DataWorkbenchClient.tsx`) |
| **v1 API / MCP** | `GET /api/v1/accounts/[id]/analysis` through `authorizeApi`, `OBJECT_FEATURE.company_analyses = "ai_assistant_web"`, **`EXPLICIT_SCOPE_ONLY` += `company_analyses`** (names of people, behavioural data); fields: verdict, factors, claims, sources, refreshedAt — never contacts' PII; MCP `get_company_analysis(account_id)`; `/api/v1` index, `SCOPABLE_OBJECTS`, Settings endpoint table; version bump |
| **Change history** | not a user-edited object: no `logChange` (stated); the audit is `assistant_actions` + `ai_usage_log` |
| **Analytics** | metric `accounts_analysed_30d` tile is deferred (stated) |

## 9. Build plan (each ≈ 60 min for one Sonnet builder; validated on the demo tenant before the next)

**Flag decision:** no new flag. The ability is gated on **`ai_assistant_web`** (requires `ai_assistant`;
platform-admin, default off — assistant-smarter WP4) because it *is* consented research in a structured
card and shares its budget; the Engagement/Timing sections additionally light up when `buying_signals`
is on, else read *"Buying signals is not part of this workspace"*. A separately sold `company_analysis`
flag can be added later with one `TenantFeatures` line if the owner decides to price it (decision 1).

**Order:** CA1 → CA2 → **CA3 (slider ability — needs WP4)** → CA4 (Account 360 + signals feed) →
CA5 (next-step cards — needs WP5) → CA6 (API/MCP/DW/settings). CA1–CA2 can start today; CA3 the day
WP4's consent chips land; the slider ability therefore ships **before** the Account 360 card.

| WP | Delivers | Files | Needs |
|---|---|---|---|
| **CA1 Engine (pure)** | `AnalysisCard` types; `validateResearch()`; `companyKey()`; `fit.ts` + `verdict.ts`; `claimsToSignals()` (web claims → `RawSignal[]`, source `web`); `diffAnalyses()`; `tips.ts`; tests for all (validator drops unsourced/non-https/over-long; fit labels; verdict order; diff; tip limits) | `src/lib/analysis/{types,validate,companyKey,fit,verdict,toSignals,diff,tips}.ts` + `*.test.ts`; `src/lib/signals/types.ts` (`SignalSource` + `"web"`, `SOURCE_LABEL`, new `SignalKind`s `web_award web_tender_issued web_tender_named web_hiring web_risk` in group `moving` with the §6.2 points) | — |
| **CA2 Research + cache + route** | `research.ts` (prompt builder with the whitelist, schema, isolated call via WP4's `assistant/research.ts` — until WP4 lands, a thin copy of `marketIntel.ts`'s client, replaced in CA3); website fetch through `fetchPublic`; `build.ts` (research + live engagement/contacts/gaps + fit/timing + phrasing via `askStructuredMetered`); `POST /api/ai/analysis` `{account_id? | name?, domain?, country?, refresh?, allow_web}` → `AnalysisCard`; `GET /api/ai/analysis?account_id=` (cache only); daily cap + hourly refresh rate; migration **0206**; ledger entry; `analysis.prompt.test.ts`; `analysis.route.test.ts` (cross-tenant id → 404; cap → 429; pending table → uncached card) | `src/lib/analysis/{research,website,build,cache,budget}.ts`, `src/app/api/ai/analysis/route.ts`, `supabase/migrations/0206_company_analysis.sql`, `constants.ts` (`TenantConfig.company_analysis`), PROJECT.md ledger | CA1 |
| **CA3 Slider ability** | `analyse_company` tool (enum-free, schema above) in `ai/assistant.ts`; consent kind `analyse_company` on WP4's chips with the cost hint; `reply.analysis`; `AnalysisCardView` (sections as disclosures, source pills, `i` tips, 375 px sticky button row); `<company_analysis>` volatile data block for follow-ups; account-page **Analyse company** button (replaces `NovaAccountMarketSignals`, which is deleted with `api/nova/market-intel` and `marketIntelClient.ts`); opening chip on account pages; `analyse.flow.test.ts` (fake-Anthropic seam: cache hit → no consent; consent No → no search; flag off → tool absent; typed name outside the user's words → refused) | `ai/assistant.ts`, `AIDock.tsx`, `components/analysis/AnalysisCardView.tsx`, `assistant/context.ts`, account page header, deletions above | CA2, **WP4** |
| **CA4 Account 360 + signals feed** | summary card `company_analysis` + suggestion in `buildAccount360`; `BUILTINS`/`CARD_IDS`; row click → dock; signals recompute reads cached claims for matched accounts (`claimsToSignals`), nightly and on refresh; Sources settings row; Buying signals Analyse button + ⋯ item; `record_comments` "since last time" note; tests (card shape; a Looking account with a fresh award claim rescored; no comment without new claims) | `src/lib/analysis/account360.ts`, `account360/server.ts`, `settings/account-360/Account360Client.tsx`, `api/settings/account-360/route.ts`, `signals/collect.ts`, `signals/recompute.ts`, `marketing/signals/SignalsWorkspace.tsx`, settings Sources page | CA2 (CA3 for the row click) |
| **CA5 Next-step cards** | registry actions `contact.create` (from a public person; email/phone typed), `segment.add_accounts`, `campaign.add_accounts`, `opportunity.create`, `quote.create`, `abm.add_member`, `email.draft` (outward tier, CRM contact with consent only); `nextSteps` rule table (stage × gaps × fit); follow-up tests ("who in procurement" answers from data; "draft an email" to a public name is refused with the reason) | `lib/actions/registry.ts` entries, `analysis/nextSteps.ts` (+test), `AnalysisCardView.tsx` | CA3, **WP5** |
| **CA6 Surfaces** | v1 `GET /api/v1/accounts/[id]/analysis` + `OBJECT_FEATURE` + `EXPLICIT_SCOPE_ONLY` + index/`SCOPABLE_OBJECTS`/Settings table; MCP `get_company_analysis` + version; DW export route + `OBJECT_META` (export only, comment); Settings → AI usage two lines (daily limit, this month's analyses); ABM target table Fit column; `objectFeatures.test.ts` passes | `api/v1/accounts/[id]/analysis/route.ts`, `_auth.ts`, `listSources.ts` (read-only source), `mcp-server/mcp.json`, `api/export/company_analyses/route.ts`, `registrySchema.ts`, `DataWorkbenchClient.tsx`, AI usage page, ABM table | CA2 (CA4 for ABM) |

**CA4 as built (2026-10-22).** Account 360: built-in card `company_analysis` (`analysis/card360.ts`, read by `analysis/account360.ts` from the saved row only: verdict Yes / Not now / Unclear with its sentence, the newest 2 to 3 highlights, "Last analysed 3 days ago", one Analyse / Refresh button; no source or address is ever on it). It is registered conditionally like `buying_signals` (the drawer route passes it only to a person who may use company analysis), plus `BUILTINS` and `CARD_IDS`. `Account360Card` gained two generic optional fields, `summary` (one visible line) and `action` (a button that asks the AI slider a prepared question). Buttons: **Analyse company** in the account page's action area and **Analyse** on the Buying signals account view, both `AnalyseButton` (self-gating on `ai_assistant` + `ai_assistant_web`). The retired "Get market signals" rail section, `api/nova/market-intel`, `lib/nova/marketIntel*` and the Stream block `nova_market_signals` are gone. Signals feed: `analysis/feed.ts` + `signals/collectWeb.ts`, called from `collectSignals`; one `web_*` signal per (account, kind, day); the line is the claim text, no address, no publisher; a fresh analysis of an account rescores that account at once (`deps.rescore`). **Slider contract for CA3:** every screen asks the slider through one window event, `bpm:ai-dock-ask`, `detail: { question, accountId }` (`analysis/dockAsk.ts`); the dock must listen, open itself, send `question` as the person's message and, when `accountId` is set, send it as the open record (`objectType: "account"`, `recordId`). The questions are "Analyse <name>" and "Refresh the analysis of <name>". **Not done:** the ABM required-roles hook (ABM roles decision maker / influencer / user / blocker do not map onto the card's decision maker / procurement / technical gaps; needs the owner's call on one role vocabulary).

**Acceptance for every package:** `npx tsc --noEmit` and `npx next build` clean; 375 px and desktop
checked; a cross-tenant `account_id` fails (404) before any name leaves the server; a prompt never
contains a field outside the whitelist (test); no claim without an https source survives validation;
the verdict and fit are identical on two renders of the same row; flag off → tool absent, routes 403;
over the daily cap → cached card still renders; `rlsPolicies.test.ts` sees no write policy on
`company_analyses`; the commit lists the SQL file and every §3b skip (below).

**§3b applicability (stated):** 1 yes (table, RLS select-only, degrade, demo seed
`scripts/seed-company-analysis-demo.sql` with two cached analyses for demo accounts, run after 0206);
2 type yes, master ref **skip** (system row), registry **skip**; 3 custom fields **skip**; 3½ routes
yes, pages **none** (no new page, by design); 4 export only; 5 yes (read, explicit scope); 6 yes;
7 feature map yes, change history **skip**, search **skip** (found through the account), Nova via
comments, ⌘K **"Analyse company"** entry (opens the dock with the chip); 7½ **deferred**;
7¾ §8; 8 Sales Cloud Guide + Admin & Setup (AI usage) after the owner validates; 9 yes.

## 10. Decisions still open for the owner

1. **Sold module or part of web research?** Recommendation: part of `ai_assistant_web` (no new flag);
   add a `company_analysis` flag only if it gets its own price.
2. **Who may analyse a company that is not yet an account?** Recommendation: anyone with the Accounts
   workcenter view, within the daily cap; admin-only would kill the "analyse Tesla Germany" moment.
3. **Retire the Nova "Get market signals" button into the analysis?** Recommendation: yes — one
   research implementation, one card; its summary becomes the "What is happening" section.
4. **Reverse-IP provider to trial on the demo site for GCC match rate** (Snitcher, Dealfront or
   IPinfo)? Recommendation: Snitcher first (self-serve, cheapest with a company-level API); decide
   only after the platform snippet exists — nothing in CA1–CA6 depends on it.

## 11. Later (not in these packages)

Scheduled refresh for accounts in ABM programs or Deciding (weekly, within the cap); the platform
snippet and reverse-IP connector (signals Phase 2) feeding "Our websites they visited"; tenders, jobs
and registry collectors (signals 1b/2) replacing web-found tenders; a licensed person-enrichment
connector (tenant's own contract, adapter like §5.3, admin consent recorded); fit label as a segment
field; the briefing line; a Nova Crew Growth agent drafting outreach from a new trigger for approval;
Arabic claims and topics once the platform language rule exists.
