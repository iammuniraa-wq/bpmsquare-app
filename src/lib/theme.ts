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

export const g = {
  sidebar: "linear-gradient(180deg, #152233 0%, #0e1a28 100%)",
  login: "linear-gradient(160deg, #152233, #0a1320)",
} as const;

export const sh = {
  card: "0 1px 2px rgba(16,24,40,.04)",
  modal: "0 20px 60px rgba(0,0,0,.35)",
} as const;
