"use client";

import { useState } from "react";
import { c, statusInk } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import { COMPETITOR_PRICE_LABEL } from "@/lib/tender/competitors/rules";
import { COMPETITOR_CARD_TIPS } from "@/lib/assistant/competitors/tips";
import { moneyText, pctText } from "@/lib/assistant/competitors/format";
import type { CompetitorRow, DockCompetitors, LadderRow, Step } from "@/lib/assistant/competitors/types";

// The competitor analysis card as the dock draws it: who we expect to bid against and how we have fared against each, the margin
// ladder with its recommended range, the risks, and the next steps. Every figure arrives as a field the server computed; the
// model's two texts are drawn as plain text nodes, and the only links are internal paths handed to onOpen. Pure view: it decides nothing.

const ROWS_SHOWN = 3;

const chip: React.CSSProperties = {
  background: "var(--accentbg)", border: "1px solid var(--line)", borderRadius: 999, padding: "6px 12px", minHeight: 44,
  fontSize: 11.5, fontWeight: 650, color: c.accent, cursor: "pointer", fontFamily: "inherit",
};
const label: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 };
const section: React.CSSProperties = { padding: "10px 12px", borderTop: `1px solid ${c.line}`, display: "flex", flexDirection: "column", gap: 6 };
const plainBtn: React.CSSProperties = { background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left", color: "inherit" };

export function metTextOf(r: CompetitorRow): string {
  if (r.met === 0) return r.openElsewhere > 0 ? `Not met on a decided tender · on ${r.openElsewhere} open` : "Not met before";
  return `Met ${r.met} · beat us ${r.theyWon} · we won ${r.weWon}`;
}

export function expectedCell(r: LadderRow, currency: string | null): string {
  return r.expected !== null ? moneyText(r.expected, currency) : `${r.expectedPer100} per 100`;
}

function CompetitorLine({ r }: { r: CompetitorRow }) {
  return (
    <div data-guide="competitors.row" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "6px 0", borderBottom: `1px solid ${c.line}` }}>
      <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ color: c.ink, overflowWrap: "anywhere" }}>{r.name}</strong>
        {r.country && <span style={{ color: c.hint, fontSize: 11.5 }}>{r.country}</span>}
        {r.focus && <span style={{ fontSize: 10.5, fontWeight: 700, color: c.accent }}>Asked about</span>}
        {r.expectedPrice && <span style={{ fontSize: 11, color: c.muted }}>Expected: {COMPETITOR_PRICE_LABEL[r.expectedPrice]}</span>}
      </div>
      <div style={{ color: r.theyWon > 0 ? statusInk.bad : c.muted, fontSize: 12 }}>
        {metTextOf(r)}
        {r.typicalGapPct !== null && <span style={{ color: c.muted }}>{` · usually ${pctText(Math.abs(r.typicalGapPct))} ${r.typicalGapPct >= 0 ? "above" : "below"} their price`}</span>}
      </div>
      {r.web.line && (
        <div style={{ color: c.muted, fontSize: 12, overflowWrap: "anywhere" }}>
          {r.web.line}
          <span style={{ color: c.hint }}>{` · web, ${r.web.sources} ${r.web.sources === 1 ? "source" : "sources"}`}</span>
        </div>
      )}
    </div>
  );
}

function LadderLine({ r, currency }: { r: LadderRow; currency: string | null }) {
  return (
    <div
      data-guide="competitors.ladder.row"
      style={{
        display: "grid", gridTemplateColumns: "42px minmax(0, 1fr) 82px", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 6,
        background: r.recommended ? "var(--accentbg)" : "transparent", fontWeight: r.recommended ? 650 : 400,
      }}
    >
      <span style={{ color: c.ink }}>{r.marginPct}%{r.current && <span title="Where your price stands now" style={{ color: c.accent, marginLeft: 2 }}>•</span>}</span>
      <span style={{ position: "relative", height: 16, borderRadius: 4, background: "var(--panel2)", overflow: "hidden" }} role="img" aria-label={`Chance of winning ${pctText(r.winPct)}`}>
        <span style={{ position: "absolute", inset: 0, width: `${Math.max(2, Math.min(100, r.winPct))}%`, background: c.accent, opacity: r.recommended ? 0.9 : 0.45 }} />
        <span style={{ position: "relative", paddingLeft: 6, fontSize: 11, lineHeight: "16px", color: c.ink }}>{pctText(r.winPct)}</span>
      </span>
      <span style={{ textAlign: "right", color: c.ink, fontSize: 12 }}>{expectedCell(r, currency)}</span>
    </div>
  );
}

export default function CompetitorCardView({ data, busy = false, onOpen, onAsk }: {
  data: DockCompetitors;
  busy?: boolean;
  onOpen: (href: string) => void;
  onAsk: (question: string) => void;
}) {
  const [allCompetitors, setAllCompetitors] = useState(false);
  const [sharpen, setSharpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const d = data.deal;
  const l = data.ladder;
  const h = data.history;
  const shown = allCompetitors ? data.competitors : data.competitors.slice(0, ROWS_SHOWN);
  const perCost = l.rows.every((r) => r.expected === null);

  const run = (s: Step) => {
    if (s.kind === "navigate" && s.target) onOpen(s.target);
    else if (s.kind === "ask" && s.question) onAsk(s.question);
    else if (s.kind === "add") setAdding((x) => !x);
  };
  const submitAdd = () => {
    const n = name.trim();
    if (!n || busy) return;
    onAsk(`Add competitor ${n} to ${d.ref}`);
    setName(""); setAdding(false);
  };

  return (
    <section aria-label={`Competitor analysis: ${d.ref}`} data-guide="competitors.card" style={{ border: `1px solid ${c.line}`, borderRadius: "var(--card-radius, 10px)", background: "var(--card-bg, #fff)", overflow: "hidden", fontSize: 12.5, lineHeight: 1.4 }}>
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: c.ink, overflowWrap: "anywhere" }}>Competitors · {d.ref}</div>
        <div style={{ fontSize: 11.5, color: c.muted, overflowWrap: "anywhere" }}>
          {[
            d.title,
            d.daysLeft === null ? null : d.daysLeft >= 0 ? `bid ends in ${d.daysLeft} ${d.daysLeft === 1 ? "day" : "days"}` : `bid end date passed`,
            d.price !== null ? `price ${moneyText(d.price, d.currency)}` : null,
            d.marginPct !== null ? `margin ${pctText(d.marginPct)}` : null,
          ].filter(Boolean).join(" · ")}
        </div>
      </div>

      <div style={{ ...section, gap: 4 }}>
        <div style={{ color: c.ink, overflowWrap: "anywhere" }}>{data.summary}</div>
        <div style={label}>How to position</div>
        <div style={{ color: c.ink, overflowWrap: "anywhere" }}>{data.position}</div>
      </div>

      <div style={section} data-guide="competitors.list">
        <div style={label}>Who you are up against</div>
        {data.competitors.length === 0 ? (
          <div style={{ color: statusInk.warn }}>No competitors are recorded on this tender yet.</div>
        ) : (
          <>
            <div>{shown.map((r) => <CompetitorLine key={r.name} r={r} />)}</div>
            {data.competitors.length > ROWS_SHOWN && (
              <button type="button" className="bms-dock-chip" style={{ ...chip, alignSelf: "flex-start" }} onClick={() => setAllCompetitors((x) => !x)}>
                {allCompetitors ? "Show fewer" : `Show all ${data.competitors.length}`}
              </button>
            )}
          </>
        )}
        {h.decided > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: c.muted, fontSize: 12 }}>
            <span>
              {`Your record: won ${h.wins} of ${h.decided} decided`}
              {h.avgMarginWinPct !== null && h.avgMarginLossPct !== null ? ` · margin on wins ${pctText(h.avgMarginWinPct)}, on losses ${pctText(h.avgMarginLossPct)}` : ""}
            </span>
            <InfoTip label="your record">{COMPETITOR_CARD_TIPS.history}</InfoTip>
          </div>
        )}
        {h.bands && (
          <div style={{ color: c.muted, fontSize: 12 }}>
            {h.bands.map((b) => `${b.label}: won ${b.wins} of ${b.decided}${b.current ? " (this tender)" : ""}`).join(" · ")}
          </div>
        )}
      </div>

      <div style={section} data-guide="competitors.ladder">
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={label}>Margin ladder</span>
          <InfoTip label="the margin ladder">{COMPETITOR_CARD_TIPS.ladder}</InfoTip>
          <span style={{ fontSize: 11, fontWeight: 650, padding: "2px 8px", borderRadius: 999, border: `1px solid ${c.line}`, color: l.basis === "history" ? statusInk.good : statusInk.warn }}>
            {l.basis === "history" ? `From your history · ${l.sample} bids` : "Starting assumption"}
          </span>
        </div>
        {l.basis === "prior" && <div role="status" style={{ color: statusInk.warn, fontSize: 12 }}>{l.note}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "42px minmax(0, 1fr) 82px", gap: 8, padding: "0 6px", fontSize: 10.5, fontWeight: 700, color: c.hint }}>
          <span>Margin</span>
          <span>Chance of winning</span>
          <span style={{ textAlign: "right", display: "inline-flex", justifyContent: "flex-end", alignItems: "center", gap: 2 }}>
            {perCost ? "Profit" : "Expected"}
            <InfoTip label="expected profit">{COMPETITOR_CARD_TIPS.expected}</InfoTip>
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {l.rows.map((r) => <LadderLine key={r.marginPct} r={r} currency={d.currency} />)}
        </div>
        {l.recommended && (
          <div style={{ color: c.ink }} data-guide="competitors.recommended">
            <strong>{`Aim for ${l.recommended.fromPct}% to ${l.recommended.toPct}%.`}</strong>{` ${l.recommended.reason}`}
          </div>
        )}
        {d.marginPct !== null && <div style={{ color: c.hint, fontSize: 11.5 }}>• marks where your price stands now ({pctText(d.marginPct)}).</div>}
      </div>

      {data.risks.length > 0 && (
        <div style={section} data-guide="competitors.risks">
          <div style={label}>Worth knowing</div>
          <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }}>
            {data.risks.map((k) => <li key={k.id} style={{ overflowWrap: "anywhere", color: k.level === "warn" ? statusInk.warn : c.muted }}>{k.text}</li>)}
          </ul>
          {data.sharpen.length > 0 && (
            <>
              <button type="button" className="bms-dock-row" aria-expanded={sharpen} onClick={() => setSharpen((x) => !x)} style={{ ...plainBtn, fontSize: 12, color: c.accent, fontWeight: 650 }}>
                What would sharpen this {sharpen ? "▴" : "▾"}
              </button>
              {sharpen && (
                <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3 }}>
                  {data.sharpen.map((s) => <li key={s} style={{ overflowWrap: "anywhere", color: c.muted }}>{s}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {data.steps.length > 0 && (
        <div style={section}>
          <div style={label}>Next steps</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {data.steps.map((s) => (
              <button key={s.id} type="button" className="bms-dock-chip" data-guide={`competitors.step.${s.id}`} style={chip} disabled={busy} onClick={() => run(s)}>{s.label}</button>
            ))}
          </div>
          {adding && (
            <div style={{ display: "flex", gap: 6 }}>
              <input
                aria-label="Competitor name" value={name} maxLength={200} placeholder="Company name" onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitAdd(); }}
                style={{ flex: 1, minWidth: 0, boxSizing: "border-box", minHeight: 44, border: `1px solid ${c.line}`, borderRadius: 8, padding: "6px 10px", fontSize: 16, fontFamily: "inherit", color: c.ink, background: "var(--card-bg, #fff)" }}
              />
              <button type="button" className="bms-dock-chip" data-guide="competitors.add.send" style={{ ...chip, minHeight: 44 }} disabled={busy || !name.trim()} onClick={submitAdd}>Add</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
