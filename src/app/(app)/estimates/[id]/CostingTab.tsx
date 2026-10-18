import { c, pillar, type PillarKey } from "@/lib/theme";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { ESTIMATE_COMPONENTS, ESTIMATE_COMPONENT_LABEL, type EstimateComponent } from "@/lib/estimator/types";
import type { EstimateTotals } from "@/lib/types";

const TONE: Record<EstimateComponent, PillarKey> = {
  materials: "blue", moulds: "purple", labour: "teal", overhead: "amber", transport: "green", erection: "red", other: "blue",
};
// "other" repeats blue; a lighter fill keeps it apart from materials.
const OPACITY: Partial<Record<EstimateComponent, number>> = { other: 0.45 };

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderTop: `1px solid ${c.line}`, fontSize: strong ? 14 : 13 }}>
      <span style={{ color: strong ? c.ink : c.muted, fontWeight: strong ? 700 : 400 }}>{label}</span>
      <span style={{ color: c.ink, fontWeight: strong ? 700 : 500 }}>{value}</span>
    </div>
  );
}

/** The cost build-up: by component (stacked bar), by group, then margin, price and VAT. */
export default function CostingTab({ totals, money }: { totals: EstimateTotals | null; money: (n: number) => string }) {
  if (!totals) {
    return <Card padding={0}><EmptyState title="Not calculated yet" text="Recalculate the estimate on the Inputs tab to see its cost build-up." /></Card>;
  }
  const parts = ESTIMATE_COMPONENTS
    .map((k) => ({ key: k, amount: totals.by_component[k] ?? 0 }))
    .filter((p) => p.amount > 0);
  const sum = parts.reduce((a, p) => a + p.amount, 0);
  const pct = (n: number) => (sum > 0 ? Math.round((n / sum) * 1000) / 10 : 0);

  const problems: string[] = [];
  if (totals.unresolved?.length) problems.push(`No product matches the item number for: ${totals.unresolved.join(", ")}. Add the product, or change the rule's item number.`);
  if (totals.unpriced?.length) problems.push(`No cost yet for: ${totals.unpriced.join(", ")}. Give the product a cost or price book entry, or enter a unit cost on the BOM tab.`);
  const notes = totals.warnings ?? [];

  return (
    <>
      {problems.length > 0 && (
        <Card title="These block the quote" padding={16}>
          <ul role="alert" style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--err-ink)" }}>
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        </Card>
      )}

      <Card title="Cost build-up" padding={18}>
        {parts.length === 0 ? (
          <div className="bpm-t-help">No cost lines yet.</div>
        ) : (
          <>
            <div role="img" aria-label={`Cost by component: ${parts.map((p) => `${ESTIMATE_COMPONENT_LABEL[p.key]} ${pct(p.amount)}%`).join(", ")}`}
              style={{ display: "flex", height: 16, borderRadius: 8, overflow: "hidden", background: c.panel2, marginBottom: 14 }}>
              {parts.map((p) => (
                <div key={p.key} title={`${ESTIMATE_COMPONENT_LABEL[p.key]} ${pct(p.amount)}%`}
                  style={{ width: `${(p.amount / sum) * 100}%`, background: pillar[TONE[p.key]].fg, opacity: OPACITY[p.key] ?? 1 }} />
              ))}
            </div>
            {parts.map((p) => (
              <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: `1px solid ${c.line}`, fontSize: 13 }}>
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: pillar[TONE[p.key]].fg, opacity: OPACITY[p.key] ?? 1, flexShrink: 0 }} />
                <span style={{ flex: 1, color: c.ink }}>{ESTIMATE_COMPONENT_LABEL[p.key]}</span>
                <span style={{ color: c.hint }}>{pct(p.amount)}%</span>
                <span style={{ minWidth: 90, textAlign: "right", fontWeight: 600, color: c.ink }}>{money(p.amount)}</span>
              </div>
            ))}
          </>
        )}
      </Card>

      <Card title="Price" padding={18}>
        <Row label="Cost" value={money(totals.cost_total)} />
        <Row label={`Margin (${totals.margin_pct}% on cost)`} value={money(totals.margin_amount)} />
        <Row label="Price before VAT" value={money(totals.price)} />
        <Row label={`VAT (${totals.vat_pct}%)`} value={money(totals.vat)} />
        <Row label="Total incl. VAT" value={money(totals.price_incl_vat)} strong />
      </Card>

      {totals.by_group.length > 0 && (
        <Card title="By group" padding={18}>
          {totals.by_group.map((g) => (
            <div key={g.key} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderTop: `1px solid ${c.line}`, fontSize: 13 }}>
              <span style={{ color: c.ink }}>{g.name}</span>
              <span style={{ fontWeight: 600, color: c.ink }}>{money(g.cost)}</span>
            </div>
          ))}
        </Card>
      )}

      {notes.length > 0 && (
        <Card title="Notes from the calculation" padding={16}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: c.muted }}>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </Card>
      )}
    </>
  );
}
