# Colour system — a tone by meaning, never a colour

> Owner brief 2026-10-26: the app looks plain (white boxes, grey borders); add coloured boxes, but consistent, lean, not crowded.
> Code: `src/lib/ui/tone.ts` (vocabulary), `src/components/ui/StatTile.tsx` (`StatTile`, `StatStrip`), `Card tone`, `IconChip`,
> `PageHeader icon`. Colours come only from `src/lib/theme.ts` pillar tokens, so every theme and dark mode follows.

## Tones

| Tone | Pillar | Means | Example |
|---|---|---|---|
| `info` | blue | money, totals, plain information | contract value, budget, total |
| `good` | teal | won, approved, done, healthy | margin 10% or more, active |
| `warn` | amber | needs attention, expiring, estimated | margin under 10%, due in 14 days |
| `bad` | red | overdue, lost, over budget, loss | negative margin, past due |
| `context` | purple | tender and BOQ context | bids submitted, tender settings |
| `neutral` | none | a count or fact with no judgement | lines, added, removed |

## Rules

1. A screen picks a tone from what the number means, never a colour. Use the `toneFor*` helpers (margin, days left, delta, budget,
   status) so the same figure has the same tone on every screen. No hex, no `rgb()` outside `theme.ts` (a test enforces it).
2. Colour never carries meaning alone. A tile always has its label and a short sub line; a status keeps its pill label.
3. One tile pattern: `StatStrip` of `StatTile`. Do not hand-roll a KPI box.
4. Colour goes in: summary strips at the top of a screen, status, section headers (`Card tone`, `IconChip` next to a title).
5. Colour does not go in: tables and rows, forms and fields, settings bodies, long text. Keep at most one strip per screen
   and four or five tiles in it.
6. Explanations stay behind the `i` (`info` on the tile), per ux-simplification.md.

## Check before calling a coloured screen done

- [ ] 375 px: tiles wrap to one or two columns, no horizontal scroll, long values wrap, tap targets unchanged.
- [ ] Classic, Modern, Nextgen light, Nextgen dark: tint, edge and ink all readable (label and value legible on the tint).
- [ ] Each tone matches the table above; a neutral number is not coloured to look busy.
- [ ] Nothing else on the screen changed: no new tint on tables, forms or settings bodies.

## Where it is applied (2026-10-26)

Contract project overview tiles, contract projects list strip (active, value, budget, margin under 10%), tender Bids tab strip
and compare tiles, and an icon chip beside the Settings Tenders and Contract projects titles.
Tender desk home (2026-10-27, `src/components/tenderDesk/`, spec `tender-desk.md`): bolder than the tone system on purpose, five saturated gradient tiles (Bold tiles) and an always-dark surface (Control room); the palette is the `tenderDesk` group in `theme.ts`, stage colours come from the tenant's stage definitions.
Contrast was measured: white on every tile stop 5.2:1 or better, on the day chips and status pills 5.0:1 or better, Control room text 6.0:1 or better on its panel; day chips say "3 days" and statuses keep their word, so colour is never the only signal.

Screens coloured in the tender-edition pass (2026-10-26), all from data the screen already held:

| Screen | Strip | Tones |
|---|---|---|
| Tender deal, Overview tab (`TenderStatStrip`, redesign step 1) | Bid end date, Bid decision, Bid guarantee, Open work | bid end date by `toneForDaysLeft` (amber under 7 days, red past); go good, no-go bad, waiting for approval warn; guarantee good / warn / bad (Requested is warn); open questions and overdue steps warn. The strip is on the Overview only. The deal header (every tab) carries the same three facts as a decision marker and two chips (`BidDecisionMarker` uses the same tones: Pending neutral, Awaiting approval warn, Go good, No-go bad). |
| BOQ tab, Prices | Priced, Total, Stale prices, Without a product | priced warn while any line is unpriced, else good; total info; stale and no-product warn when above zero |
| Estimates tab | Estimates linked, Cost total, Lines priced from them, Needs re-price | context, info, good, warn |
| Estimate page for a tender (`TenderEstimateStrip`) | BOQ lines linked, Lines priced, Needs re-price, Costs missing | context, good, warn, warn. The amber quantity-mismatch warning is unchanged. |
| Contract project page header (`ProjectKpiStrip`) | Contract value, Budget, Planned margin, Lines | info, info, `toneForMargin`, neutral. Shown once, on every tab; the Overview tab no longer repeats them. |
| RFQ page (`RfqStatStrip`) | Suppliers invited, Replies in, Awarded lines, Still open | neutral, warn while replies are awaited then good, good, warn |

Skipped: the Tender tab has no RFQ or BOQ progress (its data lives on the BOQ and RFQ screens, and adding it would need a new query); the RFQ
list has no strip (its chips already count by state); Settings Tenders and Contract projects keep their icon chips only.
