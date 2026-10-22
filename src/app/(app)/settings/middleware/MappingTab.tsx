"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { useFeel } from "@/components/FeelProvider";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import type { D365EntityKey } from "@/lib/connectors/d365/types";
import D365Preview from "@/components/connectors/D365Preview";
import s from "./middleware.module.css";
import { getMappingDoc, previewEntity, resetMapping, saveMappingRows, type MapDocumentKey, type MappingDocView } from "./api";
import { useMw } from "./context";
import { hasOutbound } from "./connectors";
import {
  changedSections, currentErp, documentChoices, erpOptions, inboundChoices, isInboundDocument, isMapDirty, isReadOnlyRow, missingBar, sampleFieldMap, setEdit, NOT_SENT,
  type MapEdits,
} from "./mappingLogic";
import { MIDDLEWARE_TIPS } from "./tips";
import { Notice, ProblemNotice, useFlash, useLoad } from "./ui";

export default function MappingTab() {
  const mw = useMw();
  const { confirm } = useFeel();
  const [doc, setDoc] = useState<MapDocumentKey>(hasOutbound(mw.connector.id) ? "quote" : "customers");
  const [edits, setEdits] = useState<MapEdits>({});
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<"reset" | "sample" | null>(null);
  const [sample, setSample] = useState<Record<string, unknown>[] | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const { flash, show } = useFlash();
  const view = useLoad(() => getMappingDoc(doc), [doc, mw.connector.id]);
  const inbound = isInboundDocument(doc);

  const quote = mw.documents.data?.documents.find((d) => d.key === "quote");
  const choices = hasOutbound(mw.connector.id) ? documentChoices(mw.connector.shortName, quote?.target.label ?? null) : inboundChoices(mw.connector.shortName);
  const v = view.data;
  const dirty = isMapDirty(edits);

  const pickDocument = async (next: MapDocumentKey) => {
    if (next === doc) return;
    if (dirty && !(await confirm({ title: "Discard your changes?", body: "The fields you changed in this mapping have not been saved.", confirmLabel: "Discard", tone: "danger" }))) return;
    setEdits({}); setSample(null); setProblem(null); setDoc(next);
  };

  const save = async () => {
    if (!v) return;
    setSaving(true); setProblem(null);
    try {
      for (const part of changedSections(v, edits)) await saveMappingRows(doc, part.section, part.rows);
      setEdits({});
      await view.reload();
      show(true, "Mapping saved.");
    } catch (e) { setProblem(e); } finally { setSaving(false); }
  };

  const reset = async () => {
    if (!(await confirm({ title: "Reset to standard?", body: "Your changes to this mapping are replaced by the standard one.", confirmLabel: "Reset", tone: "danger" }))) return;
    setBusy("reset"); setProblem(null);
    try { await resetMapping(doc); setEdits({}); await view.reload(); show(true, "Back to the standard mapping."); } catch (e) { setProblem(e); } finally { setBusy(null); }
  };

  const showSample = async () => {
    if (sample) { setSample(null); return; }
    setBusy("sample"); setProblem(null);
    try { setSample((await previewEntity(doc as D365EntityKey)).rows); } catch (e) { setProblem(e); } finally { setBusy(null); }
  };

  const bar = v ? missingBar(v.missingRequired) : null;

  return (
    <>
      <SettingsSave dirty={dirty} saving={saving} onSave={() => void save()} label="Save mapping" />
      {flash && <Notice tone={flash.ok ? "ok" : "err"}>{flash.text}</Notice>}
      {bar && <Notice tone="warn">{bar}</Notice>}
      {problem != null && <ProblemNotice error={problem} />}

      <div className={s.rowBetween}>
        <span className="bpm-label-row">
          <h2 className="bpm-t-section">Field mapping</h2>
          <InfoTip label="Field mapping">{MIDDLEWARE_TIPS.mapping}</InfoTip>
        </span>
        <span className={`${s.row} bpm-tap`}>
          <select className="bpm-input" style={{ width: "auto", maxWidth: "100%" }} aria-label="Mapping for" value={doc} onChange={(e) => void pickDocument(e.target.value as MapDocumentKey)}>
            {choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <Button variant="quiet" size="sm" onClick={() => void reset()} loading={busy === "reset"} disabled={!v || v.usingStandard || !!busy}>Reset to standard</Button>
        </span>
      </div>

      {inbound && (
        <div className={`${s.row} bpm-tap`}>
          <Button variant="quiet" size="sm" onClick={() => void showSample()} loading={busy === "sample"} aria-pressed={!!sample}>{sample ? "Hide sample data" : "Show sample data"}</Button>
        </div>
      )}
      {sample && v && <D365Preview title={v.document.label || doc} rows={sample} fieldMap={sampleFieldMap(v)} onClose={() => setSample(null)} />}

      {view.error != null && !v && <ProblemNotice error={view.error} onRetry={() => void view.reload()} />}
      {!v && view.error == null && <div className={`${s.small} ${s.muted}`} role="status">Loading…</div>}
      {v && <MappingSections view={v} edits={edits} inbound={inbound} onEdit={(section, row, value) => setEdits((e) => setEdit(e, section, row, value))} />}
    </>
  );
}

// ── The two-column table ────────────────────────────────────────────────────

/** Plain props only, so it renders the same in the page and in a test. */
export function MappingSections({ view, edits, inbound, onEdit }: {
  view: MappingDocView; edits: MapEdits; inbound?: boolean; onEdit: (section: string, row: MappingDocView["sections"][number]["rows"][number], value: string) => void;
}) {
  return (
    <>
      {view.sections.map((sec) => (
        <section key={sec.key} aria-label={sec.label}>
          <h3 className="bpm-t-label" style={{ margin: "6px 0" }}>{sec.label}</h3>
          <div className={s.mapCard}>
            <table className={s.mapTbl}>
              <thead><tr><th>BPMSquare field</th><th>{inbound ? "ERP source field" : "ERP field"}</th></tr></thead>
              <tbody>
                {sec.rows.length === 0 && <tr><td colSpan={2} className={s.muted}>No fields.</td></tr>}
                {sec.rows.map((r) => {
                  const readOnly = isReadOnlyRow(r);
                  const cur = currentErp(sec.key, r, edits);
                  const options = erpOptions(view.erpFields[sec.key] ?? [], r.erp);
                  return (
                    <tr key={r.id}>
                      <td><FieldCell label={r.bpm.label} name={r.bpm.name} /></td>
                      <td>
                        {readOnly ? (
                          <span className={s.readOnlyCell}>
                            {r.erp ? <FieldCell label={r.erp.label} name={r.erp.name} /> : <span className={s.muted}>Not sent</span>}
                            <span className={s.standardWord}>Standard</span>
                          </span>
                        ) : (
                          <select className="bpm-input" aria-label={`${inbound ? "ERP source field" : "ERP field"} for ${r.bpm.label}`} value={cur} onChange={(e) => onEdit(sec.key, r, e.target.value)}>
                            <option value={NOT_SENT}>{inbound ? "Not read" : "Not sent"}</option>
                            {options.map((o) => <option key={o.name} value={o.name}>{o.label} · {o.name}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}

function FieldCell({ label, name }: { label: string; name: string }) {
  return (
    <span className={s.fieldCell}>
      <span className={s.fieldName}>{label}</span>
      {name && name !== label ? <span className={s.fieldTech}>{name}</span> : null}
    </span>
  );
}

