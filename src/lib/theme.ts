// VeveyCRM design tokens — single source of truth for colour.
// Mirrors the prototype palette. Never hardcode hex outside this file.

export const c = {
  bg2: "#152233",
  bg: "#0e1a28",
  panel: "#ffffff",
  panel2: "#f4f6f9",
  ink: "#1c2733",
  muted: "#5f6b7a",
  hint: "#8a96a5",
  line: "#e2e7ee",
  accent: "#378add",
  accentbg: "#e6f1fb",
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
