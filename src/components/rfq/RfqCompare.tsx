"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import InfoTip from "@/components/ui/InfoTip";
import { RFQ_SUPPLIER_STATUS_LABEL, type Rfq, type RfqLine, type RfqResponse, type RfqSupplier } from "@/lib/rfq/types";
import {
  awardDecision, buildComparison, type AwardView, type CompareCell, type CompareResponse, DEFAULT_STALE_DAYS, MIN_REASON_CHARS,
} from "@/lib/rfq/comparison";
import { RFQ_TIPS } from "@/lib/rfq/tips";
import { quoteLabel, QUOTE_ORIGIN_TYPES } from "@/lib/rfq/linking";
import { SUPPLIER_STATUS_TONE, inp, lbl, btnPrimary, btnGhost, fmtDate, fmtMoney } from "./rfqUi";
import RfqModal from "./RfqModal";

// "Compare & award" (GCC tender deals, slice 3b): one row per RFQ line, one column per supplier, the lowest VALID price marked,
// expired or stale answers in amber, each supplier's total and "covers N of M lines", unanswered suppliers as waiting with the
// next chase date, and an award that records who chose and why when the price is not the lowest valid one. The rules live in
// src/lib/rfq/comparison.ts (pure, tested); the server re-checks every one of them, so nothing here is trusted.

export type CompareSupplierRow = RfqSupplier & { suppliers: { id: string; ref: string | null; name: string; email: string | null; phone: string | null } | null };

export type CompareBundle<S extends CompareSupplierRow = CompareSupplierRow> = {
  rfq: Rfq;
  lines: RfqLine[];
  suppliers: S[];
  responses: RfqResponse[];
  products: { id: string; ref: string | null; name: string }[];
  origin_href: string | null;
  tenant_currency: string;
  used_on?: Record<string, { sl_no: string | null; description: string }>;
  awards?: AwardView[];
  awards_pending?: boolean;
  today?: string;
  stale_days?: number;
  max_reminders?: number;
  /** A tender RFQ is awarded only on the deal's Costing tab (it also prices the BOQ row): where that is. Absent = award here as usual. */
  costing_href?: string | null;
};

type Call = (url: string, init?: RequestInit) => Promise<Record<string, unknown>>;
type Run = (fn: () => Promise<string | void>) => void;

const CSS = `
.rfq-cmp-scroll { overflow-x: auto; max-width: 100%; }
.rfq-cmp-first { min-width: 240px; }
@media (min-width: 901px) { .rfq-cmp-first { position: sticky; left: 0; z-index: 1; } }
@media (max-width: 900px) {
  .rfq-cmp-first { min-width: 160px; }
  .rfq-cmp button, .rfq-cmp a.rfq-tap { min-height: 44px; }
}
`;

const amber: React.CSSProperties = { color: "var(--amberink)" };
const timeOf = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export default function RfqCompare<S extends CompareSupplierRow>({ b, canEdit, id, call, run, onKeyIn, onAddSupplier, onDone }: {
  b: CompareBundle<S>;
  canEdit: boolean;
  id: string;
  call: Call;
  run: Run;
  onKeyIn: (s: S) => void;
  onAddSupplier: () => void;
  onDone: (message: string, warning?: string) => void;
}) {
  const today = b.today ?? new Date().toISOString().slice(0, 10);
  const stale = b.stale_days ?? DEFAULT_STALE_DAYS;
  const sups = b.suppliers.filter((s) => s.status !== "cancelled");
  const lines = b.lines;
  const liveLines = lines.filter((l) => l.status !== "cancelled");
  const responses = b.responses as unknown as CompareResponse[];
  const cmp = useMemo(() => buildComparison({
    lines: liveLines.map((l) => ({ id: l.id, qty: l.qty })), suppliers: sups, responses, today, staleDays: stale,
    tenantCurrency: b.tenant_currency, respondBy: b.rfq.respond_by, maxReminders: b.max_reminders ?? 2,
  }), [liveLines, sups, responses, today, stale, b.tenant_currency, b.rfq.respond_by, b.max_reminders]);
  const awardOf = useMemo(() => new Map((b.awards ?? []).map((a) => [a.rfq_line_id, a])), [b.awards]);
  const [dialog, setDialog] = useState<null | { line: RfqLine; resp: RfqResponse; supplier: S } | { all: S }>(null);
  const productOf = (pid: string | null) => b.products.find((p) => p.id === pid);
  const canAward = canEdit && b.rfq.status !== "draft" && !b.awards_pending && !b.costing_href;

  if (!sups.length) {
    return (
      <div style={{ ...cardStyle, textAlign: "center", padding: 36, color: c.hint }}>
        No suppliers on this RFQ yet.
        {canEdit && <div style={{ marginTop: 12 }}><button type="button" style={btnPrimary} onClick={onAddSupplier}>Add suppliers</button></div>}
      </div>
    );
  }

  const cellTh: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontSize: 11.5, color: c.hint, fontWeight: 700, background: c.panel2, borderBottom: `1px solid ${c.line}`, verticalAlign: "bottom", minWidth: 180 };

  return (
    <div className="rfq-cmp" data-guide="rfq.compare" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{CSS}</style>
      {b.costing_href && canEdit && (
        <div data-guide="rfq.award.in_costing" style={{ ...cardStyle, fontSize: 13, color: c.ink }}>
          This RFQ belongs to a tender. Award it on the tender&apos;s <Link href={b.costing_href} style={{ color: c.accent }}>Costing tab</Link>, where the price also goes onto the BOQ row.
        </div>
      )}
      {b.awards_pending && canEdit && (
        <div role="alert" data-guide="rfq.award.pending" style={{ ...cardStyle, ...amber, background: "var(--amberbg)", fontSize: 13 }}>
          Awarding needs a database update (migration 0224). The comparison below works; ask your administrator to apply it.
        </div>
      )}
      <div data-guide="rfq.compare.legend" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: c.muted }}>
        <Pill label="Lowest valid" tone="blue" />
        <Pill label="Expired or stale" tone="amber" />
        <Pill label="Awarded" tone="green" />
        <InfoTip label="the comparison">{RFQ_TIPS.compare}</InfoTip>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        <div className="rfq-cmp-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th className="rfq-cmp-first" style={{ ...cellTh, minWidth: undefined }}>Item</th>
                {sups.map((s, i) => {
                  const col = cmp.columns[i];
                  const hasQuote = col.cover.quoted > 0;
                  return (
                    <th key={s.id} style={cellTh} data-guide={`rfq.compare.supplier.${i + 1}`}>
                      <div style={{ color: c.ink, fontSize: 13, textTransform: "none" }}>{s.suppliers?.name}</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap", fontWeight: 500 }}>
                        <Pill label={col.waiting ? "Waiting" : col.notSent ? "Not sent" : RFQ_SUPPLIER_STATUS_LABEL[s.status]} tone={col.waiting ? "amber" : SUPPLIER_STATUS_TONE[s.status]} />
                        {s.currency && <span style={{ color: c.hint }}>{s.currency}</span>}
                        {s.incoterm && <span style={{ color: c.hint }}>{s.incoterm}</span>}
                      </div>
                      {col.waiting && (
                        <div style={{ marginTop: 4, fontWeight: 500, textTransform: "none", ...(col.chase?.overdue ? amber : { color: c.hint }) }}>
                          {col.chase?.date ? (col.chase.overdue ? `Overdue since ${fmtDate(col.chase.date)}: chase now` : `Next reminder ${fmtDate(col.chase.date)}`) : "No reminder due"}
                        </div>
                      )}
                      {hasQuote && (
                        <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", textTransform: "none", fontWeight: 600 }}>
                          <Pill label={`Covers ${col.cover.quoted} of ${col.cover.total} line${col.cover.total === 1 ? "" : "s"}`} tone={col.cover.quoted === col.cover.total ? "green" : "amber"} />
                          <span style={{ color: c.ink, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(col.total, b.tenant_currency)}</span>
                          <InfoTip label="coverage and total">{RFQ_TIPS.coverage}</InfoTip>
                        </div>
                      )}
                      {col.waiting && <span style={{ display: "inline-block", marginTop: 4 }}><InfoTip label="waiting">{RFQ_TIPS.waiting}</InfoTip></span>}
                      {canEdit && (
                        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                          <button type="button" data-guide="rfq.compare.enter_reply" style={{ ...btnGhost, padding: "3px 8px", fontSize: 11.5 }} onClick={() => onKeyIn(s)}>Enter reply</button>
                          {canAward && hasQuote && (
                            <button type="button" data-guide="rfq.compare.award_all" style={{ ...btnGhost, padding: "3px 8px", fontSize: 11.5 }} onClick={() => setDialog({ all: s })}>Award all</button>
                          )}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const prod = productOf(l.product_id);
                const award = awardOf.get(l.id);
                const awardedTo = award ? sups.find((s) => s.id === award.rfq_supplier_id)?.suppliers?.name ?? "a supplier" : null;
                return (
                  <tr key={l.id} style={{ borderBottom: `1px solid ${c.line}`, opacity: l.status === "cancelled" ? 0.45 : 1 }}>
                    <td className="rfq-cmp-first" style={{ padding: "10px 12px", verticalAlign: "top", background: c.panel }}>
                      <div style={{ fontWeight: 600, color: c.ink }}>{l.sl_no}. {l.description}</div>
                      <div style={{ fontSize: 12, color: c.hint, marginTop: 2 }}>
                        {l.qty ?? ""} {l.uom ?? ""}
                        {prod
                          ? <> · <Link href={`/products/${prod.id}`} style={{ color: c.accent, textDecoration: "none" }}>{prod.name}{prod.ref ? ` (${prod.ref})` : ""}</Link></>
                          : " · free text"}
                      </div>
                      {b.used_on?.[l.id] && b.origin_href ? (
                        <div style={{ fontSize: 11.5, marginTop: 2 }}>
                          <Link href={b.origin_href} style={{ color: c.accent, textDecoration: "none" }}>{quoteLabel(b.rfq.origin_type, b.rfq.origin_label)} · line {b.used_on[l.id].sl_no ?? "—"}</Link>
                        </div>
                      ) : QUOTE_ORIGIN_TYPES.includes(b.rfq.origin_type) ? (
                        <div style={{ fontSize: 11.5, marginTop: 2, color: c.hint }}>Not linked to a line on the quote</div>
                      ) : null}
                      {l.status === "awarded" && (
                        <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
                          <span><Pill label={`Awarded · ${fmtMoney(l.awarded_unit_cost, b.tenant_currency)}`} tone="green" /></span>
                          {award && (
                            <span style={{ fontSize: 11.5, color: c.muted }}>
                              {awardedTo} · {award.chosen_by_name ?? "a team member"} · {timeOf(award.chosen_at)}
                            </span>
                          )}
                          {award?.not_lowest && (
                            <span style={{ fontSize: 11.5, ...amber }}>Not the lowest valid price: {award.reason}</span>
                          )}
                        </div>
                      )}
                      {l.status === "no_award" && <div style={{ marginTop: 4 }}><Pill label="No award" tone="amber" /></div>}
                      {canAward && l.status !== "cancelled" && l.status !== "no_award" && l.status !== "awarded" && (
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                          <button type="button" data-guide="rfq.compare.no_award" style={{ ...btnGhost, padding: "2px 8px", fontSize: 11 }} onClick={() => run(async () => {
                            await call(`/api/rfqs/${id}/award`, json("POST", { line_id: l.id, response_id: null }));
                            return `Line ${l.sl_no} marked no award.`;
                          })}>No award</button>
                        </div>
                      )}
                    </td>
                    {sups.map((s) => {
                      const cell = cmp.cells.get(l.id)?.get(s.id);
                      if (!cell) return <td key={s.id} style={{ padding: "10px 12px", color: c.hint, verticalAlign: "top" }}>—</td>;
                      return (
                        <td key={s.id} style={{ padding: "10px 12px", verticalAlign: "top", background: cell.response.is_awarded ? "var(--greenbg)" : cell.lowestValid ? "var(--bluebg)" : undefined }}>
                          <Cell b={b} cell={cell} />
                          {!cell.response.is_awarded && cell.response.status !== "no_quote" && canAward && l.status !== "cancelled" && (
                            <button type="button" data-guide="rfq.compare.award" style={{ ...btnGhost, padding: "2px 8px", fontSize: 11, marginTop: 6 }}
                              onClick={() => setDialog({ line: l, resp: b.responses.find((r) => r.id === cell.response.id)!, supplier: s })}>Award</button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <DealPrices b={b} canEdit={canEdit} id={id} call={call} run={run} />

      {dialog && (
        <AwardDialog
          b={b} id={id} call={call} today={today} stale={stale}
          picks={"all" in dialog
            ? b.responses.filter((r) => r.rfq_supplier_id === dialog.all.id && r.status !== "no_quote" && r.unit_price !== null && lines.some((l) => l.id === r.rfq_line_id && l.status !== "cancelled")).map((r) => ({ line: lines.find((l) => l.id === r.rfq_line_id)!, resp: r }))
            : [{ line: dialog.line, resp: dialog.resp }]}
          supplier={"all" in dialog ? dialog.all : dialog.supplier}
          all={"all" in dialog}
          awards={awardOf}
          onClose={() => setDialog(null)}
          onDone={(m, w) => { setDialog(null); onDone(m, w); }}
        />
      )}
    </div>
  );
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function Cell({ b, cell }: { b: CompareBundle<CompareSupplierRow>; cell: CompareCell }) {
  const r = cell.response;
  const foreign = !!r.currency && r.currency !== b.tenant_currency;
  if (r.status === "no_quote") return <span style={{ color: c.hint }}>Can&apos;t quote</span>;
  const bad = cell.validity !== "ok";
  return (
    <>
      <div style={{ fontWeight: 700, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(r.unit_price, r.currency)}</div>
      {foreign && !cell.needsFx && r.fx_rate && r.fx_rate !== 1 && <div style={{ fontSize: 11.5, color: c.muted }}>≈ {fmtMoney(cell.landed, b.tenant_currency)}</div>}
      {cell.needsFx && <div style={{ fontSize: 11.5, ...amber }}>No exchange rate yet</div>}
      <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>
        {[r.lead_time_days != null ? `${r.lead_time_days} d lead` : null, r.moq != null ? `MOQ ${r.moq}` : null].filter(Boolean).join(" · ")}
      </div>
      <div style={{ fontSize: 11.5, marginTop: 2, ...(bad ? amber : { color: c.hint }) }}>
        {r.valid_until ? `${cell.validity === "expired" ? "Expired" : "Valid to"} ${fmtDate(r.valid_until)}` : cell.validity === "stale" ? "Stale: no validity date" : "No validity date"}
      </div>
      <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>Answered {cell.age}</div>
      {r.status === "alternative" && <div style={{ fontSize: 11.5, ...amber, marginTop: 2 }}>Alternative: {r.offered_description}</div>}
      {r.note && <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>{r.note}</div>}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
        {cell.lowestValid && !r.is_awarded && <Pill label="Lowest valid" tone="blue" />}
        {bad && <Pill label={cell.validity === "expired" ? "Expired" : "Stale"} tone="amber" />}
        {r.is_awarded && <Pill label="Awarded" tone="green" />}
      </div>
    </>
  );
}

// ── Award dialog ────────────────────────────────────────────────────────────

function AwardDialog({ b, id, call, today, stale, picks, supplier, all, awards, onClose, onDone }: {
  b: CompareBundle<CompareSupplierRow>; id: string; call: Call; today: string; stale: number;
  picks: { line: RfqLine; resp: RfqResponse }[];
  supplier: CompareSupplierRow; all: boolean; awards: Map<string, AwardView>;
  onClose: () => void; onDone: (m: string, warning?: string) => void;
}) {
  const foreign = picks.some((p) => !!p.resp.currency && p.resp.currency !== b.tenant_currency);
  const [fx, setFx] = useState(() => {
    const known = picks.find((p) => p.resp.fx_rate && p.resp.fx_rate !== 1)?.resp.fx_rate;
    return known ? String(known) : foreign ? "" : "";
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fxN = fx ? Number(fx) : null;
  const responses = b.responses as unknown as CompareResponse[];
  const rows = picks.map((p) => {
    const lineResponses = responses.filter((r) => r.rfq_line_id === p.line.id && b.suppliers.find((s) => s.id === r.rfq_supplier_id)?.status !== "cancelled");
    const d = awardDecision(p.resp.id, lineResponses, today, stale, fxN);
    const cur = awards.get(p.line.id);
    const replaces = !!cur || p.line.status === "awarded";
    return { ...p, d, cur, replaces };
  });
  const needReason = rows.some((r) => r.d.notLowest);
  const replacing = rows.filter((r) => r.replaces);
  const nameOf = (rsId: string) => b.suppliers.find((s) => s.id === rsId)?.suppliers?.name ?? "a supplier";
  const missingFx = foreign && !(fxN && fxN > 0);
  const ready = !busy && !missingFx && (!needReason || reason.trim().length >= MIN_REASON_CHARS);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const common = { fx_rate: fx || null, reason: needReason ? reason.trim() : undefined, replace: replacing.length > 0 };
      const j = all
        ? await call(`/api/rfqs/${id}/award`, json("POST", { rfq_supplier_id: supplier.id, all: true, ...common }))
        : await call(`/api/rfqs/${id}/award`, json("POST", { line_id: rows[0].line.id, response_id: rows[0].resp.id, ...common }));
      const warning = (j.warning as string | undefined) ?? (j.results as { warning?: string }[] | undefined)?.find((x) => x.warning)?.warning;
      onDone(all ? `Awarded ${rows.length} line${rows.length === 1 ? "" : "s"} to ${supplier.suppliers?.name}.` : `Line ${rows[0].line.sl_no} awarded to ${supplier.suppliers?.name}.`, warning);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <RfqModal title={all ? `Award all lines to ${supplier.suppliers?.name ?? "supplier"}` : `Award line ${rows[0].line.sl_no}`} onClose={onClose} width={520}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13, color: c.ink }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.line.id} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px" }}>
              <div><strong>{r.line.sl_no}. {r.line.description}</strong></div>
              <div style={{ color: c.muted, marginTop: 2 }}>
                {supplier.suppliers?.name} at {fmtMoney(r.resp.unit_price, r.resp.currency)} per {r.line.uom ?? "unit"}
                {r.d.lowestValid !== null && <> · lowest valid {fmtMoney(r.d.lowestValid, b.tenant_currency)}</>}
              </div>
              {r.d.notLowest && (
                <div style={{ marginTop: 4, fontSize: 12.5, ...amber }}>
                  {r.d.why === "expired" ? "This answer has expired." : r.d.why === "stale" ? "This answer is stale." : "Not the lowest valid price."} A reason is needed.
                </div>
              )}
              {r.replaces && <div style={{ marginTop: 4, fontSize: 12.5, ...amber }}>Replaces the award to {r.cur ? nameOf(r.cur.rfq_supplier_id) : "another supplier"}.</div>}
            </div>
          ))}
        </div>
        {foreign && (
          <div>
            <label style={{ ...lbl, display: "flex", alignItems: "center", gap: 6 }} htmlFor="award-fx">Exchange rate to {b.tenant_currency} <InfoTip label="exchange rate">{RFQ_TIPS.fx}</InfoTip></label>
            <input id="award-fx" data-guide="rfq.award.fx" style={inp} inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} placeholder="e.g. 3.64" />
          </div>
        )}
        {needReason && (
          <div>
            <label style={{ ...lbl, display: "flex", alignItems: "center", gap: 6 }} htmlFor="award-reason">Why this supplier? <InfoTip label="the reason">{RFQ_TIPS.reason}</InfoTip></label>
            <textarea id="award-reason" data-guide="rfq.award.reason" rows={3} style={{ ...inp, resize: "vertical" }} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          </div>
        )}
        {error && <div role="alert" style={{ color: "var(--redink)" }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
          <InfoTip label="awarding">{all ? RFQ_TIPS.awardAll : replacing.length ? RFQ_TIPS.replace : RFQ_TIPS.award}</InfoTip>
          <button type="button" data-guide="rfq.award.cancel" style={btnGhost} onClick={onClose}>Cancel</button>
          <button type="button" data-guide="rfq.award.confirm" style={{ ...btnPrimary, opacity: ready ? 1 : 0.6 }} disabled={!ready} onClick={submit}>
            {busy ? "Awarding…" : replacing.length ? "Replace award" : "Award"}
          </button>
        </div>
      </div>
    </RfqModal>
  );
}

// ── Use the awarded prices on the deal ──────────────────────────────────────

function DealPrices({ b, canEdit, id, call, run }: { b: CompareBundle<CompareSupplierRow>; canEdit: boolean; id: string; call: Call; run: Run }) {
  const [open, setOpen] = useState(false);
  const awards = b.awards ?? [];
  if (b.rfq.origin_type !== "opportunity" || !awards.length || b.awards_pending || b.costing_href) return null;
  const pendingOnes = awards.filter((a) => !a.applied_to_deal_at);
  return (
    <div style={{ ...cardStyle, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
      <div style={{ fontSize: 13, color: c.ink, display: "flex", alignItems: "center", gap: 6 }}>
        {pendingOnes.length
          ? `${pendingOnes.length} awarded price${pendingOnes.length === 1 ? "" : "s"} not on the deal yet`
          : "The awarded prices are on the deal."}
        <InfoTip label="using the prices on the deal">{RFQ_TIPS.deal}</InfoTip>
      </div>
      {canEdit && pendingOnes.length > 0 && (
        <button type="button" data-guide="rfq.deal.apply" style={btnPrimary} onClick={() => setOpen(true)}>Use these prices on the deal lines</button>
      )}
      {open && (
        <RfqModal title="Use these prices on the deal lines" onClose={() => setOpen(false)} width={460}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13, color: c.ink }}>
            <div>Sets the rate of {pendingOnes.length} deal line{pendingOnes.length === 1 ? "" : "s"} to the awarded supplier price in {b.tenant_currency}, and records where each price came from.</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" style={btnGhost} onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" data-guide="rfq.deal.confirm" style={btnPrimary} onClick={() => { setOpen(false); run(async () => {
                const j = await call(`/api/rfqs/${id}/apply-to-deal`, { method: "POST" });
                return j.changed ? `${j.changed} deal line${j.changed === 1 ? "" : "s"} now carry the awarded price. Add your margin on the deal.` : "The deal lines already carry these prices.";
              }); }}>Use prices</button>
            </div>
          </div>
        </RfqModal>
      )}
    </div>
  );
}
