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
and compare tiles, and an icon chip beside the Settings Tenders and Contract projects titles. Everything else is unchanged.
