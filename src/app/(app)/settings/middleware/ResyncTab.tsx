"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import D365Runs from "@/components/connectors/D365Runs";
import SyncRow from "@/components/connectors/SyncRow";
import { useD365Runs } from "@/components/connectors/useD365Runs";
import { countsLine, pickResult, type SyncResult } from "@/lib/connectors/d365/runSummary";
import s from "./middleware.module.css";
import {
  SENDABLE_LABEL, SENDABLE_OBJECTS, getMessage, getMessages, getSync, retryMessage, runSync, sendRecord, setSchedule,
  type AccountChoice, type EntitySchedule, type MonitorMessage, type SendResult, type SendableObject, type SyncEntity,
} from "./api";
import { useMw } from "./context";
import { filtersToQuery, recordTypeWord } from "./monitorLogic";
import { MIDDLEWARE_TIPS } from "./tips";
import { Notice, ProblemNotice, describeError, useLoad } from "./ui";
import { AccountPick, QuoteSelect, useQuoteOptions } from "./Pickers";
import { SendOutcome } from "./OutTab";

const SCHEDULES: { id: EntitySchedule; label: string }[] = [{ id: "off", label: "Off" }, { id: "hourly", label: "Every hour" }, { id: "daily", label: "Daily" }];

export default function ResyncTab() {
  const mw = useMw();
  const connected = mw.health.data?.connection.connected === true;
  return (
    <>
      <FailedItems />
      <SendRecord connected={connected} />
      <SyncSection connected={connected} connectorId={mw.connector.id} />
    </>
  );
}

// ── Failed items ────────────────────────────────────────────────────────────

function FailedItems() {
  const mw = useMw();
  const system = mw.connector.shortName;
  const list = useLoad(async () => {
    const [failed, waiting] = await Promise.all([
      getMessages(filtersToQuery({ direction: "out", channel: "connector", status: "failed" }, { limit: 30 })),
      getMessages(filtersToQuery({ direction: "out", channel: "connector", status: "pending" }, { limit: 30 })),
    ]);
    return { items: [...waiting.items, ...failed.items], update: failed.needsDatabaseUpdate, bundle: failed.bundle };
  }, [mw.connector.id]);

  const items = list.data?.items ?? [];
  return (
    <Card title="Needs attention" info={MIDDLEWARE_TIPS.failed} action={<Button size="sm" onClick={() => void list.reload()} loading={list.loading}>Refresh</Button>}>
      {list.error != null && <ProblemNotice error={list.error} onRetry={() => void list.reload()} />}
      {list.data?.update && <Notice tone="warn">A database update is needed{list.data.bundle ? `: run ${list.data.bundle} once` : ""}.</Notice>}
      {list.data && !list.data.update && items.length === 0 && (
        <EmptyState title="Nothing is stuck" text={`Everything sent to ${system} arrived. A failed or waiting item shows here with a Retry button.`} />
      )}
      {items.map((m) => <FailedItem key={m.id} m={m} onDone={() => { void list.reload(); void mw.reloadAll(); }} />)}
    </Card>
  );
}

function FailedItem({ m, onDone }: { m: MonitorMessage; onDone: () => void }) {
  const [busy, setBusy] = useState<"retry" | "details" | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [fix, setFix] = useState<{ fix: string | null; raw: string | null } | null>(null);
  const canRetry = m.record?.type === "standard_quotes";

  const retry = async () => {
    setBusy("retry"); setProblem(null);
    try { const r = await retryMessage(m.id); setResult(r); if (r.ok) onDone(); } catch (e) { setProblem(e); } finally { setBusy(null); }
  };
  const details = async () => {
    setBusy("details"); setProblem(null);
    try {
      const r = await getMessage(m.id);
      if ("detail" in r) {
        const sum = (r.detail.summary ?? {}) as Record<string, unknown>;
        setFix({ fix: typeof sum.fix === "string" ? sum.fix : null, raw: typeof r.detail.error === "string" ? r.detail.error : null });
      }
    } catch (e) { setProblem(e); } finally { setBusy(null); }
  };

  return (
    <div className={s.failItem}>
      <div className={s.rowBetween}>
        <span className="bpm-t-label">{m.status === "pending" ? "Waiting" : "Failed"} · {m.record?.label ?? (m.record ? recordTypeWord(m.record.type) : m.summary)}</span>
        <span className={`${s.row} bpm-tap`}>
          {!fix && <Button size="sm" onClick={() => void details()} loading={busy === "details"} disabled={!!busy}>Details</Button>}
          {canRetry && <Button size="sm" variant="primary" onClick={() => void retry()} loading={busy === "retry"} disabled={!!busy}>{m.status === "pending" ? "Send" : "Retry"}</Button>}
        </span>
      </div>
      <div className={`${s.small} ${s.wrapAny}`}>{m.summary}</div>
      {fix?.fix && <div className={s.small}><span className={s.noticeStrong}>What to do:</span> {fix.fix}</div>}
      {fix?.raw && (
        <details><summary style={{ cursor: "pointer", minHeight: 32 }} className={`${s.small} ${s.muted}`}>The ERP&apos;s own message</summary><pre className={`${s.raw} ${s.mono}`} tabIndex={0}>{fix.raw}</pre></details>
      )}
      {!canRetry && <div className={`${s.small} ${s.muted}`}>Run the sync again below once the cause is fixed.</div>}
      {result && <SendOutcome result={result} />}
      {problem != null && <ProblemNotice error={problem} />}
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
    <Card title="Send a record" info={MIDDLEWARE_TIPS.sendRecord}>
      <div className={s.stack}>
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
          <Button variant="primary" onClick={() => void send()} loading={busy} disabled={!id || busy || (type === "standard_quotes" && !connected)}>Send</Button>
        </div>
        {problem != null && <ProblemNotice error={problem} />}
        {result && <SendOutcome result={result} />}
      </div>
    </Card>
  );
}

// ── Sync per entity, schedule and history ───────────────────────────────────

const toResult = (e: SyncEntity): SyncResult | null => {
  const r = e.last_run;
  if (!r || r.status === "running") return null;
  const ok = r.status === "succeeded" || r.status === "partial";
  return { ok, text: r.error && !ok ? r.error : countsLine(r.counts), at: r.finished_at ?? r.started_at };
};

function SyncSection({ connected, connectorId }: { connected: boolean; connectorId: string }) {
  const sync = useLoad(getSync, [connectorId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [session, setSession] = useState<Record<string, SyncResult>>({});
  const [problem, setProblem] = useState<unknown>(null);
  const hist = useD365Runs({ url: `/api/connectors/${connectorId}/runs`, active: !!busy });
  const rows = sync.data && sync.data.connected ? sync.data.entities.filter((e) => e.key !== "fence_projects") : [];
  const anyRunning = rows.some((e) => e.running);

  useEffect(() => {
    if (!anyRunning && !busy) return;
    const t = setInterval(() => void sync.reload(), 4000);
    return () => clearInterval(t);
  }, [anyRunning, busy, sync]);

  const run = async (e: SyncEntity, full: boolean) => {
    setBusy(`sync-${e.key}`); setProblem(null);
    try {
      const r = await runSync(e.key, full);
      setSession((x) => ({ ...x, [e.key]: { ok: true, text: countsLine(r.counts), issues: r.issues?.length ? r.issues : undefined, at: new Date().toISOString() } }));
    } catch (err) {
      setSession((x) => ({ ...x, [e.key]: { ok: false, text: describeError(err), at: new Date().toISOString() } }));
    } finally {
      setBusy(null);
      await Promise.all([sync.reload(), hist.refresh()]);
    }
  };
  const schedule = async (e: SyncEntity, value: EntitySchedule) => {
    setProblem(null);
    try { await setSchedule(e.key, value); await sync.reload(); } catch (err) { setProblem(err); }
  };

  return (
    <>
      <div className={s.rowBetween} style={{ marginTop: 6 }}>
        <span className="bpm-label-row"><h2 className="bpm-t-section">Pull from the ERP</h2><InfoTip label="Pull from the ERP">{MIDDLEWARE_TIPS.syncNow}</InfoTip></span>
      </div>
      {sync.error != null && <ProblemNotice error={sync.error} onRetry={() => void sync.reload()} />}
      {problem != null && <ProblemNotice error={problem} />}
      {sync.data && sync.data.connected && sync.data.pending_migration && <Notice tone="warn">A database update is needed before runs can be recorded.</Notice>}
      {sync.data && !sync.data.connected && (
        <EmptyState title="Connect an ERP first" text="Syncing starts once there is a connection." />
      )}
      {rows.map((e) => (
        <SyncRow
          key={e.key} entityKey={e.key} label={e.label} direction={e.direction}
          subtitle={`${e.running ? "Running · " : ""}${e.linked} linked`}
          enabled={e.enabled} connected={connected} busy={busy}
          result={pickResult(session[e.key], toResult(e))}
          onSync={(full) => void run(e, full)}
          actions={
            <label className="bpm-label-row" style={{ gap: 6 }}>
              <span className="bpm-sr-only">Automatic sync for {e.label}</span>
              <select className="bpm-input" style={{ width: "auto", minWidth: 120 }} value={e.schedule} onChange={(ev) => void schedule(e, ev.target.value as EntitySchedule)} aria-label={`Automatic sync for ${e.label}`}>
                {SCHEDULES.map((o) => <option key={o.id} value={o.id}>{o.id === "off" ? "Auto: off" : `Auto: ${o.label.toLowerCase()}`}</option>)}
              </select>
            </label>
          }
        />
      ))}
      {rows.length > 0 && <div className="bpm-label-row" style={{ justifyContent: "flex-end" }}><span className={`${s.small} ${s.muted}`}>Automatic sync</span><InfoTip label="Automatic sync">{MIDDLEWARE_TIPS.schedule}</InfoTip></div>}

      <D365Runs runs={hist.runs} loading={hist.loading} onRefresh={() => void hist.refresh()} pending={busy ? [{ entity: busy.replace("sync-", ""), label: "Running" }] : []} />
    </>
  );
}
