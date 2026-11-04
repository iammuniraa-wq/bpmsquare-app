# Marketing in two parts: Marketing and Intelligence

**Status 2026-11-04: design, then built slice by slice on branch `marketing-two-parts`.** Mock-up (self-contained, PC and
375 px, light and dark): `docs/design/marketing-two-parts-mockup.html`. Every file named here was read on `develop`
(commit 8667c736). No database was queried; tenant flag state is taken from `PROJECT.md` and `docs/marketing-build-status.md`.

**Owner brief (2026-11-04).** "Marketing needs to be divided into 2 parts: one is Intelligence (ABM) and the other is simple
Marketing, and club certain things that way we can avoid confusion and make it easy to use." Standard: `bpmsquarecore.md`
6b (explanations behind the InfoTip, tabs, 375 px and PC) and 6c (lean: look first, one place per setting, few options,
one pattern per kind of thing, live clients are not a constraint, every capability stays reachable).

---

## 1. What is already there (screens checked)

Checked: the sidebar (`NAV` in `src/lib/constants.ts`), `navGroups.ts`, `navGlyphs.ts`, `MobileTabBar.tsx`, `workcenters.ts`,
`settingsMenu.ts`, and every screen under `src/app/(app)/marketing/**` plus `settings/marketing-*`.

| Today | What it is | Verdict |
|---|---|---|
| Sidebar: one parent "Marketing" with **12** children | Segmentation, ABM programs, Campaigns, Newsletters, WhatsApp, Events, Forms, Journeys, Buying signals, Leads, Scored leads, Revenue by source. Two jobs (reach people, know who is ready) mixed in one flat list. | Split in two groups: 6 + 4 (+ two Overview rows). |
| `/marketing` = "Marketing campaigns" list | A list of send records. There is **no marketing home**. | Becomes the Marketing home (slice 5). The list moves under Email. |
| Campaigns `/marketing/new`, `/marketing/[id]` | The plain-email composer (12 festival template files, rich text, 5-part audience picker) and the draft/sent record. | Stays the plain-email composer, reached from Email. |
| Newsletters `/marketing/newsletters` | Newsletter Studio: designs, languages, AI. **Already has the "Send..." side panel** (`SendPanel.tsx`: audience, live "N will receive", count-aware confirm, topic and languages inherited). Every send creates a campaign row. | The model for the one send flow. |
| Segmentation `/marketing/segments` | Saved "target groups" (`marketing_target_groups`): account types, include/exclude accounts, extra emails, filters, any/all. | Becomes **Audiences**. The campaign picker already stores the same six fields. |
| `TargetAudiencePicker.tsx` + `AudienceExtras.tsx` | A second copy of the target-group fields inside the campaign form. | Replaced by "pick an audience" (slice 3). |
| `/leads` ("Marketing & enquiries") and `/marketing/leads` ("Scored leads") | Two lists, one workcenter key (`leads`), two flags (`leads`, `marketing_scoring`). | Both go to Intelligence; merge is a late optional slice (open question 1). |
| Buying signals, ABM, Revenue by source | Analysis and focus screens. | Intelligence. |
| Settings > Marketing: Consent, Leads (scoring + hand-over), Brand kit | Already one page each (2026-10-22 pass, `settings-simplification-marketing.md`). | Kept. Scoring rules stay here; Intelligence only links to them. |
| Journeys, Forms, WhatsApp, Events | Automation and channels. | Marketing. |
| Tab strip (`tabs-context.tsx`) | Hard cap of 20 tabs. A 21st page bounces back with no message. | Small separate fix (section 9). |

The twelve ground rules (`bpmsquarecore.md` 3c) apply to *new objects*; this change adds none. It regroups and merges, so the
relevant ones are answered here: simple (6 + 4 nav rows, 3-step send), not crowded (explanations behind InfoTip), collapsible
(skip reasons show 5 + "show all"), documents and sending (one send flow with a review), change log (unchanged:
`logChange` stays on campaign create/update/send), AI by default (assistant screens list and ⌘K read `NAV`, so they follow;
section 8), show the data (the two home screens, section 6).

---

## 2. The grouping (recommendation)

| Part | Sidebar group (space) | Rows, in order | Job in one line |
|---|---|---|---|
| **Marketing** | `MARKETING`, parent "Marketing" | Overview, Audiences, Email, Journeys, Forms, WhatsApp, Events | Reach people. |
| **Intelligence** | `INTELLIGENCE`, parent "Intelligence" | Overview, Buying signals, Leads, ABM programs, Results | Know who is ready and what worked. |

Names. "Marketing" and "Intelligence" as the owner said. Sidebar rows use one word each:

| Today | New label | Why |
|---|---|---|
| Segmentation | **Audiences** | The object is a saved audience ("target group" is retired on screen). |
| Campaigns + Newsletters | **Email** | Both send email; one entry, two tabs (Sends, Designs). |
| Buying signals | Buying signals | Unchanged (first step of the Intelligence path: who is in market). |
| Leads + Scored leads | **Leads** (+ "Scored leads" until the merge) | Scoring is Intelligence. |
| ABM programs | ABM programs | Unchanged. |
| Revenue by source | **Results** | Page title stays "Revenue by source". |
| (none) | **Scoring rules** | Not a nav row. A link on Intelligence Overview and on Leads, to Settings > Marketing > Leads. |

Two groups, not two parents in one group: Spaces (the group navigator) and the mobile "More" sheet then show two tiles, so the
split is visible everywhere. Cost: `MobileTabBar` shows the first four groups only, so on a phone Intelligence sits in "More"
(Nova layout only). Accepted; a phone user opens Intelligence less than Marketing.

**Where the brief and the code disagree on grouping:** none on the table above. The disagreements are listed in section 12.

---

## 3. Merged vs only regrouped

| Item | Treatment |
|---|---|
| Campaigns + Newsletters | **Merged** into Email: one entry, one list (tabs Sends and Designs), one send flow Audience, Message, Review and send. Newsletter *designs* and plain *campaign records* stay two kinds of row (a design can be sent many times; a campaign row is one send), shown with a type chip. |
| Segmentation + campaign audience picker + extra-email box | **Merged** into Audiences. Campaigns, newsletters, ABM source and event follow-up all *pick* an audience. A one-off audience is allowed ("Build one now") and can be saved in one click. |
| Consent and topics | **Merged**: definitions, country rules, opens counting, limits live only in Settings > Marketing > Consent. Screens show a chip. |
| Leads + Scored leads | Regrouped now; merge later (open question 1). |
| Journeys, Forms, WhatsApp, Events | **Regrouped** only (their own tabs and studios stay). |
| Buying signals, ABM, Results | **Regrouped** only. Signals "Interests" stays a tab (it is signal configuration, not consent). |
| Brand kit, Scoring, Hand-over | Unchanged. |

What stays a tab: Email (Sends, Designs), Signals (In market, Did it work?, Interests), ABM program (its 5 tabs), Journey and Form studios (their tabs).

---

## 4. Navigation, permissions, feature flags

Feature flags are **unchanged**; missing = off. Nothing in `TenantFeatures` is renamed or added. The parent rows have no flag and
appear only when a child survives (existing `hasVisibleChild` rule), so a workspace that bought only Journeys sees "Marketing > Journeys" and no Intelligence.

| Row | Route (unchanged unless noted) | `featureKey` | `workcenterKey` |
|---|---|---|---|
| Overview (Marketing) | `/marketing` (home, slice 5; until then not shown) | `marketing` | `marketing` |
| Audiences | `/marketing/segments` | `marketing` | `marketing_segments` |
| Email | `/marketing/email` (slice 2; until then Campaigns `/marketing` and Newsletters stay as two rows) | `marketing` (Sends), `newsletter_studio` (Designs tab) | `marketing`, `marketing_newsletters` |
| Journeys | `/marketing/journeys` | `journeys` | `marketing_journeys` |
| Forms | `/marketing/forms` | `marketing_forms` | `marketing_forms` |
| WhatsApp | `/marketing/whatsapp` | `whatsapp_marketing` | `marketing_whatsapp` |
| Events | `/marketing/events` | `marketing_events` | `marketing_events` |
| Overview (Intelligence) | `/marketing/intelligence` (slice 5) | any of the five below | any of the five below |
| Buying signals | `/marketing/signals` | `buying_signals` | `signals` |
| Leads | `/leads` | `leads` | `leads` |
| Scored leads | `/marketing/leads` | `marketing_scoring` | `leads` |
| ABM programs | `/marketing/abm` | `abm` | `abm` |
| Results | `/marketing/attribution` | `marketing_attribution` | `marketing_attribution` |

**Permissions.** Business roles grant workcenters one by one and a parent row hides itself when no child is viewable
(`isItemViewable`). So "grant each part separately" already works: grant `signals`, `leads`, `abm`, `marketing_attribution` and the
role sees Intelligence only. **No new workcenter key and no data change.** Slice 5 adds two headings and a "grant all in this part" shortcut to the role editor, and relabels the catalog (`WORKCENTERS` labels: "Marketing Campaigns" becomes "Email", "Segmentation" becomes "Audiences", "Revenue by source" becomes "Results"). Keys, and therefore every saved grant, are untouched.

**Cross-flag note.** `TenantFeatures` comments say each marketing flag "needs `marketing`". The nav does not enforce that, and this change does not add it.

---

## 5. Before and after

Counts from the code on develop; "decisions" are things the user must choose.

| Task | Before | After |
|---|---|---|
| Find the screen | Open Marketing (1), scan **12** rows | Open Marketing (1), **6** rows; or Intelligence (1), **4** rows |
| Send a plain email to an audience | Campaigns > New (2), name, template folder + template (2), subject, tick a type (1), search + add account (3), Save draft (1), page changes, Send now (1), confirm (1). **About 12 clicks, 2 screens, no real recipient count.** | Email > New email > Plain (3), name + subject + message, pick audience (1), Review and send (1) shows "N will receive, M left out and why", Send to N (1). **6 clicks, 1 screen + panel.** |
| Send a newsletter | Studio > Send... panel (already built): about 4 clicks. | Same panel, same words as plain email. |
| Add one outside address | Type, Add (submits the whole form today), no result | Type, Add; the chip says "Not a contact: can't be emailed. Create contact" or "Ready" |
| Know why someone was skipped | "Skipped (no email)", "Skipped (no contact)" | A sentence and a link to the fix (section 7, bug 6) |
| Change consent for a topic | Settings (1 place) but 5 screens also ask for a topic | Settings only; screens show the chip |
| Start the day | Land on a list of campaigns | Overview: four steps with numbers (section 6) |

---

## 6. Home screens

Both are **4 tiles in a path, not 11 links**. Each tile has a number, a state colour, and one button. A tile for a module the
workspace has not bought is not drawn; an empty module shows its next step instead of a zero.

**Marketing Overview** (`/marketing`), "Reach people":
1. **Audience** (who): saved audiences, people who can be emailed now. Button: Audiences.
2. **Message** (what): drafts waiting; designs. Button: New email.
3. **Review and send**: drafts ready to send, with the first one's real recipient count. Button: Review.
4. **What happened**: last send, sent / left out / failed. Button: open it.
Below, one quiet row "Always on": Journeys running, Forms live, Events coming, WhatsApp templates approved. Each is a link.

**Intelligence Overview** (`/marketing/intelligence`), "Know who is ready":
1. **Who is in market**: accounts moving up (Buying signals).
2. **Who is ready**: hot leads waiting and overdue (Leads), and a small link "Scoring rules" (Settings).
3. **Where to focus**: ABM programs, engaged accounts.
4. **What worked**: revenue by source, top three.

Data comes from existing counts (`getAnalyticsDataLive`, `briefing/score.ts` lead and ABM counts, `listMarketingCampaigns`); no new table.

---

## 7. Slice 1 bugs (verified in the code)

| # | Observed | Verified cause (file) | Fix in slice 1 |
|---|---|---|---|
| 1 | "Add" next to "also send to emails not in the system" submits the form | `ManualEmailChips` button has no `type`, and `ObjectFormPage` wraps children in a `<form>` (`src/components/marketing/AudienceExtras.tsx` line 138; `src/components/page/ObjectFormPage.tsx`). The same is true of every button in `AudienceExtras.tsx` (+ Add, − Exclude, remove ×) and `TargetAudiencePicker.tsx` (Save as target group, Delete group, Clear). | `type="button"` on all of them. |
| 2 | Typed emails are skipped as `no_contact`, no reason on screen | `consentVerdict` in `src/lib/newsletter/send.ts` line 179 returns `skipped_no_contact` when no contact has that address; the send route (`api/marketing/campaigns/[id]/send/route.ts`) stores it, the picker never says so. | **Intended behaviour (recommended): an address is mailed only if it is a contact with consent. Never mail without consent.** The address chip shows its state live ("Ready", "Not a contact", "No consent for this topic") and offers **Create contact** (opens `/contacts/new`) or **Record consent** (opens the contact). |
| 3 | Counter reads "0 recipients" | Not tied to saving: `recipients-preview` takes the rule from the request body. The 0 comes from `will_receive` counting `accounts.email` only (`api/marketing/recipients-preview/route.ts` lines 25-27, `live.ts` line 2230); sample accounts have no email, and a typed address that was submitted away (bug 1) is lost. It also over-counts: it ignores contacts and consent, so it can say 5 and send 0. | The preview runs the **same decisions as the send** (`plainCampaignConsent`) and returns will receive, left out, and reasons. |
| 4 | "Send now" fires with no confirmation | A confirm exists but is generic: "Send this campaign now?" with no number (`[id]/MarketingCampaignDetail.tsx` line 87), and in a workspace without the Nova layer it is the browser's `window.confirm`, easy to miss or have suppressed. The newsletter panel already shows the count. | "Send now" opens **Review and send** (side panel, bottom sheet on a phone): "N will receive, M left out", reasons with links, then **Send to N**. |
| 5 | Save draft on `/marketing/new` leaves a blank form, no feedback | The code does `router.push` to the saved record after the POST (`MarketingComposeForm.tsx` line 64). The likely cause is the tab cap: `tabs-context.tsx` lines 161-166 bounce a new page back to the previous one when 20 tabs are open, with no message. The draft *was* saved. | Show "Draft saved" at once, keep the saved id in state so a second press updates rather than duplicates, and fix the tab cap (section 9). |
| 6 | Skip reasons are terse | `RECIPIENT_STATUS_LABEL` in `[id]/page.tsx` ("Skipped (no email)"). | One shared `skipReasons.ts`: label, one sentence, and a fix link (table below). Used by the preview, the review panel and the sent record. |
| 7 | Demo accounts have no contact emails, so a real send cannot be shown | Send needs `accounts.email` and a contact with consent (`live.ts` 2230, `send.ts` 163-185). | `scripts/seed-marketing-demo-contacts.sql` (section 10). |

Skip reasons (plain, with the fix). Each sentence is at most 160 characters and held by a test.

| Code | Shown | Fix link |
|---|---|---|
| `no_email` | This account has no email address. | Open the account |
| `no_contact` | This address is not a contact yet, so we cannot check consent. | Create contact |
| `no_consent` (and `denied` / policy codes) | This person has not agreed to this topic. | Record consent / Open Consent settings |
| `account_opted_out` | The account unsubscribed. | Open the account |
| `bounced`, `complained` | This address bounced or complained, so it is blocked. | Open the contact |
| `no_language` | No version in this person's language. | Open the newsletter |

---

## 8. Old route to new route, and every place that names these screens

| Old | New | How | Slice |
|---|---|---|---|
| `/marketing/signals`, `/abm*`, `/leads`, `/marketing/leads*`, `/marketing/attribution` | **Same URL** | No move: the part is shown by the sidebar group, not by the URL. Zero redirects, stored links, emails and notices keep working. | 1 |
| `/marketing` (campaign list) | `/marketing/email` | `redirect()` in `page.tsx` until slice 5, then `/marketing` becomes the home | 2 |
| `/marketing/newsletters` (list) | `/marketing/email?tab=designs` | `redirect()` | 2 |
| `/marketing/new`, `/marketing/[id]`, `/marketing/newsletters/new`, `/marketing/newsletters/[id]` | **Same** | Records and composers keep their URLs | n/a |
| `/marketing/segments*` | Same URL, label "Audiences" | Label only | 1 |
| `/settings/marketing-consent` | Same | Page also opens for `marketing`-only workspaces (see risks) | 4 |
| `/marketing/leads` | `/leads?view=scored` | only if the merge is approved | 6 |

Places that name these screens (all read from `NAV` unless noted, so they follow the label change on their own):
- Sidebar, Spaces, mobile tab bar and More: `NAV`, `navGroups.ts` (`NAV_GROUP_LABELS`), `navGlyphs.ts` (`GROUP_ICON`, one glyph per new row), tests `navGroups.test.ts`, `navGlyphs.test.ts`.
- ⌘K palette and assistant navigation targets: `NovaPalette.tsx`, `assistant/navTargets.ts` (from `NAV`). `createActions.ts` "New Newsletter" and "New Journey" keep working; add "New email".
- Assistant screens list `assistant/screens/generate.ts` (ids `marketing.*`, titles "Newsletter studio", "Revenue by source", ...): titles stay, section text says Marketing or Intelligence.
- Global search: only `abm_program` has a spec (`globalSearch.ts`); no change.
- Nova inbox `ROUTE_FOR` (`NovaInbox.tsx` `leads`, `abm_programs`, `abm_targets`): same URLs, no change.
- Tab strip titles (`tabs-context.tsx` lines 93-96) call every `/marketing/*` page "Campaign": give Email, Audiences, Intelligence screens their own title.
- Briefing and suggestions links (`briefing/score.ts`, `assistant/suggestions.ts`): same URLs.
- Dashboard ABM tile (`DashboardLayout.tsx`): same URL.
- Admin tenant editor flag list (`TenantEditor.tsx`): text unchanged.
- "Edit in Segmentation" link text in `TargetAudiencePicker.tsx`: becomes "Edit audience".
- Docs: `docs/guides/marketing-how-to.md` (Segmentation 2 mentions, Campaigns 1, Newsletters 3, Buying signals 8, ABM 3), the Drive "Marketing Guide", the website pages `guide-marketing.html`, `platform.html`, `solution-guide.html` in `bpmsquare-site`. **Not edited in this work** (memory rule: docs after the owner has tested); list kept here and in each slice commit.

---

## 9. Tab strip cap (separate small item)

At 20 tabs a new page silently bounces back (`tabs-context.tsx` lines 161-166 and 189-192). Recommended: **close the oldest tab that is not the current page and not pinned**, then open the new one; show a toast "Closed 'X' to make room". Pinned = a tab the user favourited. Never close a tab holding unsaved changes (the existing `confirmLeave` guard); if every tab is pinned or dirty, keep today's message. Ships as its own commit.

---

## 10. Demo seed `scripts/seed-marketing-demo-contacts.sql`

Convention (`PROJECT.md`): idempotent, `is_demo` tenants only, listed in the ledger "run AFTER <migration>", never a client. Content:
- For each `is_demo` tenant, up to 8 accounts get an `email` (plain text, `decrypt()` passes legacy plaintext through), with the local part `marketing.demo+<ref>@example.com`. The email safeguard (`resolveOutbound`, demo = redirect only) sends every message to the owner's inbox, whatever the address.
- Each of those accounts gets one contact (role "Marketing contact") with the same address, a `CON-####` ref continuing the tenant's sequence, skipped if a contact with that address exists.
- A `consent_events` + `consent_state` row (email, all topics, status `granted`, basis `consent`, source `import`) per contact, so the strict gate lets the send through. Needs 0139.
- Flips `marketing` on for demo tenants. Writes nothing for a non-demo tenant.

The contact `email_hash` (blind index) cannot be computed in SQL. It is only needed to find a contact by a typed address; for the seeded
account contacts the send matches by account. Typed outside addresses on the demo are therefore shown as "Not a contact" until created in the app, which is the intended behaviour and part of the demonstration.

---

## 11. Slice plan (each ships alone)

| # | Slice | Contents | Risk | Migration |
|---|---|---|---|---|
| 0 | Tab cap | Auto-close the oldest unpinned tab, toast | Low | none |
| 1 | **Two parts in the sidebar + the seven campaign fixes** | `INTELLIGENCE` group and labels (Audiences, Results), glyphs, group label and tests; type=button; preview = send decisions; Review and send panel; plain skip reasons with links; Save draft feedback; demo contacts seed | Low | none (seed script) |
| 2 | Email | `/marketing/email` with Sends and Designs, New email chooser, `/marketing` and `/marketing/newsletters` redirects, plain email uses the same panel as newsletters | Med (Vikas uses Campaigns) | none |
| 3 | Audiences | Composer picks an audience; one-off audience; chips per address; "target group" retired on screen | Med | none |
| 4 | Consent in one place | Consent page opens for any marketing flag; pickers show a chip with a link; "new topic" removed from pickers | Med (consent gate) | none |
| 5 | Home screens + role editor headings | Both Overviews; `/marketing` becomes the home | Low | none |
| 6 | Leads merge (optional) | One Leads list with Score and Stage; Scored leads becomes a view | Med | none |

No slice needs a database change. If one does, numbering starts at 0250 (0245-0249 are reserved).

---

## 12. Where the code contradicts the brief, and risks

Contradictions:
1. **Newsletters and campaigns are not two copies of one thing.** A newsletter is a *design* sent many times; a campaign is one *send record* (every newsletter send creates one). "One tool with a type" is right for the entry and the send flow, so Email has tabs Sends and Designs, not one flat list.
2. **The audience is already one object** in data (`marketing_target_groups` and the campaign columns share six fields). The merge is a screen merge, not a data migration.
3. **"Send now" does confirm today** (generic text, no number). The fix is the missing number and reasons, not a missing dialog.
4. **"0 recipients until saved" is not caused by saving**; it is the counter's definition (section 7).
5. **Scoring rules are a Settings page, not a screen of the part**, so they are a link, not a row.
6. **Two lists called Leads exist**, on two flags. Not one "Leads" to place.
7. **Consent settings are unreachable for a `marketing`-only workspace** (`settingsMenu.ts` gates the Consent page on `marketing_scoring` or `newsletter_studio`), yet the plain send already uses the consent gate. Fixed in slice 4.
8. **Phones** show only four groups in the Nova tab bar; Intelligence goes to More.

Risks:
- **Live clients.** Vikas Pioneers is the only live client that plausibly uses Marketing (Campaigns with festival greetings, Segmentation; flag state not checked here). BIM Infotech is WFM only and sees nothing. KAMCO uses tender flags, no marketing. Slice 1 changes labels and group only for Vikas, and the campaign form behaviour (fixes). Slice 2 and 3 change screens Vikas uses; per 6c.7 lean wins, but note it in the commit.
- Consent gate: the preview now says the truth, which for a workspace without recorded consent is "0 will receive". That is correct and is shown with the fix link, not hidden.
- Any stored link to `/marketing` (campaign list) lands on Email after slice 2.
- Docs drift until the owner has tested (not edited here).

---

## 13. Open questions for the owner

1. **Leads: merge `/leads` and "Scored leads" into one list?** Recommendation: yes, in slice 6, after the nav split has been seen. Until then both rows sit together in Intelligence.
2. **Move the Intelligence screens to `/intelligence/...`?** Recommendation: no. The sidebar group tells the part; keeping URLs means no redirects and no broken links in sent emails, notices and change history.
3. **Does Vikas Pioneers still send festival campaigns?** Recommendation: assume yes; slice 2 keeps festival templates as a "Seasonal" group in Designs and the plain composer unchanged, and Vikas is told before it ships.

---

## 14. Built

**Slice 0 (8de1f3d2) and slice 1 (b363761a).** As in sections 7 and 9. Verified by tests, tsc and reading the code; not clicked in a browser: the Review and send panel, the address chips, the new sidebar groups, the tab-closing notice.

**Slice 2, Email.**
- Sidebar: one **Email** row (`/marketing/email`, flag `marketing`, workcenter `marketing`) replaces Campaigns and Newsletters.
- `/marketing/email` has chips **Sends**, **Newsletters**, **Templates**. The last two appear only with `newsletter_studio` and keep the studio's own access check (`studioPage()`).
- Sends has a Type column (Plain or Newsletter) and two buttons, **+ New email** and **+ New newsletter** (the second only with the studio).
- `/marketing` and `/marketing/newsletters` redirect to Email (search and page kept). Record and composer addresses did not move.
- The assistant's newsletter-studio manifest carries its own feature and workcenter gate now that the sidebar row is gone.
- Deviations: the composer is still one page, not three steps (Audience, Message, Review and send arrive with slice 3, because the audience picker is replaced there). A role granted only the Newsletters workcenter (and not Email) no longer sees a sidebar row; the studio pages stay open to it by address and ⌘K "New Newsletter".
- Verified by tests only: redirects (source checks), nav gating, assistant manifests.

**Slice 3, Audiences.**
- The campaign form's audience block is one **Audience** control: a select (Everyone we can email, a saved audience, or "One-off (changed here)") plus **More** for account types, specific accounts and extra addresses. It sits before the message in both the new and the draft form. A new email starts as Everyone.
- The select tells the truth by value (`src/lib/marketing/audienceRule.ts`): load a saved audience and change a box, and it becomes a one-off with **Save as audience** beside it. A matching saved audience shows **Edit audience** and **Delete**.
- The count (`AudienceCount`) is the send's own, with a status chip on every typed address.
- "Target group" is gone from the screens: Audiences list and builder, ABM source ("From an audience"), ABM tips, the change-log line. Routes and the `marketing_target_groups` table are unchanged; no data migration.
- Deviation: the composer is one page with Audience, then Message, then **Review and send** (the panel from slice 1), not a stepper. The three steps are the order of the cards.
- The saved-audience dropdown, the account-type filter and the specific-account search are still reachable (under More). The Segmentation builder is untouched except wording.
- Verified by tests and tsc only: the select/More behaviour in a browser.

**Slice 4, Consent in one place.**
- New `ConsentChip` (topic, "Change in Settings", InfoTip) is the only consent element on the email screens: under the audience count of the campaign form, and on a newsletter campaign in place of the topic dropdown (the topic is the newsletter's own, set in the studio).
- The Consent page and its Limits tab now open for a workspace with `marketing` alone (menu entry, page and the two routes via `loadMarketingSettingsContext({ consent: true })`). Before, a Newsletter-Studio-only workspace could open the page but the API answered 404, and a Marketing-only workspace could not open it although its sends are consent-gated. Scoring and Hand-over still need `marketing_scoring`.
- Deliberate: the form, WhatsApp template and journey-step topic pickers stay. They *choose* a topic from the list for their own content; the list, country rules, opens counting and limits are defined only in Settings. The journey step already inherits the newsletter's topic.
- Verified by tests and tsc only.

**Slice 5, Overview screens and role headings.**
- `/marketing` is the **Marketing Overview** (four steps: Audience, Message, Review and send, What happened, plus an "Always on" row of links with small counts). `/marketing/intelligence` is the **Intelligence Overview** (Who is in market, Who is ready, Where to focus, What worked; a step is drawn only for a module the workspace has and the person may open; a Scoring rules link goes to Settings). Both use one `OverviewPath` component.
- Each part's first sidebar row is **Overview**, and the parent row's address is its Overview. `NavItem` gains `featureAnyOf` and `workcenterAnyOf` (a row switched on by any of several flags or workcenters); `navFeatureOn()` in `navGroups.ts` is the single check, used by the sidebar, the ⌘K palette and the access explainer. A workspace without any Intelligence module sees no Intelligence group.
- The old campaign list address `/marketing` now shows the Overview; the list is `/marketing/email` (so a stored link to the list lands on the Overview, one click from Email).
- Role editor: Marketing and Intelligence headings with **Grant all / Clear all** (`WORKCENTER_PARTS`). Keys and saved grants are unchanged.
- Counts are small tolerant queries (`homeCounts.ts`, tenant-scoped; a missing table gives no number). Deviation from the mock-up: "Who is ready" shows scored leads, not hot/overdue, and the Marketing step 1 shows the number of saved audiences, not the number of people who can be emailed (that count needs the per-person consent check and is shown on the send form).
- Verified by tests and tsc only. Not seen in a browser: both Overviews, the sidebar groups, the role editor headings.
