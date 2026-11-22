"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import MoreMenu from "@/components/ui/MoreMenu";
import { CheckOpt } from "@/components/ui/Opt";
import { useFeel } from "@/components/FeelProvider";
import {
  DIRECTION_LABEL, OBJECT_LABEL, RUN_MODE_LABEL, RUN_MODES, SCHEDULES, methodsFor, operationLine, runLine, type EndpointObject, type PublicEndpoint,
} from "@/lib/connections/endpointSpec";
import type { PublicConnection } from "@/lib/connections/spec";
import { ENDPOINT_TIPS } from "@/lib/connections/tips";
import s from "./middleware.module.css";
import {
  addCustomEndpoints, deleteCustomEndpoint, discoverEndpoints, getCustomEndpoints, getEndpointTemplates, tryCustomEndpoint, updateCustomEndpoint,
  type EndpointCandidate, type EndpointDraft, type EndpointTemplateView,
} from "./api";
import { OBJECT_OPTIONS, candidateToDraft, draftFromEndpoint, draftProblem, emptyDraft, mappingHref, templateToDrafts, toDraftBody, type Draft } from "./endpointLogic";
import Panel from "./Panel";
import { Notice, ProblemNotice, Segmented, Switch, describeError, useFlash, useLoad } from "./ui";

// The endpoints of one connection. A connection starts with NONE; this panel lists them and adds more, three ways, all here:
// by hand, from what the system says it offers (its $metadata or an OpenAPI description), or from an optional template.
// Mapping is the existing Mapping tab (Open mapping); what runs is the Monitor.

type View = { kind: "list" } | { kind: "add" } | { kind: "edit"; endpoint: PublicEndpoint };
type Way = "hand" | "system" | "template";

export default function EndpointsPanel({ connection, onClose, onChanged }: { connection: PublicConnection; onClose: () => void; onChanged: () => Promise<void> | void }) {
  const { confirm } = useFeel();
  const list = useLoad(() => getCustomEndpoints(connection.id), [connection.id]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [busy, setBusy] = useState<string | null>(null);
  const [tried, setTried] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const { flash, show } = useFlash();

  const endpoints = list.data?.endpoints ?? [];
  const pending = list.data?.needsDatabaseUpdate === true;
  const refresh = async () => { await list.reload(); await onChanged(); };

  const toggle = async (e: PublicEndpoint, enabled: boolean) => {
    setBusy(e.id);
    try { await updateCustomEndpoint(e.id, { enabled }); await refresh(); } catch (x) { show(false, describeError(x)); } finally { setBusy(null); }
  };
  const remove = async (e: PublicEndpoint) => {
    if (!(await confirm({ title: `Remove ${e.name}?`, body: "The endpoint is removed. Its saved mapping and past messages stay.", confirmLabel: "Remove", tone: "danger" }))) return;
    setBusy(e.id);
    try { await deleteCustomEndpoint(e.id); await refresh(); } catch (x) { show(false, describeError(x)); } finally { setBusy(null); }
  };
  const run = async (e: PublicEndpoint) => {
    setBusy(e.id); setTried(null);
    try {
      const { result } = await tryCustomEndpoint(e.id);
      setTried({ id: e.id, ok: result.ok, text: result.ok ? `${e.name}: ${result.message}${result.fields.length ? ` Fields: ${result.fields.join(", ")}.` : ""}` : `${e.name}: ${result.message}${result.fix ? ` ${result.fix}` : ""}` });
      await list.reload();
    } catch (x) { setTried({ id: e.id, ok: false, text: describeError(x) }); } finally { setBusy(null); }
  };

  if (view.kind === "add" || view.kind === "edit") {
    return (
      <Panel title={view.kind === "add" ? "Add endpoint" : `Edit ${view.endpoint.name}`} subtitle={connection.name} onClose={onClose} label="Endpoint">
        <EndpointForm
          connection={connection} editing={view.kind === "edit" ? view.endpoint : null}
          onBack={() => setView({ kind: "list" })} onDone={async () => { setView({ kind: "list" }); await refresh(); }}
        />
      </Panel>
    );
  }

  return (
    <Panel title="Endpoints" subtitle={connection.name} onClose={onClose} label="Endpoints">
      {flash && <Notice tone={flash.ok ? "ok" : "err"}>{flash.text}</Notice>}
      {tried && <Notice tone={tried.ok ? "ok" : "err"} live>{tried.text}</Notice>}
      {list.error != null && !list.data ? <ProblemNotice error={list.error} onRetry={() => void list.reload()} /> : null}
      {pending && <Notice tone="info">An update is needed before endpoints can be added.</Notice>}

      <div className={s.rowBetween}>
        <span className="bpm-label-row"><h3 className="bpm-t-label">Endpoints</h3><InfoTip label="Endpoints">{ENDPOINT_TIPS.section}</InfoTip></span>
        <Button variant="primary" size="sm" data-guide="endpoints.add" disabled={pending || !list.data} onClick={() => setView({ kind: "add" })}>Add endpoint</Button>
      </div>

      {list.data && endpoints.length === 0 && !pending ? (
        <EmptyState title="No endpoints yet" text="Add what you want to read from this system, or send to it." action={<Button variant="primary" onClick={() => setView({ kind: "add" })}>Add endpoint</Button>} />
      ) : null}

      {endpoints.length > 0 && (
        <div className={s.listCard} data-guide="endpoints.table">
          <table className={`${s.docTable} ${s.epTable}`}>
            <thead><tr><th>Name</th><th>Operation</th><th>Serves</th><th>On</th><th><span className="bpm-sr-only">Actions</span></th></tr></thead>
            <tbody>
              {endpoints.map((e) => (
                <tr key={e.id} className={s.docRow}>
                  <td className={s.connName} data-label="Name">
                    <span className={s.fieldName}>{e.name}</span>
                    <span className={s.connDetail}>{runLine(e)}{e.lastRunStatus === "failed" && e.lastRunMessage ? ` · ${e.lastRunMessage}` : ""}</span>
                  </td>
                  <td data-label="Operation"><span className={s.mono}>{operationLine(connection.family, e)}</span> {e.direction === "in" ? "←" : "→"}</td>
                  <td data-label="Serves">{OBJECT_LABEL[e.objectType]}</td>
                  <td className={s.epOn} data-label="On">
                    <Switch checked={e.enabled} label={`${e.name}: ${e.enabled ? "on" : "off"}`} disabled={busy === e.id} onChange={(v) => void toggle(e, v)} />
                  </td>
                  <td className={s.connActions}>
                    <MoreMenu label={`More for ${e.name}`} items={[
                      { label: "Try", onSelect: () => void run(e), hidden: e.direction !== "in" },
                      { label: "Open mapping", href: mappingHref(connection.id, e.objectType) },
                      { label: "Edit", onSelect: () => setView({ kind: "edit", endpoint: e }) },
                      { label: "Remove", onSelect: () => void remove(e), danger: true },
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ── Add and edit ────────────────────────────────────────────────────────────

export function EndpointForm({ connection, editing, onBack, onDone }: { connection: PublicConnection; editing: PublicEndpoint | null; onBack: () => void; onDone: () => Promise<void> }) {
  const [way, setWay] = useState<Way>("hand");
  return (
    <div className={s.stack}>
      {!editing && (
        <Segmented<Way>
          label="Add endpoint" value={way} onChange={setWay}
          options={[{ id: "hand", label: "By hand" }, { id: "system", label: "From the system" }, { id: "template", label: "From a template" }]}
        />
      )}
      {way === "hand" || editing ? <ByHand connection={connection} editing={editing} onBack={onBack} onDone={onDone} /> : null}
      {!editing && way === "system" ? <FromSystem connection={connection} onBack={onBack} onDone={onDone} /> : null}
      {!editing && way === "template" ? <FromTemplate connection={connection} onBack={onBack} onDone={onDone} /> : null}
    </div>
  );
}

function ObjectSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: EndpointObject | "") => void }) {
  return (
    <select id={id} className="bpm-input" value={value} onChange={(e) => onChange(e.target.value as EndpointObject | "")}>
      <option value="">Choose…</option>
      {OBJECT_OPTIONS.map((o) => <option key={o} value={o}>{OBJECT_LABEL[o]}</option>)}
    </select>
  );
}

function ByHand({ connection, editing, onBack, onDone }: { connection: PublicConnection; editing: PublicEndpoint | null; onBack: () => void; onDone: () => Promise<void> }) {
  const family = connection.family;
  const [d, setD] = useState<Draft>(editing ? draftFromEndpoint(editing) : emptyDraft());
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const methods = methodsFor(family, d.direction);

  const save = async () => {
    const p = draftProblem(d, family);
    if (p) { setProblem(p); return; }
    setSaving(true); setProblem(null);
    try {
      const body: EndpointDraft = toDraftBody(d, family);
      if (editing) {
        const { origin: _o, ...patch } = body; // eslint-disable-line @typescript-eslint/no-unused-vars
        await updateCustomEndpoint(editing.id, patch);
      } else await addCustomEndpoints(connection.id, [body]);
      await onDone();
    } catch (e) { setProblem(describeError(e)); } finally { setSaving(false); }
  };

  return (
    <div className={s.stack} data-guide="endpoints.by_hand">
      {problem && <Notice tone="err">{problem}</Notice>}
      <div className={s.fields}>
        <div className={s.fieldFull}>
          <Field label="Name" htmlFor="ep-name" style={{ marginBottom: 0 }}>
            <input id="ep-name" className="bpm-input" autoComplete="off" value={d.name} placeholder="Projects" onChange={(e) => set({ name: e.target.value })} />
          </Field>
        </div>
        <Field label="Direction" info={ENDPOINT_TIPS.direction} htmlFor="ep-dir" style={{ marginBottom: 0 }}>
          <select id="ep-dir" className="bpm-input" value={d.direction} onChange={(e) => set({ direction: e.target.value as Draft["direction"], method: undefined, run_mode: e.target.value === "in" && d.run_mode === "on_change" ? "manual" : d.run_mode })}>
            {(["in", "out"] as const).map((x) => <option key={x} value={x}>{DIRECTION_LABEL[x]}</option>)}
          </select>
        </Field>
        <Field label="Serves" info={ENDPOINT_TIPS.object} htmlFor="ep-obj" style={{ marginBottom: 0 }}>
          <ObjectSelect id="ep-obj" value={d.object_type} onChange={(v) => set({ object_type: v })} />
        </Field>
        {family === "rest" && methods.length > 1 && (
          <Field label="Method" htmlFor="ep-method" style={{ marginBottom: 0 }}>
            <select id="ep-method" className="bpm-input" value={d.method && methods.includes(d.method) ? d.method : methods[0]} onChange={(e) => set({ method: e.target.value as Draft["method"] })}>
              {methods.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
        )}
        <div className={family === "rest" && methods.length > 1 ? undefined : s.fieldFull}>
          <Field label={family === "odata" ? "Entity set" : "Path"} info={ENDPOINT_TIPS.operation} htmlFor="ep-path" style={{ marginBottom: 0 }}>
            <input id="ep-path" className={`bpm-input ${s.mono}`} autoComplete="off" spellCheck={false} value={d.path} placeholder={family === "odata" ? "ProjectsV2" : "/projects"} onChange={(e) => set({ path: e.target.value })} />
          </Field>
        </div>
        <Field label="Runs" info={ENDPOINT_TIPS.runMode} htmlFor="ep-run" style={{ marginBottom: 0 }}>
          <select id="ep-run" className="bpm-input" value={d.run_mode} onChange={(e) => set({ run_mode: e.target.value as Draft["run_mode"] })}>
            {RUN_MODES.filter((m) => m !== "on_change" || d.direction === "out").map((m) => <option key={m} value={m}>{RUN_MODE_LABEL[m]}</option>)}
          </select>
        </Field>
        {d.run_mode === "schedule" && (
          <Field label="How often" htmlFor="ep-sched" style={{ marginBottom: 0 }}>
            <select id="ep-sched" className="bpm-input" value={d.schedule} onChange={(e) => set({ schedule: e.target.value as Draft["schedule"] })}>
              {SCHEDULES.map((x) => <option key={x} value={x}>{x === "hourly" ? "Hourly" : "Daily"}</option>)}
            </select>
          </Field>
        )}
      </div>
      <div className={`${s.row} bpm-tap`}>
        <Button onClick={onBack} disabled={saving}>Back</Button>
        <Button variant="primary" data-guide="endpoints.save" onClick={() => void save()} loading={saving} disabled={saving}>{editing ? "Save" : "Add"}</Button>
      </div>
    </div>
  );
}

function FromSystem({ connection, onBack, onDone }: { connection: PublicConnection; onBack: () => void; onDone: () => Promise<void> }) {
  const rest = connection.family === "rest";
  const [specPath, setSpecPath] = useState("/openapi.json");
  const [items, setItems] = useState<{ source: "odata" | "openapi"; list: EndpointCandidate[] } | null>(null);
  const [picked, setPicked] = useState<Record<string, EndpointObject | "">>({});
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const key = (c: EndpointCandidate) => `${c.method} ${c.path}`;

  const read = async () => {
    setReading(true); setProblem(null); setItems(null);
    try {
      const r = await discoverEndpoints(connection.id, rest ? specPath : undefined);
      setItems({ source: r.source, list: r.items }); setPicked({});
    } catch (e) { setProblem(describeError(e)); } finally { setReading(false); }
  };
  const chosen = items ? items.list.filter((c) => key(c) in picked) : [];
  const missingObject = chosen.some((c) => !picked[key(c)]);

  const add = async () => {
    if (!items) return;
    setSaving(true); setProblem(null);
    try {
      await addCustomEndpoints(connection.id, chosen.map((c) => candidateToDraft(c, picked[key(c)] as EndpointObject, items.source === "odata" ? "metadata" : "openapi", connection.family)));
      await onDone();
    } catch (e) { setProblem(describeError(e)); } finally { setSaving(false); }
  };

  return (
    <div className={s.stack} data-guide="endpoints.from_system">
      <span className="bpm-label-row"><span className="bpm-t-label">From the system</span><InfoTip label="From the system">{ENDPOINT_TIPS.fromMetadata}</InfoTip></span>
      {problem && <Notice tone="err">{problem}</Notice>}
      {rest && (
        <Field label="Description path" htmlFor="ep-spec" style={{ marginBottom: 0 }}>
          <input id="ep-spec" className={`bpm-input ${s.mono}`} value={specPath} onChange={(e) => setSpecPath(e.target.value)} />
        </Field>
      )}
      <div className={`${s.row} bpm-tap`}>
        <Button onClick={onBack}>Back</Button>
        <Button variant="primary" onClick={() => void read()} loading={reading} disabled={reading}>{rest ? "Read the OpenAPI description" : "Read what the service offers"}</Button>
      </div>
      {items && (
        <>
          <ul className={s.pickList} aria-label="What the system offers">
            {items.list.map((c) => {
              const k = key(c);
              const on = k in picked;
              return (
                <li key={k} className={s.pickRow}>
                  <CheckOpt checked={on} onChange={(v) => setPicked((p) => { const n = { ...p }; if (v) n[k] = c.object_type ?? ""; else delete n[k]; return n; })} label={rest ? `${c.method} ${c.path}` : c.name} />
                  {on && <ObjectSelect id={`pick-${k}`} value={picked[k] ?? ""} onChange={(v) => setPicked((p) => ({ ...p, [k]: v }))} />}
                </li>
              );
            })}
          </ul>
          <div className={`${s.row} bpm-tap`}>
            <Button variant="primary" onClick={() => void add()} loading={saving} disabled={saving || chosen.length === 0 || missingObject}>{chosen.length ? `Add ${chosen.length}` : "Add"}</Button>
            {missingObject && <span className={`${s.small} ${s.muted}`} role="status">Choose what each one serves.</span>}
          </div>
        </>
      )}
    </div>
  );
}

function FromTemplate({ connection, onBack, onDone }: { connection: PublicConnection; onBack: () => void; onDone: () => Promise<void> }) {
  const templates = useLoad(async () => (await getEndpointTemplates()).templates, []);
  const [key, setKey] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const list: EndpointTemplateView[] = (templates.data ?? []).filter((t) => t.family === connection.family);
  const t = list.find((x) => x.key === key) ?? null;

  const add = async () => {
    if (!t) return;
    setSaving(true); setProblem(null);
    try { const r = await addCustomEndpoints(connection.id, templateToDrafts(t, picked) as EndpointDraft[]); if (r.skipped && !r.created) setProblem("Those endpoints are already on this connection."); else await onDone(); }
    catch (e) { setProblem(describeError(e)); } finally { setSaving(false); }
  };

  return (
    <div className={s.stack} data-guide="endpoints.from_template">
      <span className="bpm-label-row"><span className="bpm-t-label">From a template</span><InfoTip label="From a template">{ENDPOINT_TIPS.fromTemplate}</InfoTip></span>
      {problem && <Notice tone="err">{problem}</Notice>}
      {templates.error != null && !templates.data ? <ProblemNotice error={templates.error} onRetry={() => void templates.reload()} /> : null}
      {list.length === 0 && templates.data ? <p className={`${s.small} ${s.muted}`}>There are no templates for a REST API. Add endpoints by hand or from its description.</p> : null}
      {list.length > 0 && (
        <Field label="Template" htmlFor="ep-tpl" style={{ marginBottom: 0 }}>
          <select id="ep-tpl" className="bpm-input" value={key} onChange={(e) => { setKey(e.target.value); setPicked(new Set()); }}>
            <option value="">Choose…</option>
            {list.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </Field>
      )}
      {t && (
        <>
          <p className={`${s.small} ${s.muted}`}>Service address: <span className={s.mono}>{t.addressHint}</span></p>
          <ul className={s.pickList} aria-label="Endpoints in this template">
            {t.endpoints.map((e) => (
              <li key={e.name} className={s.pickRow}>
                <CheckOpt checked={picked.has(e.name)} onChange={(v) => setPicked((p) => { const n = new Set(p); if (v) n.add(e.name); else n.delete(e.name); return n; })} label={`${e.name} · ${e.path}`} />
              </li>
            ))}
          </ul>
        </>
      )}
      <div className={`${s.row} bpm-tap`}>
        <Button onClick={onBack} disabled={saving}>Back</Button>
        <Button variant="primary" onClick={() => void add()} loading={saving} disabled={saving || !t || picked.size === 0}>{picked.size ? `Add ${picked.size}` : "Add"}</Button>
      </div>
    </div>
  );
}
