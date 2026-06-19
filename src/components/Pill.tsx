import { pillar, type PillarKey } from "@/lib/theme";

export default function Pill({
  label,
  tone = "blue",
}: {
  label: string;
  tone?: PillarKey;
}) {
  const t = pillar[tone];
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        padding: "2px 9px",
        borderRadius: 7,
        whiteSpace: "nowrap",
        background: t.bg,
        color: t.fg,
      }}
    >
      {label}
    </span>
  );
}
