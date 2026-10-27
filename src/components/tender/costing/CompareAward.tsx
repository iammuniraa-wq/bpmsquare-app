"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import SidePanel from "@/components/ui/SidePanel";
import StatusPill from "@/components/ui/StatusPill";
import { awardDecision, buildComparison, MIN_REASON_CHARS, type CompareResponse } from "@/lib/rfq/comparison";
import { ageText, awardSum, parseMarkup, unpricedAwards, type CompareView } from "@/lib/tender/costing/rules";
import { COSTING_TIPS } from "@/lib/tender/costing/tips";

// The compare-and-award screen of the Costing tab (docs/design/gcc-tender-deals.md section 25). Suppliers side by side for each line,
// the lowest valid price marked, an expired or stale answer in amber. "Award and price" is the only way a tender RFQ is awarded: it
// records the decision, stores the supplier's price as the row's cost, adds the markup and sets the price source to the RFQ. The rules
// are the RFQ module's own (src/lib/rfq/comparison.ts); the server re-checks every one of them, so nothing here is trusted.

type Line = CompareView["lines"][number];
type Resp = CompareView["responses"][number];
type Sup = CompareView["suppliers"][number];
type Pick = { line: Line; resp: Resp };

const money = (n: number | null | undefined, cur?: string | null) =>
  n == null || !Number.isFinite(Number(n)) ? "—" : `${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}${cur ? ` ${cur}` : ""}`;
const day = (s: string | null | undefined) => (s ? new Date(s.length === 10 ? `${s}T00:00:00` : s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const J = { "Content-Type": "application/json" };

export default function CompareAward({ opportunityId, rfqId, onClose, onChanged, onError, onNotice, initialView, initialPanel }: {
  opportunityId: string;
  rfqId: string;
  onClose: () => void;
  /** After an award the page and the list read the new prices. */
  onChanged: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  /** Lets a server render (and its test) show the loaded screen. The page never passes it. */
  initialView?: CompareView;
  initialPanel?: { picks: Pick[]; supplierId: string; all?: boolean } | { applyOnly: true };
}) {
  const base = `/api/opportunities/${opportunityId}/tender/costing`;
  const [view, setView] = useState<CompareView | null>(initialView ?? null);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<null | { picks: Pick[]; supplierId: string; all?: boolean } | { applyOnly: true }>(initialPanel ?? null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}/rfqs/${rfqId}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not load the RFQ"); return; }
      setError("");
      setView(j as CompareView);
    } catch { setError("Could not load the RFQ"); }
  }, [base, rfqId]);
  useEffect(() => { if (!initialView) void load(); }, [initialView, load]);

  const cmp = useMemo(() => {
    if (!view) return null;
    return buildComparison({
      lines: view.lines.map((l) => ({ id: l.id, qty: l.qty })), suppliers: view.suppliers as never,
      responses: view.responses as unknown as CompareResponse[], today: view.today, staleDays: view.stale_days,
      tenantCurrency: view.tenant_currency, respondBy: view.rfq.respond_by, maxReminders: view.max_reminders,
    });
  }, [view]);

  if (!view || !cmp) {
    return (
      <Card title="Compare and award">
        {error ? <div role="alert" style={{ fontSize: 13, color: "var(--redink)" }}>{error}</div> : <div role="status" style={{ fontSize: 13, color: c.hint }}>Loading the answers…</div>}
      </Card>
    );
  }

  const awardOf = new Map(view.awards.map((a) => [a.rfq_line_id, a]));
  const supOf = (id: string): Sup | undefined => view.suppliers.find((s) => s.id === id);
  const waiting = unpricedAwards(view.awards);
  const heading = `${view.rfq.ref ?? "RFQ"} · ${view.rfq.title}`;

  return (
    <Card
      title="Compare and award"
      info={COSTING_TIPS.compare}
      action={<Button variant="quiet" size="sm" onClick={onClose} style={{ minHeight: 44 }} data-guide="costing.compare.close">Close</Button>}
    >
      <div data-guide="costing.compare" className="bpm-tap" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center" }}>
          <b style={{ fontSize: 13, color: c.ink, overflowWrap: "anywhere" }}>{heading}</b>
          <StatusPill label="Lowest valid" tone="blue" />
          <StatusPill label="Expired or stale" tone="amber" />
          <StatusPill label="Awarded" tone="green" />
        </div>

        {error && <div role="alert" style={{ fontSize: 13, color: "var(--redink)" }}>{error}</div>}
        {view.awards_pending && (
          <div role="alert" data-guide="costing.compare.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>
            Awarding needs a database update (migration 0224). The comparison works; ask your administrator to apply it.
          </div>
        )}
        {view.bid_locked && view.can_award && (
          <div data-guide="costing.compare.locked" style={{ fontSize: 12.5, color: "var(--amberink)" }}>The bid is already in. A new rate does not change a version you submitted.</div>
        )}
        {!view.prices_rows && view.can_award && (
          <div data-guide="costing.compare.estimate_rfq" style={{ fontSize: 12.5, color: c.muted }}>
            This RFQ was raised for an estimate. The awarded cost goes into the estimate line and re-prices the rows that estimate prices.
          </div>
        )}
        {view.prices_rows && view.can_award && waiting > 0 && (
          <div data-guide="costing.compare.waiting" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 13, color: "var(--amberink)" }}>
            <span>{waiting} awarded line{waiting === 1 ? "" : "s"} not on {waiting === 1 ? "its" : "their"} BOQ row yet</span>
            <Button variant="secondary" size="sm" onClick={() => setPanel({ applyOnly: true })} style={{ minHeight: 44 }} data-guide="costing.compare.price_awarded">Price {waiting === 1 ? "it" : "them"}</Button>
            <InfoTip label="Awarded lines">{COSTING_TIPS.awardedUnpriced}</InfoTip>
          </div>
        )}

        {/* One strip per supplier: coverage, total, and the award-all action. */}
        <div data-guide="costing.compare.suppliers" style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}>
          {view.suppliers.map((s, i) => {
            const col = cmp.columns[i];
            return (
              <div key={s.id} data-guide="costing.compare.supplier" style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                <b style={{ fontSize: 13, color: c.ink, overflowWrap: "anywhere" }}>{s.name}</b>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", fontSize: 12 }}>
                  {col.waiting
                    ? <StatusPill label="Waiting" tone="amber" />
                    : col.declined ? <StatusPill label="Declined" tone="red" />
                    : col.notSent ? <StatusPill label="Not sent" tone="purple" />
                    : col.cover.quoted > 0 ? <StatusPill label={`Covers ${col.cover.quoted} of ${col.cover.total}`} tone={col.cover.quoted === col.cover.total ? "green" : "amber"} />
                    : <StatusPill label="No quote" tone="purple" />}
                  {col.cover.quoted > 0 && <b style={{ fontVariantNumeric: "tabular-nums", color: c.ink }}>{money(col.total, view.tenant_currency)}</b>}
                </div>
                {col.waiting && col.chase?.date && <span style={{ fontSize: 12, color: col.chase.overdue ? "var(--amberink)" : c.hint }}>{col.chase.overdue ? `Overdue since ${day(col.chase.date)}: chase now` : `Next reminder ${day(col.chase.date)}`}</span>}
                {view.can_award && col.cover.quoted > 1 && (
                  <div>
                    <Button variant="secondary" size="sm" style={{ minHeight: 44 }} data-guide="costing.compare.award_all"
                      onClick={() => setPanel({ supplierId: s.id, all: true, picks: view.responses.filter((r) => r.rfq_supplier_id === s.id && r.status !== "no_quote" && r.unit_price !== null).flatMap((r) => { const line = view.lines.find((l) => l.id === r.rfq_line_id); return line ? [{ line, resp: r }] : []; }) })}>
                      Award all {col.cover.quoted} lines
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* One block per line; the suppliers side by side inside it (stacked on a phone). */}
        {view.lines.map((l) => {
          const award = awardOf.get(l.id);
          const awardedTo = award ? supOf(award.rfq_supplier_id)?.name ?? "a supplier" : null;
          return (
            <div key={l.id} data-guide="costing.compare.line" style={{ borderTop: `1px solid ${c.line}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "baseline" }}>
                <b style={{ fontSize: 13, color: c.ink, overflowWrap: "anywhere" }}>{l.rows.length > 0 ? `${l.rows.join(" · ")} ` : ""}{l.description}</b>
                <span style={{ fontSize: 12, color: c.hint }}>{l.qty ?? ""} {l.uom ?? ""}</span>
              </div>
              {award && (
                <div data-guide="costing.compare.awarded" style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "center", fontSize: 12.5 }}>
                  <StatusPill label={`Awarded · ${money(l.awarded_unit_cost ?? award.landed_unit, view.tenant_currency)}`} tone="green" />
                  <span style={{ color: c.muted }}>{awardedTo} · {award.chosen_by_name ?? "a team member"} · {ageText(award.chosen_at, view.today)}</span>
                  {award.applied_rate != null && <span style={{ color: c.ink }}>On the row at <b style={{ fontVariantNumeric: "tabular-nums" }}>{money(award.applied_rate)}</b></span>}
                  {view.prices_rows && !award.applied_to_deal_at && <span style={{ color: "var(--amberink)" }}>Not on the row yet</span>}
                  {award.not_lowest && <span style={{ color: "var(--amberink)" }}>Not the lowest valid price: {award.reason}</span>}
                </div>
              )}
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))" }}>
                {view.suppliers.map((s) => {
                  const cell = cmp.cells.get(l.id)?.get(s.id);
                  if (!cell) return <div key={s.id} style={{ border: `1px dashed ${c.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 12.5, color: c.hint }}><b style={{ color: c.muted }}>{s.name}</b><div>No reply</div></div>;
                  const r = cell.response;
                  const resp = view.responses.find((x) => x.id === r.id)!;
                  const bad = cell.validity !== "ok";
                  const foreign = !!r.currency && r.currency !== view.tenant_currency;
                  return (
                    <div key={s.id} data-guide="costing.compare.cell" style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3, background: r.is_awarded ? "var(--greenbg)" : cell.lowestValid ? "var(--bluebg)" : undefined }}>
                      <b style={{ fontSize: 12.5, color: c.ink, overflowWrap: "anywhere" }}>{s.name}</b>
                      {r.status === "no_quote" ? <span style={{ color: c.hint, fontSize: 12.5 }}>Can&apos;t quote</span> : (
                        <>
                          <span style={{ fontWeight: 700, fontSize: 15, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{money(r.unit_price, r.currency)}</span>
                          {foreign && !cell.needsFx && r.fx_rate && r.fx_rate !== 1 && <span style={{ fontSize: 11.5, color: c.muted }}>≈ {money(cell.landed, view.tenant_currency)}</span>}
                          {cell.needsFx && <span style={{ fontSize: 11.5, color: "var(--amberink)" }}>No exchange rate yet</span>}
                          <span style={{ fontSize: 11.5, color: c.hint }}>{[r.lead_time_days != null ? `${r.lead_time_days} d lead` : null, r.moq != null ? `MOQ ${r.moq}` : null].filter(Boolean).join(" · ")}</span>
                          <span style={{ fontSize: 11.5, color: bad ? "var(--amberink)" : c.hint }}>
                            {r.valid_until ? `${cell.validity === "expired" ? "Expired" : "Valid to"} ${day(r.valid_until)}` : cell.validity === "stale" ? "Stale: no validity date" : "No validity date"}
                          </span>
                          <span style={{ fontSize: 11.5, color: c.hint }}>Answered {cell.age}</span>
                          {r.status === "alternative" && <span style={{ fontSize: 11.5, color: "var(--amberink)" }}>Alternative: {resp.offered_description}</span>}
                          {r.note && <span style={{ fontSize: 11.5, color: c.muted, overflowWrap: "anywhere" }}>{r.note}</span>}
                          <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            {cell.lowestValid && !r.is_awarded && <StatusPill label="Lowest valid" tone="blue" />}
                            {bad && <StatusPill label={cell.validity === "expired" ? "Expired" : "Stale"} tone="amber" />}
                            {r.is_awarded && <StatusPill label="Awarded" tone="green" />}
                          </span>
                          {view.can_award && !r.is_awarded && (
                            <div>
                              <Button variant={cell.lowestValid ? "primary" : "secondary"} size="sm" style={{ minHeight: 44 }} data-guide="costing.compare.award"
                                onClick={() => setPanel({ supplierId: s.id, picks: [{ line: l, resp }] })}>Award and price</Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {view.lines.length === 0 && <div style={{ fontSize: 13, color: c.muted }}>This RFQ has no lines.</div>}
      </div>

      {panel && (
        <AwardPanel
          view={view} base={base} panel={panel} onClose={() => setPanel(null)}
          onDone={(message, warning) => { setPanel(null); onNotice(message); if (warning) onError(warning); void load(); onChanged(); }}
        />
      )}
    </Card>
  );
}

// ── Award and price ──────────────────────────────────────────────────────────────────────────────────────────────────────

function AwardPanel({ view, base, panel, onClose, onDone }: {
  view: CompareView; base: string;
  panel: { picks: Pick[]; supplierId: string; all?: boolean } | { applyOnly: true };
  onClose: () => void; onDone: (message: string, warning?: string) => void;
}) {
  const applyOnly = "applyOnly" in panel;
  const picks = applyOnly ? [] : panel.picks;
  const supplier = applyOnly ? null : view.suppliers.find((s) => s.id === panel.supplierId) ?? null;
  const foreign = picks.some((p) => !!p.resp.currency && p.resp.currency !== view.tenant_currency);
  const [fx, setFx] = useState(() => { const known = picks.find((p) => p.resp.fx_rate && p.resp.fx_rate !== 1)?.resp.fx_rate; return known ? String(known) : ""; });
  const [reason, setReason] = useState("");
  const [markup, setMarkup] = useState(String(view.markup_default));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fxN = fx ? Number(fx) : null;
  const markupN = parseMarkup(markup);
  const responses = view.responses as unknown as CompareResponse[];
  const awardOf = new Map(view.awards.map((a) => [a.rfq_line_id, a]));
  const rows = applyOnly
    ? view.awards.filter((a) => !a.applied_to_deal_at).map((a) => ({ line: view.lines.find((l) => l.id === a.rfq_line_id)!, cost: a.landed_unit, d: null, cur: a, replaces: false })).filter((x) => x.line)
    : picks.map((p) => {
      const lineResponses = responses.filter((r) => r.rfq_line_id === p.line.id && view.suppliers.some((s) => s.id === r.rfq_supplier_id));
      const d = awardDecision(p.resp.id, lineResponses, view.today, view.stale_days, fxN);
      const cur = awardOf.get(p.line.id) ?? null;
      return { line: p.line, cost: d.landed, d, cur, replaces: !!cur || p.line.status === "awarded" };
    });
  const needReason = rows.some((r) => r.d?.notLowest);
  const replacing = rows.filter((r) => r.replaces);
  const missingFx = foreign && !(fxN && fxN > 0);
  const needsMarkup = view.prices_rows;
  const ready = !busy && !missingFx && (!needsMarkup || markupN !== null) && (!needReason || reason.trim().length >= MIN_REASON_CHARS) && rows.length > 0;
  const nameOf = (rsId: string) => view.suppliers.find((s) => s.id === rsId)?.name ?? "another supplier";

  async function submit() {
    setBusy(true); setError(null);
    try {
      const common = { rfq_id: view.rfq.id, markup_pct: needsMarkup ? markupN : undefined };
      const body = applyOnly
        ? { ...common, apply_only: true }
        : panel.all
          ? { ...common, rfq_supplier_id: panel.supplierId, all: true, fx_rate: fx || null, reason: needReason ? reason.trim() : undefined, replace: replacing.length > 0 }
          : { ...common, line_id: picks[0].line.id, response_id: picks[0].resp.id, fx_rate: fx || null, reason: needReason ? reason.trim() : undefined, replace: replacing.length > 0 };
      const res = await fetch(`${base}/award`, { method: "POST", headers: J, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not award"); setBusy(false); return; }
      const priced = (j.priced ?? []) as { item: string; to: number }[];
      const skipped = (j.skipped ?? []) as { reason: string }[];
      const warning = (j.warning as string | undefined) ?? (j.results as { warning?: string }[] | undefined)?.find((x) => x.warning)?.warning ?? (skipped[0] ? `Not priced: ${skipped[0].reason}` : undefined);
      const awardedCount = applyOnly ? priced.length : picks.length;
      const lead = applyOnly ? "" : picks.length === 1 ? `Awarded to ${supplier?.name ?? "the supplier"}. ` : `Awarded ${awardedCount} lines to ${supplier?.name ?? "the supplier"}. `;
      onDone(`${lead}${priced.length > 0 ? `${priced.length} row${priced.length === 1 ? "" : "s"} priced.` : view.prices_rows ? "" : "The estimate was updated."}`.trim(), warning);
    } catch { setError("Network error. Try again."); setBusy(false); }
  }

  return (
    <SidePanel
      title={applyOnly ? "Price the awarded rows" : picks.length === 1 ? `Award and price · ${picks[0].line.rows[0] ?? picks[0].line.sl_no}` : `Award ${picks.length} lines to ${supplier?.name ?? "the supplier"}`}
      subtitle={supplier?.name} onClose={onClose} label="Award and price"
      footer={
        <>
          <InfoTip label="Award and price">{COSTING_TIPS.award}</InfoTip>
          <Button variant="secondary" onClick={onClose} disabled={busy} style={{ minHeight: 44 }} data-guide="costing.award.cancel">Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void submit()} style={{ minHeight: 44 }} data-guide="costing.award.confirm">
            {applyOnly ? "Price the rows" : replacing.length ? "Replace and price" : "Award and price"}
          </Button>
        </>
      }
    >
      <div className="bpm-tap" data-guide="costing.award" style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13, color: c.ink }}>
        {rows.map((r) => (
          <div key={r.line.id} data-guide="costing.award.row" style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
            <b style={{ overflowWrap: "anywhere" }}>{r.line.rows.length > 0 ? `${r.line.rows.join(" · ")} ` : ""}{r.line.description}</b>
            {!applyOnly && r.d && (
              <span style={{ color: c.muted }}>
                {supplier?.name} at {money(picks.find((p) => p.line.id === r.line.id)?.resp.unit_price, picks.find((p) => p.line.id === r.line.id)?.resp.currency)} per {r.line.uom ?? "unit"}
                {r.d.lowestValid !== null && <> · lowest valid {money(r.d.lowestValid, view.tenant_currency)}</>}
              </span>
            )}
            {needsMarkup && r.cost != null && markupN !== null && <span data-guide="costing.award.sum" style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{awardSum(r.cost, markupN)}</span>}
            {r.d?.notLowest && <span style={{ color: "var(--amberink)" }}>{r.d.why === "expired" ? "This answer has expired." : r.d.why === "stale" ? "This answer is stale." : "Not the lowest valid price."} A reason is needed.</span>}
            {r.replaces && !applyOnly && <span style={{ color: "var(--amberink)" }}>Replaces the award to {r.cur ? nameOf(r.cur.rfq_supplier_id) : "another supplier"}.</span>}
          </div>
        ))}
        {needsMarkup && (
          <Field label="Markup %" info={COSTING_TIPS.markup} guide="costing.award.markup" error={markupN === null ? "Enter 0 to 1000" : undefined}>
            <Input type="number" min={0} max={1000} step="0.01" inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} style={{ minHeight: 44 }} />
          </Field>
        )}
        {foreign && (
          <Field label={`Exchange rate to ${view.tenant_currency}`} info={COSTING_TIPS.fx} guide="costing.award.fx">
            <Input inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} placeholder="e.g. 3.64" style={{ minHeight: 44 }} />
          </Field>
        )}
        {needReason && (
          <Field label="Why this supplier?" info={COSTING_TIPS.reason} guide="costing.award.reason">
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </Field>
        )}
        {error && <div role="alert" style={{ color: "var(--redink)" }}>{error}</div>}
      </div>
    </SidePanel>
  );
}
