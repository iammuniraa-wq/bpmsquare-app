"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { MAX_SCOPE_CONDITIONS, SCOPE_CHANGED_LINE, type ScopeAttribute } from "@/lib/connectors/d365/scope";
import s from "./middleware.module.css";
import { getScope, getScopeValues, saveScope, type ScopeEntityKey, type ScopeValuesData, type ScopeViewData } from "./api";
import {
  addCondition, draftFromScope, draftToSave, parseTypedValues, removeCondition, sameDraft, scopeProblem, setConditionAttribute, toggleConditionValue,
  type ConditionDraft, type ScopeDraft,
} from "./resyncLogic";
import { MIDDLEWARE_TIPS } from "./tips";
import { Notice, PlusIcon, ProblemNotice, describeError, useLoad } from "./ui";
import Panel from "./Panel";

// The Scope of one entity: which records of the connected system every run reads. One side panel, rows of
// [Attribute] [is any of] [values], at most five, AND between rows and OR inside a row.

const attributeName = (a: ScopeAttribute) => (a.via === "customer" ? `Customer: ${a.label}` : a.label);

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function ScopePanel({ entity, entityName, onClose, onSaved }: {
  entity: ScopeEntityKey; entityName: string; onClose: () => void; onSaved: () => Promise<void> | void;
}) {
  const view = useLoad(() => getScope(entity), [entity]);
  const [draft, setDraft] = useState<ScopeDraft>([]);
  const [base, setBase] = useState<ScopeDraft>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const adopt = (v: ScopeViewData) => { const d = draftFromScope(v.conditions); setDraft(d); setBase(d); };
  useEffect(() => { if (view.data) adopt(view.data); }, [view.data]);

  const attributes = view.data?.attributes ?? [];
  const problem = view.data ? scopeProblem(draft, attributes) : null;
  const dirty = !sameDraft(draft, base);

  const persist = async (next: ScopeDraft) => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const saved = await saveScope(entity, draftToSave(next));
      view.setData(saved);
      adopt(saved);
      setNotice(saved.needs_full ? SCOPE_CHANGED_LINE : "Saved.");
      await onSaved();
    } catch (e) { setError(describeError(e)); } finally { setSaving(false); }
  };

  return (
    <Panel
      title={`Scope: ${entityName}`} subtitle="Every run reads only the records that match" onClose={onClose} label={`Scope for ${entityName}`}
      footer={
        <>
          {error && <div className={s.issue} role="alert">{error}</div>}
          {problem && !error && draft.length > 0 && <div className={s.issue} role="alert">{problem}</div>}
          {notice && !error && <span className={`${s.small} ${s.muted}`} role="status">{notice}</span>}
          {(base.length > 0 || draft.length > 0) && <Button variant="quiet" onClick={() => void persist([])} disabled={saving}>Clear</Button>}
          <Button variant="primary" onClick={() => void persist(draft)} loading={saving} disabled={saving || !dirty || !!problem}>Save</Button>
        </>
      }
    >
      <div className="bpm-label-row"><h3 className="bpm-t-label">Read only records where</h3><InfoTip label="Scope">{MIDDLEWARE_TIPS.scope}</InfoTip></div>
      {view.error != null && <ProblemNotice error={view.error} onRetry={() => void view.reload()} />}
      {view.loading && !view.data && <span className={`${s.small} ${s.muted}`} role="status">Loading the system&apos;s fields…</span>}
      {view.data?.source === "presets" && <Notice tone="warn">The system&apos;s field list could not be read, so only the common attributes are offered.</Notice>}
      {view.data && (
        <>
          {draft.length === 0 && <p className={s.greyLine}>All {entityName.toLowerCase()}. Add a condition to read only some.</p>}
          {draft.map((c, i) => (
            <ConditionRow
              key={i} entity={entity} index={i} cond={c} attributes={attributes}
              onAttribute={(id) => setDraft((d) => setConditionAttribute(d, i, id))}
              onValues={(values, labels) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, values, labels } : x)))}
              onToggle={(value, label) => setDraft((d) => toggleConditionValue(d, i, value, label))}
              onRemove={() => setDraft((d) => removeCondition(d, i))}
            />
          ))}
          <div className={`${s.row} bpm-tap`}>
            <Button size="sm" onClick={() => setDraft((d) => addCondition(d, attributes))} disabled={draft.length >= MAX_SCOPE_CONDITIONS || draft.length >= attributes.length}>
              <PlusIcon /> Add condition
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

function ConditionRow({ entity, index, cond, attributes, onAttribute, onValues, onToggle, onRemove }: {
  entity: ScopeEntityKey; index: number; cond: ConditionDraft; attributes: readonly ScopeAttribute[];
  onAttribute: (id: string) => void; onValues: (values: string[], labels: string[]) => void; onToggle: (value: string, label: string) => void; onRemove: () => void;
}) {
  const current = attributes.find((a) => a.id === cond.id);
  const [more, setMore] = useState(false);
  const common = attributes.filter((a) => a.common || a.id === cond.id);
  const rest = attributes.filter((a) => !a.common && a.id !== cond.id);
  return (
    <section className={s.condCard} aria-label={`Condition ${index + 1}`}>
      <div className={`${s.row} bpm-tap`}>
        <div className={s.grow}>
          <label className="bpm-sr-only" htmlFor={`sc-attr-${index}`}>Attribute</label>
          <select id={`sc-attr-${index}`} className="bpm-input" value={current ? cond.id : ""} onChange={(e) => onAttribute(e.target.value)}>
            {!current && <option value="" disabled>{cond.id ? "Not in the system any more" : "Choose…"}</option>}
            {common.map((a) => <option key={a.id} value={a.id}>{attributeName(a)}</option>)}
            {more && rest.length > 0 && <optgroup label="More attributes">{rest.map((a) => <option key={a.id} value={a.id}>{attributeName(a)}</option>)}</optgroup>}
          </select>
        </div>
        <span className={`${s.small} ${s.muted} ${s.nowrap}`}>is any of</span>
        <Button size="sm" variant="quiet" onClick={onRemove} aria-label={`Remove condition ${index + 1}`}>Remove</Button>
      </div>
      <div className={s.row}>
        {rest.length > 0 && !more && <button type="button" className={s.linkBtn} onClick={() => setMore(true)}>More attributes</button>}
        {current?.via === "customer" ? <InfoTip label="Customer attribute">{MIDDLEWARE_TIPS.scopeCustomer}</InfoTip> : null}
      </div>
      {current && <ValuePicker key={current.id} entity={entity} attribute={current} cond={cond} onValues={onValues} onToggle={onToggle} />}
    </section>
  );
}

function ValuePicker({ entity, attribute, cond, onValues, onToggle }: {
  entity: ScopeEntityKey; attribute: ScopeAttribute; cond: ConditionDraft; onValues: (values: string[], labels: string[]) => void; onToggle: (value: string, label: string) => void;
}) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [typed, setTyped] = useState(() => cond.values.join(", "));
  const list = useLoad<ScopeValuesData>(() => getScopeValues(entity, attribute.id, q), [entity, attribute.id, q]);
  const isTyped = list.data?.typed === true;

  return (
    <div className={s.stack} style={{ gap: 8 }}>
      {cond.values.length > 0 && !isTyped && (
        <div className={s.valueChips} role="list" aria-label="Chosen values">
          {cond.values.map((v, i) => (
            <button key={v} type="button" role="listitem" className={s.valueChip} onClick={() => onToggle(v, cond.labels[i] ?? v)} aria-label={`Remove ${cond.labels[i] ?? v}`}>
              {cond.labels[i] ?? v} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      {list.error != null && !isTyped && <ProblemNotice error={list.error} onRetry={() => void list.reload()} />}
      {isTyped ? (
        <>
          <label className="bpm-sr-only" htmlFor={`sc-typed-${attribute.id}`}>Values</label>
          <textarea
            id={`sc-typed-${attribute.id}`} className={`bpm-input ${s.idsBox}`} autoComplete="off" spellCheck={false} value={typed} placeholder="Separate values with commas"
            onChange={(e) => { setTyped(e.target.value); const v = parseTypedValues(e.target.value); onValues(v, v); }}
          />
        </>
      ) : (
        <>
          {(list.data?.more || q) && (
            <>
              <label className="bpm-sr-only" htmlFor={`sc-find-${attribute.id}`}>Search</label>
              <input id={`sc-find-${attribute.id}`} className="bpm-input" type="search" autoComplete="off" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
            </>
          )}
          {list.loading && !list.data && <span className={`${s.small} ${s.muted}`} role="status">Loading…</span>}
          {list.data && list.data.values.length === 0 && !list.loading && <span className={`${s.small} ${s.muted}`}>{q ? "Nothing matches." : "The system lists no values for this attribute."}</span>}
          {list.data && list.data.values.length > 0 && (
            <div className={s.valueList} role="group" aria-label="Values">
              {list.data.values.map((v) => (
                <label key={v.value} className={s.valueOpt}>
                  <input type="checkbox" checked={cond.values.some((x) => x.toLowerCase() === v.value.toLowerCase())} onChange={() => onToggle(v.value, v.label)} />
                  <span className={s.wrapAny}>{v.label}</span>
                </label>
              ))}
            </div>
          )}
          {list.data?.more && <span className={`${s.small} ${s.muted}`}>Showing the first {list.data.values.length}. Search to narrow.</span>}
        </>
      )}
    </div>
  );
}
