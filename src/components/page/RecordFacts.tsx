import { c } from "@/lib/theme";
import { CARD_SURFACE } from "@/components/ui/Card";

export type RecordFact = { label: string; value: React.ReactNode };

/** The record page's header strip: a few key facts as small cards (callers pass at most four). */
export default function RecordFacts({ facts }: { facts: RecordFact[] }) {
  if (facts.length === 0) return null;
  return (
    <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
      {facts.map((f) => (
        <div key={f.label} style={{ ...CARD_SURFACE, padding: "10px 14px", minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5 }}>{f.label}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: c.ink, marginTop: 3, wordBreak: "break-word" }}>{f.value}</div>
        </div>
      ))}
    </div>
  );
}
