"use client";

import { c } from "@/lib/theme";

// The waterfall trace of one priced line -- the "why is my price X" view
// (spec §6, §1.3: explainability is an output). One component, mounted by
// the cockpit's Test & Trace tab today and by the quote line in batch 2, so
// the customer-facing explanation and the admin's never drift apart.

export type PriceTraceStep = {
  step: number; component?: string; subtotal?: string; status: string; reason?: string;
  rule_id?: string; matched_on?: Record<string, unknown>; specificity?: number;
  inputs?: { path: string; rate: number; qty: number; source?: string | null; quality?: string | null; as_of?: string | null }[];
  calc_type?: string;
  basis?: number; value?: number; qty?: number; result?: number;
  formula?: string; values_used?: { path: string; value: string | number | boolean }[];
  statistical?: boolean; manual?: boolean;
};

// Where a cost figure came from, in the words the setup ladder uses -- the
// rep sees the same names the admin configured.
const SOURCE_LABEL: Record<string, string> = {
  PRODUCT_COST: "ERP cost price on the product",
  RFQ: "supplier RFQ reply",
  PRICE_LIST: "imported cost price list",
  MANUAL: "rate kept by hand",
};

/** "supplier RFQ reply, confirmed, as of 2026-09-06" -- empty when the
 *  input carries no provenance (a plain cost-model rate). */
export function describeCostSource(inp: { source?: string | null; quality?: string | null; as_of?: string | null }): string {
  if (!inp.source) return "";
  const parts = [SOURCE_LABEL[inp.source] ?? inp.source];
  if (inp.quality) parts.push(inp.quality);
  if (inp.as_of) parts.push(`as of ${inp.as_of}`);
  return parts.join(", ");
}

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

function fmtNum(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Substitute each ctx path the formula actually read with its resolved
 *  value -- "610 * ctx.line.quantity" + quantity=500 -> "610 x 500". Purely
 *  a display concern (the engine hands back the raw formula + the reads it
 *  made); word-boundary regex is safe because path segments are a
 *  restricted identifier charset (dsl/parser.ts rejects dunder segments). */
function substituteFormula(formula: string, valuesUsed: { path: string; value: string | number | boolean }[] | undefined): string {
  let out = formula;
  for (const { path, value } of valuesUsed ?? []) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const shown = typeof value === "number" ? fmtNum(value) : String(value);
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "g"), shown);
  }
  return out.replace(/\*/g, "×").replace(/\//g, "÷");
}

/** The "show your work" line for a step -- the actual rate/formula and the
 *  values it ran on, not just which rule matched. Null when there's nothing
 *  more concrete to add (a flat FIXED_AMOUNT rule, a manual override, scale
 *  tables). This is what "trace_detail" (TenantConfig.pricing) gates. */
function describeCalcDetail(t: PriceTraceStep): string | null {
  if (t.formula) {
    const shown = substituteFormula(t.formula, t.values_used);
    return t.result !== undefined ? `${shown} = ${fmtNum(t.result)}` : shown;
  }
  if (t.calc_type === "PERCENT" && t.value !== undefined && t.basis !== undefined) {
    return `${fmtNum(t.value)}% × ${fmtNum(t.basis)} = ${fmtNum(t.result ?? 0)}`;
  }
  if (t.calc_type === "PER_UNIT" && t.value !== undefined && t.qty !== undefined) {
    return `${fmtNum(t.value)} × ${fmtNum(t.qty)} = ${fmtNum(t.result ?? 0)}`;
  }
  return null;
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

export default function PriceTrace({
  steps, currency, compact = false, detailed = true,
}: { steps: PriceTraceStep[]; currency?: string | null; compact?: boolean; detailed?: boolean }) {
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (compact) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {steps.map((t, i) => {
          const calc = detailed ? describeCalcDetail(t) : null;
          return (
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, color: t.status === "SUBTOTAL" ? c.ink : c.muted, fontWeight: t.status === "SUBTOTAL" ? 600 : 400 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{describeTraceStep(t)}</span>
                <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: (t.result ?? 0) < 0 ? "var(--err-ink)" : undefined }}>
                  {t.result !== undefined ? fmt(t.result) : ""}
                </span>
              </div>
              {calc && (
                <div style={{ fontSize: 11, color: c.hint, paddingLeft: 12, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {calc}
                </div>
              )}
              {detailed && t.inputs?.filter((inp) => inp.qty !== 0).map((inp, j) => (
                <div key={j} style={{ fontSize: 11, color: c.hint, paddingLeft: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {fmt(inp.rate)} × {fmt(inp.qty)}{describeCostSource(inp) ? ` · from ${describeCostSource(inp)}` : ""}
                </div>
              ))}
            </div>
          );
        })}
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
              {describeCalcDetail(t) && <div style={mono}>{describeCalcDetail(t)}</div>}
              {t.inputs?.map((inp, j) => <div key={j} style={mono}>{inp.path}: {inp.rate} × {inp.qty}{describeCostSource(inp) ? ` · ${describeCostSource(inp)}` : ""}</div>)}
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
