export type RingTone = "violet" | "warm" | "good";

export const RING_TONE_VAR: Record<RingTone, string> = {
  violet: "var(--rich-violet, var(--accent))",
  warm: "var(--rich-warm, var(--amberc))",
  good: "var(--rich-good, var(--green))",
};

/** Clamp to 0..100; anything that is not a finite number reads as 0. */
export const ringPercent = (value: number): number => (Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0);

/**
 * A progress ring (docs/design/rich-ui.md): state in one glance, the label in the centre. The arc is one `pathLength=100` circle, so
 * the dash maths is the percentage itself. It draws in with CSS under the Rich look (src/styles/rich.css) and is simply static
 * anywhere else. Server-safe, no hooks, colour only from tokens. The number in the centre carries the meaning, never the colour alone.
 */
export default function Ring({ value, size = 128, stroke = 10, tone = "violet", label, children }: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: RingTone;
  /** Spoken name, e.g. "Account health". The percentage is appended. */
  label: string;
  /** Centre content, usually the number. */
  children?: React.ReactNode;
}) {
  const pct = ringPercent(value);
  const r = (size - stroke) / 2;
  return (
    <span
      className="rich-ring"
      role="img"
      aria-label={`${label}: ${Math.round(pct)} percent`}
      style={{ position: "relative", display: "inline-grid", placeItems: "center", width: size, height: size, flex: "none", ["--ring-to" as string]: String(100 - pct) }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--rich-ring-track, var(--line))" strokeWidth={stroke} />
        <circle
          className="rich-ring__val" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={RING_TONE_VAR[tone]}
          strokeWidth={stroke} strokeLinecap="round" pathLength={100} strokeDasharray={100} strokeDashoffset={100 - pct}
        />
      </svg>
      {children !== undefined && (
        <span style={{ position: "relative", font: "600 1.75rem/1 var(--rich-font-head, inherit)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{children}</span>
      )}
    </span>
  );
}
