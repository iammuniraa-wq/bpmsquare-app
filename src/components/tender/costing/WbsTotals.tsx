"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import { outsideWbs, marginText, moneyText, totalsRow, totalsRows, type TotalsRow, type WbsTotalsData } from "@/lib/tender/costing/wbsTotals";
import { WBS_PENDING } from "@/lib/wbs/tips";
import { useCards } from "../useCards";
import s from "../BoqRows.module.css";

// "Totals by WBS" on the Costing tab (docs/design/wbs.md section 3b): the tender's WBS as a read-only tree with the bid amount, the cost and the
// margin of each item, parents adding their sub-items, a split line counted by its shares. It reads the WBS answer of the tender when the section
// is first opened (SettingsSection draws its body only while open), so a tender nobody looks at costs nothing. The figures are internal, like the
// rest of this tab.

const PAGE = 12;

export default function WbsTotals({ opportunityId, currency, onOpenBoq, initialData, layout }: {
  opportunityId: string;
  currency?: string | null;
  /** Opens the Bill of quantities, where the WBS is made. */
  onOpenBoq?: () => void;
  /** Lets a server render (and its test) show the loaded section. The page never passes it. */
  initialData?: WbsTotalsData;
  layout?: "table" | "cards";
}) {
  const [data, setData] = useState<WbsTotalsData | null>(initialData ?? null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const cards = useCards(layout);

  useEffect(() => {
    if (initialData) return;
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`/api/opportunities/${opportunityId}/tender/wbs`, { cache: "no-store" });
        const j = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok) { setError(typeof j.error === "string" ? j.error : "Could not load the WBS"); return; }
        setData(j as WbsTotalsData);
      } catch { if (live) setError("Could not load the WBS"); }
    })();
    return () => { live = false; };
  }, [opportunityId, initialData]);

  if (error) return <div role="alert" style={{ fontSize: 13, color: "var(--redink)" }}>{error}</div>;
  if (!data) return <div role="status" style={{ fontSize: 13, color: c.hint }}>Loading the WBS…</div>;
  if (data.pending) return <div role="alert" data-guide="costing.wbs.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>{WBS_PENDING}</div>;
  if (data.items.length === 0) {
    return (
      <div data-guide="costing.wbs.empty" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 13, color: c.ink }}>
        <span>No WBS on this tender yet. Group lines on the Bill of quantities.</span>
        {onOpenBoq && <Button variant="secondary" size="sm" style={{ minHeight: 44 }} onClick={onOpenBoq} data-guide="costing.wbs.open_boq">Open the Bill of quantities</Button>}
      </div>
    );
  }

  const all = totalsRows(data.items, data.rollup);
  const rows = showAll ? all : all.slice(0, PAGE);
  const total = totalsRow({ id: "total", code: "", name: "In a WBS item", depth: 1 }, data.total);
  const outside = outsideWbs(data.unassigned ?? []);
  const money = (n: number | null) => (n === null ? "–" : `${currency ? `${currency} ` : ""}${moneyText(n)}`);

  return (
    <div data-guide="costing.wbs" className="bpm-tap" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {cards ? (
        <div data-guide="costing.wbs.list" style={{ display: "flex", flexDirection: "column" }}>
          {rows.map((r) => <Card key={r.id} r={r} money={money} />)}
          <Card r={total} money={money} foot />
        </div>
      ) : (
        <div className={s.wrap}>
          <table className={s.table} data-guide="costing.wbs.table">
            <thead>
              <tr><th scope="col">Item</th><th scope="col" className={s.num}>Bid amount</th><th scope="col" className={s.num}>Cost</th><th scope="col" className={s.num}>Margin</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-guide="costing.wbs.row">
                  <td className={s.desc} style={{ paddingLeft: 10 + (r.depth - 1) * 18 }}><b>{r.code}</b> {r.name}</td>
                  <td className={s.num}>{money(r.bid)}</td>
                  <td className={s.num}>{money(r.cost)}</td>
                  <td className={s.num} title={r.uncosted > 0 ? `${r.uncosted} priced row${r.uncosted === 1 ? " has" : "s have"} no cost` : undefined}>{marginText(r)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-guide="costing.wbs.total" style={{ fontWeight: 700 }}>
                <td className={s.desc}>{total.name}</td><td className={s.num}>{money(total.bid)}</td><td className={s.num}>{money(total.cost)}</td><td className={s.num}>{marginText(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {all.length > PAGE && (
        <Button variant="quiet" size="sm" onClick={() => setShowAll(!showAll)} style={{ minHeight: 44 }} data-guide="costing.wbs.show_all">{showAll ? "Show fewer" : `Show all ${all.length}`}</Button>
      )}
      {outside.rows > 0 && (
        <div role="status" data-guide="costing.wbs.outside" style={{ fontSize: 13, color: "var(--amberink)" }}>
          Not in a WBS item: {outside.rows} row{outside.rows === 1 ? "" : "s"}, {money(outside.bid)}
        </div>
      )}
    </div>
  );
}

function Card({ r, money, foot }: { r: TotalsRow; money: (n: number | null) => string; foot?: boolean }) {
  return (
    <div data-guide={foot ? "costing.wbs.total" : "costing.wbs.row"} style={{ borderTop: `1px solid ${c.line}`, padding: "8px 0", paddingLeft: (r.depth - 1) * 14, display: "flex", flexDirection: "column", gap: 2, fontWeight: foot ? 700 : 400 }}>
      <span style={{ fontSize: 13.5, fontWeight: 700, color: c.ink, overflowWrap: "anywhere" }}>{r.code ? `${r.code} ` : ""}{r.name}</span>
      <Pair label="Bid amount" value={money(r.bid)} />
      <Pair label="Cost" value={money(r.cost)} />
      <Pair label="Margin" value={marginText(r)} />
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
      <span style={{ color: c.muted }}>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums", color: c.ink }}>{value}</span>
    </span>
  );
}
