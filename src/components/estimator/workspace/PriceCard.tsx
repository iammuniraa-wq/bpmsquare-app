"use client";

import Card from "@/components/ui/Card";
import type { PriceOption, PriceView } from "@/lib/estimator/preview";
import type { LiveStatus } from "./useLivePreview";

export type PriceCardState = {
  status: LiveStatus;
  /** Product lines are priced from the catalogue. */
  catalogue: boolean;
  /** The figures are the live preview of unsaved changes, not the stored estimate. */
  unsaved: boolean;
  /** Why the current inputs do not compute. */
  issue?: string;
  notes: string[];
};

const fmtDelta = (n: number, money: (n: number) => string) => (n === 0 ? "base price" : `${n > 0 ? "+" : "-"}${money(Math.abs(n))}`);

/**
 * Step 3: the price, in the customer's words. Total including VAT large, one row
 * per section (the same lines the quote will carry), the finish options when
 * the template offers them, then the one action. Costs are not shown here.
 */
export default function PriceCard({
  view, options, onPickOption, money, state, children,
}: {
  view: PriceView | null;
  options: { label: string; items: PriceOption[] } | null;
  /** Absent while the estimate is locked. */
  onPickOption?: (key: string) => void;
  money: (n: number) => string;
  state: PriceCardState;
  /** The action area: Create quote and its note. */
  children?: React.ReactNode;
}) {
  const priced = !!view && view.problems.length === 0 && view.sections.length > 0;
  return (
    <Card title="3. Price" padding={16}>
      {state.issue && <div role="alert" className="est-warn" style={{ marginBottom: 10 }}>{state.issue}</div>}
      {state.status === "pricing" && <div role="status" className="est-note" style={{ marginBottom: 10 }}>Pricing from the catalogue…</div>}
      {state.status === "unavailable" && <div role="alert" className="est-warn" style={{ marginBottom: 10 }}>{state.notes[0] ?? "Could not price from the catalogue."}</div>}
      {state.unsaved && priced && <div className="est-note" style={{ marginBottom: 10 }}>This is a preview of your changes. Save them to keep it.</div>}

      <div className="est-total">
        <span className="bpm-t-help">Total including VAT</span>
        <b aria-live="polite">{priced ? money(view!.total) : "—"}</b>
      </div>

      {priced ? (
        <div>
          {view!.sections.map((s) => (
            <div key={s.key} className="est-row"><span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{s.name}</span><span>{money(s.amount)}</span></div>
          ))}
          <div className="est-row"><span className="bpm-t-help">Total before VAT</span><span>{money(view!.price)}</span></div>
          <div className="est-row"><span className="bpm-t-help">VAT {view!.vat_pct}%</span><span>{money(view!.vat)}</span></div>
        </div>
      ) : (
        !state.issue && state.status === "ready" && view && view.problems.length > 0 && (
          <div className="bpm-t-help" role="status">{view.problems[0]}</div>
        )
      )}

      {priced && options && (
        <div style={{ marginTop: 12 }}>
          <div className="bpm-t-label">{options.label} options</div>
          <div className="est-opts" role="group" aria-label={`${options.label} options`}>
            {options.items.map((o) => (
              <button key={o.key} type="button" className="est-opt" aria-pressed={o.selected}
                disabled={!onPickOption} onClick={() => onPickOption?.(o.key)}>
                {o.label}
                <b>{money(o.total)}</b>
                <span>{fmtDelta(o.delta, money)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {state.notes.length > 0 && state.status !== "unavailable" && (
        <ul className="bpm-t-help" style={{ margin: "10px 0 0", paddingLeft: 18 }}>{state.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      )}
      {children && <div style={{ marginTop: 12 }}>{children}</div>}
    </Card>
  );
}
