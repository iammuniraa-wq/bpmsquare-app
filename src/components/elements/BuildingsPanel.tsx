"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import { useFeel } from "@/components/FeelProvider";
import { money } from "@/lib/contractProjects/format";
import type { BuildingRow } from "@/lib/elements/buildings";
import type { BuildingsAnswer, BuildingsData, IssueAnswer } from "@/lib/elements/clientTypes";
import type { ElementLineRow } from "@/lib/elements/rows";
import type { QtyBand } from "@/lib/elements/quantity";
import { ELEMENT_TIPS } from "@/lib/elements/tips";
import { COMMON_BUILDING, ELEMENTS_PENDING } from "@/lib/elements/types";
import { call } from "./api";
import ElementPanel from "./ElementPanel";
import s from "./Buildings.module.css";

// The Buildings view (docs/design/pcbs-buildings-elements.md, mock-up pcbs-buildings-elements-mockup.html): one row per building with what matters at a
// glance (lines, elements, contract value, variance), the element types and the client / model quantities behind a fold, the lines in no building, and
// the element table. A building is a level-1 WBS item with a code: nothing here keeps a second tree. It is the same panel on a tender and on a contract
// project; `root` is the API root of the record. It renders nothing in a workspace without the module, and says so while migration 0253 is pending.

const foldKey = (root: string) => `bldg-fold:${root}`;
const BAND_CLASS: Record<QtyBand, string> = { none: s.mutedPill, within: s.tealPill, over: s.amberPill, red: s.redPill };
const BAND_WORDS: Record<QtyBand, string> = { none: "", within: "Within tolerance", over: "Over tolerance", red: "Well over tolerance" };
const nf = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });
const SHOWN = 8;

export default function BuildingsPanel({ root, canEdit, onChanged }: {
  /** `/api/contract-projects/<id>` or `/api/opportunities/<id>/tender`. */
  root: string;
  canEdit: boolean;
  /** Told after a change so the host screen can refresh what it shows. */
  onChanged?: () => void;
}) {
  const { confirm } = useFeel();
  const [data, setData] = useState<BuildingsAnswer | null>(null);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showElements, setShowElements] = useState(false);
  const [all, setAll] = useState(false);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [editing, setEditing] = useState<BuildingRow | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const r = await call<BuildingsAnswer>(`${root}/buildings`, "GET");
    if (!r.ok) { setLoadError(r.j.error ?? "Could not load the buildings"); return; }
    setLoadError(""); setData(r.j as BuildingsAnswer);
  }, [root]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(foldKey(root)) ?? "[]") as unknown;
      if (Array.isArray(raw)) setOpen(new Set(raw.filter((x): x is string => typeof x === "string")));
    } catch { /* remembering is a convenience */ }
  }, [root]);

  const flip = (id: string) => setOpen((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    try { window.localStorage.setItem(foldKey(root), JSON.stringify([...next])); } catch { /* remembering is a convenience */ }
    return next;
  });
  const changed = () => { void load(); onChanged?.(); };

  const d: BuildingsData | null = data && data.enabled ? data : null;
  const rows = useMemo(() => (d ? d.rows.filter((r) => !r.is_category && (filter === "" ? true : filter === "__none__" ? !r.building_code : r.building_code === filter)) : []), [d, filter]);
  const picked = d && line ? d.rows.find((r) => r.key === line) ?? null : null;

  if (loadError) return <div role="alert" className={s.err}>{loadError}</div>;
  if (!data || !d) return null;
  if (d.pending) return <div role="alert" data-guide="buildings.pending" className={s.warn}>{ELEMENTS_PENDING}</div>;

  const names = d.settings.level_names;
  const editable = canEdit && !d.lock;
  const hasCommon = d.view.buildings.some((b) => b.code === COMMON_BUILDING.code);
  const view = d.view;
  const currency = d.currency;
  const shownRows = all ? rows : rows.slice(0, SHOWN);

  async function makeCommon() {
    setBusy(true); setError(""); setNotice("");
    const r = await call(`${root}/buildings`, "POST", { common: true });
    setBusy(false);
    if (!r.ok) { setError(r.j.error ?? "Could not add the building"); return; }
    setNotice(`${COMMON_BUILDING.name} added`); changed();
  }

  async function remove(b: BuildingRow) {
    if (!(await confirm({ title: `Remove ${b.code} ${b.name}?`, body: "Nothing is moved: a building can only go when it holds no lines.", confirmLabel: "Remove", tone: "danger" }))) return;
    setBusy(true); setError(""); setNotice("");
    const r = await call(`${root}/buildings/${b.item_id}`, "DELETE");
    setBusy(false);
    if (!r.ok) { setError(r.j.error ?? "Could not remove it"); return; }
    setNotice(`${b.code} removed`); changed();
  }

  return (
    <section className={s.wrap} data-guide="buildings" aria-label={`${names.building}s`}>
      <div className={s.head}>
        <h3 className={`bpm-t-section ${s.title}`}>{names.building}s</h3>
        <InfoTip label={`${names.building}s`}>{ELEMENT_TIPS.buildings}</InfoTip>
        <div className={s.chips} data-guide="buildings.summary">
          <span className={`${s.pill} ${s.mutedPill}`}>{view.buildings.length} {view.buildings.length === 1 ? names.building.toLowerCase() : `${names.building.toLowerCase()}s`}</span>
          <span className={`${s.pill} ${s.mutedPill}`}>{view.totals.element_count} element{view.totals.element_count === 1 ? "" : "s"}</span>
          {view.totals.outside_tolerance > 0 && <span className={`${s.pill} ${s.amberPill}`}>{view.totals.outside_tolerance} outside tolerance</span>}
        </div>
        <span className={s.grow} />
        <div className={s.tools}>
          {editable && <Button variant="primary" style={{ minHeight: 44 }} data-guide="buildings.add" onClick={() => setAdding(true)}>Add {names.building.toLowerCase()}</Button>}
          {editable && d.issuable > 0 && <Button variant="secondary" style={{ minHeight: 44 }} data-guide="buildings.issue" onClick={() => setIssuing(true)}>Issue codes ({d.issuable})</Button>}
        </div>
      </div>

      {d.lock && <div role="status" className={s.warn} data-guide="buildings.lock">{d.lock}<InfoTip label="Locked">{ELEMENT_TIPS.locked}</InfoTip></div>}
      {d.scope === "tender" && d.has_project && <div role="status" className={s.note}>This tender became a project. Its codes were copied; the project owns them now.</div>}

      {adding && <AddBuilding root={root} names={names} onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); setNotice(m); changed(); }} />}

      {view.buildings.length === 0 && !adding ? (
        <div className={s.note} data-guide="buildings.empty">{editable ? `No ${names.building.toLowerCase()}s yet. Add the first one, then put lines in it with Group into WBS.` : `No ${names.building.toLowerCase()}s yet.`}</div>
      ) : view.buildings.length > 0 && (
        <ul className={s.list} aria-label={`${names.building}s`}>
          <li className={`${s.row} ${s.headRow}`} aria-hidden="true"><span>{names.building}</span><span className={s.num}>Lines</span><span className={s.num}>Elements</span><span className={s.num}>Contract value</span><span className={s.num}>Variance</span><span /></li>
          {view.buildings.map((b) => {
            const isOpen = open.has(b.item_id);
            const top = Math.max(1, ...b.types.map((t) => Math.max(t.client_qty, t.model_qty)));
            return (
              <li key={b.item_id} className={s.item} data-guide="buildings.row">
                <div className={s.row}>
                  <div className={`${s.name}`}>
                    <span className={s.code}>{b.code}</span>
                    <button type="button" className={`${s.link} ${s.nameText}`} onClick={() => flip(b.item_id)} aria-expanded={isOpen} aria-label={`${isOpen ? "Fold" : "Unfold"} ${b.code} ${b.name}`}>{b.name}</button>
                  </div>
                  <div className={`${s.cell} ${s.num}`}><span className={s.label}>Lines</span>{b.line_count}</div>
                  <div className={`${s.cell} ${s.num}`}><span className={s.label}>Elements</span>{b.element_count}</div>
                  <div className={`${s.cell} ${s.num}`}><span className={s.label}>Contract value</span>{b.client_amount ? money(b.client_amount, currency, 0) : "–"}</div>
                  <div className={`${s.cell} ${s.num}`}>
                    <span className={s.label}>Variance</span>
                    {b.worst_band === "none" ? "–" : <span className={`${s.pill} ${BAND_CLASS[b.worst_band]}`} title={BAND_WORDS[b.worst_band]}>{b.variance_amount === 0 ? "0" : `${b.variance_amount > 0 ? "+" : ""}${money(b.variance_amount, currency, 0)}`}{b.outside_tolerance > 0 ? ` · ${b.outside_tolerance}` : ""}</span>}
                  </div>
                  <div className={s.toggleCell}><button type="button" className={s.toggle} aria-label={`${isOpen ? "Fold" : "Unfold"} ${b.code}`} aria-expanded={isOpen} onClick={() => flip(b.item_id)}>{isOpen ? "▾" : "▸"}</button></div>
                </div>
                {isOpen && (
                  <div className={s.detail} data-guide="buildings.detail">
                    {b.types.length === 0 ? <div className={s.note}>No element types in this {names.building.toLowerCase()} yet.</div> : (
                      <div className={s.types}>
                        <span className={s.typesHead}>Type</span><span className={s.typesHead}>Count</span><span className={s.typesHead}>Client and model</span><span className={s.typesHead}>Client qty</span><span className={s.typesHead}>Model qty</span>
                        {b.types.map((t) => (
                          <TypeLine key={t.type} t={t} top={top} />
                        ))}
                      </div>
                    )}
                    {b.is_common && <div className={s.note}>{ELEMENT_TIPS.common}</div>}
                    <div className={s.detailActions}>
                      {editable && <Button variant="secondary" size="sm" style={{ minHeight: 44 }} data-guide="buildings.edit" onClick={() => setEditing(b)}>Edit</Button>}
                      {editable && b.line_count === 0 && <Button variant="quiet" size="sm" style={{ minHeight: 44 }} disabled={busy} data-guide="buildings.remove" onClick={() => void remove(b)}>Remove</Button>}
                      <Button variant="quiet" size="sm" style={{ minHeight: 44 }} onClick={() => { setShowElements(true); setFilter(b.code); }}>Show its elements</Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {view.no_building.line_count > 0 && (
        <div className={s.note} data-guide="buildings.none" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <span>No {names.building.toLowerCase()}: {view.no_building.line_count} line{view.no_building.line_count === 1 ? "" : "s"}{view.no_building.client_amount ? `, ${money(view.no_building.client_amount, currency, 0)}` : ""}</span>
          <InfoTip label="No building">{ELEMENT_TIPS.noBuilding}</InfoTip>
          {editable && !hasCommon && <Button variant="quiet" size="sm" style={{ minHeight: 44 }} disabled={busy} data-guide="buildings.common" onClick={() => void makeCommon()}>Add {COMMON_BUILDING.name}<InfoTip label="Common">{ELEMENT_TIPS.common}</InfoTip></Button>}
        </div>
      )}

      {error && <div role="alert" className={s.err}>{error}</div>}
      {notice && !error && <div role="status" className={s.ok}>{notice}</div>}

      <div className={s.head}>
        <Button variant="quiet" size="sm" aria-expanded={showElements} style={{ minHeight: 44 }} data-guide="buildings.elements_toggle" onClick={() => setShowElements((v) => !v)}>{showElements ? "Hide elements" : `Elements (${d.rows.filter((r) => !r.is_category && (r.element_code || r.element_type)).length})`}</Button>
        <InfoTip label="Elements">{ELEMENT_TIPS.elementCode}</InfoTip>
        {showElements && (
          <Select aria-label="Show elements of" value={filter} style={{ minHeight: 44, width: "auto", maxWidth: "100%" }} data-guide="buildings.filter" onChange={(e) => { setFilter(e.target.value); setAll(false); }}>
            <option value="">All lines</option>
            {view.buildings.map((b) => <option key={b.item_id} value={b.code}>{b.code} {b.name}</option>)}
            <option value="__none__">No {names.building.toLowerCase()}</option>
          </Select>
        )}
      </div>
      {showElements && (
        <>
          {rows.length === 0 ? <div className={s.note}>No lines to show.</div> : (
            <div className={s.table} role="table" aria-label="Elements" data-guide="buildings.elements">
              <div className={s.ehead} role="row"><span role="columnheader">Element code</span><span role="columnheader">Type</span><span role="columnheader">{names.building}</span><span role="columnheader">Description</span><span role="columnheader" className={s.num}>Client qty</span><span role="columnheader" className={s.num}>Model qty</span><span role="columnheader">Budget uses</span></div>
              {shownRows.map((r) => <ElementLine key={r.key} r={r} onOpen={() => setLine(r.key)} />)}
            </div>
          )}
          {rows.length > SHOWN && <div><Button variant="quiet" size="sm" style={{ minHeight: 44 }} onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${rows.length}`}</Button></div>}
        </>
      )}

      {issuing && <IssuePanel root={root} onClose={() => setIssuing(false)} onDone={(m) => { setIssuing(false); setNotice(m); changed(); }} />}
      {editing && <BuildingPanel root={root} b={editing} names={names} canReissue={d.can_reissue} onClose={() => setEditing(null)} onDone={(m) => { setEditing(null); setNotice(m); changed(); }} />}
      {picked && <ElementPanel root={root} data={d} row={picked} canEdit={canEdit} onClose={() => setLine(null)} onSaved={changed} />}
    </section>
  );
}

function TypeLine({ t, top }: { t: BuildingRow["types"][number]; top: number }) {
  const w = (n: number) => `${Math.max(2, Math.round((n / top) * 100))}%`;
  return (
    <>
      <span className={s.mono}>{t.type}</span>
      <span>{t.count}</span>
      <span className={s.bars}>
        <span className={`${s.bar} ${s.barClient}`} style={{ width: w(t.client_qty) }} />
        <span className={`${s.bar} ${t.outside > 0 ? s.barWarn : s.barModel}`} style={{ width: w(t.model_qty) }} />
      </span>
      <span className={s.num}>{nf(t.client_qty)}</span>
      <span className={s.num}>{nf(t.model_qty)}{t.outside > 0 ? ` · ${t.outside} out` : ""}</span>
    </>
  );
}

function ElementLine({ r, onOpen }: { r: ElementLineRow; onOpen: () => void }) {
  return (
    <button type="button" role="row" className={s.erow} onClick={onOpen} data-guide="buildings.element">
      <span className={`${s.ecell} ${s.mono}`} role="cell"><span className={s.label}>Element code</span>{r.element_code ?? <span className={s.note}>No code</span>}{r.outside_pattern && <> <span className={`${s.pill} ${s.amberPill}`}>Outside pattern</span></>}</span>
      <span className={s.ecell} role="cell"><span className={s.label}>Type</span>{r.element_type ?? "–"}</span>
      <span className={s.ecell} role="cell"><span className={s.label}>Building</span>{r.building_code ?? <span className={s.note}>None</span>}</span>
      <span className={`${s.ecell} ${s.wide}`} role="cell"><span className={s.label}>Description</span>{r.ref ? `${r.ref} ` : ""}{r.description}</span>
      <span className={`${s.ecell} ${s.num}`} role="cell"><span className={s.label}>Client qty</span>{r.client_qty === null ? "–" : nf(r.client_qty)}</span>
      <span className={`${s.ecell} ${s.num}`} role="cell"><span className={s.label}>Model qty</span>{r.model_qty === null ? "–" : nf(r.model_qty)}{r.band !== "none" && r.band !== "within" && <> <span className={`${s.pill} ${BAND_CLASS[r.band]}`}>{r.variance_pct}%</span></>}</span>
      <span className={s.ecell} role="cell"><span className={s.label}>Budget uses</span>{r.model_qty === null ? "–" : r.uses === "model" ? "Model" : "Client"}</span>
    </button>
  );
}

function AddBuilding({ root, names, onClose, onDone }: { root: string; names: BuildingsData["settings"]["level_names"]; onClose: () => void; onDone: (m: string) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true); setError("");
    const r = await call(`${root}/buildings`, "POST", { code, name });
    setBusy(false);
    if (!r.ok) { setError(r.j.error ?? "Could not add it"); return; }
    onDone(`${code.trim().toUpperCase()} added`);
  }
  return (
    <form className={s.form} data-guide="buildings.add_form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className={s.field}><span className="bpm-label-row">Code <InfoTip label="Code">{ELEMENT_TIPS.buildingCode}</InfoTip></span><Input value={code} maxLength={6} autoFocus style={{ minHeight: 44, textTransform: "uppercase" }} data-guide="buildings.add_code" onChange={(e) => setCode(e.target.value)} /></label>
      <label className={s.field}><span>{names.building} name</span><Input value={name} maxLength={200} style={{ minHeight: 44 }} data-guide="buildings.add_name" onChange={(e) => setName(e.target.value)} /></label>
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" loading={busy} disabled={!code.trim() || !name.trim()} style={{ minHeight: 44 }} data-guide="buildings.add_save">Add</Button>
        <Button type="button" variant="quiet" style={{ minHeight: 44 }} onClick={onClose}>Cancel</Button>
      </div>
      {error && <div role="alert" className={s.err} style={{ gridColumn: "1 / -1" }}>{error}</div>}
    </form>
  );
}

function IssuePanel({ root, onClose, onDone }: { root: string; onClose: () => void; onDone: (m: string) => void }) {
  const [plan, setPlan] = useState<IssueAnswer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await call<IssueAnswer>(`${root}/elements/issue`, "POST", { preview: true });
      if (!live) return;
      if (!r.ok) setError(r.j.error ?? "Could not preview the codes"); else setPlan(r.j as IssueAnswer);
    })();
    return () => { live = false; };
  }, [root]);
  async function apply() {
    setBusy(true); setError("");
    const r = await call<IssueAnswer>(`${root}/elements/issue`, "POST", {});
    setBusy(false);
    if (!r.ok) { setError(r.j.error ?? "Could not issue the codes"); return; }
    onDone(`${r.j.written} code${r.j.written === 1 ? "" : "s"} issued`);
  }
  return (
    <SidePanel
      title="Issue codes" subtitle={plan ? `Pattern ${plan.pattern}` : undefined} label="Issue element codes" onClose={onClose}
      footer={<Button variant="primary" loading={busy} disabled={!plan || plan.plan.assignments.length === 0} style={{ minHeight: 44 }} data-guide="buildings.issue_apply" onClick={() => void apply()}>Issue {plan?.plan.assignments.length ?? 0} code{plan?.plan.assignments.length === 1 ? "" : "s"}</Button>}
    >
      <div className={s.stack} data-guide="buildings.issue_panel">
        <div className="bpm-label-row"><span className="bpm-t-label">Preview</span><InfoTip label="Issue codes">{ELEMENT_TIPS.issue}</InfoTip></div>
        {!plan && !error && <div className={s.note}>Working it out…</div>}
        {plan && plan.plan.summary.length === 0 && <div className={s.note}>There is nothing to issue: every line with a building and a type already has a code.</div>}
        {plan && plan.plan.summary.map((t) => <div key={t} className={s.mono} style={{ fontSize: 13 }}>{t}</div>)}
        {plan && plan.plan.skipped.length > 0 && <div className={s.warn}>{plan.plan.skipped.length} line{plan.plan.skipped.length === 1 ? "" : "s"} cannot get a code: {[...new Set(plan.plan.skipped.map((x) => x.reason))].slice(0, 3).join("; ")}</div>}
        {error && <div role="alert" className={s.err}>{error}</div>}
      </div>
    </SidePanel>
  );
}

function BuildingPanel({ root, b, names, canReissue, onClose, onDone }: { root: string; b: BuildingRow; names: BuildingsData["settings"]["level_names"]; canReissue: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const [name, setName] = useState(b.name);
  const [code, setCode] = useState(b.code);
  const [preview, setPreview] = useState<{ rows: { key: string; from: string; to: string }[] } | null>(null);
  const [used, setUsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = `${root}/buildings/${b.item_id}`;

  async function save(reissue = false) {
    setBusy(true); setError("");
    const body: Record<string, unknown> = {};
    if (name.trim() !== b.name) body.name = name.trim();
    if (code.trim().toUpperCase() !== b.code) body.code = code.trim();
    if (reissue) body.reissue = true;
    if (Object.keys(body).length === 0) { setBusy(false); onClose(); return; }
    const r = await call<{ used_by?: number }>(url, "PATCH", body);
    setBusy(false);
    if (!r.ok) {
      if (r.status === 409 && typeof r.j.used_by === "number") { setUsed(r.j.used_by); setError(r.j.error ?? ""); return; }
      setError(r.j.error ?? "Could not save"); return;
    }
    onDone(reissue ? "Codes reissued" : "Saved");
  }

  async function showPreview() {
    setBusy(true); setError("");
    const r = await call<{ preview?: { rows: { key: string; from: string; to: string }[] } }>(url, "PATCH", { code: code.trim(), reissue: true, preview: true });
    setBusy(false);
    if (!r.ok) { setError(r.j.error ?? "Could not preview"); return; }
    setPreview(r.j.preview ?? { rows: [] });
  }

  return (
    <SidePanel title={`${b.code} ${b.name}`} label={`Edit ${names.building.toLowerCase()}`} onClose={onClose} footer={<Button variant="primary" loading={busy} style={{ minHeight: 44 }} data-guide="buildings.edit_save" onClick={() => void save(preview !== null)}>{preview ? `Reissue ${preview.rows.length} code${preview.rows.length === 1 ? "" : "s"} and save` : "Save"}</Button>}>
      <div className={s.stack} data-guide="buildings.edit_panel">
        <Field label={`${names.building} name`}><Input value={name} maxLength={200} style={{ minHeight: 44 }} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Code" info={ELEMENT_TIPS.buildingCode}><Input value={code} maxLength={6} style={{ minHeight: 44, textTransform: "uppercase" }} data-guide="buildings.edit_code" onChange={(e) => { setCode(e.target.value); setPreview(null); }} /></Field>
        {used > 0 && canReissue && !preview && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="secondary" disabled={busy} style={{ minHeight: 44 }} data-guide="buildings.reissue" onClick={() => void showPreview()}>Preview reissue</Button>
            <InfoTip label="Reissue codes">{ELEMENT_TIPS.reissue}</InfoTip>
          </div>
        )}
        {used > 0 && !canReissue && <div className={s.warn}>The codes are final: the baseline is approved or the ERP has them. Fix a wrong code with a revision.</div>}
        {preview && (
          <div className={s.stack} data-guide="buildings.reissue_preview">
            <div className="bpm-t-label">{preview.rows.length} code{preview.rows.length === 1 ? "" : "s"} change</div>
            {preview.rows.slice(0, 12).map((r) => <div key={r.key} className={s.mono} style={{ fontSize: 13 }}>{r.from} to {r.to}</div>)}
            {preview.rows.length > 12 && <div className={s.note}>and {preview.rows.length - 12} more</div>}
          </div>
        )}
        {error && <div role="alert" className={s.err}>{error}</div>}
      </div>
    </SidePanel>
  );
}
