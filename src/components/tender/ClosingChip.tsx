import { closingState, type ClosingTone } from "@/lib/tender/rules";

// The bid-end-date countdown of a tender: amber under 7 days, red under 2 days or once the date has passed, calm otherwise.
// The text carries the meaning as well as the colour ("Bid ends tomorrow"), so it reads without seeing the colour. The server
// hands over `nowIso` so the first paint and the hydrated page agree.

const TONE: Record<ClosingTone, { bg: string; fg: string; line: string }> = {
  none: { bg: "var(--panel2)", fg: "var(--muted)", line: "var(--line)" },
  ok: { bg: "var(--tealbg)", fg: "var(--tealink)", line: "transparent" },
  amber: { bg: "var(--amberbg)", fg: "var(--amberink)", line: "var(--amberline)" },
  red: { bg: "var(--redbg)", fg: "var(--redink)", line: "var(--red)" },
};

export default function ClosingChip({ closingAt, nowIso, timezone, closed = false, size = "md" }: {
  closingAt: string | null;
  nowIso: string;
  timezone: string;
  /** The tender is no longer facing its deadline (submitted, decided or closed): show the date, not a countdown. */
  closed?: boolean;
  size?: "sm" | "md";
}) {
  const state = closingState(closingAt, new Date(nowIso), timezone);
  const tone: ClosingTone = closed ? "none" : state.tone;
  const t = TONE[tone];
  const label = closed ? (closingAt ? new Date(closingAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: timezone }) : "No bid end date") : state.label;
  return (
    <span
      data-tone={tone}
      title={closingAt ? new Date(closingAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }) : undefined}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", fontWeight: 600,
        fontSize: size === "sm" ? 10.5 : 12, padding: size === "sm" ? "1px 7px" : "3px 10px", borderRadius: 999,
        background: t.bg, color: t.fg, border: `1px solid ${t.line}`,
      }}
    >
      <svg width={size === "sm" ? 10 : 12} height={size === "sm" ? 10 : 12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" />
      </svg>
      {label}
    </span>
  );
}
