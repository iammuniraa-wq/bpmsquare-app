"use client";

import { c, pillar } from "@/lib/theme";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import type { LineRow, PackageRow } from "@/lib/contractProjects/allocation";
import { money } from "@/lib/contractProjects/format";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";

// The allocation table of a project (mock-up screen 6): one row per BOQ line (or per work package) with what the client pays, the cost the
// person allocates (one input, 44 px) and what is left. The detail of a line (resource type, cost code, reserve, unit) sits behind its item
// number, in a side panel. Under 780 px the table is a list of cards (the shared .bpm-rows-table / .bpm-rows-cards rules). Labels, values and
// inputs only: the explanations are behind the "i".

const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, padding: "9px 12px", background: c.panel2, fontWeight: 600, whiteSpace: "nowrap" };
const thR: React.CSSProperties = { ...th, textAlign: "right" };
const num: React.CSSProperties = { padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 13, whiteSpace: "nowrap" };
const inputStyle: React.CSSProperties = { minHeight: 44, width: 132, textAlign: "right", fontVariantNumeric: "tabular-nums" };

const leftInk = (left: number | null) => (left !== null && left < 0 ? pillar.red.fg : c.ink);
const Head = ({ label, tip, right, guide }: { label: string; tip?: string; right?: boolean; guide?: string }) => (
  <th data-guide={guide} style={right ? thR : th}><span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>{label}{tip && <InfoTip label={label}>{tip}</InfoTip>}</span></th>
);

export type ErpCols = { ordered: number | null; spent: number | null };

type Common = {
  currency: string | null;
  editable: boolean;
  /** What is typed per row, keyed by line_key (lines) or package id (packages). */
  typed: Record<string, string>;
  onType: (key: string, value: string) => void;
  /** The Ordered / Spent columns appear only once buy-out or the ERP has filled them. */
  erp?: { rows: Record<string, ErpCols>; ordered: boolean; spent: boolean };
};

const amountOf = (v: string | undefined): number | null => (v === undefined || v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const leftOf = (client: number | null, v: string | undefined): number | null => (client === null ? null : Math.round((client - (amountOf(v) ?? 0)) * 100) / 100);

export function LinesTable({ rows, onOpen, ...p }: Common & { rows: LineRow[]; onOpen: (lineKey: string) => void }) {
  const showOrdered = !!p.erp?.ordered, showSpent = !!p.erp?.spent;
  const cell = (r: LineRow) => (
    <input
      className="bpm-input" type="number" min="0" step="any" inputMode="decimal" data-guide="cp.alloc.input" aria-label={`Allocated cost for ${r.item ?? r.description}`}
      value={p.typed[r.line_key] ?? ""} disabled={!p.editable} placeholder="0" style={inputStyle} onChange={(e) => p.onType(r.line_key, e.target.value)}
    />
  );
  const opener = (r: LineRow) => (
    <button
      type="button" data-guide="cp.alloc.open_line" aria-label={`Details of ${r.item ?? r.description}`} onClick={() => onOpen(r.line_key)}
      style={{ all: "unset", boxSizing: "border-box", cursor: "pointer", minHeight: 44, display: "inline-flex", alignItems: "center", color: c.accent, fontWeight: 600, fontSize: 13 }}
    >
      {r.item ?? "—"}
    </button>
  );
  return (
    <>
      <div className="bpm-rows-table" style={{ overflowX: "auto" }}>
        <table data-guide="cp.alloc.table" style={{ width: "100%", minWidth: 640, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <Head label="Item" /><Head label="Description" />
              <Head label="Client amount" right />
              <Head label="Allocated cost" right />
              <Head label="Left" tip={PROJECT_TIPS.left} right />
              {showOrdered && <Head label="Ordered" tip={PROJECT_TIPS.ordered} right guide="cp.budget.committed" />}
              {showSpent && <Head label="Spent" tip={PROJECT_TIPS.spent} right />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const left = leftOf(r.client_amount, p.typed[r.line_key]);
              const erp = p.erp?.rows[r.line_key];
              return (
                <tr key={r.line_key} style={{ borderTop: `1px solid ${c.line}` }}>
                  <td style={{ padding: "0 12px" }}>{opener(r)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, color: c.ink, minWidth: 200, overflowWrap: "anywhere" }}>{r.description}<Missing r={r} /></td>
                  <td style={num}>{r.client_amount === null ? "—" : money(r.client_amount, p.currency, 2)}</td>
                  <td style={{ ...num, padding: "4px 12px" }}>{cell(r)}</td>
                  <td style={{ ...num, color: leftInk(left) }}>{left === null ? "—" : money(left, null, 2)}</td>
                  {showOrdered && <td style={{ ...num, color: c.muted }}>{erp?.ordered == null ? "—" : money(erp.ordered, null, 2)}</td>}
                  {showSpent && <td style={{ ...num, color: c.muted }}>{erp?.spent == null ? "—" : money(erp.spent, null, 2)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="bpm-rows-cards" data-guide="cp.alloc.cards" style={{ gap: 10, padding: 12 }}>
        {rows.map((r) => {
          const left = leftOf(r.client_amount, p.typed[r.line_key]);
          const erp = p.erp?.rows[r.line_key];
          return (
            <div key={r.line_key} data-guide="cp.alloc.card" style={{ boxSizing: "border-box", width: "100%", padding: 12, border: `1px solid ${c.line}`, borderRadius: 12, background: "var(--card-bg)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{opener(r)}<span style={{ minWidth: 0, fontSize: 13.5, color: c.ink, overflowWrap: "anywhere" }}>{r.description}<Missing r={r} /></span></div>
              <CardRow label="Client amount" value={r.client_amount === null ? "—" : money(r.client_amount, p.currency, 2)} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 6, fontSize: 13 }}>
                <span style={{ color: c.muted }}>Allocated cost</span>{cell(r)}
              </div>
              <CardRow label="Left" value={left === null ? "—" : money(left, null, 2)} ink={leftInk(left)} />
              {showOrdered && <CardRow label="Ordered" value={erp?.ordered == null ? "—" : money(erp.ordered, null, 2)} />}
              {showSpent && <CardRow label="Spent" value={erp?.spent == null ? "—" : money(erp.spent, null, 2)} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function PackagesTable({ rows, onOpen, ...p }: Common & { rows: PackageRow[]; onOpen: (id: string) => void }) {
  const cell = (r: PackageRow) => (
    <input
      className="bpm-input" type="number" min="0" step="any" inputMode="decimal" data-guide="cp.alloc.input" aria-label={`Allocated cost for ${r.code} ${r.name}`}
      value={p.typed[r.id] ?? ""} disabled={!p.editable} placeholder="0" style={inputStyle} onChange={(e) => p.onType(r.id, e.target.value)}
    />
  );
  const opener = (r: PackageRow) => (
    <Button variant="quiet" data-guide="cp.alloc.open_package" aria-label={`Open ${r.code}`} style={{ minHeight: 44, fontWeight: 600 }} onClick={() => onOpen(r.id)}>{r.code}</Button>
  );
  if (rows.length === 0) {
    return <div role="status" data-guide="cp.alloc.no_packages" style={{ padding: 16, fontSize: 13, color: c.hint }}>No work packages yet. Add one below, put lines in it, then type its cost.</div>;
  }
  return (
    <>
      <div className="bpm-rows-table" style={{ overflowX: "auto" }}>
        <table data-guide="cp.alloc.table" style={{ width: "100%", minWidth: 640, borderCollapse: "collapse" }}>
          <thead>
            <tr><Head label="Package" /><Head label="Name" /><Head label="Lines" right /><Head label="Client amount" right /><Head label="Allocated cost" right /><Head label="Left" tip={PROJECT_TIPS.left} right /></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const left = leftOf(r.client_amount, p.typed[r.id]);
              return (
                <tr key={r.id} style={{ borderTop: `1px solid ${c.line}` }}>
                  <td style={{ padding: "0 12px" }}>{opener(r)}</td>
                  <td style={{ padding: "8px 12px", fontSize: 13, color: c.ink, minWidth: 160, overflowWrap: "anywhere" }}>{r.name}</td>
                  <td style={num}>{r.line_count}</td>
                  <td style={num}>{r.client_amount === null ? "—" : money(r.client_amount, p.currency, 2)}</td>
                  <td style={{ ...num, padding: "4px 12px" }}>{cell(r)}</td>
                  <td style={{ ...num, color: leftInk(left) }}>{left === null ? "—" : money(left, null, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="bpm-rows-cards" data-guide="cp.alloc.cards" style={{ gap: 10, padding: 12 }}>
        {rows.map((r) => {
          const left = leftOf(r.client_amount, p.typed[r.id]);
          return (
            <div key={r.id} data-guide="cp.alloc.card" style={{ boxSizing: "border-box", width: "100%", padding: 12, border: `1px solid ${c.line}`, borderRadius: 12, background: "var(--card-bg)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{opener(r)}<span style={{ minWidth: 0, fontSize: 13.5, color: c.ink, overflowWrap: "anywhere" }}>{r.name}</span></div>
              <CardRow label="Lines" value={String(r.line_count)} />
              <CardRow label="Client amount" value={r.client_amount === null ? "—" : money(r.client_amount, p.currency, 2)} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 6, fontSize: 13 }}>
                <span style={{ color: c.muted }}>Allocated cost</span>{cell(r)}
              </div>
              <CardRow label="Left" value={left === null ? "—" : money(left, null, 2)} ink={leftInk(left)} />
            </div>
          );
        })}
      </div>
    </>
  );
}

/** What a line still lacks, in plain sight: a missing resource type blocks approval, so it is not left behind an "i". */
function Missing({ r }: { r: LineRow }) {
  if (r.missing.length === 0) return null;
  return <span data-guide="cp.alloc.missing" style={{ display: "block", fontSize: 11.5, color: pillar.amber.fg }}>No {r.missing.join(" or ")}</span>;
}

function CardRow({ label, value, ink }: { label: string; value: string; ink?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6, fontSize: 13 }}>
      <span style={{ color: c.muted }}>{label}</span>
      <b style={{ color: ink ?? c.ink, fontVariantNumeric: "tabular-nums", fontWeight: 600, textAlign: "right", overflowWrap: "anywhere" }}>{value}</b>
    </div>
  );
}
