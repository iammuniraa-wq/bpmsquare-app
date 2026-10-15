"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { RFQ_STATUS_LABEL, type RfqOriginType, type RfqStatus } from "@/lib/rfq/types";
import { RFQ_STATUS_TONE, fmtDate } from "./rfqUi";
import CreateRfqButton from "./CreateRfqButton";
import type { ComposerLine } from "./RfqComposer";

// The RFQs raised from one record (a case, an inspection report, a work
// order, a fence project, a quote, a deal), plus the button to raise one.
// Self-gating: if the tenant doesn't have the RFQ module, or the viewer has
// no RFQ access, the list call answers 404/403 and this renders nothing --
// so a page can mount it unconditionally.

type Row = { id: string; ref: string | null; title: string; status: RfqStatus; respond_by: string | null; created_at: string };

export default function RecordRfqsCard({
  origin, originLabel, lines, title, heading = "Supplier quotations (RFQ)", compactTop,
}: {
  origin: { type: RfqOriginType; id: string };
  originLabel?: string | null;
  lines?: ComposerLine[];
  title?: string;
  heading?: string;
  /** Inside a gapped column already -- no extra top margin. */
  compactTop?: boolean;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    fetch(`/api/rfqs?origin_type=${origin.type}&origin_id=${origin.id}`)
      .then(async (r) => {
        if (!r.ok) { setHidden(true); return; }
        const j = await r.json();
        if (j.pending_migration) { setHidden(true); return; }
        setRows(j.rfqs ?? []);
      })
      .catch(() => setHidden(true));
  }, [origin.type, origin.id]);

  if (hidden || rows === null) return null;
  return (
    <section style={{ ...cardStyle, marginTop: compactTop ? 0 : 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: rows.length ? 10 : 0 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>{heading}</div>
          {!rows.length && <div style={{ fontSize: 12.5, color: c.hint, marginTop: 2 }}>No price on file for something here? Ask your suppliers — replies come back into this record.</div>}
          {!!rows.length && lines && lines.some((l) => l.include !== false) && <div style={{ fontSize: 12.5, color: c.hint, marginTop: 2 }}>{lines.filter((l) => l.include !== false).length} line{lines.filter((l) => l.include !== false).length === 1 ? "" : "s"} not on an RFQ yet.</div>}
        </div>
        <CreateRfqButton origin={origin} originLabel={originLabel} lines={lines} title={title} />
      </div>
      {rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.map((r) => (
            <Link key={r.id} href={`/rfqs/${r.id}`} style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 4px", borderTop: `1px solid ${c.line}`, textDecoration: "none", color: c.ink, fontSize: 13 }}>
              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5, color: c.hint, minWidth: 74 }}>{r.ref}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
              {r.respond_by && <span style={{ fontSize: 12, color: c.hint, whiteSpace: "nowrap" }}>by {fmtDate(r.respond_by)}</span>}
              <Pill label={RFQ_STATUS_LABEL[r.status]} tone={RFQ_STATUS_TONE[r.status]} />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
