"use client";

import { useEffect, useMemo, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import SidePanel from "@/components/ui/SidePanel";
import { useFeel } from "@/components/FeelProvider";
import { reshare, type Proposal, type ProposalBy } from "@/lib/tender/estimates/allocate";
import { allocationSummary, round2, type AllocationLink } from "@/lib/tender/estimates/rules";
import { ESTIMATE_TIPS } from "@/lib/tender/estimates/tips";
import { COSTING_TIPS } from "@/lib/tender/costing/tips";
import { parseMarkup } from "@/lib/tender/costing/rules";

// "Price the BOQ rows from this estimate" in the Costing tab: the existing allocation (GET .../estimates/allocate proposes, POST
// .../estimates/links writes), in the shared side panel. Nothing here sends a cost: it sends which row, which part of the estimate and
// what share, and the server works the cost out again and refuses more than 100 percent of any part.

const money = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const J = { "Content-Type": "application/json" };
const PAGE = 10;

type Allocation = {
  estimate: { id: string; ref: string | null; name: string };
  outputs: { key: string; label: string; cost: number }[];
  rows: Proposal[];
  existing: AllocationLink[];
};

export default function PriceRowsPanel({ opportunityId, estimate, markupDefault, bidLocked, onClose, onDone, onError, initialData }: {
  opportunityId: string;
  estimate: { id: string; ref: string | null; name: string };
  markupDefault: number;
  bidLocked: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
  /** Lets a server render (and its test) show the loaded panel. The page never passes it. */
  initialData?: Allocation;
}) {
  const { confirm } = useFeel();
  const base = `/api/opportunities/${opportunityId}/tender/estimates`;
  const [mode, setMode] = useState<"match" | "spread">("match");
  const [by, setBy] = useState<ProposalBy>("amount");
  const [output, setOutput] = useState("total");
  const [markup, setMarkup] = useState(String(markupDefault));
  const [data, setData] = useState<Allocation | null>(initialData ?? null);
  const [ticked, setTicked] = useState<Set<string>>(new Set((initialData?.rows ?? []).map((r) => r.boq_id)));
  const [shares, setShares] = useState<Record<string, string>>(Object.fromEntries((initialData?.rows ?? []).map((r) => [r.boq_id, String(r.share_pct)])));
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (initialData) return;
    let live = true;
    setData(null);
    fetch(`${base}/allocate?estimate=${encodeURIComponent(estimate.id)}&mode=${mode}&by=${by}&output=${encodeURIComponent(output)}`, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
      .then(({ ok, j }) => {
        if (!live) return;
        if (!ok) { onError(j.error ?? "Could not work out the allocation"); return; }
        const d = j as Allocation;
        setData(d);
        setTicked(new Set(d.rows.map((r) => r.boq_id)));
        setShares(Object.fromEntries(d.rows.map((r) => [r.boq_id, String(r.share_pct)])));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [base, estimate.id, mode, by, output, onError, initialData]);

  function toggle(id: string) {
    if (!data) return;
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id); else next.add(id);
    const re = reshare(data.rows, next, by, data.existing);
    setTicked(next);
    setShares(Object.fromEntries(data.rows.map((r) => [r.boq_id, String(re.get(r.boq_id) ?? 0)])));
  }

  const chosen = useMemo(() => (data?.rows ?? []).filter((r) => ticked.has(r.boq_id) && Number(shares[r.boq_id]) > 0), [data, ticked, shares]);
  const summary = useMemo(() => {
    if (!data) return null;
    const replacing = new Set(data.rows.map((r) => r.boq_id));
    const links: AllocationLink[] = [
      ...data.existing.filter((l) => !replacing.has(l.boq_line_id)),
      ...chosen.map((r) => ({ boq_line_id: r.boq_id, output: r.output, basis: "total" as const, share_pct: Number(shares[r.boq_id]) })),
    ];
    return allocationSummary(data.outputs, links);
  }, [data, chosen, shares]);
  const markupN = parseMarkup(markup);

  async function apply() {
    if (!data || chosen.length === 0 || markupN === null) return;
    const ok = await confirm({
      title: `Price ${chosen.length} BOQ row${chosen.length === 1 ? "" : "s"} from ${estimate.ref ?? "the estimate"}?`,
      body: `This sets the cost of those rows and adds ${markupN}% to give the rate. ${bidLocked ? "The bid is already in; the submitted version is kept as it was." : ""}`.trim(),
      confirmLabel: "Apply",
    });
    if (!ok) return;
    setBusy(true); onError("");
    try {
      const res = await fetch(`${base}/links`, {
        method: "POST", headers: J,
        body: JSON.stringify({ items: chosen.map((r) => ({ boq_id: r.boq_id, estimate_id: data.estimate.id, output: r.output, basis: "total", share_pct: Number(shares[r.boq_id]) })), markup_pct: markupN }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j.error ?? "Could not apply the allocation"); return; }
      const failed = (j.failed ?? []) as { item: string; reason: string }[];
      const n = j.repriced?.length ?? chosen.length;
      onDone(`${n} row${n === 1 ? "" : "s"} priced from the estimate${failed.length ? `, ${failed.length} could not be priced` : ""}`);
      if (failed.length) onError(`${failed[0].item}: ${failed[0].reason}`);
    } catch { onError("Network error. Try again."); } finally { setBusy(false); }
  }

  const rows = data?.rows ?? [];
  const shown = showAll ? rows : rows.slice(0, PAGE);
  return (
    <SidePanel
      title={`Price the BOQ rows from ${estimate.ref ?? "the estimate"}`} subtitle={estimate.name} onClose={onClose} label="Price the BOQ rows"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy} style={{ minHeight: 44 }} data-guide="costing.price_rows.cancel">Cancel</Button>
          <Button variant="primary" loading={busy} disabled={chosen.length === 0 || markupN === null || (summary?.over.length ?? 0) > 0} onClick={() => void apply()} style={{ minHeight: 44 }} data-guide="costing.price_rows.apply">
            Apply to {chosen.length} row{chosen.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="bpm-tap" data-guide="costing.price_rows" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="bpm-label-row"><b style={{ fontSize: 13, color: c.ink }}>How</b><InfoTip label="Price the BOQ rows">{COSTING_TIPS.priceRows}</InfoTip></span>
        <div className="fg2">
          <Field label="Match by" guide="costing.price_rows.mode" info={mode === "match" ? ESTIMATE_TIPS.allocateMatch : ESTIMATE_TIPS.allocateSpread}>
            <Select value={mode} onChange={(e) => setMode(e.target.value as "match" | "spread")} style={{ minHeight: 44 }}>
              <option value="match">Cost code and wording</option>
              <option value="spread">Spread one part over the rows</option>
            </Select>
          </Field>
          <Field label="Share by" guide="costing.price_rows.by">
            <Select value={by} onChange={(e) => setBy(e.target.value as ProposalBy)} style={{ minHeight: 44 }}>
              <option value="amount">BOQ amount</option>
              <option value="quantity">BOQ quantity</option>
            </Select>
          </Field>
          {mode === "spread" && (
            <Field label="Part of the estimate" guide="costing.price_rows.output">
              <Select value={output} onChange={(e) => setOutput(e.target.value)} style={{ minHeight: 44 }}>
                {(data?.outputs ?? [{ key: "total", label: "Whole estimate", cost: 0 }]).filter((o) => !o.key.startsWith("line:")).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Markup %" info={COSTING_TIPS.markup} guide="costing.price_rows.markup" error={markupN === null ? "Enter 0 to 1000" : undefined}>
            <Input type="number" min={0} max={1000} step="0.01" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} style={{ minHeight: 44 }} />
          </Field>
        </div>

        {!data && <div role="status" style={{ fontSize: 12.5, color: c.hint }}>Looking…</div>}
        {data && rows.length === 0 && (
          <div style={{ fontSize: 12.5, color: c.hint }}>{mode === "match" ? "No BOQ row reads like a line of this estimate. Try spreading a part over the rows instead." : "Nothing left to give out: this part is fully allocated."}</div>
        )}

        {shown.map((r) => {
          const on = ticked.has(r.boq_id);
          const sh = Number(shares[r.boq_id]) || 0;
          const perUnit = r.qty > 0 ? (r.output_cost * sh) / 100 / r.qty : 0;
          return (
            <div key={r.boq_id} data-guide="costing.price_rows.row" style={{ borderTop: `1px solid ${c.line}`, paddingTop: 8, display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "center", opacity: on ? 1 : 0.55 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, cursor: "pointer" }}>
                <input type="checkbox" checked={on} onChange={() => toggle(r.boq_id)} data-guide="costing.price_rows.tick" style={{ width: 20, height: 20 }} aria-label={`Include ${r.item_no ?? r.description}`} />
                <b style={{ fontSize: 12.5, color: c.ink, minWidth: 36 }}>{r.item_no ?? "·"}</b>
              </label>
              <span style={{ flex: "1 1 180px", fontSize: 13, color: c.ink, overflowWrap: "anywhere" }}>{r.description}</span>
              <span style={{ flex: "1 1 140px", fontSize: 12, color: c.muted, overflowWrap: "anywhere" }}>
                {r.output_label}{r.band !== "spread" ? ` · ${r.band === "strong" ? "strong" : "possible"} match` : ""}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 12.5, color: c.ink }}>{on ? `${sh}% · ${money(perUnit)} / ${r.uom ?? "unit"}` : "—"}</span>
            </div>
          );
        })}
        {rows.length > PAGE && <div><Button variant="quiet" onClick={() => setShowAll(!showAll)} style={{ minHeight: 44 }} data-guide="costing.price_rows.show_all">{showAll ? "Show fewer" : `Show all ${rows.length} rows`}</Button></div>}

        {summary && (
          <div data-guide="costing.price_rows.summary" style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", alignItems: "center", fontSize: 12.5, color: c.ink, borderTop: `1px solid ${c.line}`, paddingTop: 8 }}>
            <span>Allocated <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(summary.allocated_cost)}</b> of {money(summary.total_cost)}</span>
            <span style={{ color: summary.unallocated_cost > 0 ? "var(--amberink)" : c.muted, display: "inline-flex", alignItems: "center", gap: 4 }}>
              Unallocated <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(round2(summary.unallocated_cost))}</b> <InfoTip label="Unallocated">{ESTIMATE_TIPS.unallocated}</InfoTip>
            </span>
            {summary.over.length > 0 && <b role="alert" style={{ color: "var(--redink)" }}>More than 100 percent is given out. Untick a row.</b>}
          </div>
        )}
      </div>
    </SidePanel>
  );
}
