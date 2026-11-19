"use client";

import Card from "@/components/ui/Card";
import { groupTone } from "@/components/estimator/EstimateVisualStrip";
import { wholeShares } from "@/lib/estimator/visualStrip";
import type { StripPill } from "@/lib/estimator/visualStrip";
import { ESTIMATE_TIPS } from "@/lib/estimator/tips";
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
 * Step 3: the price, in the customer's words, and the ONE place the breakdown is shown. Total including VAT large, then one row per
 * section (the same lines the quote will carry) with its amount and its share as a bar, total before VAT and VAT, the finish options
 * when the template offers them, then the one action. Costs are not shown here: they are under "How the price is built".
 */
export default function PriceCard({
  view, options, onPickOption, money, state, unpriced = [], children,
}: {
  view: PriceView | null;
  options: { label: string; items: PriceOption[] } | null;
  /** Absent while the estimate is locked. */
  onPickOption?: (key: string) => void;
  money: (n: number) => string;
  state: PriceCardState;
  /** Lines still without a price: they stop the quote, so they stay visible. */
  unpriced?: readonly StripPill[];
  /** The action area: Create quote and its note. */
  children?: React.ReactNode;
}) {
  const priced = !!view && view.problems.length === 0 && view.sections.length > 0;
  const sections = priced ? view!.sections : [];
  const sum = sections.reduce((a, s) => a + Math.max(0, s.amount), 0);
  const pct = wholeShares(sections.map((s) => Math.max(0, s.amount)));
  return (
    <Card title="3. Price" info={ESTIMATE_TIPS.price} padding={16}>
      {state.issue && <div role="alert" className="est-warn" style={{ marginBottom: 10 }}>{state.issue}</div>}
      {state.status === "pricing" && <div role="status" className="est-note" style={{ marginBottom: 10 }}>Pricing from the catalogue…</div>}
      {state.status === "unavailable" && <div role="alert" className="est-warn" style={{ marginBottom: 10 }}>{state.notes[0] ?? "Could not price from the catalogue."}</div>}
      {state.unsaved && priced && <div className="est-note" style={{ marginBottom: 10 }}>This is a preview of your changes. Save them to keep it.</div>}

      <div className="est-total">
        <span className="bpm-t-help">Total including VAT</span>
        <b aria-live="polite">{priced ? money(view!.total) : "—"}</b>
      </div>

      {priced ? (
        <div data-guide="estimate.strip">
          <ul className="est-strip-rows" aria-label="Price by section" style={{ marginBottom: 10 }}>
            {sections.map((s, i) => {
              const frac = sum > 0 ? Math.max(0, s.amount) / sum : 0;
              const share = pct[i] === 0 && frac > 0 ? "<1%" : `${pct[i]}%`;
              return (
                <li key={s.key} className="est-strip-row">
                  <div className="est-strip-head">
                    <span className="est-strip-label">{s.name}</span>
                    <span className="est-strip-figs">{money(s.amount)}{sections.length > 1 ? ` · ${share}` : ""}</span>
                  </div>
                  {sections.length > 1 && (
                    <div className="est-strip-track" role="img" aria-label={`${s.name}: ${share} of the price`}>
                      <div className="est-strip-fill" style={{ width: `${Math.max(frac * 100, 0.8)}%`, background: groupTone(i) }} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="est-row"><span className="bpm-t-help">Total before VAT</span><span>{money(view!.price)}</span></div>
          <div className="est-row"><span className="bpm-t-help">VAT {view!.vat_pct}%</span><span>{money(view!.vat)}</span></div>
        </div>
      ) : !view ? (
        !state.issue && <div className="bpm-t-help" role="status">Fill in the details to see a price.</div>
      ) : (
        !state.issue && state.status === "ready" && view.problems.length > 0 && (
          <div className="bpm-t-help" role="status">{view.problems[0]}</div>
        )
      )}
      {unpriced.length > 0 && (
        <ul className="est-strip-pills" aria-label="Lines without a price" style={{ marginTop: 10 }}>
          {unpriced.map((u) => <li key={u.code} className="est-strip-pill">No price yet: {u.label}</li>)}
        </ul>
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
