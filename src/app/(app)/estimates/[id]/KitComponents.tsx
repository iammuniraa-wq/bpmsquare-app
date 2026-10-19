"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";

type Row = {
  lineId: string; componentId: string; name: string; sku: string | null; itemTypeLabel: string | null;
  qty: number; uom: string | null; scrapPct: number; lineKind: "consumed" | "used";
  unitCost: number | null; lineCost: number | null; nested: boolean;
};
type Kit = { productId: string; name: string; total: number; incomplete: boolean; missing: string[]; rows: Row[] };

const th: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 600, color: c.hint, padding: "5px 10px", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "6px 10px", fontSize: 12.5, verticalAlign: "top" };
const num: React.CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };

const fmt = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 4 });

/**
 * The parts of a kit line, read-only: what ONE unit of the kit is made of and
 * what each part costs (the products module's own roll-up). Fetched when opened.
 * To change a kit, change it on its product page.
 */
export default function KitComponents({
  estimateId, lineId, unit, linkable, productId, money,
}: {
  estimateId: string; lineId: string; unit: string | null; linkable: boolean; productId: string; money: (n: number) => string;
}) {
  const [kit, setKit] = useState<Kit | null | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/estimates/${estimateId}/lines/${lineId}/components`)
      .then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => ({})) }))
      .then(({ ok, json }) => {
        if (!live) return;
        if (!ok) { setError(json.error ?? "Could not load the components."); return; }
        setKit(json.components ?? null);
      })
      .catch(() => { if (live) setError("Could not load the components."); });
    return () => { live = false; };
  }, [estimateId, lineId]);

  if (error) return <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{error}</div>;
  if (kit === undefined) return <div className="bpm-t-help" role="status">Loading the components…</div>;
  if (kit === null) return <div className="bpm-t-help">This item has no components yet.</div>;

  return (
    <div style={{ background: c.panel2, borderRadius: 8, padding: "8px 4px 10px", overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 460 }}>
        <thead>
          <tr>
            <th style={th}>Component</th>
            <th style={{ ...th, textAlign: "right" }}>Per {unit || "unit"}</th>
            <th style={{ ...th, textAlign: "right" }}>Unit cost</th>
            <th style={{ ...th, textAlign: "right" }}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {kit.rows.map((r) => (
            <tr key={r.lineId} style={{ borderTop: `1px solid ${c.line}` }}>
              <td style={td}>
                <div style={{ color: c.ink }}>{r.name}{r.nested ? " (a kit itself)" : ""}</div>
                <div style={{ fontSize: 11, color: c.hint }}>
                  {[r.sku, r.itemTypeLabel, r.lineKind === "used" ? "used, not costed" : null].filter(Boolean).join(" · ")}
                </div>
              </td>
              <td style={num}>{fmt(r.qty)} {r.uom ?? ""}{r.scrapPct > 0 ? <div style={{ fontSize: 11, color: c.hint }}>+{fmt(r.scrapPct)}% scrap</div> : null}</td>
              <td style={num}>{r.unitCost === null ? "no cost" : money(r.unitCost)}</td>
              <td style={{ ...num, fontWeight: 600 }}>{r.lineKind === "used" ? "—" : r.lineCost === null ? "no cost" : money(r.lineCost)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: `1px solid ${c.line}` }}>
            <td style={{ ...td, fontWeight: 600 }} colSpan={3}>Cost of one {unit || "unit"}{kit.incomplete ? " (incomplete)" : ""}</td>
            <td style={{ ...num, fontWeight: 700 }}>{money(kit.total)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="bpm-t-help" style={{ padding: "6px 10px 0" }}>
        {kit.incomplete && kit.missing.length > 0 ? `No cost on file for: ${kit.missing.join(", ")}. ` : ""}
        Read-only here.{" "}
        {linkable ? <>Change the components on <Link href={ROUTES.product(productId)} style={{ color: "var(--accent)" }}>the kit&apos;s page</Link>.</> : "Change them on the product."}
      </div>
    </div>
  );
}
