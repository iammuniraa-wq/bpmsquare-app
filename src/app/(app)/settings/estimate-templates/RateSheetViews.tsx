"use client";

import { useMemo } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select } from "@/components/ui/Input";
import StatusPill from "@/components/ui/StatusPill";
import { RATE_SHEET_TIPS } from "@/lib/estimator/rateSheet/tips";
import { FILTER_LABEL, STATUS_LABEL, STATUS_TONE, countFilters, filterRows, isFixed, setUnmatched } from "@/lib/estimator/rateSheet/view";
import type { ApplyView, Choice, PreviewView, RowFilter } from "@/lib/estimator/rateSheet/view";

// The three steps of the rate-sheet panel as plain views over their data, so the panel holds only state and calls. Layout rules
// (bpmsquarecore 6b): one column at any width, every control at least 44 px tall, long text wraps instead of scrolling sideways, a
// list shows a page of rows and "show more", and the explanations sit behind the "i".

export const PAGE = 25;

const box: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 10, padding: 12, background: "var(--panel)", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 };
const num = (n: number | null | undefined) => (n == null ? "none" : n.toLocaleString(undefined, { maximumFractionDigits: 4 }));
export const todayKey = () => new Date().toISOString().slice(0, 10);

export function StartStep({ asOf, onAsOf, onFile }: { asOf: string; onAsOf: (v: string) => void; onFile: (f: File | null) => void }) {
  return (
    <div data-guide="rate.sheet.start" style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <Field label="File" info={RATE_SHEET_TIPS.file} htmlFor="rate-sheet-file" guide="rate.sheet.file">
        <Input id="rate-sheet-file" type="file" accept=".xlsx,.xlsm,.csv,.txt" style={{ minHeight: 44, maxWidth: "100%" }} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      </Field>
      <Field label="Prices as of" info={RATE_SHEET_TIPS.asOf} htmlFor="rate-sheet-asof" guide="rate.sheet.asof">
        <Input id="rate-sheet-asof" type="date" max={todayKey()} value={asOf} style={{ minHeight: 44 }} onChange={(e) => onAsOf(e.target.value)} />
      </Field>
      <div className="bpm-label-row" data-guide="rate.sheet.starter">
        <a className="bpm-t-label" href="/api/estimate-templates/rate-sheet" download style={{ display: "inline-flex", alignItems: "center", minHeight: 44, color: "var(--accent)" }}>
          Download the starter item list
        </a>
        <InfoTip label="Starter item list">{RATE_SHEET_TIPS.starterList}</InfoTip>
      </div>
    </div>
  );
}

export function PreviewStep({
  view, choices, onChoices, filter, onFilter, shown, onShown,
}: {
  view: PreviewView;
  choices: Record<number, Choice>;
  onChoices: (c: Record<number, Choice>) => void;
  filter: RowFilter;
  onFilter: (f: RowFilter) => void;
  shown: number;
  onShown: (n: number) => void;
}) {
  const rows = view.rows;
  const counts = useMemo(() => countFilters(rows), [rows]);
  const list = useMemo(() => filterRows(rows, filter), [rows, filter]);
  return (
    <>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }} data-guide="rate.sheet.summary">
        <span className="bpm-t-label">{view.counts.rows} items</span>
        {view.counts.stale > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <StatusPill label={`${view.counts.stale} stale`} tone="amber" />
            <InfoTip label="Stale prices">{RATE_SHEET_TIPS.stale}</InfoTip>
          </span>
        )}
        {view.truncated && <StatusPill label="First 2,000 items only" tone="amber" />}
        {view.skipped_total > 0 && <span className="bpm-t-help">{view.skipped_total} lines were not items (headings, totals, no rate)</span>}
      </div>

      <div role="tablist" aria-label="Rows" data-guide="rate.sheet.filter" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {(Object.keys(FILTER_LABEL) as RowFilter[]).map((f) => (
          <button
            key={f} type="button" role="tab" aria-selected={filter === f}
            className={`bpm-btn bpm-btn-sm ${filter === f ? "bpm-btn-primary" : "bpm-btn-secondary"}`}
            style={{ minHeight: 44 }} onClick={() => { onFilter(f); onShown(PAGE); }}
          >
            {FILTER_LABEL[f]} ({counts[f]})
          </button>
        ))}
        <InfoTip label="Matching">{RATE_SHEET_TIPS.match}</InfoTip>
      </div>

      {filter === "choose" && rows.some((r) => r.status === "none") && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="secondary" size="sm" style={{ minHeight: 44 }} data-guide="rate.sheet.add_all" onClick={() => onChoices(setUnmatched(rows, choices, "add"))}>Add every unmatched item as new</Button>
          <Button variant="quiet" size="sm" style={{ minHeight: 44 }} onClick={() => onChoices(setUnmatched(rows, choices, "skip"))}>Skip them</Button>
        </div>
      )}
      {filter === "not_applied" && counts.not_applied > 0 && (
        <div className="bpm-label-row"><span className="bpm-t-help">These rows cannot be applied.</span><InfoTip label="Not applied">{RATE_SHEET_TIPS.notApplied}</InfoTip></div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }} data-guide="rate.sheet.rows">
        {list.length === 0 && <div className="bpm-t-help">Nothing here.</div>}
        {list.slice(0, shown).map((r) => {
          const choice = choices[r.row_no] ?? "skip";
          const picked = choice.startsWith("update:") ? r.suggestions.find((s) => s.product_id === choice.slice(7)) : undefined;
          return (
            <div key={r.row_no} style={box} data-guide="rate.sheet.row">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", minWidth: 0 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="bpm-t-label" style={{ overflowWrap: "anywhere" }}>{r.name}</div>
                  <div className="bpm-t-help" style={{ overflowWrap: "anywhere" }}>{[r.sku, r.uom, `row ${r.row_no}`].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="bpm-t-label" style={{ textAlign: "end", whiteSpace: "nowrap" }}>{num(r.rate)}{r.currency ? ` ${r.currency}` : ""}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <StatusPill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
                {r.stale_text && <StatusPill label={r.stale_text} tone="amber" />}
                {r.date_unreadable && <span className="bpm-t-help">Date not read; using {r.as_of_used}</span>}
              </div>
              {r.reason && <div className="bpm-t-help" role={isFixed(r) ? "alert" : undefined}>{r.reason}</div>}
              {!isFixed(r) && (
                <>
                  <label className="bpm-t-help" htmlFor={`rate-choice-${r.row_no}`} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    What to do <InfoTip label="What to do">{RATE_SHEET_TIPS.choice}</InfoTip>
                  </label>
                  <Select
                    id={`rate-choice-${r.row_no}`} value={choice} style={{ minHeight: 44, maxWidth: "100%" }} data-guide="rate.sheet.choice"
                    onChange={(e) => onChoices({ ...choices, [r.row_no]: e.target.value })}
                  >
                    <option value="skip">Skip</option>
                    {r.suggestions.map((s) => (
                      <option key={s.product_id} value={`update:${s.product_id}`}>Update {s.name}{s.sku ? ` (${s.sku})` : ""}</option>
                    ))}
                    <option value="add">Add as a new item</option>
                  </Select>
                  {picked && (
                    <div className="bpm-t-help">
                      Now {num(picked.current_rate)}{picked.current_as_of ? ` as of ${picked.current_as_of}` : ", no date"}
                      {picked.illustrative ? " · illustrative placeholder" : ""}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
        {list.length > shown && (
          <Button variant="secondary" style={{ minHeight: 44 }} onClick={() => onShown(shown + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more of {list.length - shown}</Button>
        )}
      </div>
      <div className="bpm-label-row">
        <span className="bpm-t-help">{view.currency ? `Workspace currency ${view.currency}` : "No workspace currency set"}</span>
        <InfoTip label="Currency">{RATE_SHEET_TIPS.currency}</InfoTip>
        <InfoTip label="History">{RATE_SHEET_TIPS.history}</InfoTip>
      </div>
    </>
  );
}

export function DoneView({ done }: { done: ApplyView }) {
  const s = done.summary;
  const parts = [
    s.updated ? `${s.updated} updated` : null, s.added ? `${s.added} added` : null, s.unchanged ? `${s.unchanged} already had it` : null,
    s.skipped ? `${s.skipped} skipped` : null, s.errors ? `${s.errors} not done` : null,
  ].filter(Boolean);
  return (
    <div data-guide="rate.sheet.result" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div className="bpm-t-section">{parts.join(" · ") || "Nothing changed"}</div>
      {s.stale > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <StatusPill label={`${s.stale} imported as stale`} tone="amber" />
          <InfoTip label="Stale prices">{RATE_SHEET_TIPS.stale}</InfoTip>
        </div>
      )}
      {done.notes.map((n) => (
        <div key={n.row_no} className="bpm-t-help" role={n.outcome === "error" ? "alert" : undefined} style={{ overflowWrap: "anywhere", ...(n.outcome === "error" ? { color: "var(--err-ink)" } : {}) }}>
          Row {n.row_no}, {n.name}: {n.message}
        </div>
      ))}
    </div>
  );
}
