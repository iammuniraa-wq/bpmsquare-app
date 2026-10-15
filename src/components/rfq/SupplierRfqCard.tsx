"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { RFQ_SUPPLIER_STATUS_LABEL, type RfqSupplierStatus } from "@/lib/rfq/types";
import { SUPPLIER_STATUS_TONE, fmtDate } from "./rfqUi";

// A supplier's RFQ track record on their own page: reply rate, how fast they
// answer, lines won, latest requests. Self-gating like RecordRfqsCard --
// renders nothing without the RFQ module, access, or any history.

type Stats = { asked: number; replied: number; declined: number; reply_rate: number | null; median_reply_hours: number | null; lines_won: number };
type Recent = { rfq_id: string; ref: string | null; title: string; status: RfqSupplierStatus; sent_at: string | null };

function hours(h: number | null): string {
  if (h === null) return "—";
  if (h < 1) return "< 1 h";
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

export default function SupplierRfqCard({ supplierId }: { supplierId: string }) {
  const [data, setData] = useState<{ stats: Stats | null; recent: Recent[] } | null>(null);
  useEffect(() => {
    fetch(`/api/rfqs/supplier-stats?supplier_id=${supplierId}`).then((r) => (r.ok ? r.json() : null)).then(setData).catch(() => {});
  }, [supplierId]);
  if (!data?.stats || data.stats.asked === 0) return null;
  const s = data.stats;
  const tile = (label: string, value: string) => (
    <div style={{ minWidth: 90 }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
    </div>
  );
  return (
    <section style={{ ...cardStyle, padding: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink, marginBottom: 10 }}>RFQ track record</div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 10 }}>
        {tile("Asked", String(s.asked))}
        {tile("Reply rate", s.reply_rate === null ? "—" : `${s.reply_rate}%`)}
        {tile("Typical reply", hours(s.median_reply_hours))}
        {tile("Lines won", String(s.lines_won))}
      </div>
      {data.recent.map((r) => (
        <Link key={r.rfq_id} href={`/rfqs/${r.rfq_id}`} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 0", borderTop: `1px solid ${c.line}`, textDecoration: "none", color: c.ink, fontSize: 12.5 }}>
          <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: c.hint, minWidth: 70 }}>{r.ref}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
          <span style={{ color: c.hint, fontSize: 11.5, whiteSpace: "nowrap" }}>{fmtDate(r.sent_at)}</span>
          <Pill label={RFQ_SUPPLIER_STATUS_LABEL[r.status]} tone={SUPPLIER_STATUS_TONE[r.status]} />
        </Link>
      ))}
    </section>
  );
}
