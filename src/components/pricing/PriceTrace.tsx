"use client";

import { c } from "@/lib/theme";

// The waterfall trace of one priced line -- the "why is my price X" view
// (spec §6, §1.3: explainability is an output). One component, mounted by
// the cockpit's Test & Trace tab today and by the quote line in batch 2, so
// the customer-facing explanation and the admin's never drift apart.

export type PriceTraceStep = {
  step: number; component?: string; subtotal?: string; status: string; reason?: string;
  rule_id?: string; matched_on?: Record<string, unknown>; specificity?: number;
  inputs?: { path: string; rate: number; qty: number }[]; basis?: number; value?: number; result?: number;
  statistical?: boolean; manual?: boolean;
};

const mono: React.CSSProperties = { fontFamily: "monospace", fontSize: 11.5 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, padding: "6px 8px", borderBottom: `1px solid ${c.line}` };
const td: React.CSSProperties = { fontSize: 12, color: c.ink, padding: "6px 8px", borderBottom: `1px solid ${c.line}`, verticalAlign: "top" };

export function TraceStatusChip({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    APPLIED: { bg: "var(--tealbg)", fg: "var(--tealink)" },
    EXCLUDED: { bg: "var(--amberbg)", fg: "var(--amberink)" },
    SKIPPED: { bg: c.panel2, fg: c.hint },
    SUBTOTAL: { bg: "var(--bluebg)", fg: "var(--blueink)" },
  };
  const s = map[status] ?? { bg: c.panel2, fg: c.muted };
  return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5, background: s.bg, color: s.fg, whiteSpace: "nowrap" }}>{status}</span>;
}

function describeMatch(matchedOn: Record<string, unknown> | undefined): string {
  const entries = Object.entries(matchedOn ?? {});
  if (entries.length === 0) return "everyone";
  return entries.map(([k, v]) => `${k} = ${String(v)}`).join(", ");
}

/** Plain-language one-liner for a step: what happened and why. */
export function describeTraceStep(t: PriceTraceStep): string {
  if (t.status === "SUBTOTAL") return `Subtotal ${t.subtotal}`;
  if (t.status === "APPLIED") {
    const who = t.manual ? "entered by hand" : `rule for ${describeMatch(t.matched_on)}`;
    return `${t.component}: ${who}${t.statistical ? " (shown, not charged)" : ""}`;
  }
  return `${t.component}: ${t.reason ?? t.status.toLowerCase()}`;
}

export default function PriceTrace({ steps, currency, compact = false }: { steps: PriceTraceStep[]; currency?: string | null; compact?: boolean }) {
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (compact) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {steps.map((t, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: t.status === "SUBTOTAL" ? c.ink : c.muted, fontWeight: t.status === "SUBTOTAL" ? 600 : 400 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{describeTraceStep(t)}</span>
            <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: (t.result ?? 0) < 0 ? "var(--err-ink)" : undefined }}>
              {t.result !== undefined ? fmt(t.result) : ""}
            </span>
          </div>
        ))}
        {currency && <div style={{ fontSize: 11, color: c.hint }}>Amounts in {currency}</div>}
      </div>
    );
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr><th style={th}>Step</th><th style={th}>Component</th><th style={th}>Status</th><th style={th}>Detail</th><th style={{ ...th, textAlign: "right" }}>Amount</th></tr></thead>
      <tbody>
        {steps.map((t, i) => (
          <tr key={i} style={t.status === "SUBTOTAL" ? { background: c.panel2 } : undefined}>
            <td style={td}>{t.step}</td>
            <td style={{ ...td, ...mono }}>{t.component ?? t.subtotal}</td>
            <td style={td}><TraceStatusChip status={t.status} />{t.manual ? " ✎" : ""}{t.statistical ? " (stat)" : ""}</td>
            <td style={{ ...td, fontSize: 11.5, color: c.muted }}>
              {t.reason && <div>{t.reason}</div>}
              {t.rule_id && <div>rule <span style={mono}>{t.rule_id.slice(0, 8)}</span>{t.specificity !== undefined ? ` · specificity ${t.specificity}` : ""}{t.matched_on && Object.keys(t.matched_on).length > 0 ? ` · ${describeMatch(t.matched_on)}` : ""}</div>}
              {t.inputs?.map((inp, j) => <div key={j} style={mono}>{inp.path}: {inp.rate} × {inp.qty}</div>)}
              {t.basis !== undefined && <div>basis {fmt(t.basis)}</div>}
            </td>
            <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: (t.result ?? 0) < 0 ? "var(--err-ink)" : c.ink }}>
              {t.result !== undefined ? fmt(t.result) : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
