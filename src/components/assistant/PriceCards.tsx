"use client";

import { useState } from "react";
import { c, pillar, statusInk } from "@/lib/theme";
import { formatMoney, type CurrencyDef } from "@/lib/currency";
import InfoTip from "@/components/ui/InfoTip";
import { InlineMarkdown } from "./Markdown";
import { PRICE_TIPS } from "@/lib/assistant/priceCompare/tips";
import type { AwardDone, AwardSettled, CompareCell, DockAward, DockPriceCheck, DockPriceCompare, PriceCard } from "@/lib/assistant/priceCompare/types";
import type { NextStep } from "@/lib/assistant/cards";
import { AwardCheckPanel, type AwardGate } from "@/components/suppliers/AwardCheckPanel";
import { gateBody, gateReady, type AwardCheck } from "@/lib/suppliers/check/awardGate";

// The three price cards of the dock (compare, award, check). Pure views of the fields the server worked out: nothing here adds, ranks or decides
// anything, and every string arrives as a React text node. The award card's one button is the only thing that writes, through POST /api/ai/award.

const box: React.CSSProperties = { border: `1px solid ${c.line}`, borderRadius: "var(--card-radius, 10px)", background: "var(--card-bg, #fff)", overflow: "hidden", fontSize: 12 };
const head: React.CSSProperties = { padding: "9px 12px", background: "var(--panel2)", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700 };
const section: React.CSSProperties = { padding: "10px 12px", borderTop: `1px solid ${c.line}`, display: "flex", flexDirection: "column", gap: 6 };
const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 };
const chip: React.CSSProperties = { background: "var(--accentbg)", border: `1px solid ${c.line}`, borderRadius: 999, padding: "6px 12px", fontSize: 11.5, fontWeight: 650, color: c.accent, cursor: "pointer", fontFamily: "inherit" };
const primary: React.CSSProperties = { borderRadius: "var(--card-radius, 10px)", padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: "var(--tenant-accent, #1e3a6e)", color: "var(--on-accent, #fff)", border: "none" };
const ghost: React.CSSProperties = { borderRadius: "var(--card-radius, 10px)", padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: "transparent", border: `1px solid ${c.line}`, color: c.muted };
const input: React.CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box", minHeight: 36, border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px", fontSize: 16, fontFamily: "inherit", color: "var(--ink)", background: "var(--card-bg, #fff)" };
const th: React.CSSProperties = { textAlign: "right", padding: "6px 6px", fontWeight: 650, color: c.muted, whiteSpace: "nowrap", verticalAlign: "bottom" };
const td: React.CSSProperties = { textAlign: "right", padding: "5px 6px", whiteSpace: "nowrap", borderTop: `1px solid ${c.line}` };
const sticky: React.CSSProperties = { position: "sticky", left: 0, background: "var(--card-bg, #fff)", textAlign: "left", maxWidth: 104, overflow: "hidden", textOverflow: "ellipsis" };

export type Money = (n: number) => string;
export const moneyFor = (cur: { symbol: string; locale: string; decimals: number }): Money =>
  (n) => formatMoney(n, cur as CurrencyDef, { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals });

const ROWS = 6;
const RISKS = 3;
const short = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Steps({ steps, onOpen, onAsk, busy }: { steps: NextStep[]; onOpen: (href: string) => void; onAsk: (q: string) => void; busy?: boolean }) {
  if (!steps.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {steps.map((s) => (
        <button
          key={s.id} type="button" className="bms-dock-chip" style={chip} disabled={busy} data-guide={`assistant.price.step.${s.id}`}
          onClick={() => (s.kind === "navigate" && s.target ? onOpen(s.target) : s.question ? onAsk(s.question) : undefined)}
        >{s.label}</button>
      ))}
    </div>
  );
}

function CellView({ cell, money }: { cell: CompareCell | null; money: Money }) {
  if (!cell) return <span style={{ color: c.hint }}>not quoted</span>;
  if (cell.unit === null) return <span style={{ color: c.hint }}>{cell.left === "no_fx" ? "no FX rate" : "no quote"}</span>;
  const old = cell.validity !== null && cell.validity !== "ok";
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.25 }}>
      <span style={{ fontWeight: cell.cheapest ? 800 : 500, padding: "1px 5px", borderRadius: 6, background: cell.cheapest ? pillar.green.bg : "transparent", color: cell.cheapest ? statusInk.good : old ? statusInk.warn : c.ink }}>
        {money(cell.unit)}
      </span>
      {(cell.outlier || old || cell.alternative) && (
        <span style={{ fontSize: 10.5, color: statusInk.warn }}>
          {cell.outlier ? `${cell.outlier.pct > 0 ? "▲" : "▼"} ${Math.abs(cell.outlier.pct)}%${cell.outlier.refStale ? " stale ref" : ""}` : ""}
          {cell.outlier && (old || cell.alternative) ? " · " : ""}
          {old ? (cell.validity === "expired" ? "expired" : "stale") : cell.alternative ? "alternative" : ""}
        </span>
      )}
    </span>
  );
}

export function CompareCardView({ card, onOpen, onAsk, busy }: { card: DockPriceCompare; onOpen: (href: string) => void; onAsk: (q: string) => void; busy?: boolean }) {
  const [allLines, setAllLines] = useState(false);
  const [allRisks, setAllRisks] = useState(false);
  const cmp = card.comparison;
  const money = moneyFor(card.currency);
  const lines = allLines ? cmp.lines : cmp.lines.slice(0, ROWS);
  const risks = allRisks ? cmp.risks : cmp.risks.slice(0, RISKS);
  const rec = cmp.recommendation ? cmp.suppliers[cmp.recommendation.index] : null;
  return (
    <section style={box} data-testid="price-compare" data-guide="assistant.price.compare">
      <div style={head}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cmp.rfq.ref} · {cmp.rfq.title}</span>
      </div>
      {card.notice && <div role="status" style={{ padding: "8px 12px 0", color: statusInk.warn }}>{card.notice}</div>}

      {rec && (
        <div style={{ ...section, borderTop: "none", background: pillar.green.bg }} data-guide="assistant.price.recommendation" data-by={card.recommendationBy}>
          <div style={{ fontWeight: 800, color: statusInk.good }}>Recommended: {rec.name} · {rec.score} of 100</div>
          <div style={{ color: c.ink, lineHeight: 1.4 }}><InlineMarkdown text={card.recommendationText} /></div>
        </div>
      )}

      <div style={{ ...section, flexDirection: "row", flexWrap: "wrap", gap: 12 }} data-guide="assistant.price.figures">
        {cmp.bestSingle && <Figure name="One supplier" value={money(cmp.bestSingle.total)} note={cmp.bestSingle.name} />}
        {cmp.split && (
          <Figure
            name="Split by line" value={money(cmp.split.total)}
            note={cmp.split.saving !== null && cmp.split.saving > 0 ? `saves ${money(cmp.split.saving)}${cmp.split.savingPct !== null ? ` · ${cmp.split.savingPct}%` : ""}` : `${cmp.split.suppliers} suppliers`}
          />
        )}
        {cmp.spread && <Figure name="Lowest to highest" value={`${cmp.spread.pct}%`} note={money(cmp.spread.amount)} />}
      </div>

      {cmp.suppliers.length > 0 && (
        <div style={{ ...section, padding: "6px 0 8px" }}>
          <div style={{ overflowX: "auto", maxWidth: "100%" }} data-guide="assistant.price.table">
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...th, ...sticky, paddingLeft: 12 }}>Item</th>
                  {cmp.suppliers.map((s) => (
                    <th key={s.id} style={{ ...th, color: s.recommended ? statusInk.good : c.muted }} title={s.name}>
                      {short(s.name)}<div style={{ fontSize: 10.5, fontWeight: 500, color: s.partial ? statusInk.warn : c.hint }}>{s.quoted}/{s.asked} lines</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td style={{ ...td, ...sticky, paddingLeft: 12 }} title={l.description}>
                      <strong>{l.item}</strong> <span style={{ color: c.hint }}>{short(l.description, 18)}</span>
                    </td>
                    {l.cells.map((cell, i) => <td key={cmp.suppliers[i].id} style={td}><CellView cell={cell} money={money} /></td>)}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...td, ...sticky, paddingLeft: 12, fontWeight: 700 }}>Total</td>
                  {cmp.suppliers.map((s) => <td key={s.id} style={{ ...td, fontWeight: 700 }}>{money(s.total)}</td>)}
                </tr>
                {cmp.commonLines > 0 && cmp.suppliers.length > 1 && (
                  <tr>
                    <td style={{ ...td, ...sticky, paddingLeft: 12, color: c.muted }}>Like for like <InfoTip label="totals">{PRICE_TIPS.basis}</InfoTip></td>
                    {cmp.suppliers.map((s) => <td key={s.id} style={{ ...td, color: c.muted }}>{s.likeForLike === null ? "—" : money(s.likeForLike)}</td>)}
                  </tr>
                )}
                <tr>
                  <td style={{ ...td, ...sticky, paddingLeft: 12, color: c.muted }}>Score <InfoTip label="the score">{PRICE_TIPS.score}</InfoTip></td>
                  {cmp.suppliers.map((s) => <td key={s.id} style={{ ...td, color: s.recommended ? statusInk.good : c.muted, fontWeight: s.recommended ? 800 : 500 }}>{s.score}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
          {cmp.lines.length > ROWS && (
            <div style={{ padding: "0 12px" }}>
              <button type="button" className="bms-dock-chip" style={chip} onClick={() => setAllLines((x) => !x)}>{allLines ? "Show fewer lines" : `Show all ${cmp.lines.length} lines`}</button>
            </div>
          )}
          <div style={{ padding: "0 12px", fontSize: 10.5, color: c.hint }}>
            Score out of 100: price {cmp.weights.price}, completeness {cmp.weights.completeness}, validity {cmp.weights.validity}, lead time {cmp.weights.lead}. Flag at {cmp.outlierPct}% from your own price.
          </div>
        </div>
      )}

      {cmp.risks.length > 0 && (
        <div style={section} data-guide="assistant.price.risks">
          <div style={label}>Watch out</div>
          <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
            {risks.map((r) => <li key={r.id} style={{ overflowWrap: "anywhere", color: r.level === "warn" ? statusInk.warn : c.muted }}>{r.text}</li>)}
          </ul>
          {cmp.risks.length > RISKS && (
            <button type="button" className="bms-dock-chip" style={{ ...chip, alignSelf: "flex-start" }} onClick={() => setAllRisks((x) => !x)}>{allRisks ? "Show fewer" : `Show all ${cmp.risks.length}`}</button>
          )}
        </div>
      )}

      <div style={section}><Steps steps={card.next} onOpen={onOpen} onAsk={onAsk} busy={busy} /></div>
    </section>
  );
}

function Figure({ name, value, note }: { name: string; value: string; note: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
      <span style={label}>{name}</span>
      <strong style={{ fontSize: 14 }}>{value}</strong>
      <span style={{ color: c.muted, overflowWrap: "anywhere" }}>{note}</span>
    </div>
  );
}

type Done = AwardDone;

export function AwardCardView({ card, onOpen, settled, onSettled }: { card: DockAward; onOpen: (href: string) => void; settled?: AwardSettled; onSettled?: (s: AwardSettled) => void }) {
  const [reason, setReason] = useState("");
  const [replace, setReplace] = useState(false);
  const [markup, setMarkup] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needReason, setNeedReason] = useState(card.needsReason);
  const [needReplace, setNeedReplace] = useState(card.needsReplace);
  const [dismissed, setDismissed] = useState(settled?.kind === "cancelled");
  const [allLines, setAllLines] = useState(false);
  const [done, setDone] = useState<Done | null>(settled?.kind === "awarded" ? settled.done : null);
  const finish = (d: Done) => { setDone(d); onSettled?.({ kind: "awarded", done: d }); };
  const cancel = () => { setDismissed(true); onSettled?.({ kind: "cancelled" }); };
  const [checks, setChecks] = useState<AwardCheck[]>(card.supplierChecks ?? []);
  const [checkReason, setCheckReason] = useState("");
  const [checkAck, setCheckAck] = useState(false);
  const gate: AwardGate = {
    checks, askedIds: [], loaded: true, reason: checkReason, setReason: setCheckReason, ack: checkAck, setAck: setCheckAck,
    ready: gateReady(checks, checkReason, checkAck), body: gateBody(checkReason, checkAck, checks.length > 0),
  };
  const money = moneyFor(card.currency);
  const lines = allLines ? card.lines : card.lines.slice(0, ROWS);
  const blocked = card.blocked;
  const reasonMissing = needReason && reason.trim().length < 3;
  const replaceMissing = needReplace && !replace;
  const locked = busy || !!blocked || reasonMissing || replaceMissing || !gate.ready;

  async function press() {
    if (locked) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/ai/award", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_id: card.id, token: card.token, plan: card.plan, reason: needReason ? reason.trim() : undefined, replace: replace || undefined, markup_pct: markup.trim() === "" ? undefined : markup.trim(), ...gate.body }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        finish({ awarded: json.awarded ?? 0, of: json.of ?? card.lines.length, partial: json.partial === true, error: json.error, stoppedAt: json.stopped_at, next: json.next ?? [], warnings: Array.isArray(json.warnings) ? json.warnings : [] });
        return;
      }
      if (res.status === 409 && json.code === "already_done") { finish({ awarded: json.result?.awarded ?? 0, of: json.result?.of ?? card.lines.length, next: [], warnings: [] }); return; }
      if (json.code === "reason_required") setNeedReason(true);
      if (json.code === "already_awarded") setNeedReplace(true);
      if (typeof json.code === "string" && json.code.startsWith("supplier_check") && Array.isArray(json.flagged)) {
        setChecks((json.flagged as { supplier_id: string; name: string; verdict: AwardCheck["verdict"]; findings: string[] }[]).map((f) => ({ supplierId: f.supplier_id, name: f.name, verdict: f.verdict, findings: f.findings ?? [], checkedAt: "" })));
      }
      setError(json.error ?? "Could not award it.");
    } catch {
      setError("Could not reach the server. Nothing was awarded; check before trying again.");
    } finally {
      setBusy(false);
    }
  }

  if (dismissed) return <div style={{ ...box, padding: "8px 12px", color: c.hint }}>Cancelled. Nothing was awarded.</div>;
  if (done) {
    return (
      <section style={{ ...box, padding: 12, display: "flex", flexDirection: "column", gap: 8 }} data-testid="award-done">
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{done.awarded === 0 ? "Nothing was awarded." : `Awarded ${done.awarded} of ${done.of} ${done.of === 1 ? "line" : "lines"} on ${card.rfq.ref}.`}</div>
        {done.partial && <div role="alert" style={{ color: statusInk.warn }}>It stopped at item {done.stoppedAt}: {done.error} The rest are not awarded; finish them on the compare screen.</div>}
        {done.warnings.map((w) => <div key={w} style={{ color: statusInk.warn }}>{w}</div>)}
        <Steps steps={done.next} onOpen={onOpen} onAsk={() => {}} />
      </section>
    );
  }

  return (
    <section style={box} data-testid="award-card" data-guide="assistant.price.award">
      <div style={head}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.title}</span></div>
      <div style={{ padding: "8px 12px 0", color: c.muted }}>{card.summary}</div>
      {blocked && <div role="alert" style={{ margin: "8px 12px 0", color: statusInk.bad }}>{blocked}</div>}
      {card.notices.map((n) => <div key={n} role="status" style={{ margin: "6px 12px 0", color: statusInk.warn }}>{n}</div>)}

      {card.lines.length > 0 && (
        <div style={{ padding: "8px 0 0" }}>
          <div style={{ overflowX: "auto", maxWidth: "100%" }} data-guide="assistant.price.award.lines">
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...th, ...sticky, paddingLeft: 12 }}>Item</th>
                  <th style={th}>Supplier</th>
                  <th style={th}>Cost</th>
                  {card.pricesRows && <th style={th}>Markup</th>}
                  {card.pricesRows && <th style={th}>Rate</th>}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.lineId}>
                    <td style={{ ...td, ...sticky, paddingLeft: 12 }} title={l.description}><strong>{l.item}</strong> <span style={{ color: c.hint }}>{short(l.description, 18)}</span></td>
                    <td style={{ ...td, color: c.muted }} title={l.supplier}>{short(l.supplier)}</td>
                    <td style={{ ...td, color: l.validity !== "ok" ? statusInk.warn : c.ink }}>{money(l.cost)}</td>
                    {card.pricesRows && <td style={{ ...td, color: c.muted }}>{l.markupPct === null ? "—" : `${l.markupPct}%`}</td>}
                    {card.pricesRows && <td style={{ ...td, fontWeight: 650 }}>{l.rate === null ? "—" : money(l.rate)}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td style={{ ...td, ...sticky, paddingLeft: 12, fontWeight: 700 }}>Cost of the lines</td><td style={td} /><td style={{ ...td, fontWeight: 700 }}>{money(card.total)}</td>{card.pricesRows && <td style={td} />}{card.pricesRows && <td style={td} />}</tr>
              </tfoot>
            </table>
          </div>
          {card.lines.length > ROWS && (
            <div style={{ padding: "6px 12px 0" }}>
              <button type="button" className="bms-dock-chip" style={chip} onClick={() => setAllLines((x) => !x)}>{allLines ? "Show fewer lines" : `Show all ${card.lines.length} lines`}</button>
            </div>
          )}
        </div>
      )}

      {card.markupNote && <div data-testid="award-markup-note" style={{ padding: "8px 12px 0", color: c.muted }}>{card.markupNote}</div>}

      {!blocked && (
        <div style={{ padding: "10px 12px 0", display: "flex", flexDirection: "column", gap: 8 }}>
          <AwardCheckPanel gate={gate} />
          {needReason && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontWeight: 600, color: c.muted }}>Reason <InfoTip label="the reason">{PRICE_TIPS.reason}</InfoTip></span>
              <textarea className="bms-card-input" rows={2} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} style={input} data-guide="assistant.price.award.reason" aria-label="Reason for awarding a price that is not the lowest valid one" />
            </label>
          )}
          {card.pricesRows && (
            <label style={{ display: "grid", gridTemplateColumns: "minmax(86px, 34%) 1fr", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 600, color: c.muted }}>Markup % <InfoTip label="the markup">{PRICE_TIPS.markup}</InfoTip></span>
              <input className="bms-card-input" type="number" inputMode="decimal" min={0} max={1000} step="0.01" value={markup} disabled={busy} placeholder={card.markupDefaultPct === null ? "" : `${card.markupDefaultPct}`} onChange={(e) => setMarkup(e.target.value)} style={input} data-guide="assistant.price.award.markup" aria-label="Markup percent" />
            </label>
          )}
          {needReplace && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 36 }}>
              <input type="checkbox" checked={replace} disabled={busy} onChange={(e) => setReplace(e.target.checked)} data-guide="assistant.price.award.replace" />
              <span>Replace the award that stands on these lines</span>
            </label>
          )}
        </div>
      )}

      {error && <div role="alert" style={{ padding: "8px 12px 0", color: statusInk.bad }}>{error}</div>}
      <div style={{ padding: "10px 12px 12px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="bms-dock-chip" onClick={press} disabled={locked} style={{ ...primary, opacity: locked ? 0.55 : 1 }} data-guide="assistant.price.award.press">
          {busy ? "Awarding…" : card.primaryLabel}
        </button>
        <button type="button" className="bms-dock-chip" onClick={cancel} disabled={busy} style={ghost}>Cancel</button>
        <button type="button" className="bms-dock-chip" onClick={() => onOpen(card.compareHref)} disabled={busy} style={chip}>Open the compare screen</button>
      </div>
      <style>{`@media (max-width: 899px) { .bms-card-input { min-height: 44px !important; } }`}</style>
    </section>
  );
}

export function CheckCardView({ card, onOpen }: { card: DockPriceCheck; onOpen: (href: string) => void }) {
  const money = moneyFor(card.currency);
  return (
    <section style={box} data-testid="price-check" data-guide="assistant.price.check">
      <div style={head}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.deal.ref} · {card.deal.title}</span></div>
      <div style={{ padding: "8px 12px 0", color: c.muted }}>
        {card.rows.length === 0 ? "No priced line differs from your own history by 1% or more." : "Lines furthest from your own prices"}
        {` · ${card.checked} checked${card.noReference ? `, ${card.noReference} with no history` : ""}`}
      </div>
      {card.rows.length > 0 && (
        <div style={{ padding: "6px 0 0" }}>
          <div style={{ overflowX: "auto", maxWidth: "100%" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
              <thead><tr><th style={{ ...th, ...sticky, paddingLeft: 12 }}>Item</th><th style={th}>Now</th><th style={th}>History</th><th style={th}>Gap</th></tr></thead>
              <tbody>
                {card.rows.map((r, i) => (
                  <tr key={`${r.item}:${i}`}>
                    <td style={{ ...td, ...sticky, paddingLeft: 12 }} title={`${r.description} · ${r.nearest}`}><strong>{r.item}</strong> <span style={{ color: c.hint }}>{short(r.description, 16)}</span></td>
                    <td style={td}>{money(r.current)}<div style={{ fontSize: 10.5, color: c.hint }}>{r.basis}{r.stale ? " · stale" : ""}</div></td>
                    <td style={td}>{money(r.reference)}<div style={{ fontSize: 10.5, color: c.hint }}>{r.referenceCount} {r.referenceCount === 1 ? "price" : "prices"}</div></td>
                    <td style={{ ...td, fontWeight: 700, color: Math.abs(r.pct) >= 25 ? statusInk.warn : c.ink }}>{r.pct > 0 ? "+" : ""}{r.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div style={section}>
        <Steps steps={card.next} onOpen={onOpen} onAsk={() => {}} />
      </div>
    </section>
  );
}

export default function PriceCardView({ card, onOpen, onAsk, busy, settled, onSettled }: { card: PriceCard; onOpen: (href: string) => void; onAsk: (q: string) => void; busy?: boolean; settled?: AwardSettled; onSettled?: (s: AwardSettled) => void }) {
  if (card.kind === "compare") return <CompareCardView card={card} onOpen={onOpen} onAsk={onAsk} busy={busy} />;
  if (card.kind === "award") return <AwardCardView card={card} onOpen={onOpen} settled={settled} onSettled={onSettled} />;
  return <CheckCardView card={card} onOpen={onOpen} />;
}
