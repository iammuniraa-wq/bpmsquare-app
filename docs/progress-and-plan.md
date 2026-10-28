# BPMSquare — progress and plan (snapshot 2026-10-21, after the overnight build)

> Read this first when resuming. It is the single place that says what is
> done, what is half-done, what is next and what the owner still has to
> decide. Update it at every pause.

## Working rules (owner)

- **Fable designs, Sonnet builds** (2026-10-19). Design first (doc, mock-up
  where the screen is new), owner approves, then build.
- **Nothing standalone**: every capability designed integrated with the suite;
  every design has an "Integration points" section.
- **Simple screens** (bpmsquarecore §6b): labels, values, actions; explanations
  behind the `i`; tabs when a page is big; PC and 375 px checked.
- Owner runs all SQL by hand (dev, then production). **Push only on his
  "push"; develop only unless he says main.** Never stage
  `.claude/launch.json`, `src/app/login/LoginForm.tsx`,
  `src/lib/wfm/selfService.ts` (his uncommitted files).
- Ship sequence: security check, tsc + tests + build on the exact commit,
  push develop, main only on his word.
- Vikas and BIM (live clients) must see nothing new: everything below is
  behind platform-admin flags that are off for them.

## On develop (pushed 2026-10-21), waiting for the owner's validation

| Piece | What | Doc |
|---|---|---|
| Price list with quantity breaks | `products.qty_breaks` on every surface (registry, Data Workbench import/export/update, v1 API, MCP); the engine reads the product's own bands when the routed book has no rule for that product; why chip names the band; demo Wire Rope moved from a formula to real bands on the Catalogue book | `pricing-engine-architecture.md` §21 (+ §20 table) |
| ERP integration plan | Masters in, won documents out, three lanes (files, API + change feed + webhooks, connectors), phases 0-5, open decisions | `erp-integration-plan.md` |
| UI simplification batch 2 | Screens 3-14 and labels L1-L8; shared `info` props on list columns, settings sections and page headers | `design/ux-simplification.md` §6 |
| Side branches merged | Segment Coverage fields (active AMC, bought product) now match; Business Role grants enforced on every marketing page and API route; WFM supervisor scope on first paint | commit messages |
| Forms: thank-you + double opt-in | Thank-you and owner-notice emails through `resolveOutbound`; pending consent with a signed 7-day confirm link; jurisdiction setting under Consent topics | `shells/forms-shell.md` |
| Leads: hand-over | Settings → Marketing → Hand-over (response time, days off, rota, who hears about overdue, auto-create switch); auto-created leads inside the scoring run; overdue notice as a Nova inbox row | `shells/leads-shell.md` |
| How-to guide | New words and tabs (Lead scores, Check address, Go live, Hot from, Responding, Consent topics, Interests, Silent); sections 2 and 5 extended | `guides/marketing-how-to.md` |

Also on develop from earlier in the day: WhatsApp, attribution, events shells;
screen simplification batch 1; migration 0146.

## SQL the owner must run (dev, then production), in this order

| File | Why | After |
|---|---|---|
| `scripts/run-bundle-5-migrations-2026-10-20.sql`, `run-bundle-6-seeds-2026-10-20.sql` | yesterday's bundles if not yet run | — |
| `supabase/migrations/0197_consent_pending.sql` | pending consent for double opt-in | — |
| `supabase/migrations/0198_leads_handover.sql` | inbound source, fallback reason, one open inbound lead per person | — |
| `scripts/seed-products-demo.sql` (re-run) | Wire Rope list price + bands | 0118 |
| `scripts/seed-pricing-demo.sql` (regenerated, re-run) | ROPES routed to the Catalogue book | products seed |
| `scripts/seed-marketing-handover-demo.sql` | demo tenant: auto-create and overdue notices on | 0198, `seed-marketing-leads-demo.sql` |

Code degrades while each is pending (no crash, the feature simply stays
quiet); PROJECT.md's ledger carries the same list.

## What the owner should look at (validation list)

1. Standard Quote, Wire Rope 40 → 420, 150 → 390, 500 → 360, the why chip
   says "from the product's own price list, band from 100". Product page →
   quantity breaks card with its `i`. Data Workbench products export shows
   the `qty_breaks` column as `100:390; 500:360`.
2. Every batch-2 screen at 1280 px and 375 px (nobody has seen them in a
   browser yet): Settings → Scoring (three tabs), Process Design Studio,
   Forms builder (two tab levels on a phone: decide), Buying signals
   (Filters sheet), contact Email health and Consent cards, ABM target and
   program, Consent topics, Lead scores, Account 360, Needs attention.
3. A form with double opt-in: submit, thank-you mail arrives in the demo
   inbox, Consent card says "Waiting for confirmation", the Yes button on the
   link flips it.
4. Settings → Marketing → Hand-over; after a scoring run a new Warm contact
   gets a lead; an overdue lead shows in the Nova inbox.
5. The ERP plan's four open decisions (§5 of the doc).

## Next (queued, in order)

1. **Walkthrough video v3** (owner: "redo tomorrow"): record again with the
   Wire Rope bands on the Catalogue book, the Hand-over screen and the new
   labels; the script in `guides/pcbs-voiceover/ALL-SCENES-v6.txt` only needs
   the times refreshed.
2. (Skipped for now, owner 2026-10-28.) **ERP plan phases 1-3** after the owner's decisions (external refs, v1
   writes for masters, the `DocumentWon` payload).
3. (Out of scope for now, owner 2026-10-28.) Marketing enhancements still open: journeys health and heatmap; ABM "My
   ABM day"; signals heatmap and outside data; newsletter components,
   comments and approvals; leads recycling (item 4) and overdue reassign;
   forms languages and actions; the "every surface" pass per object.
4. Drive guides (Sales, Admin, API, Marketing, Products) after validation.
5. Estimator: a visual for every estimate, dynamically (owner 2026-10-28):
   `docs/design/estimator-visual-for-every-estimate.md` (generic massing from
   the template's dimensions + a composition strip on every estimate).
6. **Assistant actions** (owner 2026-10-28: "add more AI capabilities, not for
   KAMCO today, to have it in the pipeline"): `docs/design/assistant-actions.md`,
   steps 0 to 6 in order (wording when off, decouple from Nova, more create
   cards, change cards, transition verbs, delete cards, bulk). Each step
   validated on the demo before any client flag is widened.
7. (Out of scope for now, owner 2026-10-28.) **Access restrictions with access contexts** (C4C-style read/write per
   object; owner 2026-10-28 "can be done later"): design doc first, reverses
   decision 2026-10-23 on Business Roles; see `docs/design/people-access.md` 6.

## Open items waiting on the owner

- Decisions: lead response time and weekend days (now a setting with
  defaults), "Talk to us" address, WhatsApp provider, Etimad approach,
  reverse-IP provider, open-tracking default (off), Saudi consent default
  (strict), the ERP plan's four decisions.
- His uncommitted login-cleanup files: keep or discard.
- `RFQ_LINK_SECRET` in Vercel (Preview and Production).
- AI usage metering before paid clients use AI features.
- Estimator open items (glTF/IFC upload, AI render provider, ERP push, RFQ
  from estimate lines); BOM versions/stock/ERP export.
- PCBS: discovery questions prepared but not asked; D365 live test needs an
  environment from his side.
