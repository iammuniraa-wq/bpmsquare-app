"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import { fmtDateTime } from "@/components/rfq/rfqUi";
import s from "./middleware.module.css";
import {
  MESSAGE_CHANNELS, MESSAGE_DIRECTIONS, MONITOR_STATUSES, getMessage, getMessages, retryMessage, saveRules,
  type MessageDetail, type MessageFilters, type MessagePage, type MonitorMessage,
} from "./api";
import { useMw } from "./context";
import {
  CHANNEL_WORD, DIRECTION_WORD, EMPTY_FILTERS, durationWord, filterProblem, filtersToQuery, hasFilters, recordHref, recordTypeWord, statusFilterWord, statusTone, statusWord,
} from "./monitorLogic";
import { MIDDLEWARE_TIPS } from "./tips";
import { ArrowIcon, ExternalIcon, Notice, ProblemNotice, Switch, describeError, useFlash } from "./ui";
import { SendOutcome } from "./OutTab";

const PAGE = 50;

export default function MonitorTab() {
  const mw = useMw();
  const system = mw.connector.shortName;
  const [filters, setFilters] = useState<MessageFilters>(EMPTY_FILTERS);
  const [items, setItems] = useState<MonitorMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [page, setPage] = useState<MessagePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<MonitorMessage | null>(null);
  const seq = useRef(0);
  const problem = filterProblem(filters);

  const load = useCallback(async (f: MessageFilters, from: string | null) => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const p = await getMessages(filtersToQuery(f, { cursor: from, limit: PAGE }));
      if (mine !== seq.current) return;
      setPage(p);
      setItems((cur) => (from ? [...cur, ...p.items] : p.items));
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

  const set = (p: Partial<MessageFilters>) => setFilters((f) => ({ ...f, ...p }));

  return (
    <>
      <div className={s.rowBetween}>
        <span className="bpm-label-row"><h2 className="bpm-t-section">Messages</h2><InfoTip label="Messages">{MIDDLEWARE_TIPS.monitor}</InfoTip></span>
        <CaptureSwitch />
      </div>

      {page?.needsDatabaseUpdate && (
        <Notice tone="warn"><span className={s.noticeStrong}>A database update is needed.</span> The message log is missing{page.bundle ? `. Run ${page.bundle} once, then reload` : ""}. Other sources are still shown.</Notice>
      )}
      {page && page.failedSources.length > 0 && <Notice tone="warn">Some sources could not be read just now: {page.failedSources.join(", ")}. The rest is shown.</Notice>}

      <Card padding={14}>
        <div className={`${s.filters} bpm-tap`}>
          <Field label="Direction" htmlFor="mf-dir" style={{ marginBottom: 0 }}>
            <select id="mf-dir" className="bpm-input" value={filters.direction ?? ""} onChange={(e) => set({ direction: (e.target.value || undefined) as MessageFilters["direction"] })}>
              <option value="">All</option>
              {MESSAGE_DIRECTIONS.map((d) => <option key={d} value={d}>{DIRECTION_WORD[d]}</option>)}
            </select>
          </Field>
          <Field label="Channel" htmlFor="mf-ch" style={{ marginBottom: 0 }}>
            <select id="mf-ch" className="bpm-input" value={filters.channel ?? ""} onChange={(e) => set({ channel: (e.target.value || undefined) as MessageFilters["channel"] })}>
              <option value="">All</option>
              {MESSAGE_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_WORD[c]}</option>)}
            </select>
          </Field>
          <Field label="Status" htmlFor="mf-st" style={{ marginBottom: 0 }}>
            <select id="mf-st" className="bpm-input" value={filters.status ?? ""} onChange={(e) => set({ status: (e.target.value || undefined) as MessageFilters["status"] })}>
              <option value="">All</option>
              {MONITOR_STATUSES.map((st) => <option key={st} value={st}>{statusFilterWord(st, system)}</option>)}
            </select>
          </Field>
          <Field label="From" htmlFor="mf-from" style={{ marginBottom: 0 }}>
            <input id="mf-from" type="date" className="bpm-input" value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
          </Field>
          <Field label="To" htmlFor="mf-to" style={{ marginBottom: 0 }}>
            <input id="mf-to" type="date" className="bpm-input" value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} />
          </Field>
          <div className={s.filtersSearch}>
            <Field label="Search" htmlFor="mf-q" style={{ marginBottom: 0 }}>
              <input id="mf-q" type="search" className="bpm-input" value={filters.q ?? ""} placeholder="Summary or counterpart" onChange={(e) => set({ q: e.target.value || undefined })} />
            </Field>
          </div>
        </div>
        <div className={`${s.row} bpm-tap`} style={{ marginTop: 10 }}>
          {filters.object_id && <span className={s.doneChip} style={{ background: "var(--bluebg)", color: "var(--blueink)" }}>One record only</span>}
          {hasFilters(filters) && <Button size="sm" variant="quiet" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button>}
          <Button size="sm" onClick={() => void load(filters, null)} loading={loading && !cursor}>Refresh</Button>
        </div>
        {problem && <div className={s.issue} role="alert">{problem}</div>}
      </Card>

      {error != null && <ProblemNotice error={error} onRetry={() => void load(filters, null)} />}

      {!error && items.length === 0 && !loading && (
        hasFilters(filters)
          ? <EmptyState title="No message matches" text="Widen the dates or clear the filters." action={<Button onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button>} />
          : <EmptyState title="No messages yet" text="Send a test quote from What goes out and it shows here." action={<Button onClick={() => mw.goTab("out")}>Open What goes out</Button>} />
      )}

      {items.length > 0 && (
        <Card padding={0} style={{ overflow: "hidden" }}>
          <div className="bpm-rows-table" style={{ overflowX: "auto" }}>
            <table className={s.tbl}>
              <thead><tr>{["Time", "", "Channel", "Counterpart", "Summary", "Status", "Record", "Took"].map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} className={`${s.clickable} ${open?.id === m.id ? s.selected : ""}`} onClick={() => setOpen(m)}>
                    <td className={s.nowrap}>{fmtDateTime(m.at)}</td>
                    <td><span className={s.dir}><ArrowIcon dir={m.direction} />{DIRECTION_WORD[m.direction]}</span></td>
                    <td>{CHANNEL_WORD[m.channel]}</td>
                    <td className={s.wrapAny}>{m.counterpart ?? "—"}</td>
                    <td className={s.wrapAny} style={{ maxWidth: 320 }}>
                      <button type="button" className="bpm-menu-item" style={{ padding: 0, minHeight: 0, background: "none", textAlign: "start", display: "inline" }} onClick={(e) => { e.stopPropagation(); setOpen(m); }}>{m.summary}</button>
                    </td>
                    <td><StatusPill label={statusWord(m, system)} tone={statusTone(m.status)} /></td>
                    <td onClick={(e) => e.stopPropagation()}><RecordLink record={m.record} /></td>
                    <td className={s.nowrap}>{durationWord(m.duration_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bpm-rows-cards" style={{ gap: 8, padding: 10 }}>
            {items.map((m) => (
              <button key={m.id} type="button" className={s.cardRow} onClick={() => setOpen(m)}>
                <span className={s.rowBetween}>
                  <span className={s.dir}><ArrowIcon dir={m.direction} />{DIRECTION_WORD[m.direction]} · {CHANNEL_WORD[m.channel]}</span>
                  <StatusPill label={statusWord(m, system)} tone={statusTone(m.status)} />
                </span>
                <span className={s.wrapAny}>{m.summary}</span>
                <span className={`${s.small} ${s.muted}`}>{fmtDateTime(m.at)}{m.counterpart ? ` · ${m.counterpart}` : ""}</span>
              </button>
            ))}
          </div>
          {cursor && (
            <div style={{ padding: 12, display: "flex", justifyContent: "center", borderTop: "1px solid var(--line)" }}>
              <Button onClick={() => void load(filters, cursor)} loading={loading}>Load more</Button>
            </div>
          )}
        </Card>
      )}

      {open && (
        <MessagePanel
          message={open} system={system} onClose={() => setOpen(null)}
          onOnlyRecord={(id) => { setFilters({ object_id: id }); setOpen(null); }}
          onRetried={() => { void load(filters, null); void mw.reloadAll(); }}
        />
      )}
    </>
  );
}

function RecordLink({ record }: { record: MonitorMessage["record"] }) {
  if (!record) return <span className={s.hint}>—</span>;
  const href = recordHref(record);
  const text = record.label ?? recordTypeWord(record.type);
  return href ? <Link href={href} style={{ color: "var(--blueink)" }}>{text}</Link> : <span>{text}</span>;
}

/** Keep message bodies for 30 days (redacted). Off unless an admin switches it on. */
function CaptureSwitch() {
  const mw = useMw();
  const r = mw.rules.data;
  const { flash, show } = useFlash();
  if (!r) return null;
  const toggle = async (v: boolean) => {
    try { mw.rules.setData(await saveRules({ payload_capture: v })); show(true, v ? "Bodies are kept for 30 days." : "Bodies are no longer kept."); } catch (e) { show(false, describeError(e)); }
  };
  return (
    <span className={`${s.row} bpm-tap`}>
      {flash && <span role="status" className={`${s.small} ${flash.ok ? s.muted : ""}`} style={flash.ok ? undefined : { color: "var(--err-ink)" }}>{flash.text}</span>}
      <span className="bpm-label-row"><span className="bpm-t-label" style={{ marginInlineEnd: 8 }}>Keep message bodies</span><InfoTip label="Keep message bodies">{MIDDLEWARE_TIPS.capture}</InfoTip></span>
      <Switch checked={r.payload_capture} label={`Keep message bodies: ${r.payload_capture ? "on" : "off"}`} onChange={(v) => void toggle(v)} />
    </span>
  );
}

// ── Side panel ──────────────────────────────────────────────────────────────

const SHOWN_TEXT = ["body", "body_text", "payload", "html", "text"] as const;

function MessagePanel({ message: m, system, onClose, onOnlyRecord, onRetried }: {
  message: MonitorMessage; system: string; onClose: () => void; onOnlyRecord: (id: string) => void; onRetried: () => void;
}) {
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [busy, setBusy] = useState<"show" | "retry" | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [sent, setSent] = useState<Awaited<ReturnType<typeof retryMessage>> | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setDetail(null); setProblem(null); setSent(null); closeRef.current?.focus(); }, [m.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const show = async () => {
    setBusy("show"); setProblem(null);
    try {
      const r = await getMessage(m.id);
      if ("needsDatabaseUpdate" in r) setProblem(new Error("A database update is needed first."));
      else setDetail(r);
    } catch (e) { setProblem(e); } finally { setBusy(null); }
  };
  const retry = async () => {
    setBusy("retry"); setProblem(null);
    try { setSent(await retryMessage(m.id)); onRetried(); } catch (e) { setProblem(e); } finally { setBusy(null); }
  };

  const err = detail && typeof detail.detail.error === "string" ? detail.detail.error : null;
  const canRetry = m.source === "integration" && (m.status === "failed" || m.status === "pending") && m.record?.type === "standard_quotes";
  const href = recordHref(m.record);

  return (
    <>
      <div className={s.backdrop} onClick={onClose} />
      <aside className={s.drawer} role="dialog" aria-modal="true" aria-label="Message details">
        <div className={s.rowBetween}>
          <StatusPill label={statusWord(m, system)} tone={statusTone(m.status)} />
          <button ref={closeRef} type="button" className="bpm-btn bpm-btn-secondary bpm-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="bpm-t-section" style={{ overflowWrap: "anywhere" }}>{m.summary}</div>
        <dl className={s.kv}>
          <dt>Time</dt><dd>{fmtDateTime(m.at)}</dd>
          <dt>Direction</dt><dd><span className={s.dir}><ArrowIcon dir={m.direction} />{DIRECTION_WORD[m.direction]}</span></dd>
          <dt>Channel</dt><dd>{CHANNEL_WORD[m.channel]}</dd>
          <dt>Counterpart</dt><dd>{m.counterpart ?? "—"}</dd>
          <dt>Took</dt><dd>{durationWord(m.duration_ms)}</dd>
          <dt>Record</dt><dd>{m.record ? (href ? <Link href={href} style={{ color: "var(--blueink)" }}>{m.record.label ?? recordTypeWord(m.record.type)} <ExternalIcon /></Link> : (m.record.label ?? recordTypeWord(m.record.type))) : "—"}</dd>
        </dl>
        <div className={`${s.row} bpm-tap`}>
          {m.record?.id && <Button size="sm" onClick={() => onOnlyRecord(m.record!.id!)}>Show only this record</Button>}
          {canRetry && <Button size="sm" variant="primary" onClick={() => void retry()} loading={busy === "retry"} disabled={!!busy}>Retry</Button>}
        </div>
        {sent && <SendOutcome result={sent} />}
        {problem != null && <ProblemNotice error={problem} />}
        {!detail ? (
          <div className={s.row}>
            <Button onClick={() => void show()} loading={busy === "show"} disabled={!!busy}>Show details</Button>
            <InfoTip label="Show details">{MIDDLEWARE_TIPS.body}</InfoTip>
          </div>
        ) : (
          <div className={s.stack} style={{ gap: 10 }}>
            {err && <Notice tone="err"><span className={s.noticeStrong}>Error</span> <span className={s.mono}>{err}</span></Notice>}
            {SHOWN_TEXT.filter((k) => detail.detail[k] !== undefined && detail.detail[k] !== null && detail.detail[k] !== "").map((k) => (
              <div key={k}>
                <div className="bpm-t-label" style={{ marginBottom: 4 }}>{k.replace(/_/g, " ")}</div>
                <pre className={`${s.raw} ${s.mono}`} tabIndex={0}>{typeof detail.detail[k] === "string" ? (detail.detail[k] as string) : JSON.stringify(detail.detail[k], null, 2)}</pre>
              </div>
            ))}
            <details>
              <summary style={{ cursor: "pointer", minHeight: 32 }}>All fields</summary>
              <pre className={`${s.raw} ${s.mono}`} tabIndex={0} style={{ marginTop: 6 }}>{JSON.stringify(detail.detail, null, 2)}</pre>
            </details>
          </div>
        )}
      </aside>
    </>
  );
}
