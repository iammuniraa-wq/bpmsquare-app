"use client";

import { useCallback, useEffect, useState } from "react";
import { c, pillar } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Textarea } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import StatusPill from "@/components/ui/StatusPill";
import SettingsSection from "@/components/settings/SettingsSection";
import { ROUTES } from "@/lib/constants";
import { day, money } from "@/lib/contractProjects/format";
import { reloadAfterSave } from "@/components/tender/refreshAfterSave";
import { awardPackage, deletePackage, handoverUrl, markSent, packageUrl, sendRound, unawardPackage, type ApiResult } from "./api";
import { awardNeedsReason, currentRound, HANDOVER_LABEL, HANDOVER_TONE, orderRounds, overBudget, reasonOk, roundResult, STATUS_LABEL, STATUS_TONE } from "./rules";
import SendRequestForm from "./SendRequestForm";
import { BUYOUT_TIPS } from "./tips";
import { KIND_LABEL, type PackageDetail, type PackageRow, type PickerList, type Quote, type Round } from "./types";

// One package, in the shared SidePanel (a drawer on a desktop, a bottom sheet under 780 px): the lines with their cost in the bid, the quotes
// of the current round side by side, the rounds kept for audit, the budget bars and the handover. Every action goes through one runner that,
// after a success, re-reads this package and then tells the tab (which re-reads the list and refreshes the page), so the tiles, the chips
// and the table never go stale. The server decides again on every call.

export type Action =
  | { kind: "send" }
  | { kind: "award"; quote: Quote; rfqId: string }
  | { kind: "unaward" }
  | { kind: "delete" };

const card: React.CSSProperties = { border: `1px solid ${c.line}`, borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, padding: "7px 6px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "8px 6px", fontSize: 13, borderTop: `1px solid ${c.line}`, verticalAlign: "top" };

export default function PackagePanel({ projectId, row, currency, canEdit, groupName, onClose, onChanged, initialDetail, initialAction, initialPicker }: {
  projectId: string;
  /** The row the tab shows; it names the panel while the detail loads. */
  row: PackageRow;
  currency: string | null;
  canEdit: boolean;
  groupName: string | null;
  onClose: () => void;
  /** After any change the tab re-reads its list and refreshes the page. */
  onChanged: () => void;
  /** Let a server render (and its test) show the loaded panel. The page never passes them. */
  initialDetail?: PackageDetail;
  initialAction?: Action;
  initialPicker?: PickerList;
}) {
  const url = packageUrl(projectId, row.id);
  const [detail, setDetail] = useState<PackageDetail | null>(initialDetail ?? null);
  const [loadError, setLoadError] = useState("");
  const [action, setAction] = useState<Action | null>(initialAction ?? null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [erpRef, setErpRef] = useState("");

  const load = useCallback(async () => {
    const ok = await reloadAfterSave<PackageDetail>(url, setDetail);
    setLoadError(ok ? "" : "Could not load the package");
  }, [url]);
  useEffect(() => { if (!initialDetail) void load(); }, [initialDetail, load]);

  /** One runner for every action: call, and after a success re-read this package and tell the tab. */
  async function run(name: string, fn: () => Promise<ApiResult<unknown>>, opts: { gone?: boolean } = {}): Promise<boolean> {
    setError(""); setBusy(name);
    try {
      const r = await fn();
      if (!r.ok) { setError(r.json.error ?? "That did not work. Try again."); return false; }
      setAction(null); setReason("");
      if (opts.gone) { onChanged(); onClose(); return true; }
      await reloadAfterSave<PackageDetail>(url, setDetail, onChanged);
      return true;
    } finally { setBusy(""); }
  }

  // The request form shows its own error, so the top one stays for the rest.
  const bannerError = action?.kind === "send" ? loadError : error || loadError;
  const head = detail?.package;
  const status = head?.status ?? row.status;
  const awarded = status === "awarded" || status === "handed_over";
  const sent = (detail?.handover ?? row.handover).state === "sent";
  const editable = canEdit && !sent;
  const rounds = orderRounds(detail?.rounds ?? []);
  const cur = awarded ? rounds.find((r) => r.rfq_id === head?.awarded_rfq_id) ?? currentRound(rounds, head?.current_rfq_id ?? null) : currentRound(rounds, head?.current_rfq_id ?? null);
  const bars = detail?.budget_bars ?? { budget: row.budget, best_quote: row.best_quote, committed: row.committed };
  const over = overBudget(bars.committed ?? bars.best_quote, bars.budget);
  const winnerId = awarded ? head?.awarded_supplier_id ?? null : null;
  const subtitle = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span>{KIND_LABEL[head?.kind ?? row.kind]} package{(head?.ref ?? row.ref) ? ` · ${head?.ref ?? row.ref}` : ""}</span>
      <StatusPill label={STATUS_LABEL[status]} tone={STATUS_TONE[status]} />
    </span>
  );

  return (
    <SidePanel title={head?.name ?? row.name} subtitle={subtitle} label={`Package ${head?.name ?? row.name}`} onClose={onClose}>
      <div className="bpm-tap" data-guide="buyout.panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {bannerError && <div role="alert" data-guide="buyout.panel.error" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{bannerError}</div>}
        {!detail && !loadError && <div role="status" style={{ fontSize: 13, color: c.hint }}>Loading the package…</div>}

        {detail && (
          <>
            <SettingsSection id="buyout.panel.lines" title="Budget lines in this package" summary={`${detail.lines.length} line${detail.lines.length === 1 ? "" : "s"}`} defaultOpen>
              <LinesTable lines={detail.lines} currency={currency} />
            </SettingsSection>

            <SettingsSection id="buyout.panel.quotes" title={awarded ? "Awarded quote" : "Quotes in the current round"} info={BUYOUT_TIPS.quotes} summary={cur ? `${cur.quotes.filter((q) => q.total !== null).length} of ${cur.quotes.length} replied` : "No request sent yet"} defaultOpen>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {cur && cur.quotes.length > 0 ? (
                  <div data-guide="buyout.quotes" style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))" }}>
                    {cur.quotes.map((q) => (
                      <QuoteCard
                        key={q.supplier_id} quote={q} currency={currency} won={winnerId === q.supplier_id && cur.rfq_id === head?.awarded_rfq_id}
                        canAward={editable && !awarded && q.total !== null} onAward={() => { setError(""); setReason(""); setAction({ kind: "award", quote: q, rfqId: cur.rfq_id }); }}
                      />
                    ))}
                  </div>
                ) : (
                  <div role="status" data-guide="buyout.quotes.empty" style={{ fontSize: 13, color: c.muted }}>No request sent yet. Choose the suppliers and send one request for the whole package.</div>
                )}

                {action?.kind === "award" && (
                  <AwardConfirm
                    quote={action.quote} currency={currency} budget={bars.budget} busy={busy === "award"} reason={reason} onReason={setReason}
                    onConfirm={() => void run("award", () => awardPackage(projectId, row.id, { rfq_id: action.rfqId, supplier_id: action.quote.supplier_id, ...(reason.trim() ? { reason: reason.trim() } : {}) }))}
                    onCancel={() => { setAction(null); setReason(""); }}
                  />
                )}

                {awarded && head && (
                  <div data-guide="buyout.awarded" style={{ fontSize: 12.5, color: c.muted, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span>Awarded to <b style={{ color: c.ink }}>{head.awarded_supplier_name ?? cur?.quotes.find((q) => q.supplier_id === head.awarded_supplier_id)?.supplier_name ?? "the supplier"}</b>{head.committed_amount != null ? ` for ${money(head.committed_amount, currency)}` : ""}</span>
                    <span>{[head.awarded_by_name, head.awarded_at ? day(head.awarded_at) : null].filter(Boolean).join(" · ")}</span>
                    {head.award_reason && <span style={{ color: "var(--amberink)" }}>Not the lowest valid price: {head.award_reason}</span>}
                  </div>
                )}

                {editable && awarded && action?.kind !== "unaward" && (
                  <div><Button variant="secondary" style={{ minHeight: 44 }} data-guide="buyout.unaward.open" onClick={() => { setError(""); setReason(""); setAction({ kind: "unaward" }); }}>Un-award</Button><span style={{ marginLeft: 6 }}><InfoTip label="Un-award">{BUYOUT_TIPS.unaward}</InfoTip></span></div>
                )}
                {action?.kind === "unaward" && (
                  <div data-guide="buyout.unaward" style={card}>
                    <b style={{ fontSize: 13, color: c.ink }}>Un-award this package</b>
                    <Field label="Reason" required guide="buyout.unaward.reason" style={{ marginBottom: 0 }}><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button variant="danger" loading={busy === "unaward"} disabled={!!busy || !reasonOk(reason)} style={{ minHeight: 44 }} data-guide="buyout.unaward.confirm"
                        onClick={() => void run("unaward", () => unawardPackage(projectId, row.id, { reason: reason.trim() }))}>Un-award package</Button>
                      <Button variant="secondary" disabled={!!busy} style={{ minHeight: 44 }} data-guide="buyout.unaward.cancel" onClick={() => { setAction(null); setReason(""); }}>Cancel</Button>
                    </div>
                  </div>
                )}

                {editable && !awarded && action?.kind !== "send" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Button variant={rounds.length === 0 ? "primary" : "secondary"} style={{ minHeight: 44 }} data-guide="buyout.send.open" onClick={() => { setError(""); setAction({ kind: "send" }); }}>
                      {rounds.length === 0 ? "Send request" : "Send a new round"}
                    </Button>
                    <InfoTip label="Send request">{BUYOUT_TIPS.sendRequest}</InfoTip>
                  </div>
                )}
                {action?.kind === "send" && (
                  <SendRequestForm
                    projectId={projectId} packageId={row.id} groupName={groupName} nextRound={(rounds[0]?.round ?? 0) + 1} busy={busy === "send"} error={error} initialPicker={initialPicker}
                    onSend={(body) => void run("send", () => sendRound(projectId, row.id, body))} onCancel={() => { setAction(null); setError(""); }}
                  />
                )}
              </div>
            </SettingsSection>

            {rounds.length > 0 && (
              <SettingsSection id="buyout.panel.rounds" title="Rounds kept for audit" info={BUYOUT_TIPS.rounds} summary={`${rounds.length} round${rounds.length === 1 ? "" : "s"}`}>
                <RoundsTable rounds={rounds} currency={currency} />
              </SettingsSection>
            )}

            <SettingsSection id="buyout.panel.bars" title="Against the budget" info={BUYOUT_TIPS.bars} summary={`Budget ${money(bars.budget, currency)}`} defaultOpen>
              <div data-guide="buyout.bars" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Bar label="Budget" amount={bars.budget} scale={bars.budget} color={c.hint} currency={currency} />
                <Bar label="Best quote" amount={bars.best_quote} scale={bars.budget} color={pillar.blue.base} currency={currency} />
                <Bar label="Committed" amount={bars.committed} scale={bars.budget} color={pillar.teal.base} currency={currency} />
                {over > 0 && <div role="status" data-guide="buyout.over" style={{ fontSize: 12.5, color: "var(--amberink)" }}>{bars.committed != null ? "Committed" : "The best quote"} is over the budget by {money(over, currency)}. You can still award and hand over.</div>}
              </div>
            </SettingsSection>

            <SettingsSection id="buyout.panel.handover" title="Handover" info={BUYOUT_TIPS.handover} summary={HANDOVER_LABEL[detail.handover.state]} defaultOpen>
              <div data-guide="buyout.handover" style={card}>
                {!awarded ? (
                  <>
                    <div style={{ fontSize: 12.5, color: c.hint }}>Available after the package is awarded.</div>
                    <div><Button variant="secondary" disabled style={{ minHeight: 44 }} data-guide="buyout.handover.download">Download Excel</Button></div>
                  </>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <b style={{ fontSize: 13, color: c.ink, overflowWrap: "anywhere" }}>Handover for {head?.awarded_supplier_name ?? cur?.quotes.find((q) => q.supplier_id === head?.awarded_supplier_id)?.supplier_name ?? "the supplier"}</b>
                      <StatusPill label={detail.handover.state === "sent" ? "Marked as sent to ePROMIS" : "Ready to hand over"} tone={HANDOVER_TONE[detail.handover.state]} />
                    </div>
                    {detail.handover.state === "sent" && (
                      <div data-guide="buyout.handover.sent" style={{ fontSize: 12.5, color: c.muted }}>{[detail.handover.sent_at ? day(detail.handover.sent_at) : null, detail.handover.sent_by_name, detail.handover.erp_ref ? `ERP ${detail.handover.erp_ref}` : null].filter(Boolean).join(" · ")}</div>
                    )}
                    {canEdit && detail.handover.state !== "sent" && (
                      <Field label="ERP reference (optional)" info={BUYOUT_TIPS.erpRef} guide="buyout.handover.erp_ref" style={{ marginBottom: 0 }}>
                        <Input value={erpRef} onChange={(e) => setErpRef(e.target.value)} maxLength={80} />
                      </Field>
                    )}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button href={handoverUrl(projectId, row.id)} download variant="secondary" style={{ minHeight: 44 }} data-guide="buyout.handover.download">Download Excel</Button>
                      {canEdit && detail.handover.state !== "sent" && (
                        <Button variant="primary" loading={busy === "handover"} disabled={!!busy} style={{ minHeight: 44 }} data-guide="buyout.handover.mark_sent"
                          onClick={() => void run("handover", () => markSent(projectId, row.id, erpRef.trim() ? { erp_ref: erpRef.trim() } : {}))}>Mark as sent to ePROMIS</Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </SettingsSection>

            {canEdit && status === "draft" && rounds.length === 0 && (
              <div>
                {action?.kind === "delete" ? (
                  <div data-guide="buyout.delete" style={card}>
                    <b style={{ fontSize: 13, color: c.ink }}>Delete this package?</b>
                    <div style={{ fontSize: 12.5, color: c.muted }}>Its budget lines go back to the list of lines without a package.</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <Button variant="danger" loading={busy === "delete"} disabled={!!busy} style={{ minHeight: 44 }} data-guide="buyout.delete.confirm" onClick={() => void run("delete", () => deletePackage(projectId, row.id), { gone: true })}>Delete package</Button>
                      <Button variant="secondary" disabled={!!busy} style={{ minHeight: 44 }} data-guide="buyout.delete.cancel" onClick={() => setAction(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="quiet" style={{ minHeight: 44 }} data-guide="buyout.delete.open" onClick={() => { setError(""); setAction({ kind: "delete" }); }}>Delete package</Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </SidePanel>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function LinesTable({ lines, currency }: { lines: PackageDetail["lines"]; currency: string | null }) {
  const total = lines.reduce((s, l) => s + (l.cost_in_bid ?? 0), 0);
  const qty = (l: PackageDetail["lines"][number]) => (l.qty == null ? "" : `${l.qty}${l.uom ? ` ${l.uom}` : ""}`);
  return (
    <div data-guide="buyout.lines">
      <div className="bpm-rows-table" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Item</th><th style={th}>Description</th><th style={{ ...th, textAlign: "right" }}>Qty</th>
              <th style={{ ...th, textAlign: "right" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>Cost in bid <InfoTip label="Cost in bid">{BUYOUT_TIPS.costInBid}</InfoTip></span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={{ ...td, whiteSpace: "nowrap", color: c.muted }}>{l.item_no ?? "—"}</td>
                <td style={{ ...td, overflowWrap: "anywhere" }}>{l.description}</td>
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{qty(l) || "—"}</td>
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{money(l.cost_in_bid, currency)}</td>
              </tr>
            ))}
            <tr><td style={td} /><td style={{ ...td, fontWeight: 600 }}>Total</td><td style={td} /><td style={{ ...td, textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{money(total, currency)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="bpm-rows-cards" style={{ gap: 8 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: c.ink, overflowWrap: "anywhere" }}>{l.item_no ? `${l.item_no} · ` : ""}{l.description}</span>
            <span style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, color: c.muted }}>
              <span>{qty(l) || "—"}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>Cost in bid {money(l.cost_in_bid, currency)}</span>
            </span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, color: c.ink }}><span>Total</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{money(total, currency)}</span></div>
      </div>
    </div>
  );
}

export function QuoteCard({ quote: q, currency, won, canAward, onAward }: { quote: Quote; currency: string | null; won: boolean; canAward: boolean; onAward: () => void }) {
  const replied = q.total !== null;
  const bg = won ? pillar.green.bg : q.lowest_valid ? pillar.blue.bg : undefined;
  return (
    <div data-guide="buyout.quote" data-state={won ? "won" : q.lowest_valid ? "lowest" : "plain"} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 12px", minWidth: 0, background: bg, display: "flex", flexDirection: "column", gap: 4 }}>
      <b style={{ fontSize: 13, color: c.ink, overflowWrap: "anywhere" }}>{q.supplier_name}</b>
      <span style={{ fontSize: 17, fontWeight: 700, color: c.ink, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{replied ? money(q.total, currency) : "No reply yet"}</span>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: c.hint }}>
        {q.lead_days != null && <span>{q.lead_days} d lead</span>}
        {won && <StatusPill label="Awarded" tone="green" />}
        {!won && replied && q.lowest_valid && <StatusPill label="Lowest valid" tone="blue" />}
        {replied && !q.valid && <StatusPill label="Expired or stale" tone="amber" />}
      </span>
      {canAward && (
        <div><Button variant={q.lowest_valid ? "primary" : "secondary"} size="sm" style={{ minHeight: 44, width: "100%" }} data-guide="buyout.award.open" onClick={onAward}>Award package</Button></div>
      )}
    </div>
  );
}

function AwardConfirm({ quote, currency, budget, busy, reason, onReason, onConfirm, onCancel }: {
  quote: Quote; currency: string | null; budget: number; busy: boolean; reason: string; onReason: (v: string) => void; onConfirm: () => void; onCancel: () => void;
}) {
  const needReason = awardNeedsReason(quote);
  const over = overBudget(quote.total, budget);
  return (
    <div data-guide="buyout.award" role="group" aria-label="Confirm award" style={card}>
      <b style={{ fontSize: 13, color: c.ink, overflowWrap: "anywhere" }}>Award the package to {quote.supplier_name} for {money(quote.total, currency)}</b>
      {needReason && <div role="status" data-guide="buyout.award.not_lowest" style={{ fontSize: 12.5, color: "var(--amberink)" }}>{quote.valid ? "Not the lowest valid price." : "This answer has expired or is stale."} A reason is needed.</div>}
      {over > 0 && <div role="status" data-guide="buyout.award.over" style={{ fontSize: 12.5, color: "var(--amberink)" }}>This is over the package budget by {money(over, currency)}. You can still award it.</div>}
      {needReason && (
        <Field label="Why this supplier?" required info={BUYOUT_TIPS.award} guide="buyout.award.reason" style={{ marginBottom: 0 }}>
          <Textarea rows={2} value={reason} onChange={(e) => onReason(e.target.value)} maxLength={1000} />
        </Field>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button variant="primary" loading={busy} disabled={busy || (needReason && !reasonOk(reason))} style={{ minHeight: 44 }} data-guide="buyout.award.confirm" onClick={onConfirm}>Confirm award</Button>
        <Button variant="secondary" disabled={busy} style={{ minHeight: 44 }} data-guide="buyout.award.cancel" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function RoundsTable({ rounds, currency }: { rounds: Round[]; currency: string | null }) {
  const link = (r: Round) => <a href={ROUTES.rfq(r.rfq_id)} data-guide="buyout.round.link" style={{ display: "inline-flex", alignItems: "center", minHeight: 44, color: c.accent }}>{r.ref ?? "RFQ"}</a>;
  return (
    <div data-guide="buyout.rounds">
      <div className="bpm-rows-table" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>RFQ</th><th style={th}>Round</th><th style={th}>Sent</th><th style={th}>Result</th></tr></thead>
          <tbody>
            {rounds.map((r, i) => (
              <tr key={r.rfq_id}>
                <td style={td}>{link(r)}</td>
                <td style={td}>Round {r.round}{i === 0 ? " (current)" : ""}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{r.created_at ? day(r.created_at) : "—"}</td>
                <td style={td}>{roundResult(r, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bpm-rows-cards" style={{ gap: 8 }}>
        {rounds.map((r, i) => (
          <div key={r.rfq_id} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "6px 10px", display: "flex", flexDirection: "column" }}>
            <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>{link(r)}<span style={{ fontSize: 12, color: c.hint }}>Round {r.round}{i === 0 ? " (current)" : ""} · {r.created_at ? day(r.created_at) : "—"}</span></span>
            <span style={{ fontSize: 12.5, color: c.muted }}>{roundResult(r, currency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bar({ label, amount, scale, color, currency }: { label: string; amount: number | null; scale: number; color: string; currency: string | null }) {
  const pct = amount != null && scale > 0 ? Math.min(100, (amount / scale) * 100) : 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(70px, 100px) minmax(0, 1fr) auto", gap: 10, alignItems: "center", fontSize: 12.5, color: c.muted }}>
      <span>{label}</span>
      <div role="img" aria-label={`${label} ${amount != null ? money(amount, currency) : "none"}`} style={{ height: 10, borderRadius: 5, background: c.panel2, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: color }} /></div>
      <b style={{ color: c.ink, fontVariantNumeric: "tabular-nums" }}>{amount != null ? money(amount, currency) : "—"}</b>
    </div>
  );
}
