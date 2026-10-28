// VeveyCRM design tokens — single source of truth for colour.
// Mirrors the prototype palette. Never hardcode hex outside this file.

// Neutrals point at the CSS custom properties defined in globals.css, so a
// theme (e.g. nextgen's dark mode) can re-map them at runtime -- inline
// styles built from these follow automatically. `accent`/`amber` stay raw hex
// because ~20 call sites build alpha variants via string concatenation
// (`${c.accent}40`), which only works on a hex literal.
export const c = {
  bg2: "#152233",
  bg: "#0e1a28",
  panel: "var(--panel)",
  panel2: "var(--panel2)",
  ink: "var(--ink)",
  muted: "var(--muted)",
  hint: "var(--hint)",
  line: "var(--line)",
  accent: "#378add",
  accentbg: "var(--accentbg)",
  amber: "#f6b23c", // the hub dot
} as const;

// Pillar colours — each customer-journey pillar has a hue. fg/bg resolve to
// the CSS families in globals.css so nextgen dark mode can remap them; `base`
// stays hex because several call sites build alpha borders via `${base}55`.
export const pillar = {
  blue:   { fg: "var(--blueink)", bg: "var(--bluebg)", base: "#378add" },
  purple: { fg: "var(--purpleink)", bg: "var(--purplebg)", base: "#7f77dd" },
  teal:   { fg: "var(--tealink)", bg: "var(--tealbg)", base: "#1d9e75" },
  amber:  { fg: "var(--amberink)", bg: "var(--amberbg)", base: "#ba7517" },
  red:    { fg: "var(--redink)", bg: "var(--redbg)", base: "#a32d2d" },
  green:  { fg: "var(--greenink)", bg: "var(--greenbg)", base: "#639922" },
} as const;

export type PillarKey = keyof typeof pillar;

// Semantic colours for coloured TEXT. Always prefer these over a raw hex or
// over `pillar.*.base`/`c.amber`: those are tuned as solid fills against
// dark chrome and drop to near-illegible on a light background (the
// light-mode contrast bug reported 2026-08-06). These resolve to the
// pillar ink CSS variables, which globals.css redefines per theme/mode --
// dark ink in light mode, light ink in dark mode.
export const statusInk = {
  good: pillar.green.fg,
  warn: pillar.amber.fg,
  bad: pillar.red.fg,
  info: pillar.blue.fg,
  note: pillar.purple.fg,
} as const;

export const g = {
  sidebar: "linear-gradient(180deg, #152233 0%, #0e1a28 100%)",
  login: "linear-gradient(160deg, #152233, #0a1320)",
} as const;

export const sh = {
  card: "0 1px 2px rgba(16,24,40,.04)",
  modal: "0 20px 60px rgba(0,0,0,.35)",
} as const;

// Tender desk (docs/design/tender-desk.md). The two home styles are bolder than the tone system on purpose: saturated tiles and a
// dark, self-contained surface. Every value is here so no component holds a colour; stage colours are not here, they come from the
// tenant's stage definitions. Contrast (WCAG 2.x, measured 2026-10-27): white on every tile stop 5.2:1 or better (4.3:1 where the
// decorative glow lightens it); white on the day chips and status pills 5.0:1 or better; Control room ink 14.4:1, muted 7.0:1,
// dimmest text 6.0:1 and every accent 6.3:1 or better on its panel; chart fills 3.7:1 or better against a white and a dark card.
const tile = (from: string, to: string) => `linear-gradient(135deg, ${from}, ${to})`;
const controlBg = "#0a0f1e";

export const tenderDesk = {
  tile: {
    ink: "#ffffff",
    inkSoft: "rgba(255,255,255,.78)",
    glow: "rgba(255,255,255,.10)",
    pipeline: tile("#4338ca", "#6d28d9"),
    weighted: tile("#0f766e", "#0b7a71"),
    closing: tile("#b91c1c", "#bf360c"),
    win: tile("#047857", "#067a52"),
    buyout: tile("#075985", "#0369a1"),
  },
  chip: { red: "#b91c1c", amber: "#b45309", green: "#047857", slate: "#475569", ink: "#ffffff" },
  won: "#059669",
  lost: "#e11d48",
  bold: {
    clients: ["#6366f1", "#0d9488", "#d97706", "#e11d48", "#0284c7"],
    others: "#64748b",
    buyoutFill: tile("#0369a1", "#0ea5e9"),
    under: "#059669",
    over: "#e11d48",
  },
  control: {
    bg: `radial-gradient(900px 500px at 85% -10%, rgba(124,58,237,.22), transparent 60%), radial-gradient(800px 500px at -5% 105%, rgba(20,184,166,.16), transparent 60%), ${controlBg}`,
    base: controlBg,
    panel: "rgba(255,255,255,.045)",
    row: "rgba(255,255,255,.04)",
    border: "rgba(255,255,255,.08)",
    ink: "#e6eaf7",
    strong: "#ffffff",
    muted: "#9aa4c7",
    dim: "#8d97bb",
    track: "rgba(255,255,255,.09)",
    axis: "rgba(255,255,255,.14)",
    violet: "#a78bfa",
    violetSoft: "#c4b5fd",
    teal: "#2dd4bf",
    amber: "#fbbf24",
    rose: "#fb7185",
    blue: "#60a5fa",
    others: "#94a3b8",
    buttonInk: controlBg,
  },
} as const;
