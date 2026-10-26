"use client";

import { useEffect, useMemo, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import { useFeel } from "@/components/FeelProvider";
import { ESTIMATE_TIPS } from "@/lib/tender/estimates/tips";
import { reshare, type Proposal, type ProposalBy } from "@/lib/tender/estimates/allocate";
import { allocationSummary, round2, type AllocationLink } from "@/lib/tender/estimates/rules";
import type { EstimatesState } from "@/lib/tender/estimates/server";
import MissingRfqButton from "./MissingRfqButton";

// The estimate tools of the BOQ Prices tab that are about many lines at once (GCC tender deals, slice 3c-1): the chips ("Allocate to
// BOQ", costs missing, estimate changed), the allocation panel and the missing-costs list. The line-by-line tools are in
// BoqEstimates.tsx. Nothing here writes a cost: the panel sends which line, which part of the estimate and what share, and the server
// works the cost out again and refuses anything that gives out more than 100 percent of a part.

const money = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const J = { "Content-Type": "application/json" };
const PAGE = 10;

type Allocation = {
  estimate: { id: string; ref: string | null; name: string };
  outputs: { key: string; label: string; cost: number }[];
  rows: Proposal[];
  existing: AllocationLink[];
};

export function AllocatePanel({ base, state, canEdit, markup, onChanged, onError, onNotice, initialData, initialOpen }: {
  /** /api/opportunities/[id]/tender/estimates */
  base: string; state: EstimatesState; canEdit: boolean; markup: number;
  onChanged: () => void; onError: (m: string) => void; onNotice: (m: string) => void;
  initialData?: Allocation; initialOpen?: boolean;
}) {
  const { confirm } = useFeel();
  const [open, setOpen] = useState(initialOpen ?? false);
  const [estimateId, setEstimateId] = useState(initialData?.estimate.id ?? state.estimates[0]?.id ?? "");
  const [mode, setMode] = useState<"match" | "spread">("match");
  const [by, setBy] = useState<ProposalBy>("amount");
  const [output, setOutput] = useState("total");
  const [data, setData] = useState<Allocation | null>(initialData ?? null);
  const [ticked, setTicked] = useState<Set<string>>(new Set((initialData?.rows ?? []).map((r) => r.boq_id)));
  const [shares, setShares] = useState<Record<string, string>>(Object.fromEntries((initialData?.rows ?? []).map((r) => [r.boq_id, String(r.share_pct)])));
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!open || !estimateId || initialData) return;
    let live = true;
    setData(null);
    fetch(`${base}/allocate?estimate=${encodeURIComponent(estimateId)}&mode=${mode}&by=${by}&output=${encodeURIComponent(output)}`, { cache: "no-store" })
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
  }, [open, estimateId, mode, by, output, base, onError, initialData]);

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

  async function apply() {
    if (!data || chosen.length === 0) return;
    if (!(await confirm({ title: `Price ${chosen.length} BOQ line${chosen.length === 1 ? "" : "s"} from ${data.estimate.ref ?? "the estimate"}?`, body: `This sets the cost and the rate of those lines${markup === 0 ? " (markup 0%: at cost)" : ""}. ${state.bid_locked ? "The bid is already in; the submitted version is kept as it was." : ""}`.trim(), confirmLabel: "Apply" }))) return;
    setBusy(true); onError("");
    try {
      const res = await fetch(`${base}/links`, {
        method: "POST", headers: J,
        body: JSON.stringify({ items: chosen.map((r) => ({ boq_id: r.boq_id, estimate_id: data.estimate.id, output: r.output, basis: "total", share_pct: Number(shares[r.boq_id]) })), markup_pct: markup }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j.error ?? "Could not apply the allocation"); return; }
      const failed = (j.failed ?? []) as { item: string; reason: string }[];
      onNotice(`${j.repriced?.length ?? chosen.length} line${(j.repriced?.length ?? chosen.length) === 1 ? "" : "s"} priced from the estimate${failed.length ? `, ${failed.length} could not be priced` : ""}`);
      if (failed.length) onError(`${failed[0].item}: ${failed[0].reason}`);
      setOpen(false);
      onChanged();
    } catch { onError("Network error. Try again."); } finally { setBusy(false); }
  }

  if (state.estimates.length === 0) return null;
  const rows = data?.rows ?? [];
  const shown = showAll ? rows : rows.slice(0, PAGE);
  return (
    <div data-guide="boq.allocate" style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <button type="button" data-guide="boq.allocate.chip" aria-expanded={open} onClick={() => setOpen(!open)}
          style={{ minHeight: 44, padding: "0 12px", borderRadius: 999, border: `1px solid ${c.line}`, background: "var(--panel2)", color: c.ink, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          Allocate to BOQ
        </button>
        <InfoTip label="Allocate to BOQ">{ESTIMATE_TIPS.allocate}</InfoTip>
      </div>

      {open && (
        <div data-guide="boq.allocate.panel" style={{ marginTop: 8, background: "var(--panel2)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="fg2">
            <Field label="Estimate" guide="boq.allocate.estimate">
              <Select value={estimateId} onChange={(e) => setEstimateId(e.target.value)} style={{ minHeight: 44 }}>
                {state.estimates.map((e) => <option key={e.id} value={e.id}>{e.ref ?? "Estimate"} · {e.name}</option>)}
              </Select>
            </Field>
            <Field label="How" info={mode === "match" ? ESTIMATE_TIPS.allocateMatch : ESTIMATE_TIPS.allocateSpread} guide="boq.allocate.mode">
              <Select value={mode} onChange={(e) => setMode(e.target.value as "match" | "spread")} style={{ minHeight: 44 }}>
                <option value="match">Match by cost code and wording</option>
                <option value="spread">Spread one part over the lines</option>
              </Select>
            </Field>
            <Field label="Share by" guide="boq.allocate.by">
              <Select value={by} onChange={(e) => setBy(e.target.value as ProposalBy)} style={{ minHeight: 44 }}>
                <option value="amount">BOQ amount</option>
                <option value="quantity">BOQ quantity</option>
              </Select>
            </Field>
            {mode === "spread" && (
              <Field label="Part of the estimate" guide="boq.allocate.output">
                <Select value={output} onChange={(e) => setOutput(e.target.value)} style={{ minHeight: 44 }}>
                  {(data?.outputs ?? [{ key: "total", label: "Whole estimate", cost: 0 }]).filter((o) => !o.key.startsWith("line:")).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </Select>
              </Field>
            )}
          </div>

          {!data && <div style={{ fontSize: 12.5, color: c.hint }}>Looking…</div>}
          {data && rows.length === 0 && <div style={{ fontSize: 12.5, color: c.hint }}>{mode === "match" ? "No BOQ line reads like a line of this estimate. Try spreading a part over the lines instead." : "Nothing left to give out: this part is fully allocated."}</div>}

          {shown.map((r) => {
            const on = ticked.has(r.boq_id);
            const sh = Number(shares[r.boq_id]) || 0;
            const perUnit = r.qty > 0 ? (r.output_cost * sh) / 100 / r.qty : 0;
            return (
              <div key={r.boq_id} data-guide="boq.allocate.row" style={{ borderTop: `1px solid ${c.line}`, paddingTop: 8, display: "flex", flexWrap: "wrap", gap: "6px 12px", alignItems: "center", opacity: on ? 1 : 0.55 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, cursor: "pointer" }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(r.boq_id)} data-guide="boq.allocate.tick" style={{ width: 20, height: 20 }} aria-label={`Include ${r.item_no ?? r.description}`} />
                  <b style={{ fontSize: 12.5, color: c.ink, minWidth: 36 }}>{r.item_no ?? "·"}</b>
                </label>
                <span style={{ flex: "1 1 200px", fontSize: 13, color: c.ink, overflowWrap: "anywhere" }}>{r.description}</span>
                <span style={{ flex: "1 1 160px", fontSize: 12, color: c.muted, overflowWrap: "anywhere" }}>
                  {r.output_label}{r.band !== "spread" ? ` · ${r.band === "strong" ? "strong" : "possible"} match` : ""}
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Input type="number" min={0} max={100} step="0.01" inputMode="decimal" aria-label={`Share of ${r.output_label} for ${r.item_no ?? r.description}`} data-guide="boq.allocate.share"
                    value={shares[r.boq_id] ?? ""} onChange={(e) => setShares({ ...shares, [r.boq_id]: e.target.value })} style={{ width: 96, minHeight: 44 }} disabled={!on} />
                  <span style={{ fontSize: 12, color: c.hint }}>%</span>
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 12.5, color: c.ink, whiteSpace: "nowrap" }}>{on ? `${money(perUnit)} / ${r.uom ?? "unit"}` : "—"}</span>
              </div>
            );
          })}
          {rows.length > PAGE && <Button variant="quiet" onClick={() => setShowAll(!showAll)} style={{ minHeight: 44 }} data-guide="boq.allocate.show_all">{showAll ? "Show fewer" : `Show all ${rows.length} lines`}</Button>}

          {summary && (
            <div data-guide="boq.allocate.summary" style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", alignItems: "center", fontSize: 12.5, color: c.ink, borderTop: `1px solid ${c.line}`, paddingTop: 8 }}>
              <span>Allocated <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(summary.allocated_cost)}</b> of {money(summary.total_cost)}</span>
              <span data-guide="boq.allocate.unallocated" style={{ color: summary.unallocated_cost > 0 ? "var(--amberink)" : c.muted, display: "inline-flex", alignItems: "center", gap: 4 }}>
                Unallocated <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(round2(summary.unallocated_cost))}</b> <InfoTip label="Unallocated">{ESTIMATE_TIPS.unallocated}</InfoTip>
              </span>
              {summary.over.length > 0 && <b role="alert" style={{ color: "var(--redink)" }}>More than 100 percent is given out. Lower a share.</b>}
            </div>
          )}
          {canEdit && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="primary" loading={busy} disabled={chosen.length === 0 || (summary?.over.length ?? 0) > 0} onClick={() => void apply()} style={{ minHeight: 44 }} data-guide="boq.allocate.apply">
                Apply to {chosen.length} line{chosen.length === 1 ? "" : "s"}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} style={{ minHeight: 44 }} data-guide="boq.allocate.cancel">Cancel</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The "N costs missing" chip with a list of the estimates and their RFQ button, and the "estimate changed" re-price button. */
export function EstimateAttention({ opportunityId, base, state, canEdit, markup, rfqEnabled, onChanged, onError, onNotice, initialOpen }: {
  opportunityId: string; base: string; state: EstimatesState; canEdit: boolean; markup: number; rfqEnabled: boolean;
  onChanged: () => void; onError: (m: string) => void; onNotice: (m: string) => void; initialOpen?: boolean;
}) {
  const { confirm } = useFeel();
  const [open, setOpen] = useState(initialOpen ?? false);
  const [busy, setBusy] = useState(false);
  const missing = state.estimates.filter((e) => e.missing_count > 0);
  const missingTotal = missing.reduce((s, e) => s + e.missing_count, 0);
  const staleLines = new Set(state.links.filter((l) => l.stale || l.waiting).map((l) => l.boq_id)).size;
  if (missingTotal === 0 && staleLines === 0) return null;

  async function repriceAll() {
    if (state.bid_locked && !(await confirm({ title: "The bid is already in", body: "Re-pricing changes the rate on the deal's lines. The submitted bid version is kept as it was.", confirmLabel: "Re-price" }))) return;
    setBusy(true); onError("");
    try {
      const res = await fetch(`${base}/reprice`, { method: "POST", headers: J, body: JSON.stringify({ all_stale: true, markup_pct: markup > 0 ? markup : undefined }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j.error ?? "Could not re-price"); return; }
      const failed = (j.failed ?? []) as { item: string; reason: string }[];
      onNotice(`${j.repriced?.length ?? 0} line${(j.repriced?.length ?? 0) === 1 ? "" : "s"} re-priced${failed.length ? `, ${failed.length} could not be` : ""}`);
      if (failed.length) onError(`${failed[0].item}: ${failed[0].reason}`);
      onChanged();
    } catch { onError("Network error. Try again."); } finally { setBusy(false); }
  }

  return (
    <div data-guide="boq.estimate.attention" style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {staleLines > 0 && canEdit && (
          <Button variant="secondary" loading={busy} onClick={() => void repriceAll()} style={{ minHeight: 44, background: "var(--amberbg)", color: "var(--amberink)" }} data-guide="boq.estimate.reprice_all">
            Re-price {staleLines} line{staleLines === 1 ? "" : "s"} (estimate changed)
          </Button>
        )}
        {staleLines > 0 && <InfoTip label="Estimate changed">{ESTIMATE_TIPS.stale}</InfoTip>}
        {missingTotal > 0 && (
          <>
            <button type="button" data-guide="boq.estimate.missing_chip" aria-expanded={open} onClick={() => setOpen(!open)}
              style={{ minHeight: 44, padding: "0 12px", borderRadius: 999, border: `1px solid ${c.line}`, background: "var(--amberbg)", color: "var(--amberink)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              {missingTotal} estimate cost{missingTotal === 1 ? "" : "s"} missing
            </button>
            <InfoTip label="Missing costs">{ESTIMATE_TIPS.missing}</InfoTip>
          </>
        )}
      </div>
      {open && missingTotal > 0 && (
        <div data-guide="boq.estimate.missing_panel" style={{ background: "var(--panel2)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {missing.map((e) => (
            <div key={e.id} style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", alignItems: "center" }}>
              <span style={{ flex: "1 1 200px", fontSize: 13, color: c.ink, overflowWrap: "anywhere" }}>{e.ref ?? "Estimate"} · {e.name}</span>
              <span style={{ fontSize: 12, color: "var(--amberink)" }}>{e.missing_count} missing</span>
              {rfqEnabled && canEdit && <MissingRfqButton opportunityId={opportunityId} estimateId={e.id} showTip={false} guideId="boq.estimate.rfq" />}
            </div>
          ))}
          {!rfqEnabled && <div style={{ fontSize: 12, color: c.hint }}>Your workspace does not have the RFQ module, so these costs have to be typed into the estimate.</div>}
        </div>
      )}
    </div>
  );
}
