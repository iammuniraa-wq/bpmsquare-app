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

// Pillar colours — each customer-journey pillar has a hue.
export const pillar = {
  blue:   { fg: "#0c447c", bg: "#e6f1fb", base: "#378add" },
  purple: { fg: "#26215c", bg: "#eeedfe", base: "#7f77dd" },
  teal:   { fg: "#04342c", bg: "#e1f5ee", base: "#1d9e75" },
  amber:  { fg: "#633806", bg: "#faeeda", base: "#ba7517" },
  red:    { fg: "#791f1f", bg: "#fcebeb", base: "#a32d2d" },
  green:  { fg: "#173404", bg: "#eaf3de", base: "#639922" },
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
