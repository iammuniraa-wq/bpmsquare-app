"use client";

import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select } from "@/components/ui/Input";
import { CheckOpt } from "@/components/ui/Opt";
import SidePanel from "@/components/ui/SidePanel";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { useFeel } from "@/components/FeelProvider";
import { useTenantFeatureByName } from "./flag";
import s from "./webhooks.module.css";
import {
  FieldProblem, InUseProblem, createWebhook, deleteWebhook, listTokens, updateWebhook,
  type FieldError, type ObjectChoice, type Webhook, type WebhookKind,
} from "./api";
import { Notice, Segmented, Switch, describeError, useLoad } from "../middleware/ui";
import {
  CALL_OBJECTS_FALLBACK, EVENT_OBJECTS, KIND_LABEL, buildInput, canResume, deleteBlockedWord, draftFromWebhook, draftProblems, emptyDraft, isDraftDirty,
  tabForField, targetWord, usedByLine, type Draft,
} from "./logic";
import { WEBHOOK_TIPS, kindTip } from "./tips";
import RequestTab from "./RequestTab";
import SecurityTab from "./SecurityTab";
import TestTab from "./TestTab";
import LogTab from "./LogTab";

const NEW_TABS = [{ id: "basics", label: "Basics" }, { id: "request", label: "Request" }];
const SAVED_TABS = [...NEW_TABS, { id: "security", label: "Security" }, { id: "test", label: "Test" }, { id: "log", label: "Log" }];
const TAB_IDS = SAVED_TABS.map((t) => t.id);

export default function WebhookPanel({ webhook, startKind, callObjects, recordButtonId, onClose, onChanged, onDeleted }: {
  /** null = a new webhook. After the first save the same panel carries on with the saved one. */
  webhook: Webhook | null;
  startKind: WebhookKind;
  callObjects: readonly ObjectChoice[];
  recordButtonId: string | null;
  onClose: () => void;
  onChanged: (w: Webhook) => void;
  onDeleted: (id: string) => void;
}) {
  const { confirm } = useFeel();
  const monitorLink = useTenantFeatureByName("integration_middleware");
  const objects = callObjects.length > 0 ? callObjects : CALL_OBJECTS_FALLBACK;
  const [current, setCurrent] = useState<Webhook | null>(webhook);
  const [buttonId, setButtonId] = useState<string | null>(recordButtonId);
  const [draft, setDraft] = useState<Draft>(() => (webhook ? draftFromWebhook(webhook, recordButtonId) : emptyDraft(startKind, objects[0]?.key)));
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldError[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [tab, setTab] = useUrlTab(TAB_IDS);
  const isNew = current === null;
  const visibleTab = isNew && !NEW_TABS.some((t) => t.id === tab) ? "basics" : tab;

  const tokens = useLoad(
    async () => (draft.kind === "call" && draft.objectType ? listTokens(draft.objectType) : []),
    [draft.kind, draft.objectType],
  );
  const tokenList = tokens.data ?? [];

  const patch = (p: Partial<Draft>) => { setDraft((d) => ({ ...d, ...p })); setServerErrors([]); setSaved(false); setError(null); };

  const dirty = isDraftDirty(draft, current, buttonId);
  const problems = useMemo(() => [...(attempted ? draftProblems(draft, tokenList) : []), ...serverErrors], [attempted, draft, tokenList, serverErrors]);
  const errors = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of problems) if (!(p.field in m)) m[p.field] = p.message;
    return m;
  }, [problems]);

  const save = async () => {
    setAttempted(true); setError(null); setSaved(false);
    const found = draftProblems(draft, tokenList);
    if (found.length > 0) { setTab(tabForField(found[0].field)); return; }
    setSaving(true);
    try {
      const input = buildInput(draft, current, buttonId);
      const r = current ? await updateWebhook(current.id, input) : await createWebhook(input);
      const nextButton = draft.buttonOnAccounts ? r.webhook.id : buttonId === r.webhook.id ? null : buttonId;
      setCurrent(r.webhook); setButtonId(nextButton);
      setDraft(draftFromWebhook(r.webhook, nextButton));
      setAttempted(false); setServerErrors([]); setSaved(true);
      if (r.revealedSecret) { setRevealed(r.revealedSecret); setTab("security"); }
      onChanged(r.webhook);
    } catch (e) {
      if (e instanceof FieldProblem) { setServerErrors(e.errors); setTab(tabForField(e.errors[0].field)); } else setError(describeError(e));
    } finally { setSaving(false); }
  };

  const resume = async () => {
    if (!current) return;
    setError(null);
    try {
      const r = await updateWebhook(current.id, { active: true });
      setCurrent(r.webhook); setDraft(draftFromWebhook(r.webhook, buttonId)); onChanged(r.webhook);
    } catch (e) { setError(describeError(e)); }
  };

  const remove = async () => {
    if (!current) return;
    if (!(await confirm({ title: `Delete "${current.name}"?`, body: "Calls to its address stop for good. The Monitor keeps the history for 2 days.", confirmLabel: "Delete", tone: "danger" }))) return;
    setBlocked(null);
    try { await deleteWebhook(current.id); onDeleted(current.id); }
    catch (e) { if (e instanceof InUseProblem) setBlocked(deleteBlockedWord(e.usedBy)); else setError(describeError(e)); }
  };

  const first = problems[0];
  return (
    <SidePanel
      title={current ? current.name : "New webhook"}
      subtitle={current ? `${KIND_LABEL[current.kind]} · ${targetWord(current)}` : undefined}
      label={current ? `Webhook ${current.name}` : "New webhook"}
      onClose={onClose}
      footer={
        <>
          {(first || error) && <div className={`${s.issue} ${s.footIssue}`} role="alert">{error ?? first.message}{!error && problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}</div>}
          {saved && !dirty && <span className={`${s.small} ${s.muted}`} role="status">Saved.</span>}
          <Button variant="primary" data-guide="webhooks.save" onClick={() => void save()} loading={saving} disabled={saving || (!isNew && !dirty)}>{isNew ? "Create" : "Save"}</Button>
        </>
      }
    >
      <div className={s.tabs}>
        <Tabs label="Webhook sections" tabs={isNew ? NEW_TABS : SAVED_TABS} value={visibleTab} onChange={setTab} />
      </div>

      {current && canResume(current) && (
        <Notice tone="warn" action={<Button size="sm" onClick={() => void resume()}>Resume</Button>}>
          <strong>{current.failure_count >= 15 ? "Paused after 15 failures." : "Paused."}</strong>{current.last_error ? <> {current.last_error}</> : null}
        </Notice>
      )}

      {visibleTab === "basics" && (
        <BasicsTab draft={draft} onChange={patch} errors={errors} current={current} objects={objects} onDelete={() => void remove()} blocked={blocked} />
      )}
      {visibleTab === "request" && (
        <RequestTab
          draft={draft} onChange={patch} errors={errors} attention={current?.needs_attention ?? null}
          tokens={tokenList} tokensLoading={tokens.loading} tokensError={tokens.error != null && !tokens.data ? describeError(tokens.error) : null}
          webhook={current ? { id: current.id, name: current.name } : null}
        />
      )}
      {current && visibleTab === "security" && (
        <SecurityTab webhook={current} revealed={revealed} onRevealed={setRevealed} onChanged={(w) => { setCurrent(w); onChanged(w); }} />
      )}
      {current && visibleTab === "test" && <TestTab webhook={current} blocked={dirty} monitorLink={monitorLink} />}
      {current && visibleTab === "log" && <LogTab webhookId={current.id} monitorLink={monitorLink} />}
    </SidePanel>
  );
}

// ── Basics ──────────────────────────────────────────────────────────────────

export function BasicsTab({ draft, onChange, errors, current, objects, onDelete, blocked }: {
  draft: Draft; onChange: (p: Partial<Draft>) => void; errors: Record<string, string | undefined>; current: Webhook | null;
  objects: readonly ObjectChoice[]; onDelete: () => void; blocked: string | null;
}) {
  const allEvents = draft.objectTypes.includes("*");
  const toggleObject = (key: string, on: boolean) =>
    onChange({ objectTypes: on ? [...draft.objectTypes.filter((k) => k !== "*"), key] : draft.objectTypes.filter((k) => k !== key) });

  return (
    <>
      <Field label="Name" htmlFor="wh-name" error={errors.name} style={{ marginBottom: 0 }}>
        <Input id="wh-name" value={draft.name} maxLength={80} invalid={!!errors.name} autoComplete="off" onChange={(e) => onChange({ name: e.target.value })} />
      </Field>

      <section className={s.block} aria-label="Kind">
        <div className="bpm-label-row">
          <h3 className="bpm-t-label">Kind</h3>
          <InfoTip label="Kind">{current ? kindTip(current.kind) : WEBHOOK_TIPS.kind}</InfoTip>
        </div>
        {current
          ? <div className={s.row}><span className={`${s.chip} ${current.kind === "call" ? s.chipCall : s.chipEvent}`}>{KIND_LABEL[current.kind]}</span></div>
          : <Segmented<WebhookKind>
              label="Kind" value={draft.kind}
              options={[{ id: "call", label: "Call" }, { id: "event", label: "Event" }]}
              onChange={(kind) => onChange(kind === "call" ? { kind, objectType: draft.objectType || objects[0]?.key || "", objectTypes: [] } : { kind, objectType: "", objectTypes: ["*"], buttonOnAccounts: false })}
            />}
      </section>

      {draft.kind === "call" ? (
        <>
          <Field label="Sends" info={WEBHOOK_TIPS.objectType} htmlFor="wh-object" error={errors.object_type} style={{ marginBottom: 0 }}>
            <Select id="wh-object" value={draft.objectType} disabled={!!current} onChange={(e) => onChange({ objectType: e.target.value, buttonOnAccounts: e.target.value === "accounts" && draft.buttonOnAccounts })}>
              {objects.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </Select>
          </Field>
          {draft.objectType === "accounts" && (
            <CheckOpt label="Button on Accounts" info={WEBHOOK_TIPS.button} checked={draft.buttonOnAccounts} onChange={(buttonOnAccounts) => onChange({ buttonOnAccounts })} />
          )}
        </>
      ) : (
        <section className={s.block} aria-label="Changes sent">
          <div className="bpm-label-row"><h3 className="bpm-t-label">Changes sent</h3><InfoTip label="Changes sent">{WEBHOOK_TIPS.events}</InfoTip></div>
          <div className={s.checkList}>
            <CheckOpt label="All objects" checked={allEvents} onChange={(on) => onChange({ objectTypes: on ? ["*"] : [] })} />
            {!allEvents && EVENT_OBJECTS.map((o) => (
              <CheckOpt key={o.key} label={o.label} checked={draft.objectTypes.includes(o.key)} onChange={(on) => toggleObject(o.key, on)} />
            ))}
          </div>
          {errors.object_types && <div className={s.issue} role="alert">{errors.object_types}</div>}
        </section>
      )}

      <div className={s.switchRow}>
        <span className="bpm-label-row"><span className="bpm-t-label">{draft.active ? "On" : "Off"}</span><InfoTip label="On or off">{WEBHOOK_TIPS.active}</InfoTip></span>
        <Switch checked={draft.active} label={`${draft.name || "Webhook"}: ${draft.active ? "on" : "off"}`} onChange={(active) => onChange({ active })} />
      </div>

      {current && current.used_by.length > 0 && (
        <section className={s.block} aria-label="Used by">
          <div className="bpm-label-row"><h3 className="bpm-t-label">Used by</h3><InfoTip label="Used by">{WEBHOOK_TIPS.usedBy}</InfoTip></div>
          <ul className={s.usedList}>{current.used_by.map((u) => <li key={`${u.kind}:${u.label}`}><span className={`${s.chip} ${s.chipUse}`}>{usedByLine(u)}</span></li>)}</ul>
        </section>
      )}

      {current && (
        <section className={s.block} aria-label="Delete">
          {blocked && <Notice tone="warn">{blocked}</Notice>}
          <div><Button variant="danger" size="sm" onClick={onDelete}>Delete webhook</Button></div>
        </section>
      )}
    </>
  );
}
