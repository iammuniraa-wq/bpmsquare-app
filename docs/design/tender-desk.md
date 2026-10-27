# Tender desk — a colourful home for the tender edition

> Owner brief 2026-10-27: the KAMCO dashboard is pale. Build mock-up options 1 (Bold tiles) and 2 (Control room, dark) and let the
> person choose. Mock-ups (open them to see the target look, copy structure and numbers' layout, not their invented data):
> `C:\Users\ABDULN~1\AppData\Local\Temp\claude\C--Users-Abdul-Nandalpad-Documents-bpmsquare-app\69fb8a0d-43ed-43a5-b6e2-299ebe93d77d\scratchpad\kopt\project\Main.dc.html` (Bold tiles) and `Control.dc.html` (Control room).
> Live: https://claude.ai/artifact/4jHsmmM2k1sbGYyioRoRLS

## What is already there (rule 6c)

- Home is `src/app/(app)/page.tsx`: the classic `DashboardLayout` (Curated | My layout switch, per-browser in localStorage) or, for Nova
  tenants, `NovaStream`. Nothing tender-specific lives there.
- Pipeline > Tenders tab (`pipeline/TendersPanel.tsx`) lists tenders; `lib/tender/server.ts` has `listTenders`; stage definitions are
  `DEFAULT_TENDER_STAGES` (`lib/constants.ts`) with a colour each; `getTenantTenderStages`-style resolution is in
  `lib/sales/opportunityServer.ts`.
- Colour: `docs/design/colour-system.md` — tones by meaning, colours only from `src/lib/theme.ts` (a test enforces no hex elsewhere),
  `StatTile`/`StatStrip`, `Card tone`. The two new styles are bolder than that system on purpose (saturated tiles, a dark surface):
  add their palette to `theme.ts` as named tokens (`tenderDesk.*`), nothing hard-coded in components.
- Per-browser view choice precedent: `DASH_MODE_KEY` in `DashboardLayout.tsx` with the tenant default in Settings > Appearance
  (`appearance.dashboard_mode`, `settings/appearance/appearanceLogic.ts`).
- Money: `money()` from `lib/contractProjects/format`, currency from `resolveCurrency(tenant.config)`.

## What is new

A **Tender desk** home for workspaces with `features.gcc_tender` (platform-admin flag). No other workspace sees or renders anything of it.

- Two views of the home, one switch in the desk's header: **Bold tiles** (the default, white background) | **Control room**. The Tender desk is
  always the home of a tender workspace (owner decision 2026-10-27): the old classic / Nova home is not offered from it.
- The choice is remembered per person in the cookie `bpm_tender_desk` (`bold` | `control`), read on the server so the first
  paint is already right. The workspace default is one setting: Settings > Appearance > "Home style for tender workspaces" (one select, two
  values), stored in `tenants.config.appearance.tender_desk_style` (add to `TenantConfig` in `constants.ts`), default `bold`.
  A cookie wins over the workspace default; the setting is the only place a default is set.
- No new table, no migration. Everything is read from existing tables with the session/admin client scoped by `tenant_id`.

## Screens

Both styles draw the same `TenderDeskData` (`src/lib/tenderDesk/types.ts`). Same words and same meaning in both. Each block is a
card with a title and an `InfoTip` for any explanation (no running text). At 375 px: one column, tiles two per row then one, tap targets 44 px.

**Bold tiles** (light, follows the app theme in light and dark): greeting line with one sentence of figures; five saturated gradient
tiles (Open pipeline, Weighted by chance, Closing in 14 days, Win rate 12 months, Buy-out committed); Pipeline by stage (horizontal bars in the
stage colours, value in millions and count); Bids closing soonest (day chip red <= 3 days, amber <= 10, green otherwise; closes with a click through to the deal); Won and lost by month
(paired columns, emerald and rose); Open value by client (donut + legend, top 5 and Others); Buy-out against budget (budget bar, best-quote marker, awarded fill, status pill).

**Control room** (always dark, a self-contained dark surface inside the page; follows nothing but its own tokens): header line;
hero card with the open pipeline as one large number and the 12-week trend area chart; "Health" card with three rings (win rate,
weighted pipeline, buy-out committed); one segmented stage bar with a legend; a 28-day deadline timeline (markers at the closing day,
labels alternate above and below; red <= 3 days, amber <= 10, teal otherwise); "Needs you today" list (attention items, each with its action button linking to the record);
Open value by client as bars.

States: `pending` -> one calm empty state naming what is missing ("Tender data is not set up yet"); no tenders -> the empty-state with the next step
(a link to New tender); every list handles zero rows; a missing buy-out hides that card, never an error.

## Data (`getTenderDeskData(tenantId)`, `src/lib/tenderDesk/server.ts`)

Server-only, tenant-scoped (`MULTI_TENANT_GUARDRAILS.md`): every query chained with `.eq("tenant_id", tenantId)`; no id from the request.
Derivation lives in pure, tested functions in `src/lib/tenderDesk/rules.ts` (inputs: plain rows) so the numbers are explainable and stable.

- Open tenders = deals of the workspace's tender deal type with `outcome = 'open'`; value = `opportunities.amount`; chance =
  `opportunities.probability`; bid end date = `opportunity_tenders.closing_at`; client = the issuer account name. Missing table (42P01)
  or column -> `pending: true`.
- Stages: open stages of the workspace's tender stage list, in order, with each stage's own colour.
- Closing soon: `closing_at` today or later, local day in `tenant.config.timezone` (default Asia/Riyadh); `daysLeft` whole days.
- Win rate and months: tenders decided (`outcome` won / lost) with `closed_at` inside the last 12 calendar months; `dropped` is neither.
- Trend: for each of 12 week-ends, the sum of `amount` of tenders with `created_at <= weekEnd` and (`closed_at` null or `> weekEnd`).
  Honest approximation of history (later amount edits are not replayed); say so in the card's InfoTip.
- Buy-out: `project_buyout_packages` of contract projects in the workspace (budget = package budget, committed = awarded amount, best
  quote = the lowest valid current-round quote), the project with the most package activity first; sums for the KPI across all projects.
  Reuse `src/lib/contractProjects/buyout/server.ts` summaries; do not re-derive award rules.
- Attention (at most 5, severity order): a bid/no-bid proposal waiting for approval (`approval_requests`); RFQ suppliers past
  `respond_by` without a reply; a bid bond that expires within 30 days (`opportunity_tenders.bid_bond_expiry`); BOQ lines priced from a source
  older than 180 days on a deal closing within 14 days; a deal closing within 3 days with no priced lines. Each item links to the record.
- Cache: none that outlives the request. If `unstable_cache` is used, `tenantId` is part of the key.

## Wiring

`src/app/(app)/page.tsx`: when `features.gcc_tender` (`resolveTenderDeskStyle` returns a style, null when the flag is off), render `TenderDesk` (client component with
the switch; the data is passed in); otherwise the existing flow, untouched. Setting the cookie: a small route `POST /api/tender-desk/style`
(`requireTenantUser()`, value allow-listed) or a server action; the switch updates the cookie and refreshes.
Settings > Appearance gets the one select (tenant admin only, same guard as the other appearance settings).

## Seed

`scripts/seed-kamco-test-data.sql` grows so the real KAMCO dashboard looks like the mock-up (still idempotent, TEST-prefixed, only existing
columns, the seed test `scripts/seedKamcoTestData.test.ts` must pass and be extended): about 16 tenders in total across Received, Bid/No-bid,
Estimating, Submitted and Clarifications with realistic amounts (SAR 3 to 19 million), probabilities, bid end dates from 2 to 28 days out
(plus a few already past for Submitted/Clarifications), 5 clients; about 8 decided tenders over the last 12 months (some won, some lost,
one dropped) with `closed_at` spread across months; one contract project from a won tender with 4 buy-out packages (2 awarded, 1 with quotes,
1 waiting) if the buy-out tables exist; one approval request for a bid decision, one bid bond expiring in 9 days. Owners stay empty.
The cleanup script gets the matching deletes. Anything whose table is missing is skipped with a NOTICE.

## Definition of done

- [ ] Design questions of 3c that apply are answered above; rules that do not apply: it is a home view, not an object (no table, no API,
      no Data Workbench, no MCP).
- [ ] Both styles at 375 px and on PC, light and dark app theme (Control room is dark in both).
- [ ] No hex outside `theme.ts`; colour-system test passes.
- [ ] Unit tests for every derivation in `rules.ts`; render tests for both styles from a fixture; the cookie/default resolution tested.
- [ ] A workspace without `gcc_tender` renders exactly what it did before (test).
- [ ] `npx tsc --noEmit`, `npx vitest run --testTimeout=30000`, `npx next build` clean.
- [ ] Note in the commit: live-client screens changed (none expected), no SQL for the owner except the optional seed.
