# UX simplification — labels, values, actions; explanations behind an "i"

> **Status:** design, 2026-10-20. Owner brief (verbatim intent): *"I don't want
> the screen filled with text. It has to be simple, with an 'i' for
> explanation. And if a page is too big for the options, split it into
> multiple tabs. Check the layouts on PC and mobile."*
>
> This replaces the earlier studio rule "every option carries a one-line hint
> printed under it" (newsletter-studio-architecture §2, signals-architecture
> §4.5b, process-design-studio, settings `SettingsField`). Explanations move
> behind one shared **InfoTip** (`i`); the screen shows labels, values and
> actions only. Clickable mock-up: `docs/design/ux-simplification-mockup.html`
> (Before/After, desktop and 375 px, working `i` and tabs).
>
> No application code was written for this document. Builders start from §2
> (the standard) and §3 (the change list), in the order of §3.

---

## 1. Audit — what is on screen today

Method: read every screen's TSX/CSS on `develop` (commit 559d0048) and the
approved mock-ups in `docs/design/*.html`; counted the explanatory strings
rendered unconditionally (`styles.hint`, `styles.help`, `optHint`,
`bpm-t-help`, `Field hint=`, `c.hint` lines). "Groups" = collapsible option
groups or titled cards a user reads one at a time.

| Screen | Files | Explanatory texts always on screen | Groups / blocks | Mobile (375 px) today |
|---|---|---|---|---|
| **Newsletter Studio** | `marketing/newsletters/NewsletterStudio.tsx`, `panels.tsx`, `newsletter.module.css` | **33** (6 group-header hints, 15 in groups, 5 in the block editor, 1 under the preview, 3 fold notes, 3 under "Use it" buttons) | Panel: 6 groups (Start, Blocks, Languages, Health, Brand kit, Use it) + canvas + 3 folds (Versions, Email HTML, Details) | Panel becomes a 6-tab pill strip (own CSS, not the kit), one group visible, canvas below, sticky Save bar. Works, but 6 tabs scroll off a 375 px strip and the "Use it" tab duplicates the sticky bar. |
| **Journey builder** | `marketing/journeys/JourneyStudio.tsx`, `journey.module.css` | **28** (4 header hints, 9 in groups, 4 card subtitles, per step 1 "fires" + 1 "held or skipped if" line, 2 under Try it, 1 fold) | Panel: 4 groups (Name and start, When it starts, Rules, Languages). Canvas: 4 cards (Who would enter, The journey, Try it, What is happening) + fold (Details for IT) | Panel collapses above the canvas as 4 disclosures, then four cards stack: ~5 screens of scroll. No sticky bar; Save/Turn on only in the header, off-screen once scrolled. |
| **Journey run page** (same component, status live) | as above | same, plus live counts | "What is happening" card: 6 KPIs, skipped groups, task list, run-log table | Log table scrolls sideways inside its card. |
| **Forms builder** | `marketing/forms/FormStudio.tsx` (shares the newsletter CSS) | **23** (5 header hints, 14 in groups, 1 under preview, 2 fold notes, 1 status line) | Panel: 5 groups (Basics, Fields, Consent, After sending, Share) + canvas + 2 folds (Answers, Details) | 5-tab pill strip, preview below, sticky Save. Answers table scrolls sideways. |
| **Buying signals** ("Who is in market") | `marketing/signals/SignalsWorkspace.tsx`, `signals.module.css` | **14** (4 group hints, 4 option hints incl. a 4-stage legend sentence, 2 view intros, 2 in the account view, 2 in Topics) | Panel: 4 filter groups (Show, Topic, Owner, Find) + a stat card. Workspace: 3 hand-rolled tabs (Who is in market, Did it work?, Topics) | Panel folds into an "Options" disclosure; list rows reflow to cards (good). Tabs are not the kit and not in the URL. |
| **ABM program list / record** | `marketing/abm/page.tsx`, `abm/[id]/page.tsx` | List: 1 subtitle sentence. Record: **6** (source note, required-roles note, 3 result notes, by-tier empty line) | Record: kit tabs already (Target accounts, Buying groups, Results, Activity, Details) | `ObjectRecordPage`: fine. Results "By tier" table has no card view. |
| **ABM target account** (buying group grid, plan) | `abm/[id]/accounts/[targetId]/page.tsx`, `BuyingGroupGrid.tsx`, `PlanPanel.tsx`, `abm/new/NewProgramForm.tsx` | **14** (1 gap banner, 1 under grid, 1 in add dialog, 5 Field hints in Plan, 6 Field hints in New program) | Record: kit tabs (Buying group, Plan, Activity, Details) | Grid is a 5-column table in an `overflow-x` box: sideways scroll on a phone; two `<select>`s per row are small targets. |
| **Scored leads list / record** | `marketing/leads/page.tsx`, `leads/[id]/page.tsx` | **11** (list subtitle sentence; record: the "worked out … rules version …" sentence, 2 empty states, 5 rail/dl lines) | Record: kit tabs (Overview, Timeline, Activity) + rail | `ObjectRecordPage`: fine. |
| **Settings → Marketing → Scoring** | `settings/marketing-scoring/ScoringClient.tsx` | **13 distinct, repeated per rule**: with the default rubric (8 behaviour + 3 profile rules) ≈ **55** help paragraphs rendered at once | 4 `SettingsSection`s (What people do, Who they are, Where the lines are, Try it) | Each rule = 5 fields + 5 paragraphs stacked: one rule ≈ one phone screen. Uses `settingsLabel`/`settingsInput` directly, **not** `SettingsField`, so it bypasses the settings kit's own `?` toggle. |
| **Settings → Marketing → Consent & topics** | `settings/marketing-consent/ConsentClient.tsx` | **6** (2 section intros, 2 per topic, 1 per jurisdiction legal sentence, 1 page intro) | 2 `SettingsSection`s | OK; one column already. |
| **Process Design Studio** (6 steps) | `process-studio/ui.tsx` (`OptionGroup`, `Opt`, `Switch` — every one has a mandatory `hint`), six `*Step.tsx` | **~50 across the six steps** (8 Tell, 11 Process, 8 Fit, 7 Changes, 9 Plan, 7 Talk), plus a `Head` sub-sentence on every workspace | Stepper + panel (2–3 groups per step) + workspace | Panel stacks above the workspace; stepper shows only the active label. Acceptable. |
| **Contact → Email health card** | `contacts/[id]/EmailHealthCard.tsx` | **9** (status plain text, "what to do", last event, 3 button help lines, no-email line, waiting line) | 1 card, 3 inline actions | Card stacks; fine. |
| **Contact → Consent card** | `contacts/[id]/ConsentCard.tsx` | **11** (intro, 1 after the buttons, 4 Field hints in the inline form, history lines) | 1 card + 6-column table | Table scrolls sideways; the inline form is one column. |
| **Account 360 cards** | `components/Account360Drawer.tsx`, `lib/account360/types.ts` | Card `subtitle` and stat `hint` are rendered as muted lines under every title/stat (data-driven) | One renderer for every card | Drawer is full-width; fine. |
| **Needs attention** (Contacts `?view=email`) | `contacts/page.tsx` | 0 beyond the empty state | List with 3 extra columns | `ObjectListPage` cards; fine. |

Three findings that shape the standard:

1. **Five private copies of the same panel primitives.** `Group` (newsletters
   `panels.tsx`, journeys, forms), `OptionGroup`+`Opt`+`Switch` (process
   studio `ui.tsx`, signals) all take a mandatory `hint` and print it. One
   shared primitive with an `info` prop converts every studio at once.
2. **Two explanation patterns already exist and disagree.** Settings has a
   `?` HelpDot (`SettingsField.tsx`) that toggles an inline grey box; the
   studios print hints. The owner asked for one `i`. The standard below
   replaces both with one component; `SettingsField`/`SettingsRow` keep their
   `help` prop and simply render it.
3. **No tooltip component exists** in `src/components/ui` (grep for
   `tooltip`/`aria-describedby` finds only the chart renderer), and the tab
   strips of the studios (`.ptabs`, signals `.tabs`) are hand-rolled rather
   than the kit `Tabs` + `useUrlTab` that spec §13.5 made the rule.

---

## 2. The standard

Rule-like and testable. Where a rule has a number, the number is the test.

### 2a. The InfoTip (`i`)

**One component:** `src/components/ui/InfoTip.tsx`, exported default
`InfoTip`, styled by `.bpm-tip*` rules in `globals.css` (tokens only).

```ts
type InfoTipProps = {
  /** The label the tip explains. Used for aria-label ("About <label>") and as the sheet title. */
  label: string;
  /** The explanation: plain text, at most two short sentences (≤ 160 characters). */
  children: React.ReactNode;
  /** Optional key into GUIDE_LINKS (src/lib/guideLinks.ts) → renders "Learn more" at the end. */
  guide?: string;
  /** Where the popover prefers to open on desktop. Default "below". */
  placement?: "below" | "above";
};
```

Adopters, so builders add the `i` once per primitive and never by hand:

| Primitive | New prop | Renders |
|---|---|---|
| `ui/Field` | `info?: ReactNode` | `<InfoTip label={label}>` after the label text. `hint` stays, but only for a constraint line (§2a-4). |
| `ui/Card` | `info?: ReactNode` | after the card title |
| `settings/SettingsField`, `SettingsRow` | existing `help` | HelpDot is deleted; `help` renders `InfoTip`. Same API, no page edits. |
| new `ui/OptionGroup` (replaces the five private `Group`/`OptionGroup`) | `info?: ReactNode` (replaces `hint`) | after the group title in the header row |
| new `ui/Opt` (replaces process-studio `Opt`/`Switch` and signals `.opt`) | `info?: ReactNode` (replaces `hint`) | after the option label |
| `page/ObjectListPage` column defs | `info?: string` | in the column header (desktop) and the card label (mobile) |
| Account 360 renderer | reads `card.subtitle` and `stat.hint` | renders them as `i`, no data change |

**1. Look and size.** A 16 px circle: 1 px border `var(--line)`, transparent
fill, glyph "i" in Inter 10.5 px / 700, colour `var(--hint)`. Sits 6 px after
the label, vertically centred on the label's x-height. Hover/focus: border and
glyph take `--tip-accent` (= `var(--modern-accent, var(--tenant-accent,
var(--accent)))`, the same resolution as `--tab-accent`). Open: filled with
`--tip-accent`, glyph `var(--panel)`. Hit area is 44 × 44 px (a transparent
`::before` box) while the visual stays 16 px.

**2. Where it sits.** Only after a *label*: a field label, a group title, a
card title, a column header, a stat label, a checkbox label. Never on a
button, a tab, a value, a pill, a table cell, or a sentence. One `i` per
label, at most. If a thing has no label, it gets no `i` — give it a label.

**3. Content limits.** Plain words, at most two short sentences, ≤ 160
characters, no lists, no markup except the optional "Learn more" link.
Dynamic text is allowed (the trigger hint that changes with the chosen
trigger) under the same limit. The first sentence says what the option does;
the second, if any, says the consequence or where it is set. Write it as the
answer to "what happens if I change this?".

**4. What stays visible (the allow-list).** Everything else moves into an `i`
or is deleted.
- Errors and validation messages (`role="alert"`, `--err-ink`).
- Blockers — why a control is disabled or an action cannot happen now: "AI is
  not set up for this workspace", "It is on, so the steps are locked", "No
  consent recorded: this person will be skipped", "This workspace has no
  domain yet". One line, amber or blue banner style, never grey help text.
- Empty states: title ≤ 6 words + one sentence with the next step + one action.
- Constraints that prevent a mistake, ≤ 6 words, under the control, as
  `Field hint`: "PNG, JPG, WebP · max 2 MB", "Changing it breaks shared
  links", "Must be on acme.com".
- Values, facts and summaries: counts, "Updated 2 h ago", "English + Arabic",
  "Small sample (under 20)".
- The product's own explanations of a *record* (explainability): why this
  score, why this step fires today, which signal added points. One line each.
- Confirm-dialog bodies and toasts (they are already transient).
- Sub-line on a choice card (the three "start" cards), ≤ 6 words.

**5. Desktop behaviour** (`(pointer: fine)` and the page/panel ≥ 900 px):
opens on hover after 150 ms and on keyboard focus; closes when the pointer
leaves (200 ms grace to move into the popover), on blur, and on **Esc**.
Click toggles *pinned* so a mouse user can reach "Learn more"; pinned closes
on click outside or Esc. Popover: `max-width: 280px`, below the icon, flips
above when there is no room, clamped 8 px inside the viewport, surface
`var(--panel)`, border `var(--line)`, shadow `var(--card-shadow)`, text
`var(--ink)` 13 px, radius 10 px.

**6. Touch behaviour** (`(pointer: coarse)` or the container < 900 px): a tap
opens a **bottom sheet**: fixed to the bottom, full width, `padding-bottom:
env(safe-area-inset-bottom)`, title = the label, the text, "Learn more" if
any, a Close button (44 px). Backdrop tap, Esc and Close close it; focus moves
into the sheet and returns to the `i` on close; the page does not scroll
behind it. Nothing ever overflows a 375 px screen sideways.

**7. Accessibility.** `<button type="button" aria-label="About <label>"
aria-expanded aria-controls={id}>`. Desktop popover: `role="tooltip"
id={id}`, and the button carries `aria-describedby={id}` while open. Sheet:
`role="dialog" aria-modal="true" aria-labelledby`. The `i` is in the tab
order right after its label (before the control). `prefers-reduced-motion`:
no fade, no slide. Contrast: glyph `--hint` on `--panel` ≥ 4.5:1 in every
theme (checked for :root and nextgen dark; Spectacular's header band forces
white ink, so an `i` in a page header inherits it — fine).

**8. Theming.** Tokens only: `--panel`, `--panel2`, `--line`, `--ink`,
`--hint`, `--card-shadow`, `--tip-accent`. No hex. Works unchanged in
Classic, Modern, Nova light/dark, Enterprise, Spectacular (same token set the
kit Tabs rely on, spec 12.1).

**9. No button inside a button.** Every studio `Group` header today is one
`<button>` holding title, summary and chevron. An `i` inside it is a nested
button, which the HTML parser silently splits (found while building the
mock-up: the header fell apart). The new `OptionGroup` header is a **row**
(`div`, grid: title button · `i` · summary · chevron) whose title button
stretches over the row with a `::after` overlay, and the `i` sits above it
(`position: relative; z-index: 1`). The mock-up's `div.sech` + `.secbtn` is
the reference. Same rule for card titles: `Card` renders `<h2>` + `InfoTip`
as siblings, never an `i` inside a clickable title.

**10. On a phone the group's `i` must survive the tab strip.** When the panel
groups become tabs (< 900 px) the open group keeps a slim title row (title ·
summary · `i`, no chevron, not clickable) above its options, so the group's
explanation stays reachable; tabs themselves never carry an `i`.

**11. Deletions, not just moves.** A hint that repeats the label ("The thing
that happened" under "When someone…"), restates a toast, or explains an
obvious control ("Narrows the list as you type") is deleted, not moved.

### 2b. When to split into tabs

Split a page into tabs when **any** of these is true:
1. More than **5** option groups or titled blocks that a user reads one at a time.
2. The page in its typical state is longer than **2 screens at 1280 × 800**
   (≈ 1,600 px) or **3 screens at 375 × 667** (≈ 2,000 px).
3. **Two or more distinct jobs** on one page (build vs test vs monitor; design
   vs read the answers; rules vs try them).

Then:
- **3 to 5 tabs**, never more. Over 5 → merge, or move to the `⋯` menu or to
  Settings. Under 3 → do not tab; use two cards.
- **Names:** one or two words, the user's job or the object, capitalised
  like a sentence: Build, Test, Running, Answers, Results, Rules, Thresholds.
  No "Other", "Misc", "Advanced", "More".
- **First tab = the job people come for** (and the one a shared link lands on
  without `?tab=`).
- **State in the URL** via the existing `useUrlTab` (client, `?tab=`) or kit
  `Tabs` `hrefFor` (server). One tab key per page; a studio with a panel strip
  and a canvas strip uses `?tab=` for the canvas and `?panel=` for the panel.
- **Look:** the kit `Tabs` (`.bpm-tab`, spec §13.5) everywhere. The studio
  pill strips (`.ptabs`, signals `.tabs`, journey) are replaced, not restyled.
- **Desktop:** the strip sits under the header (record pages: under the facts).
- **Mobile:** same strip, `overflow-x: auto`, never wraps, each tab ≥ 44 px
  tall, the active tab scrolled into view on load, counts kept.
- **Nesting:** at most one tab level inside a page. If both the panel and the
  canvas need tabs on a phone, they merge into **one strip** (the panel
  becomes the first tab, "Setup").
- **Studio panels** (the 330 px left column) keep collapsible groups on
  desktop — at most **5**, one open at a time, the header carrying title +
  one-word summary + `i` (no hint line). Under 900 px the groups become the
  tab strip. The canvas stays below the strip when it is a live preview
  (Newsletter, Forms); when the canvas is a workspace with several jobs
  (Journey), the canvas tabs are the strip and the panel is "Setup".

### 2c. Layout rules, PC and phone

1. **Primary action in one place.** Record/studio pages: one primary button
   top-right of the header + `⋯` (spec §1). Forms: `FormFooter`. On phones the
   primary (and Save, if separate) is **also** in the sticky bottom bar — and
   nowhere else on the page. Options panels never contain action buttons
   (the Newsletter "Use it" group and the Process-studio "Save" group go).
2. **One column under 900 px** for studios (`.studio` grid → one column);
   lists → cards under 780 px (`MOBILE_BREAKPOINT`). The right rail stacks
   under the main column.
3. **No horizontal page scroll** at 375 px. A table wider than the screen
   becomes card rows (as `ObjectListPage` does). Only a log/HTML `<pre>` may
   scroll sideways, inside its own card.
4. **Touch targets ≥ 44 px**: tabs, `i`, icon buttons (`.ic` 26 px visual →
   44 px hit box), chips, select rows. Two controls side by side on a phone
   only if each keeps 44 px.
5. **Density**: Inter scale from `globals.css` only — title `--ts-title` 22,
   section 16, label 13 / 600, body 13.5, help 12.5. Nothing under 12 px
   except pills and counts. Panel gap 10 px, card padding 14–16 px, field
   gap 16 px, group header 44 px tall.
6. **Long lists show 5, then "Show all (N)"**: understood chips, who-would-
   enter chips, skipped-reason groups, consent history, factors. Logs and
   answer tables show 10 with a pager.
7. **Empty states**: `EmptyState` — title ≤ 6 words naming what is missing,
   one sentence with the next step, one action. "No steps yet" / "Add a step,
   or start from a template." / [Add a step].
8. **Sticky bottom bar on phones**: 56 px + safe-area, `--panel` surface,
   `--line` top border; the page gets matching bottom padding; the InfoTip
   sheet opens above it.
9. **Header subtitle** = facts only (ref · count · state), never a sentence of
   explanation (Scored leads and ABM list subtitles today).

---

## 3. Screen-by-screen change list

Ordered by how much the screen gains (text removed × how often it is used).
Effort: S ≤ half a day, M ≈ 1–2 days, L > 2 days, for a builder with the
shared pieces of §5 already merged. "→ i" = moves into an InfoTip on that
label; "→ ⋯" = moves into the More menu; "del" = deleted.

| # | Screen | Into an `i` | Tabs | Removed / moved | Stays visible | Effort |
|---|---|---|---|---|---|---|
| 1 | **Newsletter Studio** | 6 group-header hints → `i` on group titles; Topic sentence → `i` Topic; "Header and footer carry your brand…" → `i` Blocks; link rule → `i` "Where it goes"; picture rules (beyond the constraint) → `i` Picture; Rewrite/`{{account_name}}` → `i` Rewrite; two Languages sentences → `i` Languages and `i` Add language; Health sentence → `i` Health; Preheader "(the preview line…)" → `i` Preheader; "Shown exactly as it is built for email…" → `i` Preview; Email-HTML note → `i` | Panel groups **6 → 4: Start · Blocks · Languages · Health**. Mobile strip = kit Tabs, `?panel=`. | **Use it** group → header: primary **Use in a campaign**, secondary **Save**, `⋯` (Duplicate, Save as template, Versions, Export HTML, Archive, Delete); its 3 hints del. **Brand kit** group → one fact line "Brand: Acme Precast" + `i` + link, on Start. "In English first. Nothing is saved…" del (toast says it). "Pick one; its blocks…" del. **Details** fold del (ref/status already in header). Versions and Email HTML folds → `⋯`. | AI-not-set-up blockers; brand-block-locked line for non-admins; "PNG, JPG, WebP · max 2 MB" constraint; amber health items with their fix; empty block message; sticky bar. | **M** |
| 2 | **Journey builder + run page** | 4 header hints → `i`; template sentence → `i`; trigger hint (dynamic) → `i` "It starts when"; condition sentence → `i`; look-back sentence → `i`; re-entry sentence → `i`; the two checkbox sub-lines → `i` on each; quiet-hours sentence → `i`; 4 card `<small>` subtitles → `i` on card titles; "Held or skipped if: …" → `i` on a small **guards** chip per step; Try-it sentence → `i` Pick someone | Canvas **tabs: Build · Test · Running** (`?tab=`). Mobile: one strip **Setup · Build · Test · Running** (Setup = the panel groups). | **Languages** group del (its chips move onto the send step, with `i`). "Details for your IT team" fold → `⋯` "Definition". Panel 4 → 3 groups. | Entry count + first 5 chips (+ Show all); pre-flight checks (stop/warn); the one-line "fires" sentence per step; KPIs; skipped groups; "Waiting for the database update" blocker; Save/Turn on also in a new sticky bar on phones. | **M** |
| 3 | **Settings → Marketing → Scoring** | Every field paragraph → `i` on its label (via `SettingsField help`): Points, Fades over, Counts up to, Shown as, Matches when, Engaged from, Ready from, Look back, and the sample fields; the 3 section intros → `i` on section titles; page intro → `i` on the title | **Tabs: Rules · Thresholds · Try it** (`?tab=`); Rules holds the two rule kinds as two cards | "The thing that happened" del. Rule rows rebuilt on `SettingsField` (grid of 5 compact fields, labels only). | Version line as a fact ("Rules v3"); "must be higher than the line above" as a validation error when violated; sample result. | **M** |
| 4 | **Process Design Studio** (6 steps) | Every `OptionGroup hint` → `i` on the group title; every `Opt`/`Switch hint` → `i` on the label; every `Head sub` → `i` on the workspace title; the chips legend ("blue is what you said, amber assumed") → `i` on the chat title | Stepper stays (it is a gated flow, spec §13.4). | Plan step "Save" group → page header Save + sticky bar; "Documents you have" paragraph → an empty state "Coming next release". | Area cards' one-line blurb (choice sub-line); "Answered" tags; the Gantt total line (a value). | **S** (one edit in `ui.tsx` + Head) |
| 5 | **Forms builder** | 5 header hints → `i`; intro, consent-record sentence, topics sentence, required-box paragraph, redirect rule, embed sentence, status sentence → `i` on their labels | Page **tabs: Design · Answers (N)** (`?tab=`). Panel keeps 5 groups; mobile strip = kit Tabs `?panel=`. | **Details** fold del. "Save the form to get its address" → empty state in Share. "Name, company, phone, message and up to three questions…" del. | "Changing it breaks shared links" and "Must be on acme.com" as constraints; "Not live yet" status line; no-domain blocker; preview caption del. | **S** |
| 6 | **Buying signals** | 4 group hints → `i`; stage legend → `i` Stage; topics/owner source sentences → `i`; "How this is worked out" closing sentence → `i`; Did-it-work and Topics intros → `i` on their titles | Workspace tabs → kit `Tabs` + `useUrlTab`: **In market · Did it work? · Topics** | "Narrows the list as you type" del. Panel 4 filter groups → one **Filters** group (stage chips, topic, owner, search) + the stat line; mobile: one "Filters" sheet. | "Updated 2 h ago"; moved-count line; fresh-row marker; "Fewer than 20 recipients" small-sample fact. | **S** |
| 7 | **Contact → Email health card** | status explanation ("what to do" when nothing is wrong) → `i` on card title | — | 3 button help lines del ("Nothing is sent" moves into the result toast); "Check this address" → **Check address**; waiting line → empty state | Status pill + since; the problem sentence; "What to do: …" only when blocked; last event; no-email blocker. | **S** |
| 8 | **Contact → Consent card** | intro → `i` on card title; 4 Field hints → `i`; basis sentence (dynamic) → `i` Basis | — | "Use these to write down what the person told you…" del. Table → rows under 780 px (channel · topic · pill · since, "how we know" behind the row's `i`). History shows 5 + Show all. | "No answer recorded yet, so we do not email…" (blocker); pills; dates. | **S** |
| 9 | **ABM target account** (grid + plan) | "Roles are for this program only…" → `i` Buying group; "Naming someone sends nothing…" → `i` in the dialog's Person label; Plan: Tier, Owner (dynamic), Deal, Private note hints → `i`; New program: 6 Field hints → `i` | Tabs already (4). | Ghost-row "· required by this program" → a **Required** pill. Grid → card rows under 780 px (name/title, role select, owner select stacked, 44 px). "Check progress" `title` → the button's result toast. | Gap banner (amber, blocker); "Unsaved changes"; Overdue. | **M** |
| 10 | **ABM program list / record** | source note → `i` on a **Copied list** chip; required-roles note → `i`; "Money is from the deals…" → `i` Results; dropped/lost note → `i` | Tabs already (5 = max). | List subtitle → "N active". "Fewer than 20 targets…" → "Small sample" pill with `i`. By-tier table → rows under 780. | Goal sentence; funnel numbers. | **S** |
| 11 | **Settings → Marketing → Consent & topics** | page intro, 2 section intros, 2 topic field hints → `i`; per-country legal sentence → `i` on the country label | — (2 sections) | — | "Ask your legal adviser" shown as an amber line **only when** a relaxed option is selected. | **S** |
| 12 | **Scored leads list / record** | list sentence → `i` on the Score column; "using scoring rules version N" → `i` Why N?; About-card "Not named. The score uses everyone…" → `i` Person | Tabs already (3). | Subtitle → "N of M · best first". | "Worked out 3 min ago from 12 things" as facts; "5 more points to reach Ready" (insight); empty states. | **S** |
| 13 | **Account 360 cards** | `card.subtitle` → `i` on the card title; `stat.hint` → `i` on the stat label (renderer change only) | — | — | Health score, suggestions, stats, empty lines. | **S** |
| 14 | **Needs attention** (Contacts view) | status legend → `i` on the Email status column header | — | — | Chips, pills, empty state. | **S** |

Batching for builders: **batch A** = §5 shared pieces + rows 4, 7, 8, 13, 14
(all S, mostly one-file edits); **batch B** = rows 1, 2 (the two heavy
studios, M each, mock-up provided); **batch C** = rows 3, 5, 6, 9, 10, 11, 12.

### 3b. Labels to fix (from the how-to writer's pass over the real screens)

One word, one meaning. Each row is a find-and-replace the builder does in
the same commit as the screen's row above; the how-to guide uses the
"Recommended" column. Verified against `src/lib/constants.ts` NAV (lines
335-342), `MarketingComposeForm.tsx:84`, `leads/page.tsx:120`,
`lib/studio/types.ts:125`.

| # | Problem today | Recommended wording | Where |
|---|---|---|---|
| L1 | **"Topics" means two things.** Consent topics (what people agreed to hear about) vs Buying-signals topics (subjects you sell). The Journey send step says "Subject for consent / No one subject"; the Newsletter Studio says "Topic / No one topic". | Consent side = **"Consent topic"** everywhere (field label "Consent topic", empty option "Any consent topic", settings page "Consent topics"). Signals side = **"Interest"** (tab "Interests", filter "Interest", "Tag this link with an interest"). "Subject" is reserved for the email subject line. | Newsletter Start group, Journey send step, Forms Consent group, Settings → Marketing → Consent & topics, Signals Topics tab + filter, Contact consent card "About" column → "Consent topic". |
| L2 | **Four words for "switched on":** Live (forms), On (journeys), Active (ABM programs), Ready (newsletters). | **Live** for anything the outside world can reach or that runs by itself: forms, journeys, ABM programs. Status set: **Draft · Live · Paused · Done · Archived** (ABM "Completed" → Done). Newsletters are not switched on, they are used, so their set is **Draft · Ready to use · Archived**; the status chip says "Ready to use". Buttons: "Go live" / "Pause" / "Resume" (journeys and ABM), form status select "Live — visitors can send it". | Journey header button "Turn on" → "Go live"; ABM primary "Start" → "Go live"; pills in all four lists and records; journey toasts ("On." → "Live."). |
| L3 | **"Engaged" is three things** (lead stage, lead score band, ABM progress). **"Quiet"** is a buying stage and quiet hours. | Lead score bands: **Cold · Warm · Hot** ("Engaged from" → "Warm from", "Ready for sales from" → "Hot from"). Lead stages keep **Engaged** (it is the stage set the owner approved). ABM progress: **Engaged → "Responding"** (reached · responding · in talks · in a deal · won). Buying stages: **Quiet → "Silent"** (Silent · Looking · Comparing · Deciding); the rule stays "Quiet hours". | Settings → Scoring thresholds, ScoreMeter labels, `SCORE_LABEL`; ABM `PROGRESS_LABEL`, results funnel, program-list bar; Signals `STAGE_LABEL`, stage chips, legend. Store values unchanged; labels only. |
| L4 | Scored-leads empty state says "wait for the nightly run"; scoring runs every 15 minutes. | "Leads appear here as people at your companies are scored, every 15 minutes. Add a lead from the Leads page, or press Score again on a lead." | `leads/page.tsx` empty text; the record's "Not scored yet" text already says 15 minutes. |
| L5 | Menu has both **"Leads"** and **"Scored leads"**; Buying signals, ABM programs and Scored leads share one icon (`◎`). | Rename "Scored leads" → **"Lead scores"** (it is a view of the same leads, ordered by score) and give each item its own glyph: Lead scores `⚡`, Buying signals `◎`, ABM programs `◆`. Longer term (open to the owner): fold Lead scores into Leads as a chip "By score". | NAV in `constants.ts` lines 336, 338, 342; page titles and back links "All scored leads" → "All lead scores". |
| L6 | New Campaign subtitle: "Send a rich-text email to a filtered set of accounts" even when the source is a newsletter. | Subtitle becomes facts: **"Email · choose the audience and the newsletter or text"**; when a newsletter is picked, the form header shows "From newsletter: October update (v2)". | `MarketingComposeForm.tsx:84`. |
| L7 | Process Design Studio change kind **"Tenant extension"** is jargon. | **"Built for you"** (change kinds: Setting · Custom field · Built for you · New module), with an `i`: "Something we build only for your workspace, kept separate from the standard product." | `lib/studio/types.ts` `CHANGE_KIND_LABEL` (value `extension` unchanged). |
| L8 | Contact consent card shows "Basis: They agreed" while Data Workbench needs the raw words `granted`/`withdrawn` and `consent`/`existing_customer`. | Screen keeps plain words with the raw value in brackets once, in the `i` on the Basis label: "Stored as `consent`. Data Workbench and the API use the stored word." Data Workbench template columns use the stored words with the plain word in the column description. Plain words: Answer **Agreed / Withdrawn**; Basis **They agreed / Existing customer / Contract / Legitimate interest**. | `ConsentCard.tsx` BASIS_LABEL, consent import spec in `registrySchema.ts`. |

**GAP (not a label) — record for the build list:** no screen lets a user set
a newsletter link's **interest** (Signals topic). `signal-topics` exist and
the rubric scores "a click on a tagged link", but the Newsletter block editor
has no field for it, so topic-tagged clicks cannot happen yet. Proposal: an
"Interest" select on the Button and Product block editors (optional, `i`:
"A click on this link counts toward this interest in Buying signals"), stored
in the block settings and carried by the signed click link. Effort S; add to
the Newsletter Studio row (#1) when it is built.

---

## 4. The mock-up

`docs/design/ux-simplification-mockup.html` — no external scripts, Inter from
Google Fonts only, tokens as `:root` + `prefers-color-scheme` guarded by
`:root:not([data-theme="light"])` + `:root[data-theme="dark"]`, token names
matching `globals.css` (`--panel`, `--panel2`, `--ink`, `--muted`, `--hint`,
`--line`, `--accent`, `--accentbg`, amber/green/blue/err pairs).

What it shows:
- **Before / After** toggle for the **Newsletter Studio** and the **Journey
  builder**; **Desktop / Phone (375)** frame toggle; light / dark.
- Working `i`: hover and focus open on desktop, click pins, **Esc** closes;
  in the 375 frame (or on a real phone) a tap opens the bottom sheet.
- Working kit-style tabs with arrow keys and `?ntab=` / `?jtab=` URL state
  (the `useUrlTab` behaviour), one strip on the phone.
- The phone frame uses a CSS container query, so the 375 px layout renders
  inside a desktop page too; at a real ≤ 480 px viewport the frame is the
  screen and the bar/sheet are fixed to it.

Verified in the Browser pane at 1280 px and 375 px: no horizontal scroll, no
console errors, `i` operable by keyboard (Tab → Enter/Space → Esc).

---

## 5. Integration points

**Files the builders touch (shared, once):**

| File | Change |
|---|---|
| `src/components/ui/InfoTip.tsx` (new) | The component of §2a. Pure client component; portal for the sheet; no new npm package. |
| `src/app/globals.css` | `.bpm-tip`, `.bpm-tip-pop`, `.bpm-sheet`, `.bpm-sheet-backdrop`; `--tip-accent` beside `--tab-accent`; reduced-motion block. |
| `src/lib/guideLinks.ts` (new) | `GUIDE_LINKS: Record<string, string>` — key → URL/anchor into the how-to guide, so "Learn more" targets live in one place. |
| `src/components/ui/Field.tsx`, `Card.tsx` | `info?` prop. |
| `src/components/settings/SettingsField.tsx` | HelpDot removed; `help` renders `InfoTip`. Every settings page gets the `i` for free. |
| `src/components/ui/OptionGroup.tsx` (new) and `Opt.tsx` (new) | Replace the five private copies: `newsletters/panels.tsx Group`, `journeys/JourneyStudio.tsx Group`, `forms/FormStudio.tsx Group`, `signals/SignalsWorkspace.tsx OptionGroup`, `process-studio/ui.tsx OptionGroup/Opt/Switch`. Props: `title, summary?, info?, open, onToggle, id`. |
| `src/components/ui/Tabs.tsx` + `useUrlTab.ts` | Unchanged API; add an optional `urlKey` to `useUrlTab(ids, key = "tab")` so a page can hold `?tab=` and `?panel=`. Studio pill strips are deleted in favour of these. |
| `src/components/page/ObjectListPage.tsx` | `ListColumn.info?` → `i` in the header cell / card label. |
| `src/components/Account360Drawer.tsx` | Render `card.subtitle` and `stat.hint` through `InfoTip`. |
| `src/app/(app)/marketing/**` CSS modules | Delete `.hint`, `.help`, `.ptabs/.ptab`, `.sech .hint` rules once nothing uses them. |

**Rules for future screens** — draft for `docs/ui-restructure-spec.md`, to be
pasted as a new section when the owner approves:

> ### 14. Explanations and tabs (owner, 2026-10-20)
> 1. The screen shows labels, values and actions. Explanatory text is not
>    printed; it sits behind the kit `InfoTip` (`i`) after the label, at most
>    two sentences. `Field.hint` is for a ≤ 6-word constraint only. Visible
>    text is limited to the allow-list in `docs/design/ux-simplification.md`
>    §2a-4: errors, blockers, empty states, constraints, values, record
>    explanations, confirms and toasts.
> 2. Settings `help`, studio `OptionGroup`/`Opt`, `Card`, `Field` and list
>    columns all render the same `InfoTip`. No page defines its own.
> 3. A page splits into kit `Tabs` (3–5, `useUrlTab`) when it has more than
>    five groups, is longer than two desktop screens, or holds two jobs
>    (§2b). Studio panels keep ≤ 5 collapsible groups on desktop and become
>    the tab strip under 900 px; a studio whose canvas has tabs uses one strip
>    on a phone with the panel as "Setup".
> 4. One primary action top-right (+ `⋯`), repeated only in the phone's sticky
>    bar; never inside an options panel. One column under 900 px, no sideways
>    page scroll, 44 px targets, lists show 5 then "Show all".
> Acceptance per screen: count of always-visible explanatory strings ≤ the
> allow-list; `i` reachable by keyboard; 375 px and 1280 px checked in light
> and dark.

**For the how-to guide** (`docs/guides/marketing-how-to.md`, being written
in parallel) — names and tabs that change, so the guide describes the
"after":

| Screen | Change the guide must reflect |
|---|---|
| Newsletter Studio | Panel is Start · Blocks · Languages · Health (no "Brand kit", no "Use it"). Save and **Use in a campaign** are in the header (phone: bottom bar); Save as template, Versions, Export HTML are in `⋯`. |
| Journey builder | Canvas tabs **Build · Test · Running**; the panel is "Setup" on a phone; "Languages" group gone (languages shown on the send step); the compiled definition is `⋯ → Definition`. |
| Forms | Page tabs **Design · Answers**. |
| Buying signals | Tabs **In market · Did it work? · Topics**; one **Filters** group. |
| Settings → Marketing → Scoring | Tabs **Rules · Thresholds · Try it**. |
| Contact cards | Email health button is **Check address**; consent table becomes rows on a phone. |
| Everywhere | "Tap the `i` next to a label for what it does; Learn more opens this guide." The old "one-line hint under every option" wording must go. |
| Labels (§3b) | "Consent topic" vs "Interest"; Live / Paused / Done statuses and "Go live"; Cold · Warm · Hot score bands; ABM "Responding"; Signals "Silent"; menu item "Lead scores"; Process studio "Built for you". |

---

## 6. Open questions for the owner (with recommendations)

1. **Hover on desktop, or click only?** Recommend **hover + focus, click to
   pin** (§2a-5): fastest for a mouse user, still reachable by keyboard, and
   the pin makes "Learn more" clickable. Click-only would mean two clicks per
   question.
2. **Newsletter Studio header actions.** Moving Save / Use in a campaign /
   Save as template out of the "Use it" group into the header + `⋯` changes
   the approved Newsletter mock-up. Recommend **yes** — it matches the record
   template (spec §1) and removes a whole panel tab on the phone.
3. **Journey steps: "Held or skipped if …" lines.** They are the safety story
   of the product but double every step's height. Recommend **keep the one
   "fires" sentence visible, put the guards behind an `i` on a small "3
   guards" chip**; the pre-flight checks before Turn on stay visible.
4. **Settings `?` everywhere.** Replacing HelpDot with the `i` changes every
   settings page's look (inline grey box → popover), not only Marketing.
   Recommend **one component, one session**, demo tenant first — two styles
   of "explain this" would undo the point of the brief.
5. **Scoring rules as compact rows** (object pattern: row + `⋯` Edit) is the
   cleaner end state but a larger refactor than `i` + tabs. Recommend **`i` +
   tabs now (M), rows in a later pass** once the rubric settles.

## 6. Status (2026-10-21)

- Batch 1 (screens 1-2, the InfoTip/OptionGroup/Opt kit): merged 35b37069.
- Batch 2 (screens 3-14 and labels L1-L8): merged a7956d1b (3-6, L1 forms/signals,
  L3 score bands and signal stages, L4, L7) and the batch 2b merge (7-14, L1
  consent side, L2, L3 ABM, L5, L6, L8). Shared additions: `info` on
  `ListColumn`/`SortableTh`, `SettingsSection`, `PageHeader`,
  `SettingsPageHeader`; `.bpm-rows-table` / `.bpm-rows-cards` / `.bpm-tap`.
- The how-to guide carries the new words (2f5ffdbf).
- Still open: the owner's own look at 375 px and 1280 px (neither build agent
  had a browser); the Forms builder has two tab levels on a phone (page tabs
  plus the panel strip), which the table asked for but §2b discourages: decide
  after seeing it; `SettingsField` shows the `i` on demo and Nova workspaces
  and keeps the old `?` elsewhere (batch 1 decision), so Settings pages differ
  by workspace until that is unified.
