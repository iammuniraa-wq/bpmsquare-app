import { c } from "@/lib/theme";
import { toneTokens, type Tone } from "@/lib/ui/tone";
import InfoTip from "./InfoTip";

/**
 * One headline number: label, value, a short sub line. The tone comes from what the number means (src/lib/ui/tone.ts), never from a
 * colour choice. Colour is never the only signal: the label and the sub line always say it in words. Server-safe, no hooks.
 */
export function statTileStyle(tone: Tone = "neutral"): React.CSSProperties {
  const t = toneTokens(tone);
  return {
    background: t.bg,
    border: "1px solid var(--line)",
    borderRadius: "var(--card-radius)",
    padding: "10px 14px 12px",
    minWidth: 0,
    minHeight: 84,
    boxSizing: "border-box",
  };
}

export default function StatTile({ label, value, sub, info, tone = "neutral", icon }: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** Explanation behind an "i" after the label. */
  info?: React.ReactNode;
  tone?: Tone;
  /** A small SVG at the right of the label row. Decorative. */
  icon?: React.ReactNode;
}) {
  const t = toneTokens(tone);
  return (
    <div data-tone={tone} style={statTileStyle(tone)}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: tone === "neutral" ? c.muted : t.ink, textTransform: "uppercase", letterSpacing: 0.4 }}>
        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{label}</span>
        {info && <InfoTip label={label}>{info}</InfoTip>}
        {icon && <span aria-hidden="true" style={{ marginLeft: "auto", display: "inline-flex", color: t.ink }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: t.ink, fontVariantNumeric: "tabular-nums", marginTop: 4, overflowWrap: "anywhere" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: t.quiet, opacity: tone === "neutral" ? 1 : 0.85, marginTop: 2, overflowWrap: "anywhere" }}>{sub}</div>}
    </div>
  );
}

/** A row of tiles that wraps to the width it has, so every screen's strip looks the same. */
export function StatStrip({ children, guide }: { children: React.ReactNode; guide?: string }) {
  return (
    <div data-guide={guide} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
      {children}
    </div>
  );
}
