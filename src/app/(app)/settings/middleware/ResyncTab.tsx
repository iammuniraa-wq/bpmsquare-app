"use client";

import { Fragment, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import s from "./middleware.module.css";
import {
  SENDABLE_LABEL, SENDABLE_OBJECTS, getSync, runSync, sendRecord, setSchedule,
  type AccountChoice, type EntitySchedule, type SendResult, type SendableObject, type SyncEntity,
} from "./api";
import { useMw } from "./context";
import { SCHEDULE_CHOICES, lastRunLine, parseRecordIds } from "./resyncLogic";
import { MIDDLEWARE_TIPS } from "./tips";
import { Notice, ProblemNotice, describeError, useLoad } from "./ui";
import { AccountPick, QuoteSelect, useQuoteOptions } from "./Pickers";
import { SendOutcome } from "./SendOutcome";

// Resync moves DATA on demand: read an entity from the ERP now, on a schedule, or
// only some records of it; send one record by hand. Messages, history and failures
// are the Monitor's and never appear here.

const ENTITY_WORD: Record<string, string> = { customers: "Customers", contacts: "Contacts", vendors: "Vendors", products: "Products", projects: "Projects" };
export const entityWord = (key: string): string => ENTITY_WORD[key] ?? key;

export default function ResyncTab() {
  const mw = useMw();
  const connected = mw.health.data?.connection.connected === true;
  return (
    <>
      <EntitiesTable connected={connected} connectorId={mw.connector.id} />
      <SendRecord connected={connected} />
    </>
  );
}

// ── One row per inbound entity ──────────────────────────────────────────────

function EntitiesTable({ connected, connectorId }: { connected: boolean; connectorId: string }) {
  const sync = useLoad(getSync, [connectorId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [lines, setLines] = useState<Record<string, string>>({});
  const [onlyOpen, setOnlyOpen] = useState<Record<string, boolean>>({});
  const [only, setOnly] = useState<Record<string, string>>({});
  const rows = sync.data && sync.data.connected ? sync.data.entities.filter((e) => e.key !== "fence_projects") : [];
  const anyRunning = rows.some((e) => e.running);

  useEffect(() => {
    if (!anyRunning && !busy) return;
    const t = setInterval(() => void sync.reload(), 4000);
    return () => clearInterval(t);
  }, [anyRunning, busy, sync]);

  const run = async (e: SyncEntity, full: boolean) => {
    const ids = parseRecordIds(only[e.key] ?? "");
    setBusy(`${e.key}:${full ? "full" : "now"}`); setProblem(null);
    setLines((x) => { const { [e.key]: _drop, ...rest } = x; void _drop; return rest; });
    try {
      await runSync(e.key, full, ids);
    } catch (err) {
      setLines((x) => ({ ...x, [e.key]: describeError(err) }));
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
        <EntityRows
          rows={rows} connected={connected} busy={busy} lines={lines} onlyOpen={onlyOpen} only={only}
          onSync={(e, full) => void run(e, full)} onSchedule={(e, v) => void schedule(e, v)}
          onToggleOnly={(k) => setOnlyOpen((x) => ({ ...x, [k]: !x[k] }))} onOnly={(k, v) => setOnly((x) => ({ ...x, [k]: v }))}
        />
      )}
    </section>
  );
}

/** The table itself, plain props only. Under 780 px each row becomes a card. */
export function EntityRows({ rows, connected, busy, lines, onlyOpen, only, onSync, onSchedule, onToggleOnly, onOnly, now }: {
  rows: readonly SyncEntity[]; connected: boolean; busy: string | null; lines: Record<string, string>;
  onlyOpen: Record<string, boolean>; only: Record<string, string>;
  onSync: (e: SyncEntity, full: boolean) => void; onSchedule: (e: SyncEntity, v: EntitySchedule) => void;
  onToggleOnly: (key: string) => void; onOnly: (key: string, v: string) => void; now?: Date;
}) {
  return (
    <div className={s.listCard}>
      <table className={s.docTable}>
        <thead><tr><th>Entity</th><th>Last run</th><th>Automatic</th><th><span className="bpm-sr-only">Run now</span></th></tr></thead>
        <tbody>
          {rows.map((e) => {
            const idCount = parseRecordIds(only[e.key] ?? "").length;
            const off = !connected || !e.enabled || !!busy || e.running;
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
                      <Button size="sm" onClick={() => onSync(e, true)} loading={busy === `${e.key}:full`} disabled={off}>Full resync</Button>
                      <Button size="sm" variant="quiet" aria-expanded={!!onlyOpen[e.key]} onClick={() => onToggleOnly(e.key)}>{idCount ? `Only ${idCount} record${idCount === 1 ? "" : "s"}` : "Only some records"}</Button>
                    </span>
                  </td>
                </tr>
                {(onlyOpen[e.key] || lines[e.key]) && (
                  <tr className={s.docSub}>
                    <td colSpan={4}>
                      {onlyOpen[e.key] && (
                        <Field label="Only these records" info={MIDDLEWARE_TIPS.onlyThese} htmlFor={`only-${e.key}`} style={{ marginBottom: 0 }}>
                          <input id={`only-${e.key}`} className="bpm-input" autoComplete="off" value={only[e.key] ?? ""} placeholder="Ids or numbers, separated by commas" onChange={(ev) => onOnly(e.key, ev.target.value)} />
                        </Field>
                      )}
                      {lines[e.key] && <div className={s.issue} role="alert">{lines[e.key]}</div>}
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

// ── Send a record ───────────────────────────────────────────────────────────

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
    <section className={s.stack} style={{ gap: 10 }} aria-label="Send a record">
      <div className="bpm-label-row"><h3 className="bpm-t-label">Send a record</h3><InfoTip label="Send a record">{MIDDLEWARE_TIPS.sendRecord}</InfoTip></div>
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
    </section>
  );
}
