"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import { useFeel } from "@/components/FeelProvider";
import { ESTIMATE_TIPS } from "@/lib/tender/estimates/tips";
import type { EstimatesState, LinkView, OutputPreview } from "@/lib/tender/estimates/server";
import type { Basis } from "@/lib/tender/estimates/rules";

// Estimates on the BOQ Prices tab (GCC tender deals, slice 3c-1, migration 0227): for each line, the estimate that priced it (with
// "Estimate changed, re-price" when the estimate moved on), "Price from estimate" (pick an estimate and the part of it that prices the
// line) and "Build up this rate" (make an estimate for this line from a template). Costs shown here are internal. Every figure the
// server writes is recomputed there from the estimate as it is now; this component only sends which estimate, which part, the basis
// and the share.

const money = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const J = { "Content-Type": "application/json" };

export type EstimateBoqLine = { id: string; item_no: string | null; description: string; qty: number; uom: string | null; priced: boolean };

type Outputs = { estimate: { id: string; ref: string | null; name: string }; outputs: OutputPreview[]; boq: { id: string; qty: number; uom: string | null } };

function LinkChip({ l, canEdit, bidLocked, busy, onReprice, onReviewed, onUnlink }: {
  l: LinkView; canEdit: boolean; bidLocked: boolean; busy: boolean; onReprice: () => void; onReviewed: () => void; onUnlink: () => void;
}) {
  const basis = l.basis === "total" ? `${l.share_pct}% of its cost` : `cost per unit${l.share_pct === 100 ? "" : `, ${l.share_pct}%`}`;
  return (
    <div data-guide="boq.estimate.link" style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center", fontSize: 12 }}>
      <span style={{ color: c.muted, overflowWrap: "anywhere" }}>
        Estimate <Link href={`/estimates/${l.estimate_id}`} data-guide="boq.estimate.open" style={{ color: c.ink, fontWeight: 600 }}>{l.estimate_ref ?? l.estimate_name}</Link> · {l.output_label} · {basis}
      </span>
      {l.broken && <b data-guide="boq.estimate.broken" style={{ color: "var(--redink)" }}>That part of the estimate is gone</b>}
      {l.waiting && !l.broken && <b data-guide="boq.estimate.waiting" style={{ color: "var(--amberink)", display: "inline-flex", alignItems: "center", gap: 4 }}>Build-up in progress <InfoTip label="Build-up">{ESTIMATE_TIPS.buildUpWaiting}</InfoTip></b>}
      {l.stale && !l.waiting && <b data-guide="boq.estimate.stale" style={{ color: "var(--amberink)", display: "inline-flex", alignItems: "center", gap: 4 }}>Estimate changed, re-price <InfoTip label="Estimate changed">{ESTIMATE_TIPS.stale}</InfoTip></b>}
      {l.needs_review && (
        <span data-guide="boq.estimate.review" style={{ color: "var(--amberink)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          {l.review_note ?? "Re-priced from a supplier award, check it"} <InfoTip label="Review">{bidLocked ? ESTIMATE_TIPS.reviewLocked : ESTIMATE_TIPS.review}</InfoTip>
        </span>
      )}
      {canEdit && (l.stale || l.waiting) && !l.broken && (
        <Button size="sm" variant="secondary" loading={busy} onClick={onReprice} style={{ minHeight: 44 }} data-guide="boq.estimate.reprice">{l.waiting ? "Use its total" : "Re-price"}</Button>
      )}
      {canEdit && l.needs_review && <Button size="sm" variant="quiet" disabled={busy} onClick={onReviewed} style={{ minHeight: 44 }} data-guide="boq.estimate.reviewed">Mark reviewed</Button>}
      {canEdit && <Button size="sm" variant="quiet" disabled={busy} onClick={onUnlink} style={{ minHeight: 44 }} data-guide="boq.estimate.unlink">Unlink</Button>}
    </div>
  );
}

/** Under each BOQ line of the Prices tab: its estimate links and the two ways to price it from an estimate. */
export function LineEstimates({ opportunityId, base, line, state, canEdit, markup, onChanged, onError, onNotice, initialOpen, initialOutputs }: {
  opportunityId: string;
  /** /api/opportunities/[id]/tender/estimates */
  base: string; line: EstimateBoqLine; state: EstimatesState; canEdit: boolean; markup: number;
  /** Called after a change, so the BOQ state, the estimate state and the page reload. */
  onChanged: () => void; onError: (m: string) => void; onNotice: (m: string) => void;
  initialOpen?: "price" | "build" | null; initialOutputs?: Outputs;
}) {
  const router = useRouter();
  const { confirm } = useFeel();
  const [open, setOpen] = useState<"price" | "build" | null>(initialOpen ?? null);
  const [busy, setBusy] = useState(false);
  const [estimateId, setEstimateId] = useState(initialOutputs?.estimate.id ?? "");
  const [outs, setOuts] = useState<Outputs | null>(initialOutputs ?? null);
  const [basis, setBasis] = useState<Basis>("total");
  const [share, setShare] = useState("100");
  const [templates, setTemplates] = useState<{ id: string; name: string }[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const mine = state.links.filter((l) => l.boq_id === line.id);

  useEffect(() => {
    if (open !== "price" || !estimateId || initialOutputs) return;
    let live = true;
    setOuts(null);
    fetch(`${base}/links?estimate=${encodeURIComponent(estimateId)}&boq=${encodeURIComponent(line.id)}`, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => ({})) }))
      .then(({ ok, j }) => { if (!live) return; if (ok) setOuts(j as Outputs); else onError(j.error ?? "Could not load the estimate"); })
      .catch(() => {});
    return () => { live = false; };
  }, [open, estimateId, base, line.id, onError, initialOutputs]);

  useEffect(() => {
    if (open !== "build" || templates) return;
    fetch(base, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) { setTemplates(j.templates ?? []); setTemplateId(j.templates?.[0]?.id ?? ""); } })
      .catch(() => {});
  }, [open, templates, base]);

  async function send(url: string, init: RequestInit, done: string): Promise<boolean> {
    setBusy(true); onError("");
    try {
      const res = await fetch(url, init);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j.error ?? "That did not work"); return false; }
      const failed = (j.failed ?? []) as { item: string; reason: string }[];
      if (failed.length > 0) onError(`${failed[0].item}: ${failed[0].reason}`);
      else onNotice(done);
      onChanged();
      return true;
    } catch { onError("Network error. Try again."); return false; } finally { setBusy(false); }
  }

  async function use(o: OutputPreview) {
    const sh = Number(share);
    const ok = await send(`${base}/links`, {
      method: "POST", headers: J,
      body: JSON.stringify({ items: [{ boq_id: line.id, estimate_id: estimateId, output: o.key, basis: o.kind === "line" ? basis : "total", share_pct: sh }], markup_pct: markup }),
    }, "Priced from the estimate");
    if (ok) setOpen(null);
  }

  async function reprice(l: LinkView) {
    if (state.bid_locked && !(await confirm({ title: "The bid is already in", body: "Re-pricing changes the rate on the deal's lines. The submitted bid version is kept as it was.", confirmLabel: "Re-price" }))) return;
    await send(`${base}/reprice`, { method: "POST", headers: J, body: JSON.stringify({ link_ids: [l.id], markup_pct: markup > 0 ? markup : undefined }) }, "Re-priced from the estimate");
  }

  async function unlink(l: LinkView) {
    if (!(await confirm({ title: "Unlink this estimate?", body: ESTIMATE_TIPS.unlink, confirmLabel: "Unlink" }))) return;
    await send(`${base}/links/${l.id}`, { method: "DELETE" }, "Unlinked");
  }

  async function build() {
    setBusy(true); onError("");
    try {
      const res = await fetch(`${base}/build`, { method: "POST", headers: J, body: JSON.stringify({ boq_id: line.id, template_id: templateId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j.error ?? "Could not start the estimate"); return; }
      onChanged();
      router.push(`/estimates/${j.estimate_id}`);
    } catch { onError("Network error. Try again."); } finally { setBusy(false); }
  }

  if (!canEdit && mine.length === 0) return null;
  return (
    <div data-guide="boq.estimate" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {mine.map((l) => (
        <LinkChip key={l.id} l={l} canEdit={canEdit} bidLocked={state.bid_locked} busy={busy}
          onReprice={() => void reprice(l)} onReviewed={() => void send(`${base}/links/${l.id}`, { method: "PATCH", headers: J, body: JSON.stringify({ reviewed: true }) }, "Marked reviewed")} onUnlink={() => void unlink(l)} />
      ))}
      {canEdit && line.qty > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {state.estimates.length > 0 && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setOpen(open === "price" ? null : "price")} style={{ minHeight: 44 }} data-guide="boq.estimate.price">{open === "price" ? "Close" : "Price from estimate"}</Button>
              <InfoTip label="Price from estimate">{ESTIMATE_TIPS.priceFromEstimate}</InfoTip>
            </>
          )}
          <Button size="sm" variant="secondary" onClick={() => setOpen(open === "build" ? null : "build")} style={{ minHeight: 44 }} data-guide="boq.estimate.build">{open === "build" ? "Close" : "Build up this rate"}</Button>
          <InfoTip label="Build up this rate">{ESTIMATE_TIPS.buildUp}</InfoTip>
        </div>
      )}

      {open === "price" && (
        <div data-guide="boq.estimate.picker" style={{ background: "var(--panel2)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="fg2">
            <Field label="Estimate" guide="boq.estimate.select">
              <Select value={estimateId} onChange={(e) => setEstimateId(e.target.value)} style={{ minHeight: 44 }}>
                <option value="">Choose an estimate</option>
                {state.estimates.map((e) => <option key={e.id} value={e.id}>{e.ref ?? "Estimate"} · {e.name}</option>)}
              </Select>
            </Field>
            <Field label="Share %" info={ESTIMATE_TIPS.share} guide="boq.estimate.share">
              <Input type="number" min={1} max={100} step="1" inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} style={{ minHeight: 44 }} />
            </Field>
            <Field label="Cost basis" guide="boq.estimate.basis">
              <Select value={basis} onChange={(e) => setBasis(e.target.value as Basis)} style={{ minHeight: 44 }}>
                <option value="total">Spread over this line's quantity</option>
                <option value="per_unit">Estimate line's cost per unit</option>
              </Select>
            </Field>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: c.muted }}>
            {basis === "total" ? ESTIMATE_TIPS.basisTotal : ESTIMATE_TIPS.basisPerUnit}
          </div>
          {estimateId && !outs && <div style={{ fontSize: 12.5, color: c.hint }}>Looking…</div>}
          {outs?.outputs.length === 0 && <div style={{ fontSize: 12.5, color: c.hint }}>This estimate has no cost lines yet.</div>}
          {outs?.outputs.map((o) => {
            const at100 = basis === "per_unit" ? o.per_unit_line : o.per_unit_total;
            const unit = at100 == null ? null : Math.round(at100 * ((Number(share) || 0) / 100) * 10000) / 10000;
            const usable = unit != null && unit > 0;
            return (
              <button key={o.key} type="button" data-guide="boq.estimate.output" disabled={busy || !usable} onClick={() => void use(o)}
                style={{ textAlign: "left", background: "transparent", border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px", minHeight: 44, cursor: usable ? "pointer" : "default", opacity: usable ? 1 : 0.55, color: c.ink, display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "baseline" }}>
                <b style={{ fontSize: 12 }}>{o.kind === "total" ? "Total" : o.kind === "wbs" ? "WBS" : "Line"}</b>
                <span style={{ fontSize: 12.5, flex: "1 1 160px", overflowWrap: "anywhere" }}>{o.label}</span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 12.5 }}>cost {money(o.cost)}</span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{usable ? `${money(unit)} per ${outs.boq.uom ?? "unit"}` : "not for this basis"}</span>
                {o.unpriced > 0 && <span style={{ fontSize: 11.5, color: "var(--amberink)" }}>{o.unpriced} without a cost</span>}
              </button>
            );
          })}
        </div>
      )}

      {open === "build" && (
        <div data-guide="boq.estimate.builder" style={{ background: "var(--panel2)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {!templates && <div style={{ fontSize: 12.5, color: c.hint }}>Looking…</div>}
          {templates?.length === 0 && <div style={{ fontSize: 12.5, color: c.hint }}>There is no estimate template yet. Add one in Settings, Estimate templates.</div>}
          {templates && templates.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
              <Field label="Template" guide="boq.estimate.template">
                <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ minHeight: 44 }}>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <Button variant="primary" loading={busy} disabled={!templateId} onClick={() => void build()} style={{ minHeight: 44 }} data-guide="boq.estimate.build_go">Start the estimate</Button>
            </div>
          )}
          <div style={{ fontSize: 12, color: c.muted }}>{line.qty} {line.uom ?? ""} · {line.item_no ?? ""} {line.description.slice(0, 60)}</div>
        </div>
      )}
    </div>
  );
}
