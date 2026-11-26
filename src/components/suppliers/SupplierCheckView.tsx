"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import { CHECK_TIPS } from "@/lib/suppliers/check/tips";
import { ratingText } from "@/lib/suppliers/check/rating";
import {
  FACT_LABEL, NOT_ENOUGH_HISTORY, RATING_MIN_RFQS, SENTIMENT_LABEL, type CheckHistoryItem, type FactKind, type Signal, type SignalSeverity, type SupplierCheckResult,
} from "@/lib/suppliers/check/types";
import { Stars, VerdictPill } from "./supplierCheckUi";

// The body of the Supplier check card: verdict, our rating, the market reputation and the findings, each section open or closed and
// remembered. Read-only; the card around it (SupplierCheckPanel) owns the buttons. Explanations sit behind the "i" (bpmsquarecore 6b).

export const CHECK_CSS = `
.sc-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 900px) { .sc-tiles { grid-template-columns: 1fr; } }
.sc-sec > summary { list-style: none; cursor: pointer; }
.sc-sec > summary::-webkit-details-marker { display: none; }
@media (max-width: 900px) { .sc-sec > summary, .sc-btn { min-height: 44px; } }
`;

const SEVERITY: Record<SignalSeverity, { label: string; tone: "red" | "amber" | "blue" | "purple" }> = {
  high: { label: "Serious", tone: "red" }, medium: { label: "Check", tone: "amber" }, low: { label: "Minor", tone: "blue" }, info: { label: "Note", tone: "purple" },
};

const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

function useRemembered(key: string, open: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(open);
  useEffect(() => {
    try { const s = window.localStorage.getItem(`sc:${key}`); if (s === "1" || s === "0") setV(s === "1"); } catch { /* the default stays */ }
  }, [key]);
  return [v, (next) => { setV(next); try { window.localStorage.setItem(`sc:${key}`, next ? "1" : "0"); } catch { /* not remembered */ } }];
}

function Section({ id, title, count, info, defaultOpen = false, children }: { id: string; title: string; count?: string; info?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useRemembered(id, defaultOpen);
  return (
    <details className="sc-sec" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} style={{ borderTop: `1px solid ${c.line}`, paddingTop: 8 }} data-guide={`supplier.check.${id}`}>
      <summary style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13, fontWeight: 700, color: c.ink }}>
        <span aria-hidden style={{ color: c.hint, fontSize: 11, width: 10 }}>{open ? "▾" : "▸"}</span>
        <span>{title}</span>
        {count && <span style={{ color: c.hint, fontWeight: 500, fontSize: 12 }}>{count}</span>}
        {info && <InfoTip label={title}>{info}</InfoTip>}
      </summary>
      <div style={{ padding: "6px 0 8px 18px" }}>{children}</div>
    </details>
  );
}

const Tile = ({ label, children, guide }: { label: string; children: React.ReactNode; guide: string }) => (
  <div data-guide={guide} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 12px", minWidth: 0 }}>
    <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
    {children}
  </div>
);

function SignalRow({ s }: { s: Signal }) {
  const sev = SEVERITY[s.severity];
  return (
    <li style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", fontSize: 13, color: c.ink }}>
      <span style={{ flexShrink: 0, marginTop: 1 }}><StatusPill label={sev.label} tone={sev.tone} /></span>
      <span style={{ minWidth: 0 }}>
        {s.text}
        {s.formatOnly && <span style={{ marginLeft: 4, verticalAlign: "middle" }}><InfoTip label="format only">{CHECK_TIPS.formatOnly}</InfoTip></span>}
        {s.with?.length ? (
          <span style={{ display: "block", fontSize: 12, color: c.muted, marginTop: 2 }}>
            {s.with.map((w, i) => <span key={w.id}>{i > 0 && ", "}<a href={ROUTES.supplier(w.id)} style={{ color: c.accent }}>{w.name}</a></span>)}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export default function SupplierCheckView({ result, history }: { result: SupplierCheckResult; history?: CheckHistoryItem[] }) {
  const { rating, reputation, findings } = result;
  const risks = findings.signals.filter((s) => s.severity !== "info");
  const notes = findings.signals.filter((s) => s.severity === "info");
  const facts = reputation.facts;
  const groups = [...new Set(facts.map((f) => f.kind))] as FactKind[];
  return (
    <div className="sc-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{CHECK_CSS}</style>
      <div data-guide="supplier.check.verdict" style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <VerdictPill verdict={result.verdict} />
        <InfoTip label="the verdict">{CHECK_TIPS.verdict}</InfoTip>
        <span style={{ flex: "1 1 260px", fontSize: 13.5, color: c.ink, minWidth: 0 }}>{result.verdictSentence}</span>
      </div>

      <div className="sc-tiles">
        <Tile label="Our rating" guide="supplier.check.rating">
          {rating.value !== null ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Stars value={rating.value} size={15} />
                <span style={{ fontSize: 18, fontWeight: 700, color: c.ink, fontVariantNumeric: "tabular-nums" }}>{ratingText(rating.value)}</span>
              </div>
              <span style={{ fontSize: 12, color: c.muted }}>from {rating.basis.rfqs} RFQs in {rating.basis.months} months</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>{NOT_ENOUGH_HISTORY}</span>
              <span style={{ fontSize: 12, color: c.muted }}>{rating.basis.rfqs} of {RATING_MIN_RFQS} RFQs needed</span>
            </div>
          )}
        </Tile>
        <Tile label="Market reputation" guide="supplier.check.reputation">
          {reputation.webUsed ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span><StatusPill label={SENTIMENT_LABEL[reputation.sentiment]} tone={reputation.sentiment === "positive" ? "green" : reputation.sentiment === "negative" ? "red" : reputation.sentiment === "mixed" ? "amber" : "blue"} /></span>
              <span style={{ fontSize: 12, color: c.muted }}>{reputation.sources.length} {reputation.sources.length === 1 ? "source" : "sources"}</span>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>Not researched</span>
              <span style={{ fontSize: 12, color: c.muted }}>Records only</span>
            </div>
          )}
        </Tile>
        <Tile label="Findings" guide="supplier.check.findings">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>{risks.length === 0 ? "None to check" : `${risks.length} to check`}</span>
            <span style={{ fontSize: 12, color: c.muted }}>{findings.positives.length} in its favour</span>
          </div>
        </Tile>
      </div>

      <Section id="findings" title="Findings" count={`${risks.length + notes.length + findings.positives.length}`} defaultOpen={risks.length > 0}>
        {risks.length + notes.length + findings.positives.length === 0 && <div style={{ fontSize: 13, color: c.muted }}>Nothing to report from your own records.</div>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {[...risks, ...notes].map((s) => <SignalRow key={s.id} s={s} />)}
          {findings.positives.map((p) => (
            <li key={p.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "5px 0", fontSize: 13, color: c.ink }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}><StatusPill label="In favour" tone="green" /></span>
              <span>{p.text}{p.formatOnly && <span style={{ marginLeft: 4, verticalAlign: "middle" }}><InfoTip label="format only">{CHECK_TIPS.formatOnly}</InfoTip></span>}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="rating" title="How the rating is worked out" count={`${rating.basis.rfqs} RFQs`} info={CHECK_TIPS.rating}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <tbody>
            {rating.basis.components.map((k) => (
              <tr key={k.id} style={{ borderBottom: `1px solid ${c.line}` }}>
                <td style={{ padding: "5px 0", color: c.ink }}>{k.label}<span style={{ color: c.hint }}> · {k.weight}%</span></td>
                <td style={{ padding: "5px 0 5px 8px", color: c.muted }}>{k.detail}</td>
                <td style={{ padding: "5px 0 5px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: c.ink, whiteSpace: "nowrap" }}>{k.score === null ? "—" : `${Math.round(k.score * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ margin: "8px 0 0", fontSize: 12, color: c.muted }}>{rating.basis.formula}</p>
      </Section>

      <Section id="reputation" title="Market reputation" count={reputation.webUsed ? `${reputation.sources.length} sources` : "not researched"} info={CHECK_TIPS.reputation} defaultOpen={reputation.webUsed}>
        <p style={{ margin: "0 0 8px", fontSize: 13, color: c.ink }}>{reputation.summary}</p>
        {reputation.note && <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--amberink)" }}>{reputation.note}</p>}
        {groups.map((k) => (
          <div key={k} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4 }}>{FACT_LABEL[k]}</div>
            <ul style={{ margin: "2px 0 0", paddingLeft: 16, fontSize: 13, color: c.ink }}>
              {facts.filter((f) => f.kind === k).map((f, i) => (
                <li key={i}>{f.text}{f.when ? <span style={{ color: c.hint }}> ({f.when})</span> : null} <sup style={{ color: c.hint }}>[{f.src}]</sup></li>
              ))}
            </ul>
          </div>
        ))}
        {reputation.sources.length > 0 && (
          <ol style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: c.muted }}>
            {reputation.sources.map((s, i) => <li key={i} style={{ wordBreak: "break-word" }}><a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: c.accent }}>{s.title}</a></li>)}
          </ol>
        )}
      </Section>

      {result.sharpen.length > 0 && (
        <Section id="sharpen" title="What would sharpen this result" count={`${result.sharpen.length}`} info={CHECK_TIPS.sharpen} defaultOpen>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: c.ink }}>{result.sharpen.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </Section>
      )}

      {history && history.length > 1 && (
        <Section id="history" title="History" count={`${history.length}`} info={CHECK_TIPS.history}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {history.map((h) => (
              <li key={h.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "4px 0", fontSize: 12.5, color: c.muted, flexWrap: "wrap" }}>
                <span style={{ minWidth: 92 }}>{fmtDate(h.checkedAt)}</span>
                <VerdictPill verdict={h.verdict} />
                <span>{h.rating === null ? NOT_ENOUGH_HISTORY : `rating ${ratingText(h.rating)}`}</span>
                <span>{h.webUsed ? "with web research" : "records only"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
