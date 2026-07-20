import type { CSSProperties } from "react";
import { c, pillar, sh } from "@/lib/theme";

export const tone = {
  ok: pillar.teal,
  bad: pillar.red,
  warn: pillar.amber,
  info: pillar.blue,
} as const;

export const card: CSSProperties = {
  background: c.panel,
  border: `1px solid ${c.line}`,
  borderRadius: 12,
  padding: "20px 22px",
  boxShadow: sh.card,
};

export const btn = (bg: string = c.accent): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "9px 16px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  background: bg,
  color: c.panel,
  border: "none",
  cursor: "pointer",
});

export const btnGhost: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "9px 16px",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  background: "none",
  color: c.muted,
  border: `1px solid ${c.line}`,
  cursor: "pointer",
};

export const pill = (t: { fg: string; bg: string }): CSSProperties => ({
  fontSize: 11.5,
  fontWeight: 700,
  color: t.fg,
  background: t.bg,
  borderRadius: 6,
  padding: "3px 9px",
  whiteSpace: "nowrap",
});

export const banner = (t: { fg: string; bg: string; base: string }): CSSProperties => ({
  background: t.bg,
  border: `1px solid ${t.base}40`,
  borderRadius: 10,
  padding: "13px 16px",
  fontSize: 12.5,
  color: t.fg,
  lineHeight: 1.6,
});

export const mono: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

export const th: CSSProperties = {
  padding: "9px 11px",
  textAlign: "left",
  color: c.hint,
  fontWeight: 600,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  whiteSpace: "nowrap",
  borderBottom: `1px solid ${c.line}`,
  background: c.panel2,
};

export const td: CSSProperties = {
  padding: "8px 11px",
  fontSize: 12.5,
  color: c.ink,
  borderBottom: `1px solid ${c.line}`,
  verticalAlign: "top",
};

export const select: CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  borderRadius: 7,
  border: `1px solid ${c.line}`,
  fontSize: 12.5,
  color: c.ink,
  background: c.panel,
  cursor: "pointer",
};

export const stepDot = (active: boolean, done: boolean): CSSProperties => ({
  width: 26,
  height: 26,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 700,
  flexShrink: 0,
  background: done ? tone.ok.base : active ? c.accent : c.panel2,
  color: done || active ? c.panel : c.hint,
  border: done || active ? "none" : `1px solid ${c.line}`,
});
