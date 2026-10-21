"use client";

import { Fragment, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import s from "./middleware.module.css";
import {
  SENDABLE_LABEL, SENDABLE_OBJECTS, getSync, runSelected, runSync, sendRecord, setSchedule,
  type AccountChoice, type EntitySchedule, type SendResult, type SendableObject, type SyncEntity, type SyncRunResult,
} from "./api";
import { useMw } from "./context";
import {
  NO_FILTERS, RESYNC_TABS, RESYNC_TAB_LABEL, SCHEDULE_CHOICES, filterLine, filtersToRequest, hasFilters, lastRunLine, numbersProblem,
  parseRecordIds, recordIdsProblem, resultLine, unsupportedFilters, type FilterDraft, type ResyncTabId,
} from "./resyncLogic";
import { MIDDLEWARE_TIPS } from "./tips";
import { Notice, ProblemNotice, Switch, describeError, useLoad } from "./ui";
import { AccountPick, QuoteSelect, useQuoteOptions } from "./Pickers";
import { SendOutcome } from "./SendOutcome";

// Resync moves DATA on demand. "Full resync" reads an entity from the ERP now or on a
// schedule, all of it or only what matches some filters; "Specific records" reads a
// list of records by id or number, and sends one record by hand. Messages, history and
// failures are the Monitor's and never appear here.

const ENTITY_WORD: Record<string, string> = { customers: "Customers", contacts: "Contacts", vendors: "Vendors", products: "Products", projects: "Projects" };
export const entityWord = (key: string): string => ENTITY_WORD[key] ?? key;

export type RunLine = { ok: boolean; text: string };

/** What a finished (or refused) run is told as: one line under the entity, plus what was not applied. */
export function runLine(r: SyncRunResult): RunLine {
  const notes = [...(r.unsupported ?? []), ...(r.issues ?? []).slice(0, 2)];
  const base = r.error ? r.error : resultLine(r);
  return { ok: !r.error, text: [base, ...notes].join(" ") };
}

export default function ResyncTab() {
  const mw = useMw();
  const connected = mw.health.data?.connection.connected === true;
  const [sub, setSub] = useUrlTab(RESYNC_TABS, "view");
  return (
    <>
      <Tabs label="Resync" tabs={RESYNC_TABS.map((id) => ({ id, label: RESYNC_TAB_LABEL[id] }))} value={sub} onChange={(id) => setSub(id as ResyncTabId)} />
      <div role="tabpanel" aria-label={RESYNC_TAB_LABEL[sub as ResyncTabId]} key={sub} className={s.stack}>
        {sub === "full" && <FullResync connected={connected} connectorId={mw.connector.id} />}
        {sub === "records" && (
          <>
            <GetRecords connected={connected} />
            <SendRecord connected={connected} />
          </>
        )}
      </div>
    </>
  );
}

// ── Tab 1: one row per inbound entity, with the filters of a full resync ────

function FullResync({ connected, connectorId }: { connected: boolean; connectorId: string }) {
  const sync = useLoad(getSync, [connectorId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [lines, setLines] = useState<Record<string, RunLine>>({});
  const [filters, setFilters] = useState<FilterDraft>(NO_FILTERS);
  const rows = sync.data && sync.data.connected ? sync.data.entities.filter((e) => e.key !== "fence_projects") : [];
  const anyRunning = rows.some((e) => e.running);
  const request = filtersToRequest(filters);

  useEffect(() => {
    if (!anyRunning && !busy) return;
    const t = setInterval(() => void sync.reload(), 4000);
    return () => clearInterval(t);
  }, [anyRunning, busy, sync]);

  const run = async (e: SyncEntity, full: boolean) => {
    setBusy(`${e.key}:${full ? "full" : "now"}`); setProblem(null);
    setLines((x) => { const { [e.key]: _drop, ...rest } = x; void _drop; return rest; });
    try {
      // "Sync now" is the incremental run and never takes the filters; "Full resync" takes them, or reads everything.
      if (!full) await runSync(e.key, false);
      else if (!hasFilters(filters)) await runSync(e.key, true);
      else if (request.ok) {
        const res = await runSelected(e.key, request.filters);
        setLines((x) => ({ ...x, [e.key]: runLine(res) }));
      }
    } catch (err) {
      setLines((x) => ({ ...x, [e.key]: { ok: false, text: describeError(err) } }));
    } finally {
      setBusy(null);
      await sync.reload();
    }
  };
  const schedule = async (e: SyncEntity, value: EntitySchedule) => {
    setProblem(null);
    try { await setSchedule(e.key, value); await sync.reload(); } catch (err) { setProblem(err); }
  };

  return (
    <>
      <RunFilters value={filters} onChange={setFilters} error={request.ok ? null : request.error} />
      <section className={s.stack} style={{ gap: 10 }}>
        <div className={s.rowBetween}>
          <span className="bpm-label-row"><h2 className="bpm-t-section">Data from the ERP</h2><InfoTip label="Data from the ERP">{MIDDLEWARE_TIPS.resync}</InfoTip></span>
        </div>
        {sync.error != null && <ProblemNotice error={sync.error} onRetry={() => void sync.reload()} />}
        {problem != null && <ProblemNotice error={problem} />}
        {sync.data && sync.data.connected && sync.data.pending_migration && <Notice tone="warn">A database update is needed before runs can be recorded.</Notice>}
        {(sync.data && !sync.data.connected) || (!connected && !sync.data && !sync.loading)
          ? <EmptyState title="Connect an ERP first" text="Syncing starts once there is a connection." />
          : null}
        {rows.length > 0 && (
          <EntityRows rows={rows} connected={connected} busy={busy} lines={lines} filters={filters} filtersValid={request.ok} onSync={(e, full) => void run(e, full)} onSchedule={(e, v) => void schedule(e, v)} />
        )}
      </section>
    </>
  );
}

/** Changed since, Contains, Active only: one shared row for every entity below it. */
export function RunFilters({ value, onChange, error }: { value: FilterDraft; onChange: (v: FilterDraft) => void; error: string | null }) {
  const set = hasFilters(value);
  return (
    <Card title="Filters" info={MIDDLEWARE_TIPS.filters} action={set ? <Button size="sm" variant="quiet" onClick={() => onChange(NO_FILTERS)}>Clear</Button> : undefined}>
      <div className={s.stack} style={{ gap: 10 }}>
        <div className={s.runFilters}>
          <Field label="Changed since" info={MIDDLEWARE_TIPS.sinceDate} htmlFor="rf-since" style={{ marginBottom: 0 }}>
            <input id="rf-since" type="date" className="bpm-input" value={value.since} onChange={(e) => onChange({ ...value, since: e.target.value })} />
          </Field>
          <Field label="Contains" info={MIDDLEWARE_TIPS.containsText} htmlFor="rf-text" style={{ marginBottom: 0 }}>
            <input id="rf-text" className="bpm-input" autoComplete="off" maxLength={80} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} />
          </Field>
          <div className={s.switchField}>
            <Switch checked={value.activeOnly} label={`Active only: ${value.activeOnly ? "on" : "off"}`} onChange={(v) => onChange({ ...value, activeOnly: v })} />
            <span className="bpm-label-row"><span className="bpm-t-label">Active only</span><InfoTip label="Active only">{MIDDLEWARE_TIPS.activeOnly}</InfoTip></span>
          </div>
        </div>
        {error && <div className={s.issue} role="alert">{error}</div>}
        {set && !error && <span className={`${s.small} ${s.muted}`}>{`Full resync reads: ${filterLine("records", value)}`}</span>}
      </div>
    </Card>
  );
}

/** The table itself, plain props only. Under 780 px each row becomes a card. */
export function EntityRows({ rows, connected, busy, lines, filters = NO_FILTERS, filtersValid = true, onSync, onSchedule, now }: {
  rows: readonly SyncEntity[]; connected: boolean; busy: string | null; lines: Record<string, RunLine>;
  filters?: FilterDraft; filtersValid?: boolean;
  onSync: (e: SyncEntity, full: boolean) => void; onSchedule: (e: SyncEntity, v: EntitySchedule) => void; now?: Date;
}) {
  const filtered = hasFilters(filters);
  const setCount = (filters.since ? 1 : 0) + (filters.text.trim() ? 1 : 0) + (filters.activeOnly ? 1 : 0);
  return (
    <div className={s.listCard}>
      <table className={s.docTable}>
        <thead><tr><th>Entity</th><th>Last run</th><th>Automatic</th><th><span className="bpm-sr-only">Run now</span></th></tr></thead>
        <tbody>
          {rows.map((e) => {
            const off = !connected || !e.enabled || !!busy || e.running;
            const cannot = filtered ? unsupportedFilters(e.filters, filters) : [];
            // Every filter set is one this entity cannot express: a run would read the wrong thing, so it does not start.
            const nothingLeft = filtered && cannot.length >= setCount;
            return (
              <Fragment key={e.key}>
                <tr className={s.docRow}>
                  <td data-label="Entity"><span className={s.fieldName}>{entityWord(e.key)}</span>{!e.enabled && <span className={`${s.small} ${s.muted}`}>Switched off in Links</span>}</td>
                  <td data-label="Last run"><span className={s.small}>{lastRunLine(e, now)}</span></td>
                  <td data-label="Automatic">
                    <select className="bpm-input" aria-label={`Automatic sync for ${entityWord(e.key)}`} value={e.schedule} onChange={(ev) => onSchedule(e, ev.target.value as EntitySchedule)}>
                      {SCHEDULE_CHOICES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className={s.runCell}>
                    <span className={`${s.row} bpm-tap`}>
                      <Button size="sm" variant="primary" onClick={() => onSync(e, false)} loading={busy === `${e.key}:now`} disabled={off}>Sync now</Button>
                      <Button size="sm" onClick={() => onSync(e, true)} loading={busy === `${e.key}:full`} disabled={off || !filtersValid || nothingLeft}>Full resync</Button>
                    </span>
                  </td>
                </tr>
                {(cannot.length > 0 || lines[e.key]) && (
                  <tr className={s.docSub}>
                    <td colSpan={4}>
                      {cannot.length > 0 && <div className={`${s.small} ${s.muted}`}>{`Not available here: ${cannot.join(", ")}.`}</div>}
                      {lines[e.key] && <div className={lines[e.key].ok ? s.small : s.issue} role={lines[e.key].ok ? "status" : "alert"}>{lines[e.key].text}</div>}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Tab 2a: get specific records ────────────────────────────────────────────

function GetRecords({ connected }: { connected: boolean }) {
  const mw = useMw();
  const entities = mw.sync.data && mw.sync.data.connected ? mw.sync.data.entities.filter((e) => e.key !== "fence_projects" && e.enabled) : [];
  const [entity, setEntity] = useState<string>("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<RunLine | null>(null);
  const current = entities.find((e) => e.key === entity) ?? entities[0];
  const ids = parseRecordIds(text);
  const problem = recordIdsProblem(text) ?? numbersProblem(current?.filters, ids);

  const get = async () => {
    if (!current) return;
    setBusy(true); setLine(null);
    try { setLine(runLine(await runSelected(current.key, { ids }))); } catch (err) { setLine({ ok: false, text: describeError(err) }); } finally { setBusy(false); await mw.sync.reload(); }
  };

  return (
    <Card title="Get records from the ERP" info={MIDDLEWARE_TIPS.getRecords}>
      <div className={s.stack} style={{ gap: 12 }}>
        {entities.length === 0 && mw.sync.data ? <EmptyState title="Nothing to read yet" text="Switch an entity on under Links first." /> : (
          <>
            <Field label="Entity" htmlFor="gr-entity" style={{ marginBottom: 0 }}>
              <select id="gr-entity" className="bpm-input" value={current?.key ?? ""} onChange={(e) => { setEntity(e.target.value); setLine(null); }}>
                {entities.map((e) => <option key={e.key} value={e.key}>{entityWord(e.key)}</option>)}
              </select>
            </Field>
            <Field label="Ids or numbers" info={MIDDLEWARE_TIPS.recordIds} htmlFor="gr-ids" style={{ marginBottom: 0 }}>
              <textarea id="gr-ids" className={`bpm-input ${s.idsBox}`} autoComplete="off" spellCheck={false} value={text} onChange={(e) => { setText(e.target.value); setLine(null); }} />
            </Field>
            {problem && ids.length > 0 && <div className={s.issue} role="alert">{problem}</div>}
            <div className={`${s.row} bpm-tap`}>
              <Button variant="primary" onClick={() => void get()} loading={busy} disabled={!connected || busy || !current || current.running || ids.length === 0 || !!problem}>
                {ids.length ? `Get ${ids.length} record${ids.length === 1 ? "" : "s"}` : "Get records"}
              </Button>
            </div>
            {line && <div className={line.ok ? s.small : s.issue} role={line.ok ? "status" : "alert"}>{line.text}</div>}
          </>
        )}
      </div>
    </Card>
  );
}

// ── Tab 2b: send a record ───────────────────────────────────────────────────

function SendRecord({ connected }: { connected: boolean }) {
  const mw = useMw();
  const [type, setType] = useState<SendableObject>("standard_quotes");
  const [account, setAccount] = useState<AccountChoice | null>(null);
  const [quoteId, setQuoteId] = useState("");
  const quotes = useQuoteOptions();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const id = type === "accounts" ? account?.id ?? "" : quoteId;

  const send = async () => {
    setBusy(true); setProblem(null); setResult(null);
    try { setResult(await sendRecord(type, id)); await mw.reloadAll(); } catch (e) { setProblem(e); } finally { setBusy(false); }
  };

  return (
    <Card title="Send a record to the ERP" info={MIDDLEWARE_TIPS.sendRecord}>
      <div className={s.stack} style={{ gap: 12 }} aria-label="Send a record">
        <div className={s.fields}>
          <Field label="Kind of record" htmlFor="sr-type" style={{ marginBottom: 0 }}>
            <select id="sr-type" className="bpm-input" value={type} onChange={(e) => { setType(e.target.value as SendableObject); setResult(null); }}>
              {SENDABLE_OBJECTS.map((o) => <option key={o} value={o}>{SENDABLE_LABEL[o]}</option>)}
            </select>
          </Field>
          {type === "accounts"
            ? <AccountPick value={account} onChange={setAccount} />
            : <QuoteSelect value={quoteId} onChange={setQuoteId} options={quotes.data} loading={quotes.loading} error={quotes.error} onRetry={() => void quotes.reload()} label="Record" />}
        </div>
        <div className={`${s.row} bpm-tap`}>
          <Button onClick={() => void send()} loading={busy} disabled={!id || busy || !connected}>Send</Button>
        </div>
        {problem != null && <ProblemNotice error={problem} />}
        {result && <SendOutcome result={result} />}
      </div>
    </Card>
  );
}
