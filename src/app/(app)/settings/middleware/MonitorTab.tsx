"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import { useFeel } from "@/components/FeelProvider";
import { fmtDateTime } from "@/components/rfq/rfqUi";
import s from "./middleware.module.css";
import {
  getMessage, getMessages, restartMessages,
  type MessageDetail, type MessageFilters, type MessagePage, type MonitorMessage, type PayloadView, type RestartResult,
} from "./api";
import { useMw } from "./context";
import {
  DIRECTION_WORD, EMPTY_FILTERS, durationWord, filterProblem, filtersToQuery, hasFilters, recordHref, recordTypeWord, statusTone, statusWord,
} from "./monitorLogic";
import {
  DOCUMENT_FILTERS, STATUS_CHIPS, actionBar, filterAsRecord, hasSide, matchesDocument, payloadLine, payloadText, pruneTicks, resultLine, resultsSummary, restartableIds, restartableTicked, toggleAll, toggleTick,
  type PayloadSide,
} from "./monitorSelection";
import { MIDDLEWARE_TIPS } from "./tips";
import { ArrowIcon, ExternalIcon, Notice, ProblemNotice, Segmented } from "./ui";
import Panel from "./Panel";

const PAGE = 50;
const RESTART_ALL_CAP = 200;

export default function MonitorTab() {
  const mw = useMw();
  const { confirm } = useFeel();
  const system = mw.connector.shortName;
  const [filters, setFilters] = useState<MessageFilters>(EMPTY_FILTERS);
  const [loaded, setItems] = useState<MonitorMessage[]>([]);
  const items = loaded.filter((m) => matchesDocument(m, filters.document));
  const [cursor, setCursor] = useState<string | null>(null);
  const [page, setPage] = useState<MessagePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, RestartResult>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartProblem, setRestartProblem] = useState<unknown>(null);
  const [payload, setPayload] = useState<{ message: MonitorMessage; side: PayloadSide } | null>(null);
  const seq = useRef(0);
  const problem = filterProblem(filters);

  const load = useCallback(async (f: MessageFilters, from: string | null) => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const p = await getMessages(filtersToQuery(f, { cursor: from, limit: PAGE }));
      if (mine !== seq.current) return;
      setPage(p);
      setItems((cur) => {
        const next = from ? [...cur, ...p.items] : p.items;
        setTicked((t) => pruneTicks(t, next));
        return next;
      });
      setCursor(p.nextCursor);
      setError(null);
    } catch (e) {
      if (mine === seq.current) setError(e);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (filterProblem(filters)) return;
    const t = setTimeout(() => void load(filters, null), filters.q ? 300 : 0);
    return () => clearTimeout(t);
  }, [filters, load]);

  const set = (p: Partial<MessageFilters>) => { setFilters((f) => ({ ...f, ...p })); setTicked([]); setSummary(null); };
  const bar = actionBar(items, ticked, filters, cursor !== null);

  const restart = async () => {
    if (bar.restartMode === "none") return;
    if (bar.restartMode === "all-failed" && !(await confirm({ title: "Restart all failed?", body: `${restartableIds(items).length}${cursor ? " or more" : ""} failed lines are sent again. Nothing lands twice in the ERP.`, confirmLabel: "Restart all" }))) return;
    setRestarting(true); setRestartProblem(null);
    try {
      const out = await restartMessages(bar.restartMode === "ticked" ? { messageIds: restartableTicked(ticked, items) } : { filter: filterAsRecord(filters), limit: RESTART_ALL_CAP });
      setResults(Object.fromEntries(out.map((r) => [r.id, r])));
      setSummary(resultsSummary(out));
      setTicked([]);
      await Promise.all([load(filters, null), mw.reloadAll()]);
    } catch (e) { setRestartProblem(e); } finally { setRestarting(false); }
  };

  return (
    <>
      <div className={s.rowBetween}>
        <span className="bpm-label-row"><h2 className="bpm-t-section">Messages</h2><InfoTip label="Messages">{MIDDLEWARE_TIPS.monitor}</InfoTip></span>
      </div>

      {page?.needsDatabaseUpdate && (
        <Notice tone="warn"><span className={s.noticeStrong}>A database update is needed.</span> The message log is missing{page.bundle ? `. Run ${page.bundle} once, then reload` : ""}. Other sources are still shown.</Notice>
      )}
      {page && page.failedSources.length > 0 && <Notice tone="warn">Some sources could not be read just now: {page.failedSources.join(", ")}. The rest is shown.</Notice>}

      <FilterRow filters={filters} onChange={set} onClear={() => { setFilters(EMPTY_FILTERS); setTicked([]); setSummary(null); }} problem={problem} />

      <div className={s.actionBar} role="toolbar" aria-label="Actions for the ticked lines">
        <Button variant="primary" onClick={() => void restart()} loading={restarting} disabled={!bar.restartEnabled || restarting} title={MIDDLEWARE_TIPS.restart}>{bar.restartLabel}</Button>
        <span title={bar.viewRequest.reason ?? undefined}><Button onClick={() => bar.one && setPayload({ message: bar.one, side: "request" })} disabled={bar.viewRequest.disabled}>View request</Button></span>
        <span title={bar.viewResponse.reason ?? undefined}><Button onClick={() => bar.one && setPayload({ message: bar.one, side: "response" })} disabled={bar.viewResponse.disabled}>View response</Button></span>
        <span className={`${s.small} ${s.muted}`} aria-live="polite">{ticked.length ? `${ticked.length} selected` : ""}</span>
        <Button size="sm" variant="quiet" onClick={() => void load(filters, null)} loading={loading && !cursor}>Refresh</Button>
      </div>

      {summary && <Notice tone={Object.values(results).some((r) => r.outcome === "failed") ? "warn" : "ok"}>{summary}</Notice>}
      {restartProblem != null && <ProblemNotice error={restartProblem} />}
      {error != null && <ProblemNotice error={error} onRetry={() => void load(filters, null)} />}

      {!error && items.length === 0 && !loading && (
        hasFilters(filters)
          ? <EmptyState title="No message matches" text="Widen the dates or clear the filters." action={<Button onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button>} />
          : <EmptyState title="No messages yet" text="Send a test quote from Links and it shows here." action={<Button onClick={() => mw.goTab("links")}>Open Links</Button>} />
      )}

      {payload && <PayloadPanel message={payload.message} initial={payload.side} onClose={() => setPayload(null)} />}

      {items.length > 0 && (
        <MonitorList
          items={items} ticked={ticked} results={results} system={system}           onTick={(id) => setTicked((t) => toggleTick(t, items, id))} onAll={() => setTicked((t) => toggleAll(t, items))}
          more={cursor ? <Button onClick={() => void load(filters, cursor)} loading={loading}>Load more</Button> : null}
        />
      )}

    </>
  );
}

// ── Filter row ──────────────────────────────────────────────────────────────

export function FilterRow({ filters, onChange, onClear, problem }: {
  filters: MessageFilters; onChange: (p: Partial<MessageFilters>) => void; onClear: () => void; problem: string | null;
}) {
  const chip = filters.status ?? "all";
  return (
    <div className={s.filterRow}>
      <div className={s.seg} role="group" aria-label="Status">
        {STATUS_CHIPS.map((c) => (
          <button key={c.id} type="button" aria-pressed={chip === c.id} onClick={() => onChange({ status: c.id === "all" ? undefined : c.id })}>{c.label}</button>
        ))}
      </div>
      <div className={`${s.filterFields} bpm-tap`}>
        <label className={s.filterField}>
          <span className="bpm-sr-only">Direction</span>
          <select className="bpm-input" aria-label="Direction" value={filters.direction ?? ""} onChange={(e) => onChange({ direction: (e.target.value || undefined) as MessageFilters["direction"] })}>
            <option value="">In and out</option>
            <option value="out">Out</option>
            <option value="in">In</option>
          </select>
        </label>
        <label className={s.filterField}>
          <span className="bpm-sr-only">Document or entity</span>
          <select className="bpm-input" aria-label="Document or entity" value={filters.document ?? ""} onChange={(e) => onChange({ document: e.target.value || undefined })}>
            {DOCUMENT_FILTERS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        <label className={s.filterField}>
          <span className="bpm-sr-only">From</span>
          <input type="date" className="bpm-input" aria-label="From date" value={filters.from ?? ""} onChange={(e) => onChange({ from: e.target.value || undefined })} />
        </label>
        <label className={s.filterField}>
          <span className="bpm-sr-only">To</span>
          <input type="date" className="bpm-input" aria-label="To date" value={filters.to ?? ""} onChange={(e) => onChange({ to: e.target.value || undefined })} />
        </label>
        <label className={`${s.filterField} ${s.filterSearch}`}>
          <span className="bpm-sr-only">Search</span>
          <input type="search" className="bpm-input" aria-label="Search by record or ERP number" placeholder="Record or ERP number" value={filters.q ?? ""} onChange={(e) => onChange({ q: e.target.value || undefined })} />
        </label>
        {hasFilters(filters) && <Button size="sm" variant="quiet" onClick={onClear}>Clear filters</Button>}
      </div>
      {filters.object_id && <span className={s.small}><span className={s.doneChip} style={{ background: "var(--bluebg)", color: "var(--blueink)" }}>One record only</span></span>}
      {problem && <div className={s.issue} role="alert">{problem}</div>}
    </div>
  );
}

// ── The list ────────────────────────────────────────────────────────────────

function RecordLink({ record }: { record: MonitorMessage["record"] }) {
  if (!record) return <span className={s.hint}>—</span>;
  const href = recordHref(record);
  const text = record.label ?? recordTypeWord(record.type);
  return href ? <Link href={href} style={{ color: "var(--blueink)" }}>{text}</Link> : <span>{text}</span>;
}

function Reason({ m, result }: { m: MonitorMessage; result?: RestartResult }) {
  return (
    <span className={s.reasonStack}>
      <span className={s.wrapAny}>{m.summary}</span>
      {m.fix ? <span className={`${s.small} ${s.fixLine}`}><span className={s.noticeStrong}>What to do:</span> {m.fix}</span> : null}
      {result ? <span className={`${s.small} ${result.outcome === "failed" || result.outcome === "not_restartable" ? s.resultBad : s.resultGood}`} role="status">{resultLine(result)}</span> : null}
    </span>
  );
}

/** One table, newest first, every detail in the row. Under 780 px each row is a two-line card. Plain props only. */
export function MonitorList({ items, ticked, results, system, onTick, onAll, more }: {
  items: readonly MonitorMessage[]; ticked: readonly string[]; results: Record<string, RestartResult>; system: string;
  onTick: (id: string) => void; onAll: () => void; more?: React.ReactNode;
}) {
  const ids = items.map((m) => m.id);
  const allOn = ids.length > 0 && ids.every((id) => ticked.includes(id));
  const someOn = ids.some((id) => ticked.includes(id));
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = someOn && !allOn; }, [someOn, allOn]);

  const label = (m: MonitorMessage) => `${m.what ?? "Message"} ${m.record?.label ?? ""}`.trim();
  return (
    <div className={s.listCard}>
      <div className="bpm-rows-table" style={{ overflowX: "auto" }}>
        <table className={s.tbl}>
          <thead>
            <tr>
              <th className={s.tickCol}>
                <label className={s.tickTap}><input ref={allRef} type="checkbox" checked={allOn} disabled={ids.length === 0} onChange={onAll} aria-label="Select all lines" /></label>
              </th>
              {["Time", "Direction", "What", "Record", "ERP number", "Status", "Reason"].map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} className={`${s.clickable} ${ticked.includes(m.id) ? s.selected : ""}`} onClick={() => onTick(m.id)}>
                <td className={s.tickCol} onClick={(e) => e.stopPropagation()}>
                  <label className={s.tickTap}><input type="checkbox" checked={ticked.includes(m.id)} onChange={() => onTick(m.id)} aria-label={`Select ${label(m)}`} /></label>
                </td>
                <td className={s.nowrap}>{fmtDateTime(m.at)}</td>
                <td><span className={s.dir}><ArrowIcon dir={m.direction} />{DIRECTION_WORD[m.direction]}</span></td>
                <td>
                  {m.what ?? "Message"}
                </td>
                <td className={s.recordCell} onClick={(e) => e.stopPropagation()}><RecordLink record={m.record} /></td>
                <td className={s.wrapAny}>{m.erpNumber ?? "—"}</td>
                <td><StatusPill label={statusWord(m, system)} tone={statusTone(m.status)} /></td>
                <td className={s.reasonCell}><Reason m={m} result={results[m.id]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bpm-rows-cards" style={{ gap: 8, padding: 10 }}>
        <label className={s.tickAllCard}>
          <input type="checkbox" checked={allOn} disabled={ids.length === 0} onChange={onAll} aria-label="Select all lines" />
          <span className={s.small}>Select all</span>
        </label>
        {items.map((m) => (
          <div key={m.id} className={`${s.msgCard} ${ticked.includes(m.id) ? s.selected : ""}`}>
            <div className={s.msgTick}>
              <label className={s.tickTap}><input type="checkbox" checked={ticked.includes(m.id)} onChange={() => onTick(m.id)} aria-label={`Select ${label(m)}`} /></label>
            </div>
            <button type="button" className={s.msgBody} onClick={() => onTick(m.id)}>
              <span className={s.rowBetween}>
                <span className={s.fieldName}><span className={s.dir}><ArrowIcon dir={m.direction} /></span> {m.what ?? "Message"}{m.record?.label ? ` · ${m.record.label}` : ""}</span>
                <StatusPill label={statusWord(m, system)} tone={statusTone(m.status)} />
              </span>
              <span className={`${s.small} ${s.muted}`}>{fmtDateTime(m.at)}{m.erpNumber ? ` · ${m.erpNumber}` : ""}</span>
              <Reason m={m} result={results[m.id]} />
            </button>
          </div>
        ))}
      </div>
      {more ? <div style={{ padding: 12, display: "flex", justifyContent: "center", borderTop: "1px solid var(--line)" }}>{more}</div> : null}
    </div>
  );
}

// ── Request / response panel ────────────────────────────────────────────────

/** The only place a request or response body is drawn. It is read when opened, never before. */
function PayloadPanel({ message, initial, onClose }: { message: MonitorMessage; initial: PayloadSide; onClose: () => void }) {
  const [side, setSide] = useState<PayloadSide>(initial);
  const [payload, setPayload] = useState<PayloadView | null | undefined>(undefined);
  const [problem, setProblem] = useState<unknown>(null);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await getMessage(message.id);
        if (!live) return;
        if ("needsDatabaseUpdate" in r) setProblem(new Error("A database update is needed first."));
        else setPayload(r.payload);
      } catch (e) { if (live) setProblem(e); }
    })();
    return () => { live = false; };
  }, [message.id]);

  const copy = async () => {
    if (!payload) return;
    try { await navigator.clipboard.writeText(payloadText(payload, side)); setCopied("yes"); } catch { setCopied("no"); }
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <section className={`${s.listCard} ${s.stack}`} style={{ padding: 14, gap: 12 }} aria-label="Request and response">
      <div className={s.rowBetween}>
        <div style={{ minWidth: 0 }}>
          <div className="bpm-t-section">{side === "request" ? "Request" : "Response"}</div>
          <div className={`${s.small} ${s.muted}`}>{`${message.what ?? "Message"}${message.record?.label ? ` · ${message.record.label}` : ""}`}</div>
        </div>
        <Button size="sm" onClick={onClose}>Close</Button>
      </div>
      <Segmented label="Show" value={side} options={[{ id: "request", label: "Request" }, { id: "response", label: "Response" }]} onChange={setSide} />
      {problem != null && <ProblemNotice error={problem} />}
      {payload === undefined && problem == null && <div className={`${s.small} ${s.muted}`} role="status">Loading…</div>}
      {payload === null && <Notice tone="info">No payload recorded for this line.</Notice>}
      {payload && (
        <>
          <div className={`${s.rowBetween} bpm-tap`}>
            <span className={`${s.small} ${s.mono} ${s.wrapAny}`}>{payloadLine(payload, side) || "—"}</span>
            <span className={s.row}>
              {copied && <span className={`${s.small} ${s.muted}`} role="status">{copied === "yes" ? "Copied" : "Could not copy"}</span>}
              <Button size="sm" onClick={() => void copy()} disabled={!hasSide(payload, side)}>Copy</Button>
            </span>
          </div>
          {payload.truncated && <Notice tone="warn">This payload is cut short. Only the first part was kept.</Notice>}
          {hasSide(payload, side)
            ? <pre className={`${s.raw} ${s.mono}`} tabIndex={0}>{payloadText(payload, side)}</pre>
            : <div className={`${s.small} ${s.muted}`}>{side === "request" ? "No request was recorded." : "No response was recorded."}</div>}
        </>
      )}
    </section>
  );
}

