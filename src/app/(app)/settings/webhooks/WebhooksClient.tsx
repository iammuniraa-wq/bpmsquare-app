"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import s from "./webhooks.module.css";
import { listWebhooks, updateWebhook, type Webhook } from "./api";
import { Notice, PlusIcon, ProblemNotice, describeError, useLoad } from "../middleware/ui";
import { KIND_LABEL, canResume, lastCallWord, targetWord, usedByChip, usedByLine, webhookState, type StateKey } from "./logic";
import WebhookPanel from "./WebhookPanel";

type Selected = { key: string; id: string | null };

// One list, two kinds. A row opens the side panel; the panel does everything else. Admin and the flag are enforced by
// the page and by every route, so this client never has to decide who may see it.

export default function WebhooksClient() {
  const list = useLoad(listWebhooks, []);
  const [sel, setSel] = useState<Selected | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = list.data;

  if (list.error != null && !data) return <ProblemNotice error={list.error} onRetry={() => void list.reload()} />;
  if (!data) return <div className={`${s.small} ${s.muted}`} role="status">Loading…</div>;

  const open = sel?.id ? data.webhooks.find((w) => w.id === sel.id) ?? null : null;
  const patchList = (w: Webhook) => {
    const exists = data.webhooks.some((x) => x.id === w.id);
    list.setData({ ...data, webhooks: exists ? data.webhooks.map((x) => (x.id === w.id ? w : x)) : [...data.webhooks, w] });
    void list.reload();
  };
  const resume = async (w: Webhook) => {
    setError(null);
    try { patchList((await updateWebhook(w.id, { active: true })).webhook); } catch (e) { setError(describeError(e)); }
  };

  return (
    <div className={s.shell}>
      {data.needsDatabaseUpdate && (
        <Notice tone="info">Database update needed{data.bundle ? <>: run <span className={s.mono}>{data.bundle}</span></> : "."}</Notice>
      )}
      {error && <Notice tone="err">{error}</Notice>}

      <div className={s.rowBetween}>
        <span className={`${s.small} ${s.muted}`} aria-live="polite">{data.webhooks.length === 0 ? "" : `${data.webhooks.length} webhook${data.webhooks.length === 1 ? "" : "s"}`}</span>
        {!data.needsDatabaseUpdate && (
          <Button variant="primary" icon={<PlusIcon />} onClick={() => setSel({ key: "new", id: null })}>New webhook</Button>
        )}
      </div>

      <div className={s.card}>
        {data.webhooks.length === 0 ? (
          <EmptyState
            title="No webhooks yet"
            text="Create one to send changes or records to another system."
            action={data.needsDatabaseUpdate ? undefined : <Button variant="primary" icon={<PlusIcon />} onClick={() => setSel({ key: "new", id: null })}>New webhook</Button>}
          />
        ) : (
          <WebhookRows items={data.webhooks} onOpen={(w) => setSel({ key: w.id, id: w.id })} onResume={(w) => void resume(w)} />
        )}
      </div>

      {sel && (sel.id === null || open) && (
        <WebhookPanel
          key={sel.key}
          webhook={open}
          startKind="call"
          callObjects={data.objects}
          recordButtonId={data.recordButtons.accounts}
          onClose={() => setSel(null)}
          onChanged={patchList}
          onDeleted={(id) => { list.setData({ ...data, webhooks: data.webhooks.filter((w) => w.id !== id) }); setSel(null); void list.reload(); }}
        />
      )}
    </div>
  );
}

// ── The rows ────────────────────────────────────────────────────────────────

const DOT: Record<StateKey, string> = { on: `${s.dot} ${s.dotOn}`, off: s.dot, paused: `${s.dot} ${s.dotWarn}`, attention: `${s.dot} ${s.dotWarn}` };

export function WebhookRows({ items, onOpen, onResume, now }: { items: readonly Webhook[]; onOpen: (w: Webhook) => void; onResume: (w: Webhook) => void; now?: Date }) {
  return (
    <div role="list" aria-label="Webhooks">
      <div className={s.listHead} aria-hidden="true">
        <span>Kind</span><span>Webhook</span><span>State</span><span>Last call</span><span>Used by</span><span />
      </div>
      {items.map((w) => {
        const st = webhookState(w);
        const chip = usedByChip(w.used_by);
        return (
          <div key={w.id} className={s.item} role="listitem">
            <span className={`${s.kindCell}`}><span className={`${s.chip} ${w.kind === "call" ? s.chipCall : s.chipEvent}`}>{KIND_LABEL[w.kind]}</span></span>
            <button type="button" className={s.open} onClick={() => onOpen(w)} aria-label={`${w.name}: open`}>
              <span className={s.name}>{w.name}</span>
              <span className={`${s.target} ${s.mono}`}>{targetWord(w)}</span>
            </button>
            <span className={`${s.stateCell} ${st.key === "attention" ? s.stateAttention : ""}`}>
              <span className={DOT[st.key]} aria-hidden="true" />
              <span>{st.word}{st.key === "attention" && w.needs_attention ? <span className={`${s.small} ${s.muted}`}> · {w.needs_attention}</span> : null}</span>
            </span>
            <span className={s.lastCell}>{lastCallWord(w, now)}</span>
            <span className={s.usedCell}>
              {chip ? <span className={`${s.chip} ${s.chipUse}`} title={w.used_by.map(usedByLine).join("\n")}>{chip}</span> : null}
            </span>
            <span className={s.actionCell}>
              {canResume(w) ? <Button size="sm" onClick={() => onResume(w)} aria-label={`Resume ${w.name}`}>Resume</Button> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
