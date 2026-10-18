"use client";

import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import { useCurrency } from "@/lib/tenant-context";
import { moneyFormatter } from "@/lib/currency";
import { getGeometry, geometryIdentifiers } from "@/lib/estimator/geometry";
import { templateIdentifiers, type TemplateDraft } from "@/components/estimator/templateDraft";
import type { CheckState } from "@/components/estimator/useTemplateCheck";

function Names({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="bpm-t-label" style={{ marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, color: c.muted, overflowWrap: "anywhere" }}>{names.join("  ")}</div>
    </div>
  );
}

/** Every problem the server found, the example worked out with the default inputs, and the names a formula may use. */
export default function CheckPanel({ draft, check }: { draft: TemplateDraft; check: CheckState }) {
  const money = moneyFormatter(useCurrency(), { maximumFractionDigits: 2 });
  const r = check.result;
  const ids = templateIdentifiers(draft);
  const mod = getGeometry(draft.geometry);

  return (
    <>
      <Card title="Problems" padding={16}>
        {check.failed && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{check.failed}</div>}
        {!check.failed && !r && <div className="bpm-t-help">Checking…</div>}
        {r && r.issues.length === 0 && r.example_issues.length === 0 && (
          <div className="bpm-t-help" style={{ color: "var(--greenink)" }}>{check.loading ? "Checking…" : "No problems found."}</div>
        )}
        {r && [...r.issues, ...r.example_issues].length > 0 && (
          <ul role="alert" style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--err-ink)" }}>
            {[...r.issues, ...r.example_issues].map((x, i) => <li key={i}><span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5 }}>{x.path}</span> {x.message}</li>)}
          </ul>
        )}
        {r && r.warnings.length > 0 && (
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 12.5, color: c.muted }}>
            {r.warnings.map((x, i) => <li key={i}><span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5 }}>{x.path}</span> {x.message}</li>)}
          </ul>
        )}
      </Card>

      {r?.example && (
        <Card title="Worked example with the default inputs" padding={16}>
          <div className="bpm-t-help" style={{ marginTop: 0, marginBottom: 8 }}>
            {r.example.line_count} line{r.example.line_count === 1 ? "" : "s"}, no margin. Product lines have no price here, so the total is the rate-priced part only
            {r.example.unpriced.length > 0 ? ` (${r.example.unpriced.length} product line${r.example.unpriced.length === 1 ? "" : "s"} unpriced)` : ""}.
          </div>
          {r.example.summary.by_group.map((g) => (
            <div key={g.key} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderTop: `1px solid ${c.line}`, fontSize: 13 }}>
              <span style={{ color: c.ink }}>{g.name}</span><span style={{ fontWeight: 600, color: c.ink }}>{money(g.cost)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0 0", borderTop: `1px solid ${c.line}`, fontSize: 14, fontWeight: 700, color: c.ink }}>
            <span>Cost</span><span>{money(r.example.summary.cost_total)}</span>
          </div>
        </Card>
      )}

      <Card title="Names a formula can use" padding={16}>
        <Names label="Inputs" names={ids.inputs} />
        <Names label="Rates" names={ids.rates} />
        <Names label="Earlier lines (quantity)" names={ids.lines} />
        <Names label="Group subtotals (cost so far)" names={ids.groups} />
        {mod && <Names label={`Piece totals from ${mod.label}`} names={geometryIdentifiers(mod)} />}
        <div className="bpm-t-help" style={{ marginTop: 10 }}>
          Operators + - * / ( ), comparisons, and ceil, floor, round(x, n), min, max, abs, if(condition, a, b).
        </div>
      </Card>
    </>
  );
}
