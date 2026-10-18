import { pillar, type PillarKey } from "@/lib/theme";

/** A short fact as a rounded chip. Unlike Pill it wraps, so a long assumption never forces a sideways scroll on a phone. */
export default function Chip({ label, tone = "blue" }: { label: string; tone?: PillarKey }) {
  const t = pillar[tone];
  return (
    <span style={{ background: t.bg, color: t.fg, fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 14, overflowWrap: "anywhere", lineHeight: 1.4 }}>
      {label}
    </span>
  );
}
