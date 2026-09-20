# Mobile responsiveness — audit, 2026-09-20

> **Status: findings 1–5 fixed 2026-09-20.** See "What was done" at the
> end. 6 and 7 are deliberately still open. The finding list below is kept as
> written so the fix can be checked against it.

Static audit of the whole app at phone width. Nothing here is fixed yet; this
is the finding list and the proposed single fix.

**Method.** Every `gridTemplateColumns` written as an inline style in `src/`
(182 of them) was parsed and scored for whether it can survive a 366px content
box — that is a 390px phone minus the mobile shell's own `12px` padding either
side. A template was flagged when it has ≥200px of fixed track or ≥4 equal
columns AND the element carries no class that collapses it. 40 flagged.

Inline styles are the root cause of every finding below: **a stylesheet rule
can never override an inline `gridTemplateColumns`** without `!important`,
which is exactly the trap `343bceb` hit with `PageHeader` and solved by moving
the values into a class. The same move fixes these.

---

## What is already right

Worth stating, so none of it gets "fixed" by accident:

- There is a **real mobile shell**, not a squeezed desktop one — `Shell.tsx`
  switches on `MOBILE_BREAKPOINT` to its own branch with a top bar, a hamburger
  drawer hosting the shared `Sidebar`, and its own `<main>` at `12px` padding.
- `viewport` sets `viewportFit: "cover"` and the chrome uses
  `env(safe-area-inset-*)`, so notched iPhones are handled.
- `<main>` is `overflowX: "auto"`, **deliberately not `hidden`** (there is a
  comment saying why). This is what keeps every finding below at "you must
  scroll sideways" rather than "the content is unreachable".
- Sticky save bars clear the fixed bottom tab bar, with matching page padding
  so the bar cannot settle underneath it (`.set-savebar` / `.set-page`).
- The helper classes are well designed — `.fg2/.fg3` (form grids), `.hub-grid`,
  `.kpi-grid`, `.auto-grid`, `.set-grid`, `.card-grid`, `.mob-hide/.mob-show`.
  **The gap is not missing CSS. It is ~40 places that never opted in.**

---

## Findings

### 1 — Four responsive classes that were hooked up and never written  *(certain)*

`case-body`, `prod-body`, `cf-grid`, `qf-grid` appear as `className` on a grid
element and **have no rule anywhere in `globals.css`** — it is the only
stylesheet in the app. The markup records the intent; the rule is simply
absent, so these render as desktop grids on a phone.

| File | Template |
|---|---|
| `src/app/(app)/cases/[id]/page.tsx:203` | `1fr 260px` (`case-body`) |
| `src/app/(app)/products/[id]/page.tsx:76` | `1fr 260px` (`prod-body`) |
| `src/components/CaseField.tsx:209` | `minmax(0,1fr) 240px` (`cf-grid`) |
| `src/components/QuoteField.tsx:240` | `minmax(0,1fr) 240px` (`qf-grid`) |

### 2 — Record and form pages whose sidebar column never stacks  *(~24 sites)*

The pattern is `1fr <260–340>px` for "content + right rail". At 366px the
fixed track takes 260–340 of it, leaving 10–90px for the main column, which
then refuses to shrink below its own min-content and pushes `<main>` into a
horizontal scroll. Reading an invoice on a phone means scrolling sideways.

Detail pages: `invoices/[id]`, `inventory/[id]`, `purchase-orders/[id]`,
`suppliers/[id]`, `standard-quotes/[id]`, `cases/[id]`, `products/[id]`,
`pipeline/[id]`.
Create forms: `assets/new` (320px), `inventory/new`, `purchase-orders/new`,
`suppliers/new`, `technicians/new` (280px), `invoices/new`,
`standard-quotes/new` (×2, 300px), `technicians/[id]/config` (340px).

Some siblings already do this correctly — `quotations/new/QuoteForm.tsx:1224`
and `work-orders/[id]:125` carry `hub-grid`, and `accounts/new`, `cases/new`,
`contacts/new` carry `mob-hide` on the rail. So the fix is an established
in-repo pattern, not a new idea.

### 3 — KPI strips locked to 4–5 columns  *(5 sites)*

`.kpi-grid` exists and collapses to `1fr 1fr`, but these write the columns
inline with no class: `invoices/page.tsx:112` and `leads/page.tsx:82`
(`repeat(5, 1fr)` → ~62px per tile), `standard-quotes/page.tsx:110`,
`technicians/[id]/page.tsx:245`, `(app)/loading.tsx:9` (`repeat(4, 1fr)`).

### 4 — Fixed-track row grids in Settings and tools  *(~10 sites)*

Rows built as grids with 220–370px of fixed track and a `1fr` that cannot
shrink: `settings/pricing` (`1fr 110px 100px 80px` ×3, plus
`160px 1fr 110px 100px` — 370px fixed), `settings/coverage`
(`220px 1fr`, `1fr 140px 140px`, `1fr 1fr 120px 100px`),
`settings/templates` (`180px 1fr 80px`), `data-workbench` (`215px 1fr`),
`pricing/history` (`260px 1fr`), `marketing/SegmentBuilder` (`220px 1fr`).

### 5 — Right-side drawers wider than a phone  *(6 sites, one screen)*

`quotations/new/QuoteForm.tsx` has six `position: fixed; right: 0` drawers at
`width: 380/400/420/440` with no `maxWidth`. On a 390px viewport the 440px one
hangs 50px off the left edge and that content is unreachable — a fixed element
is outside `<main>`, so `main`'s `overflowX: auto` does not rescue it. The
`width: 380` confirm modals in `PipelineBoard.tsx:191` and
`OpportunityDetailClient.tsx:298` have the same shape. (The login/reset cards
at `width: 380` are fine — they pair it with `maxWidth: "100%"`.)

### 6 — Tables with no scroll wrapper  *(minor)*

49 of 60 table files wrap in an `overflowX` container. These do not:
`marketing/page.tsx`, `marketing/segments`, `pricing/advanced`,
`settings/number-ranges`, `CaseListNova`, `QuoteListNova`,
`components/pricing/PriceTrace`. All are `width: 100%` with no `minWidth`, so
they compress rather than overflow — 5–6 columns at 366px is cramped, not
broken. Lowest priority. (The print documents in the same grep are for PDF
output and are correctly fixed-width.)

### 7 — The bottom tab bar is Nova-only

`MobileTabBar` renders only for `nextgen2`/Nova (`Shell.tsx:158` says so
deliberately: "their phones keep the hamburger they have today"). Every other
theme, **including both Spectacular palettes**, is hamburger-only on mobile.
Not a defect — a product decision worth re-confirming now that Spectacular is
a direction being shown to enterprises.

---

## What was done

Applied 2026-09-20, in one pass, exactly as proposed. The scanner that found
the 40 was re-run afterwards: **40 unguarded → 5**, and all 5 remaining are
deliberate (three `repeat(7, 1fr)` calendar week grids, where 7 columns is the
point and a ~50px cell is fine; `NovaSidebar`'s 5-up icon row inside a
fixed-width drawer; and one scanner false positive — `technicians/[id]:245`
already carried `hub-grid`, written *after* its `style` attribute, which the
3-lines-back heuristic could not see).

1. **Six rules added to `globals.css`**, all inside `@media (max-width: 780px)`:
   - `.hub-grid, .case-body, .prod-body, .cf-grid, .qf-grid, .stack-grid`
     → `grid-template-columns: 1fr !important` (keeps each element's own gap)
   - `.kpi-grid` → `1fr 1fr`
   - `.row-grid` → `1fr` with a 6px gap (a stacked row wants a tighter rhythm)
   - `.row-grid-head` → `display: none` (a column-header row means nothing
     once the rows under it have stacked)

   The four that were already in the markup with no rule — `case-body`,
   `prod-body`, `cf-grid`, `qf-grid` — are now simply part of the first rule.

2. **34 elements opted in.** `hub-grid` on the 18 content-plus-fixed-rail
   layouts, `kpi-grid` on the 4 KPI strips, `stack-grid` on the 4 settings
   form grids, `row-grid` on the 4 data rows, `row-grid-head` on the one
   column-header row. No element's own inline style was changed.

3. **Finding 5 bounded to the viewport.** `maxWidth: "100vw"` on QuoteForm's
   six right-side drawers, `maxWidth: "calc(100vw - 32px)"` on the two centred
   confirm modals. Nothing else about them moved.

**Desktop renders byte-identical** — every rule is inside the media query, and
the class additions carry no styling of their own above 780px. That is the
property that made a 34-element sweep safe to do at once, and it is the thing
to re-check first if anything looks off above 780px.

### Still open, on purpose

Finding 6 (tables with no scroll wrapper) is cosmetic — they compress rather
than overflow. Finding 7 (`MobileTabBar` is Nova-only, so every other theme
including both Spectacular palettes is hamburger-only on a phone) is a product
decision stated in `Shell.tsx`, not a bug, and wants an owner call rather than
a patch.

### Not verified in a browser

This environment cannot reach a tenant login, so none of the above has been
seen rendered. `tsc`, `next build` and the test suite are clean, and the
reasoning is mechanical, but a phone-width look at one record page, one
settings page and the quote drawers is what would actually confirm it.
