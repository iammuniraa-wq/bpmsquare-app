import Link from "next/link";

// The RFQ state of one quote/deal line, as a small link to the RFQ:
// "RFQ-0012 · 1/3 replied" while suppliers are answering, "Supplier cost
// awarded" once the buyer has chosen. Server-safe (no hooks) so detail
// pages render it straight into their line tables.

export type RfqLineChipData = { rfq_id: string; ref: string | null; asked: number; replied: number; awarded: boolean; line_status: string };

export default function RfqLineChip({ s, style }: { s: RfqLineChipData; style?: React.CSSProperties }) {
  const awarded = s.awarded;
  const label = awarded
    ? `${s.ref ?? "RFQ"} · cost awarded`
    : s.line_status === "no_award" ? `${s.ref ?? "RFQ"} · no award`
    : s.asked ? `${s.ref ?? "RFQ"} · ${s.replied}/${s.asked} replied`
    : `${s.ref ?? "RFQ"} · not sent yet`;
  return (
    <Link href={`/rfqs/${s.rfq_id}`} title={`${s.ref ?? "RFQ"}: ${awarded ? "a supplier cost was awarded — price the line again to use it" : "supplier request for quotation on this line — open it"}`} style={{
      display: "inline-block", marginTop: 3, fontSize: 11, fontWeight: 600, borderRadius: 999, padding: "2px 8px", textDecoration: "none",
      background: awarded ? "var(--greenbg)" : "var(--tealbg)", color: awarded ? "var(--greenink)" : "var(--tealink)", ...style,
    }}>{label}</Link>
  );
}
