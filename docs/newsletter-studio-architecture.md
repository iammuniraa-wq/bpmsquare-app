# Newsletter Studio — architecture v0.1 (2026-10-19)

> **Who this is for.** The engineer (human or model) building the Newsletter
> Studio from this document alone. Status: **design only — nothing built, no
> SQL written.** Read first, every time: `bpmsquarecore.md` (§1 extension
> boundary, §3 record identity, §3b new-object checklist — this IS a new
> object, the entire list applies, §9 Drive docs, §10 "AI proposes, a person
> decides"), `MULTI_TENANT_GUARDRAILS.md`, `docs/ui-restructure-spec.md` (the
> screen contract), `docs/estimator-architecture.md` §15–16 (the approved
> style: one page, plain words, details folded away) and the mock-up that is
> the visual and behavioural spec for this piece:
> **`docs/design/newsletter-studio-mockup.html`** (open it; it works at
> 375 px, in both colour modes, and the EN / العربية switch really mirrors).
> The owner runs all SQL by hand; code must degrade while a migration is
> pending.
>
> **Integration-first (owner rule, 2026-10-19): nothing here is standalone.**
> The studio is one tool inside the integrated marketing platform described
> in `docs/marketing-platform-architecture.md` (v0.1, 2026-10-19). §12 here
> is written against that blueprint's own names — `domain_event` +
> `emitEvent()`, `canContact()` and the consent ledger, `SEGMENT_FIELDS`
> audiences, the asset library and `AssetPicker`, the `send_newsletter`
> journey action, `signal_topics`, the `StudioPage` template — and the
> blueprint adopts this design's event names (its §1.2) and its §12.1
> common fields verbatim. Where the two ever differ, the blueprint wins and
> this file is corrected, not the other way round. Its sibling
> `docs/signals-architecture.md` §9.4 says how Signals plugs into the studio.

## 0. Why, and what exists today

The owner's request: *"in marketing I need a design studio to create
multi-lingual newsletters and store them as templates and also be useful in
campaigns later."* The ambition behind it: a CRM nobody has seen before, with
real intelligence — not an engineering screen.

What exists (read 2026-10-19, all on `develop`):

| Piece | Where | What it does today |
|---|---|---|
| Campaign | `marketing_campaigns` (0040–0043), `/marketing/new`, `/marketing/[id]` | Name, subject, body, audience (types, include/exclude, manual emails, segment filters), status draft → sending → sent. |
| Content | `src/lib/marketingCampaignContent.ts` | Either a **built-in design** (`template_id` + plain-text `custom_message`, HTML built server-side) or **free-hand rich text** run through `sanitizeRichText` (p/br/strong/em/ul/ol/li only). Client HTML is never trusted when a template id is given. |
| Built-in designs | `src/lib/marketingTemplates/*` | 12 folders (Diwali … Service reminder) × 5 archetypes = ~56 fixed designs, one shared table layout, merge fields `{{account_name}}` `{{company_name}}` substituted per recipient (HTML-escaped). |
| Picker | `src/components/marketing/TemplatePicker.tsx` | Folder grid → variant grid → subject + message + iframe preview. |
| Audience | `TargetAudiencePicker.tsx`, `marketing_target_groups`, `resolveMarketingRecipients` | Accounts (one email per account) + manual emails; `accounts.marketing_opt_out` honoured. |
| Send | `api/marketing/campaigns/[id]/send/route.ts` | Resend, from `<slug>@RESEND_SENDING_DOMAIN` as the workspace name, reply-to from `company_info.email`; sequential, 200 ms apart, ~150–200 recipients per 60 s invocation; every send through `resolveOutbound()` (demo workspaces redirect-only); `email_log` row per recipient. |
| Links | `marketingUnsubscribe.ts`, `campaignInterestLink.ts` | HMAC-signed, stateless, no login, no expiry. The send route appends the "Interested? Tell us more" button and the unsubscribe footer **after** the body. |
| Leads | `/marketing/interest/...` | A click + confirm creates an attributed lead (dedup index 0046). |
| Block builder precedent | `standard-quotes/templates/[id]/TemplateBuilderClient.tsx` + `/api/standard-quote-templates/ai-design` | Ordered typed blocks, visibility, drag reorder, required blocks, accent colour, live preview; "Design with AI" returns blocks that pass the same sanitiser as a hand edit. |
| AI precedent | `src/lib/estimator/aiServer.ts`, `src/lib/rfq/extract.ts`, `src/lib/fence/draft.ts` | `claude-opus-5-5`, structured output via `output_config.format json_schema`, server only, 503 "AI is not set up" without a key, every result reviewed before anything is saved. No credit meter exists; none is invented. |
| Images | `/api/upload` (admin-only, PNG/JPG/WebP, 2 MB, no SVG), bucket `company-assets`, path `<tenantId>/…`, storage RLS checks the tenant folder (0038). `src/lib/resizeImage.ts` exists. |
| Language | Nothing. No `language`/`locale` column anywhere on accounts, contacts or the tenant. |

What the owner will say is missing: one subject, one body, one language; a
design is a fixed TypeScript file, not something a workspace can make and
keep; nothing about the recipient decides what they get.

## 1. Shape: one object, three faces

**Newsletter** is a standard core object (`newsletters`, ref `NWS-####`,
behind the existing `marketing` flag — it is a marketing capability, not a
new module to sell). It is a **structured design, never HTML**: an ordered
list of typed blocks plus, per language, the words. HTML is produced by one
server-side renderer from that structure, at preview and at send. Nobody
types HTML; nobody stores HTML they typed.

Three faces, same table:

- **Newsletter** — a design being worked on for a send.
- **Template** (`is_template = true`) — a design kept to start from. "Save as
  template" copies the newsletter into a template; "Start from a design"
  copies a template (or a built-in festival design) into a new newsletter.
  Workspace templates sit beside the built-in folders in the picker.
- **Version** (`newsletter_versions`) — an immutable snapshot (blocks, every
  language's words, the rendered HTML per language) taken when a newsletter is
  used in a campaign. A campaign points at a version, so editing the design
  later never changes what a sent campaign shows or re-sends.

Languages are first-class: a newsletter has a **source language** — **English
for every new newsletter** (owner decision 2026-10-19; other languages are
added on top, never instead) — and any number of **language rows**
(`newsletter_languages`),
each with its own subject, preheader, words per block, direction (RTL for
Arabic and Urdu) and a review state per block. A campaign chooses which of a
newsletter's languages to include; the send resolves one language per
recipient.

## 2. The studio — what a person sees (the mock-up is the spec)

One page, `/marketing/newsletters/new` and `/marketing/newsletters/[id]`
alike, **laid out like the other studios** (owner, 2026-10-19): the Fence
configurator (`src/components/fence/FenceConfigurator.tsx`: a header bar, the
canvas, and a sidebar of collapsible labelled sections) and the Project
Estimator (`EstimateScreen.tsx` / `EstimateWorkspace`, `.est-grid` in
`globals.css`: a 330 px column of inputs beside the canvas, folds below,
one column under 900 px). Here: a **header bar** (name, status, languages,
*Show me how*, "⋯"), then **the options in a left panel (330 px)** and
**the email on the right**; folds under both. **Every option group in the
panel expands and collapses** (owner, 2026-10-19: "that way it looks
leaner"): its header row is a button carrying the label, a one-word
summary, a **one-line plain-words hint** saying what the group is for — no
group without one — and a chevron; `aria-expanded` + `aria-controls` on the
button, Enter / Space toggle it. One group is open at a time: Start on a new
newsletter, and whichever is in use afterwards — clicking a block on the
email opens Blocks, "+ Add language" on the email opens Languages, the
walkthrough opens the group each step talks about. Opening one collapses
the others; a collapsed group still shows its summary ("6 blocks",
"English + Arabic", "2 to fix").
Under 900 px the panel turns into a **tab strip above the email** (Start ·
Blocks · Languages · Check · Brand · Use it), one section open at a time, a
sticky Save / Use-in-a-campaign bar at the bottom, and no horizontal scroll
at 375 px. The mock-up is the exact spec.

Left panel, top to bottom:

1. **Start** — *"How to begin: say what this issue is about, pick a design,
   or start blank."* Three cards: *Write it for me* (a one-line brief, plus
   "use my recent products and campaigns" and "use what accounts showed
   interest in" — AI drafts the blocks **in English**), *Start from a
   design* (workspace templates and the built-in festival folders), *Blank*.
   After "Write it for me": blue chips for what was understood ("New
   product: HST4 anchors, from your catalogue"), amber chips for what was
   assumed ("Assumed: formal tone"). Nothing is saved until Save.
2. **Blocks** — *"The pieces your newsletter is built from. Click one to
   change its words; drag to reorder."* The ordered list — Header, Hero,
   Text, Image, Button, Columns, Product card, Event, Divider, Social,
   Footer. Reorder, hide, add. Header and Footer are **brand blocks**:
   present in every design, locked by default (unlocked only by an admin),
   and the Footer always carries the unsubscribe and preferences links — it
   cannot be removed, same rule as `STANDARD_QUOTE_REQUIRED_BLOCKS`. Clicking
   a block opens its words for the **current language** right under the
   list, with "Rewrite: shorter · friendlier · more formal" and its own hint
   ("Rewrite suggests new words; keep them or type your own").
3. **Languages** — *"English is written first. Add a language on top and
   each person gets their own."* One row per language with its subject and
   status (*Written first* / *3 to check* / *Ready*), a picker + *Add
   language*. Two hints state the rules in plain words: what AI translation
   does and keeps as-is, and *who gets which: the contact's preferred
   language, then the account's, then English.*
4. **Check before sending** — *"Rules that run every time, not opinions.
   Fix the amber ones."* Green or amber chips: unsubscribe and preferences
   present, every image has a description, subject length, link count and
   all https, text-to-image balance, each added language reviewed, a short
   list of words spam filters dislike. These are code, not AI (§6).
5. **Brand kit** — *"Your logo, colours and fonts, set once by an admin and
   used by every design."* Read-only, link to Settings.
6. **Use it** — *"Keep this design, or hand it to a campaign."* Save
   (*"Keeps your work. Nothing is sent."*), Save as template (*"Keeps this
   design to start from next time, beside the built-in designs."*), **Use in
   a campaign** (*"A campaign or a journey step picks the audience and the
   languages. Each person gets their own language."*) — takes a version and
   opens `/marketing/new?newsletter=<versionId>`.

Right, the email: language tabs (**English · العربية · + Add language**),
Desktop / Phone, Light / Dark. The preview is the real renderer's HTML in a
sandboxed iframe (`sandbox=""`, `srcDoc`, no scripts), so what is shown is
what is sent. Switching to Arabic flips `dir="rtl"`: text aligns to the
start edge, columns and the logo mirror, numbers stay LTR. Blocks translated
by AI and not yet reviewed carry an amber **Check this** chip (*"lines the
translation was unsure about"*) with *Accept* / *Edit*; the language tab
shows how many remain. "⋯" holds Duplicate, Versions, Export HTML, Adapt
fields, Archive. Folded away under the studio, closed by default: Versions,
Email HTML for your IT team, Details (status, ref, custom fields), Activity
(Nova timeline).

Words on the screen: *newsletter, design, template, language, block, check,
campaign*. Not on the screen: *render, locale, RTL, MJML, sanitise, version
snapshot, merge field* (the help text says "replaced for each person").

### 2.0 Guided walkthrough ("Show me how")

A button in the header bar starts an **optional** step-by-step demo of the
studio on the open newsletter. It never starts on its own (no first-visit
auto-run), is closed by default, and can be left at any step with *Skip* or
Escape; the step a person reached is remembered in `localStorage` only
(the platform rule, `marketing-platform-architecture.md` §6.0), never on
the server, and never used to open it unasked. Each step spotlights one area (the
rest of the page dimmed, the area ringed in the accent colour), shows a
short plain-words caption and *Back / Next / Skip*; the step may first do
what it describes (select a block, add Arabic, switch to the phone view) so
the person sees the real thing, not a picture of it. Eight steps: (1) Start
— write a brief or pick a design, English first; (2) Blocks — the pieces;
(3) Edit a block and Rewrite; (4) Add a language, translated by AI; (5)
"Check this" — accept or edit; (6) Phone / desktop, light / dark preview;
(7) Save as template; (8) Use in a campaign. On a phone the walkthrough also
switches the panel tab for each step. Implementation: a small
`src/components/marketing/StudioWalkthrough.tsx` with a step list of
`{ target selector, panel section, caption, before() }`, no library;
spotlight = one absolutely positioned ring with a large box-shadow; the
caption card is fixed at the bottom (above the sticky bar on a phone);
`prefers-reduced-motion` turns off the ring's transition. Captions are the
hints' words, so the two never disagree. The platform makes the whole
layout rule a component — `StudioPage` with `panel`, `canvas` and
`walkthrough` props (blueprint §6.0) — so this studio, the journey builder
and the form builder share one implementation; `StudioWalkthrough` is that
template's `walkthrough` prop, not a studio-only piece.

### 2.1 Campaign side

`/marketing/new` and the draft detail gain a third source beside the built-in
designs and free text: **My newsletters**. Picking one shows its languages as
checkboxes (only languages whose every block is reviewed can be ticked), a
fallback language (default: the source language), and the audience preview
counts per language ("English 120 · Arabic 45 · no preference 12 → English").
A sent campaign's page shows sent / failed / skipped **per language** and
clicks per link.

### 2.2 Settings → Marketing → Brand kit (admin)

Logo (defaults to `tenants.logo_url`), primary / secondary / text colours,
one **email-safe font pairing** (Latin stack + Arabic stack — see §5),
footer address lines, social links, default languages, and the fallback
language. Stored in `tenants.config.brand_kit` (a `TenantConfig` addition,
validated like `nova_accent_color`: strict `#rrggbb`), no new table.

### 2.3 Where the recipient's language comes from

The recipient's language is a **preference**, and preferences belong to the
platform's one consent-and-preference model (§12), never to the studio. The
studio only *reads* it. The field is a standard, nullable
`preferred_language` column (ISO 639-1: `en`, `ar`, `hi`, `ur`, `fr`) on
**contacts** and **accounts** — the identity model's two records; the
blueprint adopts it as this design's field (its §1.1 and §10) — shown as a
plain select on both forms, in the field registry, Data Workbench and the
v1 API, offered as a `SEGMENT_FIELDS` audience field, and editable by the
recipient themselves in the preference centre. Resolution at send, in order: the
contact's language (when the recipient is a contact), the account's, the
campaign's fallback. Only languages the campaign includes are eligible;
anything else falls to the fallback. A country → language guess is
deliberately **not** applied: a Doha account may well read English, and a
wrong guess in a customer's inbox costs more than a fallback.

## 3. Data model (migration `0134_newsletter_studio.sql`, described)

All tables: `tenant_id uuid not null references tenants(id)`, RLS enabled
with the standard tenant-isolation policy **in the same migration**, UUID
`id`, `created_at`/`updated_at`. Tracked in `supabase/migrations/`, listed in
PROJECT.md's ledger as pending on both DBs; the code hides the studio and
shows only built-in designs on 42P01.

**`newsletters`** — id, tenant_id, `ref` (NWS-####, `MASTER_REF_TABLES`),
`name`, `is_template bool`, `category text` (Newsletter, Offer, Event,
Announcement, Festival — picklist in config, tenant-editable), `status`
(draft / ready / archived), `source_language text not null default 'en'`,
`blocks jsonb` (ordered
`[{ id, type, visible, locked, settings }]` — settings hold the non-text
parts: image path, product id, link target, colours, alignment, column count),
`brand_kit jsonb` (the kit as it was when the design was made, so a kit change
re-brands on next save, not silently), `built_in_origin text` (the festival
design id it was copied from, if any), `template_origin_id uuid`,
`custom_data jsonb`, `created_by`. Index `(tenant_id, is_template, updated_at
desc)`.

**`newsletter_languages`** — id, tenant_id, `newsletter_id` (on delete
cascade), `lang text`, `dir text` (`ltr`/`rtl`, derived, stored for the
renderer), `subject`, `preheader`, `texts jsonb` (`block_id → { field →
string }`; paragraph fields hold the tiptap subset and go through
`sanitizeRichText` on write), `review jsonb` (`block_id → 'written' |
'translated' | 'reviewed'`), `status` (derived: `ready` when no block is
`translated`), `translated_by` (`person` / `ai`), `reviewed_by`,
`reviewed_at`. Unique `(newsletter_id, lang)`.

**`newsletter_versions`** — id, tenant_id, `newsletter_id`, `version int`
(1, 2, …), `snapshot jsonb` (blocks + every language row), `html jsonb`
(`lang → rendered HTML with the merge tokens still in place`), `text jsonb`
(`lang → plain text`), `links jsonb` (ordered list of every outbound URL in
the design — the click-tracking link carries an **index** into this list,
never the URL itself, so there is nothing to redirect to that was not in the
design), `created_by`, `created_at`. Unique `(newsletter_id, version)`.

**`marketing_link_clicks`** — id, tenant_id, `campaign_id`, `recipient_id`
(→ `marketing_campaign_recipients`), `contact_id null`, `link_index int`,
`topic_id null` (from the version's link list, §12.3), `lang`, `clicked_at`,
`user_agent_family text` (coarse, no IP stored); select-only RLS, writes only
from the click route via the admin client, tenant-filtered. The blueprint
(§5.4) keeps this as the studio's own row — Signals reads it and never
installs a second tracker — and the **same route emits `email.clicked` to
`domain_event`**; the campaign page, scoring and journeys read the stream.
Opens, bounces, complaints and unsubscribes have no studio table at all:
they are stream events plus the consent ledger's `suppressions` /
`consent_events` rows (§12.5). The platform's `domain_event` and
`emitEvent()` are built in its phase M0, before this studio's N1 (its §12
roadmap), so there is no interim store to migrate.

**Columns added:** `marketing_campaigns.newsletter_version_id uuid null`,
`marketing_campaigns.languages text[] default '{}'`,
`marketing_campaigns.fallback_language text null`;
`marketing_campaign_recipients.lang text null`,
`marketing_campaign_recipients.contact_id uuid null` (when the recipient
resolved to a contact); `contacts.preferred_language text null`,
`accounts.preferred_language text null`.

**Images come from the shared asset library, not a newsletter folder.** An
image block holds an `asset_id` from the platform's one asset library (§12),
picked with the shared `AssetPicker("image")` — the same pictures forms and
landing pages use — never a free URL. Upload
rules the library enforces (blueprint §1.6 points back here for them): no
new bucket (`company-assets`, path `<tenantId>/assets/…`, storage RLS from
0038 checks the tenant folder), the `/api/upload` MIME allowlist
(PNG/JPG/WebP, never SVG), resize to ≤ 1200 px wide with `resizeImage.ts`,
2 MB cap, gate `marketing` feature + workcenter (marketing users are not
admins). The renderer resolves `asset_id` → the asset's public URL at render
and refuses anything else, so an external or cross-tenant image can never be
in a sent email (external images break in half the clients anyway). Until
the library exists, the studio's upload route writes to that same path and
shape, so the library inherits the files rather than migrating them.

**Config:** `TenantConfig.brand_kit` (§2.2), `TenantConfig.marketing.track_opens`
(default **false**, §7), `TenantConfig.newsletter_categories`.

**Demo:** `scripts/seed-newsletter-demo.sql` — brand kit and one finished
EN+AR newsletter for the `is_demo` tenant ("Al Noor Industrial Supplies"
sample, same content as the mock-up), one template per category, idempotent.

## 4. Rendering — the only place HTML is made

`src/lib/newsletter/render.ts`, **pure and server-only**, `render(blocks,
languageRow, brandKit, lang) → { html, text, links }`, unit-tested with golden
files per block type × direction. Rules:

- Tables only, every style inline, 600 px outer table, `role="presentation"`,
  `<html lang dir>` and `dir` repeated on every `<td>` that holds text
  (Outlook ignores the root). `text-align` follows the direction; columns
  render in mirrored order under RTL; the logo sits at the start edge;
  numerals and phone numbers wrapped `dir="ltr"`.
- Dark mode: `<meta name="color-scheme" content="light dark">`, a head
  `@media (prefers-color-scheme: dark)` block for the clients that honour it
  (Apple Mail, iOS, some Outlook), and brand colours chosen so a client that
  inverts anyway (Gmail) still reads — the "Dark" toggle in the studio shows
  exactly the second case, not a promise.
- Fonts: one of a few **email-safe pairings** (Latin: Arial / Georgia /
  Segoe-Helvetica; Arabic: Tahoma, Segoe UI, Noto Naskh Arabic fallback). No
  web-font `@import` — Gmail and Outlook drop it. The studio's own preview
  uses the same stacks so it does not flatter the result.
- Merge fields stay as tokens in the version's HTML (`{{account_name}}`,
  `{{company_name}}`, `{{contact_name}}` new, `{{unsubscribe_url}}`,
  `{{interest_url}}`); the send route substitutes per recipient with
  `escapeHtml`, exactly as today. The Footer block **is** where the
  unsubscribe line lives (today the send route appends it after the body;
  for a newsletter send the route substitutes into the footer instead and
  appends nothing). Manual-email recipients, who have no account to opt out,
  get the same plain "reply to unsubscribe" line the current route gives
  them nothing for — a small improvement stated in the commit.
- Every text field is HTML-escaped at render; paragraph fields pass
  `sanitizeRichText` (already the write-time choke point). URLs: `https:`,
  `http:`, `mailto:`, `tel:` only, validated on write and again at render;
  `javascript:`/`data:` never. Colours: `HEX_COLOR_RE`. Block types: a closed
  union; `sanitizeNewsletterBlocks()` (mirror of
  `sanitizeStandardQuoteBlocks`) is the one gate for hand edits, AI output and
  duplicated templates alike.
- **No custom-HTML block** in v1 (open question 3). Without it the stored
  design cannot contain markup, so in-app preview, the campaign page and the
  email all render from a known-safe generator. The preview iframe is
  sandboxed regardless.
- "Export HTML" downloads the rendered file for a tenant that sends through
  another tool; nothing is imported back.

## 5. Multi-lingual rules

- **English is the default source language** of every new newsletter and is
  written first; a new newsletter has exactly one language row (`en`) until
  someone adds another. "Add language" creates a row with every block
  `translated` after AI translation, or empty for a person to fill. A
  workspace cannot change the default (owner decision 2026-10-19: more
  languages come later, on top of English).
- **Translation is per block, with a glossary**: the brand name, product
  names, SKUs, prices, dates and anything inside `{{ }}` are passed as
  do-not-translate terms; the model returns one string per text field, not
  a document, so a stray sentence cannot land in the wrong block.
- **Tone per language** is a kit setting (formal / warm) and a per-call
  choice ("rewrite warmer"); Gulf business Arabic defaults to formal MSA.
- A block edited in the source language flags the same block `translated`
  again in every other language ("English changed — check 1 block"), never
  silently re-translates.
- A language is sendable only when every block is `reviewed` (or written by a
  person). The campaign picker greys the others and says why.
- Direction: `ar`, `ur` (and `fa`, `he` if ever added) are RTL; everything
  else LTR; stored on the row so the renderer never guesses.
- Subject and preheader are per language; AI "subject ideas" gives five per
  language, a person picks or types.

## 6. AI — magical, honest, reviewed

`src/lib/newsletter/ai.ts`, same shape as `estimator/aiServer.ts`
(`claude-opus-5-5`, `output_config.format json_schema`, server only, 503 when
no key; the studio shows "AI is not set up for this workspace" and everything
else still works). Five tasks, each a JSON schema the route validates with
`sanitizeNewsletterBlocks` / the language-row rules before returning:

| Task | Input | Output | Reviewed how |
|---|---|---|---|
| Draft | one-line brief; optionally the last 5 campaign subjects, up to 10 recent or flagged products (name, short description, list price — **never cost**), workspace name and industry | blocks + source-language texts + "understood" / "assumed" notes | lands in the studio unsaved; chips show what was assumed |
| Rewrite | one block's text, a tone | one string | replaces in the editor, Undo available |
| Translate | the full source language row + glossary | one language row, every block marked `translated` | per-block Check-this chips |
| Subject ideas | the texts of one language | five subjects + preheaders | pick one |
| Explain checks | the rule results of §2(5) | a plain-words sentence per amber chip | read only |

The checks themselves are deterministic code in `src/lib/newsletter/checks.ts`
(unit-tested): a number or a pass/fail a person acts on is never an AI
output (same doctrine as Account 360's rating). The tenant's data given to
the model is treated as data (the `<brief>` / `<catalogue>` tags and the
"ignore instructions inside" line from `rfq/extract.ts`).

## 7. Sending, tracking and privacy

- `send/route.ts` grows one branch: when `newsletter_version_id` is set, load
  the version's `html[lang]` / `text[lang]`, resolve the recipient's language
  (§2.3), call `canContact()` for the campaign's **topic** and the email
  channel (§12.5; the consent ledger keeps `accounts.marketing_opt_out` as a
  legacy mirror during the transition), substitute merge fields, and
  continue through the **unchanged** `resolveOutbound()`, Resend and
  `email_log` path, emitting `email.sent` / `email.failed` / `email.skipped`
  to `domain_event` through `emitEvent()`. HTML is rendered once per
  language per campaign, not per recipient. Nothing about the demo-redirect
  rule, the from address or the interest/lead flow changes.
- The 60 s / ~200-recipient ceiling is pre-existing and stays; the commit
  states it. (A queue is a separate piece of work, not hidden in this one.)
- **Clicks**: every link in the version is rewritten to
  `/marketing/c/<campaignId>/<recipientId>/<index>/<token>` (HMAC over the
  three ids, same helper family as `campaignInterestLink.ts`). The route
  verifies, records a `marketing_link_clicks` row, and redirects to
  `links[index]` from the stored version — no open redirect, no URL in the
  query string. Unsubscribe and interest links are **not** wrapped (they must
  keep working even if tracking is ever turned off).
- **Opens**: a pixel is implemented behind `config.marketing.track_opens`,
  default **off**, with a consent note in Settings (Apple Mail Privacy
  Protection makes opens unreliable anyway, and GCC personal-data laws expect
  a lawful basis). Off = no pixel in the HTML at all.
- Per-recipient rows record `lang`; the campaign page shows counts per
  language and clicks per link.

## 8. §3b checklist for this object (execute ALL, state skips)

| # | Item | Decision |
|---|---|---|
| 1 | Tables, RLS, `custom_data`, migration 0134, ledger, degrade on 42P01, demo seed | As §3. `marketing_link_clicks` select-only. |
| 2 | `Newsletter` type, `MASTER_REF_TABLES` NWS, `PilotObjectType` + `PILOT_OBJECT_TYPES`, `FIELD_REGISTRY` | Header fields only (ref, name, category, status, source language, languages, is_template); `blocks`/texts are not registry fields (they are a document, like an estimate's lines). |
| 3 | Custom fields | `custom_data` column **yes** (cheap now). Settings tab + `VALID_OBJECTS` + `ObjectSections` on the Details fold: **phase N3**, stated in the commit. Nobody has asked for a custom field on a design; the column means no second migration if they do. |
| 3½ | CRUD routes, list / record / form pages, `ROUTES`, `NAV` (under Marketing, `featureKey: marketing`, new `workcenterKey: marketing_newsletters`), feature flag | No new flag: `marketing`. Admin `TenantEditor` untouched. |
| 4 | Data Workbench | Export + Update of header rows (by `id`). **Import deliberately excluded** — a file cannot express blocks and languages (same reason RFQ excluded import); documented in `DataWorkbenchClient.tsx`. `preferred_language` is added to the contact and account specs on all three modes. |
| 5 | v1 API | `GET /api/v1/newsletters[/id]` via `authorizeApi` + `enrichedList`: header, languages with subject/preheader/status, latest version number and its rendered `html` per language (so a tenant's other tools can send it). **`EXPLICIT_SCOPE_ONLY`** (marketing content is business-sensitive). `LIST_SOURCES` entry, index listing, `SCOPABLE_OBJECTS`, Settings endpoint table. No cost fields exist here; the product card carries list price only. |
| 6 | MCP | `list_newsletters` / `get_newsletter`, version bump. |
| 7 | `OBJECT_FEATURE.newsletters = "marketing"`; change history + filter entry; global search (`SEARCH_SPECS` + `SEARCH_OBJECTS`, by name); advanced filtering on the list; Nova timeline slot + comments/inbox/`ROUTE_FOR`; ⌘K "New newsletter" | All, phase N3. |
| 7½ | Analytics | Metric `campaign_clicks` (a business number) with dashboard tile + reports entry. A tile counting designs is **skipped** (not a number anyone acts on); stated in the commit. |
| 7¾ | Cross-object | Products → product card block (id tenant-verified on write); Contacts/Accounts → `preferred_language`; Leads → interest button block; Campaigns → version link; the marketing platform → events, journeys, Signals, asset library, consent (§12); Nova → "paste anything" could land in Draft later (deferred). WFM and Service: no touchpoint, stated. |
| 8 | Docs | Marketing Guide (Drive) gains "Newsletter Studio" and "Languages"; Admin guide gains Brand kit; API guide gains the endpoint. After the owner validates (memory: docs after testing). |
| 9 | `tsc`, `vitest` (renderer goldens, checks, language resolution, link signing), `next build` clean before each commit. | |

## 9. Phases (each ends: `tsc` + `vitest` clean, build + commit; the owner validates on the demo tenant before the next)

**N0 — Foundations (no screen).** Runs after the platform's M0
(`domain_event`, `emitEvent()`, `canContact()` — `marketing-platform-architecture.md`
§12), which this phase consumes and never duplicates. Migration 0134 (the
number is "next free" — verify against the platform's and Signals'
migrations when written) + ledger line; types,
`sanitizeNewsletterBlocks`, the renderer with golden tests for all eleven
blocks in LTR and RTL, the checks, the language-resolution rule, the click
token. Brand kit in `TenantConfig` + its settings route.

**N1 — The studio, impressive on day one.** The one page of §2 exactly as the
mock-up: Start (brief → AI draft, from a design, blank), blocks, the live
preview with language tabs / phone / dark, English + Arabic with real
mirroring, AI translate with Check-this review, Languages card, checks,
Save / Save as template / Use in a campaign. Campaign picker's "My
newsletters" tab, per-recipient language at send, signed click links,
per-language counts on the sent page. Demo seed. This is the MVP the owner
shows.

**N2 — Library.** Categories, versions fold, duplicate, lock/unlock brand
blocks (admin), subject ideas, product card picker from the catalogue, event
block, Hindi / Urdu / French rows with their font stacks verified in
Gmail, Outlook desktop, iOS Mail and Outlook mobile (a real send to the
redirect inbox of the demo workspace).

**N3 — Every surface.** The §8 rows marked N3: DW export/update, v1 API, MCP,
search, change history, Nova, ⌘K, analytics metric, custom-fields tab; Drive
guides.

**Later, not promised:** opens pixel (behind the flag), "view in browser"
signed web version and a WhatsApp share of it, send-time per recipient time
zone, A/B subject test, a queue for large audiences, a paste-anything intake
through Nova.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Arabic renders wrong in Outlook desktop / Gmail (direction lost, columns not mirrored, Latin fallback font) | `dir` on every cell, mirrored column order in the markup itself (not CSS), tested in N2 with real sends; the studio's Dark/Phone previews show the renderer's output, not a flattering CSS copy. |
| AI translation reads machine-like or mistranslates a product term | Glossary, per-block output, review mandatory before a language is sendable, "English changed — check" re-flagging. |
| A design with markup reaches the inbox or the in-app page | No HTML is ever stored from a user; closed block union, escaped fields, `sanitizeRichText` on paragraphs, URL scheme allowlist, sandboxed preview iframe, images only from the tenant's own folder. |
| Click redirect abused as an open redirect | The link carries an index into the version's stored link list, signed with the campaign and recipient ids. |
| Big audiences hit the 60 s ceiling | Pre-existing; render once per language; a queue is its own later piece, said so in the commit. |
| Migration pending on production | Studio nav item hidden on 42P01, picker shows only built-in designs, send route's branch never taken. |
| Brand kit colours fail contrast in dark clients | Checks include a contrast chip; kit save warns, does not block. |

## 11. Decisions recorded (owner, 2026-10-19) and open questions

**Accepted as written** after review of the first draft ("rest all looks
good"), with four changes applied in this revision: the studio is laid out
like the Fence and Estimator studios (options in a left panel, the email on
the right, tabs above the email on a phone — §2); every panel option carries
a one-line plain-words hint (§2); an optional "Show me how" walkthrough
(§2.0); **English is the default language of every new newsletter**, other
languages are added on top — which resolves open question 4 below (more
languages later, on top of English). Questions 1, 2, 3, 5 and 6 stay open.

Open questions (few, concrete):

1. **Recipient language as a standard column** on contacts and accounts
   (`preferred_language`, proposed) — or a custom field per workspace? The
   standard column is what makes the send rule the same everywhere.
2. **Opens tracking**: ship the pixel behind an off-by-default setting with a
   consent note, or clicks only in v1?
3. **Custom HTML block**: never (proposed), or admin-only through the
   sanitiser for an agency-built design?
4. ~~Languages for the demo~~ — **resolved 2026-10-19**: English is the
   default for every newsletter; Arabic is the first language added on top
   (N1); Hindi, Urdu, French follow later (N2), each added on top of
   English.
5. **Workspace templates beside the built-in festival folders**: fixed
   category list (Newsletter, Offer, Event, Announcement, Festival) or
   tenant-editable like item types?
6. ~~Build order against the platform blueprint~~ — **settled by the
   blueprint's roadmap** (its §12): M0 foundations first (`domain_event` +
   `emitEvent()`, `email_hash`, the consent ledger + `canContact()`,
   scoring), then **M1 = this studio's N0–N1**, which emits the platform's
   first real engagement events; the asset library's `AssetPicker` and the
   `StudioPage` template are built with M1 since the studio is their first
   user. No interim shapes remain in this design.

## 12. Integration points — nothing here is standalone

The platform this studio lives in is `docs/marketing-platform-architecture.md`
(v0.1, 2026-10-19). Its six shared foundations, by their real names, and
what the studio does with each: the **identity model** (§1.1 there: the
person is always a `contacts` row, engagement is recorded against the
contact and rolled up to the account; `contacts.email_hash` is the blind
index that finds a person by address; `preferred_language` is this design's
field, adopted there); the **engagement stream** `domain_event` (§1.2, one
table, written only through `emitEvent()`, select-only RLS — the studio's
event names are its catalogue rows); the **consent and preference model**
(§1.3, a ledger — `consent_events`, `consent_state`, `suppressions` — read
through the one function `canContact()`); the **scoring framework** (§1.4,
the studio emits, `scoring.ts` scores); the **audience model** (§1.5,
`SEGMENT_FIELDS` + `marketing_target_groups`, now person-level too); the
**asset library** (§1.6, where this studio *owns* the email design, the
versions and the brand kit, and *uses* the shared images through
`AssetPicker`). Journeys are §3 there (`send_newsletter` is an action in the
shared registry), Signals is `docs/signals-architecture.md` (§9.4 names the
studio), forms / landing pages / web tracking / preference centre are §5.

### 12.1 What the studio and its sends emit

Every event carries `tenant_id`, the person (`contact_id` and/or
`account_id`, or `email_hash` for a manual email), `campaign_id`,
`newsletter_id`, `newsletter_version_id`, `lang`, `topic` and `occurred_at`.
Language is on every event, so "Arabic readers click more" is one query.

| Event | When | Payload beyond the common fields |
|---|---|---|
| `newsletter.created` / `.updated` / `.archived` | studio saves | `is_template`, languages present |
| `newsletter.language_ready` | a language's last block is reviewed | `lang`, `reviewed_by` |
| `newsletter.version_created` | "Use in a campaign" | `version` |
| `email.sent` | Resend accepted the message | `resend_id`, `redirected` (demo workspace) |
| `email.failed` | Resend refused | `error` |
| `email.skipped` | no consent for the topic, no email, no eligible language | `reason` |
| `email.delivered` / `email.bounced` / `email.complained` | Resend webhook (new `/api/webhooks/resend`, Svix-verified like the inbound-mail one) | `bounce_type` |
| `email.opened` | the pixel, **only** when `track_opens` is on | `client_family` |
| `email.clicked` | the signed click route | `link_index`, the link's `label` and `block_type` (product card → `product_id`) |
| `email.interest` | the existing interest page's confirm | the lead id it created |
| `email.unsubscribed` | the existing unsubscribe page, now writing to the consent model | `topic` (or all) |

`email_log` stays as the operational per-message log it is today; the stream
is the person-centred view. Every row goes through `emitEvent(tenantId, ev)`
on `domain_event` (never an insert from a route), with the blueprint's
columns: `name` is the string above, `object_type`/`object_id` the
newsletter or campaign, `source` is `app` for studio saves, `public_link`
for the click / interest / unsubscribe routes, `provider_webhook` for
Resend's delivery events, `runner` when a journey sent it; `occurred_at`
(when it happened — a webhook arrives late) beside `created_at`; and
`depth` carried from the journey that caused a send, so a rule never loops
on its own mail. The person on an email event is the **contact** the
recipient resolved to (`contact_id`, plus `account_id`); a manual-email
recipient who is nobody's contact carries only `email_hash`.

### 12.2 Journeys use a newsletter as an action

The journey action is **`send_newsletter`** in the shared action registry
(`src/lib/events/actions.ts`, blueprint §3.1), params `newsletter_id`,
`languages[]`, `fallback_language`, `topic`. At run time it creates a
campaign for the run's current person set, takes a version if the design
has none for its current content, and goes through **this studio's one send
branch** (§7): `canContact()` for the topic and the email channel, the
contact's language rule, `resolveOutbound()` always, an `email_log` row of
kind `journey`, and the studio emits `email.sent / failed / skipped` with
`depth + 1`. One send path, whether a person pressed Send or a journey did.
The journey's own safety rules (frequency caps, quiet hours, "account in
trouble", kill switch — blueprint §3.2) run in the runner *before* it calls
the send; the studio does not re-implement them. A journey can branch on
the studio's events (`email.clicked` on a product card → "Send the HST4
datasheet" → wait 3 days → no `email.interest` → task for the rep). Extra
merge tokens a journey knows (the triggering quote ref, the product clicked,
the owner's name) are passed to the renderer and validated against the §4
allowlist. The `newsletter_version_id` inside a journey definition is
verified against the tenant on save **and** on execution (a definition can
outlive the design it points to).

### 12.3 Signals and accounts drive content

Topics are the shared `signal_topics` list (`signals-architecture.md` §9.4),
not a studio list. "Write it for me" accepts, beside the brief, **a topic**
or **a set of accounts**: the draft then gets the products and campaigns
tied to that topic, and the AI's "understood" chips name them ("Topic:
anchoring and fixing — 14 accounts showed interest this month"). A block
(and so each link in the version's link list) carries an optional
`topic_id`; the click route already records `link_index`, so a click maps to
a topic with no second tracker — Signals reads `marketing_link_clicks`, it
never installs one. The product card block can be **"a product from the
reader's buying signals"** instead of a fixed product: the renderer resolves
it per person at send from the stream (fallback: the fixed product), so one
newsletter shows each reader the thing they looked at — the per-person
personalisation the §4 renderer is shaped for (tokens per recipient, HTML
per language rendered once). Audiences can use `buying_stage` (§12.6), and
the campaign page's "Did it work?" is Signals' component, fed by its
`account_intent_history`, not a studio chart.

### 12.4 One asset library

Images in a newsletter are `asset_id`s from the shared library (§3), chosen
with the platform's one `AssetPicker(kind)`; the same asset is reused on a
landing page or a form, with the library showing "used in: October
newsletter, Anchors landing page". The brand kit (`config.brand_kit`) is
owned here and read by forms, landing pages, the preference centre and event
pages alike (one logo, one palette, one font pairing). In the blueprint's
asset table (§1.6) the studio **owns** "email design + languages +
versions": campaigns, the `send_newsletter` step, event invitations and the
preference centre's confirmation mails all send a **version**. A landing
page (`landing_pages`, blueprint §5.2) is a newsletter version rendered by
this renderer with a **web target** — so "view in browser" is a landing
page the platform already serves and tracks, not a second renderer. The
"Interested?" button may later point at a short form (§5.1) instead of the
one-click link; the block stays, its target changes.

### 12.5 Consent and preferences are read, never duplicated

The studio holds **no** opt-out, topic, channel or language preference of
its own. At the moment of sending, the send branch calls the one function
`canContact(tenantId, contact, channel: "email", topic)` from
`src/lib/marketing/consent.ts` (blueprint §1.3: pure over `consent_state`,
`suppressions`, `contacts.do_not_contact` and the jurisdiction rules) and
records a refusal as `email.skipped` with its `reason`; the language rule
(§2.3) reads `preferred_language`. The footer's unsubscribe link and the
**"Manage preferences"** link both open the preference centre
(`/marketing/preferences/<contactId>/<token>`, blueprint §5.5, signed with
the same `QUOTE_PUBLIC_LINK_SECRET` family as today's unsubscribe link);
the existing account-level unsubscribe route keeps working and now also
writes the ledger. Every marketing send also sets the `List-Unsubscribe`
and `List-Unsubscribe-Post` headers (one-click, as Gmail and the EU rules
expect). Every language row of a newsletter must carry both links; the
checks (§2 step 5) refuse a language without them. Resend's
delivered / bounced / complained webhook (`/api/webhooks/resend`,
Svix-verified) resolves the tenant from the `email_log` row id carried in
the message tag, never from the body; a hard bounce lands in
`suppressions`, a complaint withdraws every topic for email. Transition:
`accounts.marketing_opt_out` stays a legacy mirror the ledger writes until
the platform's M4 retires it from the UI — the studio reads `canContact()`
from day one and never the flag directly.

### 12.6 Audiences and scoring

A campaign picks an **audience** from the one audience model (blueprint
§1.5: `marketingSegmentation.ts`, `marketing_target_groups`, the shared
builder); the studio never defines audiences. `SEGMENT_FIELDS` gains
`preferred_language`, `topic_consent:<topic>` and `buying_stage`, so "Arabic
readers with consent for Offers who are Comparing on anchors" is one target
group, and the audience preview's per-language counts come from the same
route journeys and forms reuse. A target group's `audience_level: account |
contact` decides whether a newsletter goes to one address per account
(today's branch, unchanged for the design partner) or to **people** — the
contact branch of `resolveMarketingRecipients` the platform adds; the
studio's language rule and `canContact()` work on the contact either way.
Scoring: `email.clicked` and `email.interest` (30 points, the strongest
email signal) and, only when opens are on, `email.opened` (1 point, decays
in a week) are inputs to `src/lib/marketing/scoring.ts` with the rubric the
tenant's config holds — the studio emits, it does not score (same doctrine
as Account 360's rating: a number a rep acts on comes from one explainable
place).

---

## 13. To enhance later (owner, 2026-10-20) — in this order, none of it built

a. **Reusable content components** — a library of saved sections (case study, product highlight, testimonial)
   written once and dropped into any design.
b. **Comments, draft sharing and an approval flow** for teams of more than one person.
c. **Dynamic blocks and recommended sections** driven by the Signals buying stage and the ABM tier.
d. **Suggested subject lines and recommended send times.**
e. **Language fallback rules editable per workspace** (today: contact, then company, then the campaign's fallback).
f. **Insights on which blocks drive clicks** (the click rows already carry the block).
g. **Inbox-rendering checks across mail clients** — needs an external service; decide later.

Added 2026-10-20 after owner review and now built: the before-send audience panel (same decision function as the
send), "See it as this person", language compare, and the Content health checklist (section 2, item 4).

## 14. As built: N0 and N1 (2026-10-20) — where the build differs from the text above

Read this before extending the studio. Everything above still holds unless it is listed here.

- **Flag and numbering.** Behind the existing `marketing` module **and** a new platform-admin flag
  `newsletter_studio` (default off; `docs/capabilities/newsletter_studio.md`, status experimental).
  Migrations are **0141** (tables), **0142** (campaign columns, `marketing_link_clicks`, three new recipient
  statuses) and **0143** (`preferred_language`) — not 0134. `PROJECT.md` has the ledger and the seed.
- **Words are plain text, not tiptap.** A text field is stored as clean plain text (tag-like strings and control
  characters removed; paragraphs on blank lines). The "rich subset" of section 3 is deferred; nothing here stores
  markup, which is the rule the subset was there to protect.
- **Link slots.** The version's `links` list is built from the blocks and the brand kit, not from the words, so a
  link has the **same index in every language**. A slot a language does not render is simply unused there.
- **Preview.** The studio calls `POST /api/newsletters/preview` (same gate, same renderer as a send) on every edit.
  The iframe is `sandbox="allow-same-origin"` — no `allow-scripts`, so no script can run — because the screen reads
  its height and each block's row (`data-nl-block`, preview only, never in a version) to pin "Check this" to it.
- **Who is emailed.** A newsletter send resolves each recipient to a **contact** (the account's contact whose address
  matches, else its oldest contact; a typed-in address by blind index). Nobody's contact => skipped
  (`skipped_no_contact`), not sent: consent belongs to a person. Then `canContact(tenant, contact, "email", topic)`.
- **Preferences link.** The footer's "Manage preferences" opens the same signed page as "Unsubscribe" until the
  preference centre (platform M4) exists. The send sets `List-Unsubscribe` + one-click `-Post` to the existing
  unsubscribe endpoint.
- **`preferred_language`** is offered on the contact and account forms, Data Workbench and exports only to a workspace
  with the studio AND only once the column exists (`requiresFeature` in `FIELD_REGISTRY`, applied in
  `getEffectiveFieldConfig`). It is not yet a `SEGMENT_FIELDS` audience field, in the v1 API or in MCP.
- **Not built in N0-N1** (by the doc's own phasing): subject ideas and "explain checks" (N2), the catalogue product
  picker and product-from-buying-signals (N2/N3 and Signals), Hindi/Urdu/French font verification (N2), Data Workbench
  export/update of headers, `/api/v1/newsletters`, MCP tools, global search, Nova timeline, analytics metric and the
  custom-fields tab (N3), the per-language audience preview before sending, the built-in festival folders of
  `src/lib/marketingTemplates` (six built-in designs ship instead), and "paste anything" through Nova.

## 14. As built: email health on the contact, and consent recorded by people (2026-10-20)

- **Delivery events.** `POST /api/webhooks/resend` (Svix-verified with `RESEND_WEBHOOK_SECRET`; 503 and nothing accepted when
  it is unset). Each newsletter message is sent with the tag `recipient_id` = the `marketing_campaign_recipients` row id and
  the provider's message id is stored on that row (0144). The tenant, campaign and contact come from that row, never from the
  body; the body's `to` is used only to notice a redirected message (a demo workspace), which never touches a real contact.
  Maps `delivered` / `bounced` (Permanent = hard, anything else soft) / `complained` / `delivery_delayed` to
  `email.delivered` / `email.bounced` (`bounce_type` hard, soft or delayed) / `email.complained`, idempotent on the Svix id
  (`email_provider_events`, 0145, and the event stream's own key). The recipient's `delivery_status` is updated; its `status`
  is not, so existing "sent" counts are unchanged.
- **Contact health.** `contacts.email_status` unknown | valid | soft_bounce | bounced | complained | invalid (+ `_at`, `_reason`),
  written only by the webhook and by the contact's three actions. One pure rule (`emailHealth.ts nextHealth`): a delivery returns
  unknown / soft_bounce / invalid to valid; severity only rises from webhook events; a late event never undoes a newer one; only a
  person can bring a bounced address back (by giving a new one). A hard bounce or complaint writes a `suppressions` row so
  `canContact()` refuses it; a complaint also withdraws email consent for every topic (source `provider_webhook`). A new hard
  bounce leaves a system comment mentioning the account owner, which is their Nova inbox item (Nova workspaces only).
- **Actions** (Marketing tab on the contact, `POST /api/contacts/[id]/email-health`, contact-edit permission, every one in the change
  history): *Check this address* (syntax + the domain's MX records over DNS only; private, loopback and internal targets refused; no
  mail server contacted, no third party), *Fix the address* (resets health to unknown, re-hashes, re-checks), *Mark as checked* (needs a
  reason; refused for a bounced or complained address, which stays blocked until it is replaced).
- **Needs attention.** Not a new screen: a second view of the Contacts list (`?view=email`, chip "Email needs attention (n)"), with
  status, since and the account owner; rows open the contact.
- **Consent recorded by staff** (`marketing_scoring`). The contact's Consent card shows each answer per channel and topic with
  its basis, since-date and how it is known; *Record consent* / *Record withdrawal* append to the ledger (source `rep`, evidence =
  the required note and the rep's user id), never editing history. Staff may record `consent`, or `existing_customer` only where
  the country recognises it, the workspace chose it and the account is a customer (the ledger's own `effectiveBasis` rule);
  `contract` and `legitimate_interest` are not offered by hand.
- **Data Workbench -> Consents.** Import (append-only): `email` (matched to an existing contact by the blind index, tenant-scoped;
  unmatched rows are reported as skipped, an address shared by two contacts is refused), `channel`, `topic`, `status`, `basis`
  (required for an opt-in, same jurisdiction limits), optional `given_on` and `note`; source `import`, the file name and row in
  the evidence. Export is the current state, read-only. No Update mode: the ledger is history.
- **Not built:** v1 API / MCP / search / analytics for consents (marketing roadmap M9); the preference centre and forms (M4);
  mirroring a full withdrawal to the legacy `accounts.marketing_opt_out` flag; email health for mail other than newsletter sends.
