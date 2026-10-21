"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import InfoTip from "@/components/ui/InfoTip";
import StatusPill from "@/components/ui/StatusPill";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { D365_ENTITY_LABEL, type D365EntityKey } from "@/lib/connectors/d365/types";
import D365Preview from "@/components/connectors/D365Preview";
import s from "./middleware.module.css";
import {
  getMapping, getMetadata, previewEntity, saveConnection, suggestMapping,
  type ConnectionConfig, type EntityMapView, type ErpField, type MapKind, type MappingView, type MetadataEntity, type OutboundMaps,
} from "./api";
import { useMw } from "./context";
import {
  INBOUND_ENTITIES, INBOUND_FIELDS, applySuggestions, bpmFieldLabel, mapToRows, missingRequired, rowsToMap, sameMap, validateRows,
  type MapMode, type MapRow,
} from "./mapEditor";
import { MIDDLEWARE_TIPS } from "./tips";
import { Notice, ProblemNotice, useFlash, useLoad } from "./ui";
import MapEditor, { MapView } from "./MapEditor";

type Ready = Extract<MappingView, { connected: true }>;

export default function MappingTab() {
  const mw = useMw();
  const mapping = useLoad(getMapping, [mw.connector.id]);
  const [editing, setEditing] = useState<string | null>(null);
  const { flash, show } = useFlash();

  if (mapping.error != null && !mapping.data) return <ProblemNotice error={mapping.error} onRetry={() => void mapping.reload()} />;
  const m = mapping.data;
  if (!m) return <div className={`${s.small} ${s.muted}`} role="status">Loading…</div>;
  if (!m.connected) {
    return (
      <EmptyState
        title="Connect an ERP first"
        text="The standard mapping appears here as soon as a connection exists."
        action={<Button variant="primary" onClick={() => mw.goTab("connections")}>Open Connections</Button>}
      />
    );
  }
  const cfg = mw.connection?.state.config ?? null;
  const target = mw.rules.data?.contract.target ?? (m.product === "dataverse" ? "quote" : "project");
  const kinds: { kind: MapKind; title: string }[] = target === "quote"
    ? [{ kind: "quote", title: "Quote header" }, { kind: "quote_line", title: "Quote lines" }]
    : [{ kind: "project", title: "Project" }];

  const changed = async (text: string) => {
    show(true, text);
    await Promise.all([mapping.reload(), mw.connections.reload()]);
  };

  return (
    <>
      {flash && <Notice tone={flash.ok ? "ok" : "err"}>{flash.text}</Notice>}
      <div className={s.rowBetween}>
        <span className="bpm-label-row"><h2 className="bpm-t-section">What goes out</h2><InfoTip label="Mapping">{MIDDLEWARE_TIPS.mapping}</InfoTip></span>
      </div>
      {kinds.map(({ kind, title }) => (
        <OutboundCard
          key={kind} kind={kind} title={title} m={m} cfg={cfg} connectorId={mw.connector.id}
          editing={editing === `out:${kind}`} onEdit={(on) => setEditing(on ? `out:${kind}` : null)} onSaved={changed}
        />
      ))}

      <div className={s.rowBetween} style={{ marginTop: 6 }}>
        <span className="bpm-label-row"><h2 className="bpm-t-section">What comes in</h2><InfoTip label="What comes in">{MIDDLEWARE_TIPS.inbound}</InfoTip></span>
      </div>
      {INBOUND_ENTITIES.map((k) => {
        const e = m.entities[k];
        return e ? (
          <InboundCard
            key={k} entity={k} view={e} cfg={cfg} connectorId={mw.connector.id} editing={editing === `in:${k}`}
            onEdit={(on) => setEditing(on ? `in:${k}` : null)} onSaved={changed}
          />
        ) : null;
      })}
    </>
  );
}

// ── Shared editing state ────────────────────────────────────────────────────

/** Rows, the ERP's field list (fetched when editing starts), and the checks that gate Save. */
function useEditor(mode: MapMode, kind: MapKind | "inbound", entity: MetadataEntity, initial: Record<string, string>, allowed: readonly string[], editing: boolean) {
  const [rows, setRows] = useState<MapRow[]>(() => mapToRows(initial));
  const meta = useLoad(async () => (editing ? getMetadata(entity) : null), [editing, entity]);
  const [fields, setFields] = useState<ErpField[] | null>(null);
  const erp = fields ?? meta.data?.fields ?? null;
  const issues = validateRows(mode, kind, rows, allowed);
  const missing = mode === "outbound" && erp && kind !== "inbound" ? missingRequired(erp, rows, kind) : [];
  const dirty = !sameMap(rowsToMap(rows), initial);
  return { rows, setRows, meta, erp, setFields, issues, missing, dirty, reset: () => setRows(mapToRows(initial)) };
}

function EditorTools({ meta, onRefresh, onSuggest, busy }: { meta: { loading: boolean }; onRefresh: () => void; onSuggest: () => void; busy: boolean }) {
  return (
    <div className={`${s.row} bpm-tap`}>
      <Button size="sm" onClick={onSuggest} disabled={busy || meta.loading}>Suggest mapping</Button>
      <InfoTip label="Suggest mapping">{MIDDLEWARE_TIPS.suggest}</InfoTip>
      <Button size="sm" onClick={onRefresh} loading={meta.loading} disabled={busy}>Refresh fields</Button>
      <InfoTip label="Refresh fields">{MIDDLEWARE_TIPS.refreshFields}</InfoTip>
    </div>
  );
}

// ── Outbound: what a quote becomes ──────────────────────────────────────────

function OutboundCard({ kind, title, m, cfg, connectorId, editing, onEdit, onSaved }: {
  kind: MapKind; title: string; m: Ready; cfg: ConnectionConfig | null; connectorId: string;
  editing: boolean; onEdit: (on: boolean) => void; onSaved: (text: string) => Promise<void>;
}) {
  const effective = m.effective[kind].field_map;
  const standard = m.using_standard[kind];
  const allowed = m.placeholders[kind];
  const entity: MetadataEntity = kind;
  const ed = useEditor("outbound", kind, entity, effective, allowed, editing);
  const [busy, setBusy] = useState<"save" | "reset" | "suggest" | null>(null);
  const [problem, setProblem] = useState<unknown>(null);

  const withOutbound = (next: OutboundMaps | null) => saveConnection(connectorId, { ...(cfg as ConnectionConfig), outbound: next });
  const current = cfg?.outbound ?? {};

  const save = async () => {
    if (!cfg || ed.issues.length) return;
    setBusy("save"); setProblem(null);
    const map = rowsToMap(ed.rows);
    const next: OutboundMaps = { ...current };
    next[kind] = kind === "project"
      ? { ...(current.project ?? {}), entity_set: m.effective.project.entity_set, id_field: m.effective.project.id_field, field_map: map }
      : { field_map: map };
    try { await withOutbound(next); onEdit(false); await onSaved(`${title} mapping saved.`); } catch (e) { setProblem(e); } finally { setBusy(null); }
  };
  const resetToStandard = async () => {
    if (!cfg) return;
    setBusy("reset"); setProblem(null);
    const { [kind]: _drop, ...rest } = current;
    void _drop;
    try { await withOutbound(Object.keys(rest).length ? rest : null); onEdit(false); await onSaved(`${title} is back to the standard mapping.`); } catch (e) { setProblem(e); } finally { setBusy(null); }
  };
  const suggest = async () => {
    setBusy("suggest"); setProblem(null);
    try {
      const bpm = allowed.map((k) => ({ key: k, label: bpmFieldLabel(k) }));
      const r = await suggestMapping(entity, bpm, ed.rows.map((x) => x.field).filter(Boolean));
      ed.setRows(applySuggestions(ed.rows, r.suggestions, "outbound").rows);
    } catch (e) { setProblem(e); } finally { setBusy(null); }
  };
  const refresh = async () => {
    setProblem(null);
    try { ed.setFields((await getMetadata(entity, true)).fields); } catch (e) { setProblem(e); }
  };

  return (
    <Card
      title={title}
      info={MIDDLEWARE_TIPS.standardMap}
      action={
        <span className={s.row}>
          <StatusPill label={standard ? "Using the standard mapping" : "Custom mapping"} tone={standard ? "green" : "blue"} />
          {!editing && <Button size="sm" onClick={() => onEdit(true)} disabled={!cfg}>Edit</Button>}
        </span>
      }
    >
      <div className={s.stack}>
        {problem != null && <ProblemNotice error={problem} />}
        {!editing ? (
          <MapView map={effective} mode="outbound" fields={ed.erp} />
        ) : (
          <>
            <SettingsSave dirty={ed.dirty} saving={busy === "save"} onSave={() => void save()} label="Save map" />
            {ed.meta.error != null && <ProblemNotice error={ed.meta.error} onRetry={() => void ed.meta.reload()} />}
            <EditorTools meta={ed.meta} onRefresh={() => void refresh()} onSuggest={() => void suggest()} busy={!!busy} />
            <MapEditor mode="outbound" rows={ed.rows} onRows={ed.setRows} erpFields={ed.erp} allowed={allowed} issues={ed.issues} />
            {ed.missing.length > 0 && (
              <Notice tone="warn">
                <span className={s.noticeStrong}>Required by the ERP and not mapped:</span> {ed.missing.map((f) => f.label).join(", ")}. {MIDDLEWARE_TIPS.required}
              </Notice>
            )}
            <div className={`${s.row} bpm-tap`}>
              <Button onClick={() => { ed.reset(); onEdit(false); }} disabled={!!busy}>Cancel</Button>
              <Button variant="danger" onClick={() => void resetToStandard()} loading={busy === "reset"} disabled={!!busy || standard}>Reset to standard</Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

// ── Inbound: what comes in, per entity ──────────────────────────────────────

function InboundCard({ entity, view, cfg, connectorId, editing, onEdit, onSaved }: {
  entity: (typeof INBOUND_ENTITIES)[number]; view: EntityMapView; cfg: ConnectionConfig | null; connectorId: string;
  editing: boolean; onEdit: (on: boolean) => void; onSaved: (text: string) => Promise<void>;
}) {
  const allowed = INBOUND_FIELDS[entity] ?? [];
  const label = D365_ENTITY_LABEL[entity as D365EntityKey];
  const ed = useEditor("inbound", "inbound", entity, view.field_map, allowed, editing);
  const [busy, setBusy] = useState<"save" | "enable" | "preview" | "suggest" | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);

  const withEntity = (patch: Partial<EntityMapView>) => {
    const cur = cfg?.entities[entity as D365EntityKey] ?? { ...view };
    return saveConnection(connectorId, { ...(cfg as ConnectionConfig), entities: { ...(cfg as ConnectionConfig).entities, [entity]: { ...cur, ...patch } } });
  };
  const toggle = async (enabled: boolean) => {
    if (!cfg) return;
    setBusy("enable"); setProblem(null);
    try { await withEntity({ enabled }); await onSaved(`${label}: ${enabled ? "included" : "left out"}.`); } catch (e) { setProblem(e); } finally { setBusy(null); }
  };
  const save = async () => {
    if (!cfg || ed.issues.length) return;
    setBusy("save"); setProblem(null);
    try { await withEntity({ field_map: rowsToMap(ed.rows) }); onEdit(false); await onSaved(`${label} mapping saved.`); } catch (e) { setProblem(e); } finally { setBusy(null); }
  };
  const preview = async () => {
    setBusy("preview"); setProblem(null);
    try { setRows((await previewEntity(entity as D365EntityKey)).rows); } catch (e) { setProblem(e); } finally { setBusy(null); }
  };
  const suggest = async () => {
    setBusy("suggest"); setProblem(null);
    try {
      const r = await suggestMapping(entity, allowed.map((k) => ({ key: k, label: bpmFieldLabel(k) })), []);
      ed.setRows(applySuggestions(ed.rows, r.suggestions, "inbound").rows);
    } catch (e) { setProblem(e); } finally { setBusy(null); }
  };
  const refresh = async () => {
    setProblem(null);
    try { ed.setFields((await getMetadata(entity, true)).fields); } catch (e) { setProblem(e); }
  };

  return (
    <Card padding={14}>
      <div className={s.stack}>
        <div className={`${s.rowBetween} bpm-tap`}>
          <span className="bpm-label-row">
            <label className="bpm-t-label" style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", minHeight: 32 }}>
              <input type="checkbox" checked={view.enabled} disabled={!cfg || busy === "enable"} onChange={(e) => void toggle(e.target.checked)} />
              {label}
            </label>
            <InfoTip label={label}>{MIDDLEWARE_TIPS.inboundOn}</InfoTip>
          </span>
          <span className={s.row}>
            <Button size="sm" onClick={() => void preview()} loading={busy === "preview"} disabled={!!busy}>Preview</Button>
            {!editing && <Button size="sm" onClick={() => onEdit(true)} disabled={!cfg}>Edit map</Button>}
          </span>
        </div>
        {problem != null && <ProblemNotice error={problem} />}
        {rows && <D365Preview title={label} rows={rows} fieldMap={view.field_map} onClose={() => setRows(null)} />}
        {!editing ? (
          <MapView map={view.field_map} mode="inbound" fields={ed.erp} />
        ) : (
          <>
            <SettingsSave dirty={ed.dirty} saving={busy === "save"} onSave={() => void save()} label="Save map" />
            {ed.meta.error != null && <ProblemNotice error={ed.meta.error} onRetry={() => void ed.meta.reload()} />}
            <EditorTools meta={ed.meta} onRefresh={() => void refresh()} onSuggest={() => void suggest()} busy={!!busy} />
            <MapEditor mode="inbound" rows={ed.rows} onRows={ed.setRows} erpFields={ed.erp} allowed={allowed} issues={ed.issues} />
            <div className={`${s.row} bpm-tap`}><Button onClick={() => { ed.reset(); onEdit(false); }} disabled={!!busy}>Cancel</Button></div>
          </>
        )}
      </div>
    </Card>
  );
}
