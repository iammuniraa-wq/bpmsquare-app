
import InfoTip from "./InfoTip";
import { toneTokens, type Tone } from "@/lib/ui/tone";

// Same surface as `cardStyle` in Shell.tsx (three theme variables). Declared
// here rather than imported because Shell is a "use client" module, and a
// server page cannot read a plain constant out of one.
export const CARD_SURFACE: React.CSSProperties = {
  background: "var(--card-bg)",
  border: "1px solid var(--line)",
  borderRadius: "var(--card-radius)",
  boxShadow: "var(--card-shadow)",
};

/**
 * A titled surface. `action` is the one quiet text action allowed in the
 * header's right corner ("Add", "Edit", "View all") -- a Button with
 * variant="quiet", or a Link. `tone` tints the header band and adds a 3px left
 * edge; without it the card is exactly the plain surface.
 */
export default function Card({
  title, info, action, padding = 16, tone, children, style,
}: {
  title?: string;
  /** Explanation of the card, behind an "i" after the title (never inside a clickable title). */
  info?: React.ReactNode;
  action?: React.ReactNode;
  padding?: number;
  /** Colour by meaning (src/lib/ui/tone.ts). Omit for the plain card. */
  tone?: Tone;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const t = tone && tone !== "neutral" ? toneTokens(tone) : null;
  const titleStyle = t ? { color: t.ink } : undefined;
  return (
    <section style={{ ...CARD_SURFACE, ...(t ? { borderLeft: `3px solid ${t.edge}`, overflow: "hidden" } : null), padding, minWidth: 0, ...style }}>
      {(title || action) && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12,
          ...(t ? { background: t.bg, margin: `-${padding}px -${padding}px 12px`, padding: `8px ${padding}px` } : null),
        }}>
          {title ? (
            info ? (
              <span className="bpm-label-row"><h2 className="bpm-t-section" style={titleStyle}>{title}</h2><InfoTip label={title}>{info}</InfoTip></span>
            ) : <h2 className="bpm-t-section" style={titleStyle}>{title}</h2>
          ) : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
