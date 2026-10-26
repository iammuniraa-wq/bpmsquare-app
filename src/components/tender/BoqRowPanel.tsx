"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import SidePanel from "@/components/ui/SidePanel";
import { useFeel } from "@/components/FeelProvider";
import { BOQ_TABLE_TIPS } from "@/lib/tender/boq/tips";
import { PRICE_SOURCE_LABEL, rateFor, type PriceSource } from "@/lib/tender/boq/price";
import { costBreakdown, itemLabel, rfqRefOf, sourceView } from "@/lib/tender/boq/table";
import type { LinkView } from "@/lib/tender/estimates/server";
import { RowChips, money, type BoqRow } from "./BoqRows";

// One row of the Bill of quantities, opened (GCC tender deals): a side panel on a desktop, a bottom sheet on a phone. Quantity, rate and
// description are edited here. Where the cost came from (the estimate line, the RFQ it was awarded under) is shown and cannot be changed
// here: the supplier is compared and awarded in Costing only, so the panel hands over to it through `onOpenCosting`.

type Cand = { source: Exclude<PriceSource, "manual" | "estimate">; ref: string; label: string; price: number; kind: "cost" | "sell"; as_of: string | null; stale: boolean; stale_text: string | null };

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "no date");
const numText = (n: number) => (Number.isFinite(n) ? String(n) : "");

export default function BoqRowPanel({ base, row, links, canEdit, markup, validityDays, onClose, onChanged, onError, onNotice, onOpenCosting, initialCandidates }: {
  /** /api/opportunities/[id]/boq */
  base: string;
  row: BoqRow;
  /** The deal's estimate links for this row. */
  links: readonly LinkView[];
  canEdit: boolean;
  /** The toolbar's markup, used when a cost source is chosen from the list. */
  markup: number;
  validityDays: number;
  onClose: () => void;
  /** After anything changed, so the table and the page reload. */
  onChanged: () => void;
  onError: (m: string) => void;
  onNotice: (m: string) => void;
  /** Opens the Costing tab for this row. Absent = the page has no Costing yet and the button is not drawn. */
  onOpenCosting?: (rowId: string) => void;
  /** Lets a server render (and its test) show the open list without a fetch. The page never passes it. */
  initialCandidates?: Cand[];
}) {
  const { confirm } = useFeel();
  const [description, setDescription] = useState(row.description);
  const [qty, setQty] = useState(numText(row.qty));
  const [rate, setRate] = useState(row.priced ? numText(row.rate) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cands, setCands] = useState<Cand[] | null>(initialCandidates ?? null);
  const [listOpen, setListOpen] = useState(!!initialCandidates);

  const mine = links.filter((l) => l.boq_id === row.id);
  const src = sourceView(row);
  const rfq = rfqRefOf(row);
  const breakdown = costBreakdown(row);
  const qtyChanged = qty.trim() !== "" && Number(qty) !== row.qty;
  const descChanged = description.trim() !== row.description;
  const rateChanged = rate.trim() !== "" && Number(rate) !== (row.priced ? row.rate : NaN);
  const dirty = qtyChanged || descChanged || rateChanged;

  async function call(url: string, init: RequestInit): Promise<boolean> {
    const res = await fetch(url, init);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "Could not save"); onError(j.error ?? "Could not save"); return false; }
    return true;
  }

  async function save() {
    setError(""); onError("");
    if (!description.trim()) { setError("A line needs a description"); return; }
    if (qty.trim() === "" || !(Number(qty) >= 0)) { setError("Enter a quantity of 0 or more"); return; }
    if (rate.trim() !== "" && !(Number(rate) >= 0)) { setError("Enter a rate of 0 or more"); return; }
    setBusy(true);
    try {
      // Quantity and description first: the rate's amount is then worked out on the new quantity.
      if (qtyChanged || descChanged) {
        const ok = await call(`${base}/lines/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(qtyChanged ? { qty: Number(qty) } : {}), ...(descChanged ? { description } : {}) }) });
        if (!ok) return;
      }
      if (rateChanged) {
        const ok = await call(`${base}/price`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ line: row.id, source: "manual", rate: Number(rate) }) });
        if (!ok) { onChanged(); return; }
      }
      onNotice("Saved");
      onChanged();
      onClose();
    } catch { setError("Network error. Try again."); } finally { setBusy(false); }
  }

  async function openList() {
    const next = !listOpen;
    setListOpen(next);
    if (!next || cands) return;
    const res = await fetch(`${base}/candidates?line=${row.id}`);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error ?? "Could not load the prices"); return; }
    setCands(j.candidates as Cand[]);
  }

  async function choose(cd: Cand) {
    if (cd.stale && !(await confirm({ title: "Use a stale price?", body: `${cd.label} is ${cd.stale_text}. Your workspace treats prices older than ${validityDays} days as out of date. Use it anyway?`, confirmLabel: "Use it knowingly" }))) return;
    setBusy(true); setError(""); onError("");
    try {
      const ok = await call(`${base}/price`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ line: row.id, source: cd.source, ref: cd.ref, markup_pct: markup, accept_stale: cd.stale }) });
      if (ok) { onNotice("Price set"); onChanged(); onClose(); }
    } catch { setError("Network error. Try again."); } finally { setBusy(false); }
  }

  const h = { fontWeight: 700, fontSize: 12.5, color: c.ink, display: "flex", alignItems: "center", gap: 6 } as const;
  const small = { fontSize: 12.5, color: c.muted, overflowWrap: "anywhere" } as const;

  return (
    <SidePanel
      title={`Item ${itemLabel(row)}`} label={`Bill of quantities item ${itemLabel(row)}`} onClose={onClose}
      subtitle={<RowChips row={row} links={mine} />}
      footer={canEdit ? <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => void save()} style={{ minHeight: 44 }} data-guide="boq.row.save">Save</Button> : undefined}
    >
      <div className="bpm-tap" data-guide="boq.row" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}

        <Field label="Description" guide="boq.row.description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} maxLength={1000} style={{ minHeight: 64 }} />
        </Field>
        <div className="fg2">
          <Field label={`Quantity${row.uom ? ` (${row.uom})` : ""}`} guide="boq.row.qty">
            <Input type="number" min={0} step="any" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} disabled={!canEdit} style={{ minHeight: 44 }} />
          </Field>
          <Field label="Rate" info={BOQ_TABLE_TIPS.rate} guide="boq.row.rate">
            <Input type="number" min={0} step="0.01" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} disabled={!canEdit} style={{ minHeight: 44 }} />
          </Field>
        </div>

        <div data-guide="boq.row.cost" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={h}>Where the cost came from <InfoTip label="Costing">{BOQ_TABLE_TIPS.costing}</InfoTip></div>
          <div style={small}>
            Source: <b style={{ color: c.ink }}>{src.label}</b>{src.detail ? ` · ${src.detail}` : ""}{row.price_source ? ` · ${fmtDate(row.price_as_of)}` : ""}
            {src.was ? <div>Replaced: {src.was}</div> : null}
            {row.stale && <div style={{ color: "var(--amberink)", fontWeight: 600 }}>{row.stale_text}{row.stale_accepted ? ", accepted knowingly" : ""}</div>}
          </div>
          {breakdown && <div style={small}>Cost {money(breakdown.cost)} + {breakdown.markup}% markup = rate {money(breakdown.rate)}</div>}
          {mine.map((l) => (
            <div key={l.id} data-guide="boq.row.estimate" style={small}>
              Estimate <b style={{ color: c.ink }}>{l.estimate_ref ?? l.estimate_name}</b> · {l.output_label}
              {l.broken && <div style={{ color: "var(--redink)", fontWeight: 600 }}>That part of the estimate is gone</div>}
              {l.waiting && !l.broken && <div style={{ color: "var(--amberink)", fontWeight: 600 }}>Build-up in progress</div>}
              {l.stale && !l.waiting && <div style={{ color: "var(--amberink)", fontWeight: 600 }}>The estimate changed, re-price it in Costing</div>}
              {l.quantity?.note && !l.broken && <div role="alert" data-guide="boq.row.quantity" style={{ color: "var(--amberink)", fontWeight: 600 }}>{l.quantity.note}</div>}
              {l.needs_review && <div style={{ color: "var(--amberink)", fontWeight: 600 }}>{l.review_note ?? "Re-priced from a supplier award, check it"}</div>}
            </div>
          ))}
          {rfq && <div data-guide="boq.row.rfq" style={small}>Awarded under <b style={{ color: c.ink }}>{rfq}</b></div>}
          {!row.price_source && mine.length === 0 && <div style={small}>No cost yet.</div>}
          {onOpenCosting && (
            <div>
              <Button variant="secondary" onClick={() => onOpenCosting(row.id)} style={{ minHeight: 44 }} data-guide="boq.row.costing">Open in Costing</Button>
            </div>
          )}
        </div>

        {canEdit && row.linked && (
          <div data-guide="boq.row.sources" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Button variant="quiet" onClick={() => void openList()} style={{ minHeight: 44 }} data-guide="boq.price_line" aria-expanded={listOpen}>{listOpen ? "Hide price sources" : "Choose a price source"}</Button>
              <InfoTip label="Price sources">{BOQ_TABLE_TIPS.sourcesList}</InfoTip>
            </div>
            {listOpen && (
              <div data-guide="boq.picker" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {cands === null && <div style={small}>Looking…</div>}
                {cands?.length === 0 && <div style={small}>No product cost, past-project or client price was found for this line.</div>}
                {cands?.map((cd) => {
                  const rfqCand = cd.source === "supplier" && /^RFQ-/i.test(cd.ref);
                  const body = (
                    <>
                      <b style={{ fontSize: 12 }}>{PRICE_SOURCE_LABEL[cd.source]}</b>
                      <span style={{ fontSize: 12.5, flex: "1 1 160px", overflowWrap: "anywhere" }}>{cd.label}</span>
                      <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{money(rateFor(cd, markup))}{cd.kind === "cost" ? ` (cost ${money(cd.price)})` : ""}</span>
                      <span style={{ fontSize: 11.5, color: cd.stale ? "var(--amberink)" : c.hint }}>{fmtDate(cd.as_of)}{cd.stale ? ` · ${cd.stale_text}` : ""}</span>
                    </>
                  );
                  const style = { textAlign: "left", background: "transparent", border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px", minHeight: 44, color: c.ink, display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "baseline" } as const;
                  // A supplier's reply on an RFQ is awarded in Costing, never picked from this list.
                  return rfqCand
                    ? <div key={cd.source + cd.ref} data-guide="boq.candidate_rfq" style={{ ...style, opacity: 0.7 }}>{body}<span style={{ fontSize: 11.5, color: c.hint }}>Award in Costing</span></div>
                    : <button key={cd.source + cd.ref} type="button" onClick={() => void choose(cd)} disabled={busy} data-guide="boq.candidate" style={{ ...style, cursor: "pointer" }}>{body}</button>;
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </SidePanel>
  );
}
