"use client";

import { useId } from "react";
import Button from "@/components/ui/Button";
import s from "./middleware.module.css";
import type { ErpField, FieldMap } from "./api";
import { appendPlaceholder, bpmFieldLabel, emptyRow, fieldOptionLabel, type MapMode, type MapRow, type RowIssue } from "./mapEditor";

/** The standard (or saved) map, read only: the ERP field on the left, what fills it on the right. */
export function MapView({ map, mode, fields }: { map: FieldMap; mode: MapMode; fields?: readonly ErpField[] | null }) {
  const entries = Object.entries(map);
  if (entries.length === 0) return <div className={`${s.small} ${s.muted}`}>Nothing is mapped.</div>;
  const known = new Map((fields ?? []).map((f) => [f.name, f]));
  const left = mode === "outbound" ? "Field in the ERP" : "BPMSquare field";
  const right = mode === "outbound" ? "Value from BPMSquare" : "Column in the ERP";
  return (
    <div className={s.mapView} role="table" aria-label="Field map">
      <div style={{ display: "contents" }} role="row"><span className={s.head} role="columnheader">{left}</span><span className={s.head} role="columnheader">{right}</span></div>
      {entries.map(([a, b]) => {
        const erp = mode === "outbound" ? a : b;
        const f = known.get(erp);
        return (
          <div key={a} style={{ display: "contents" }} role="row">
            <span role="cell">
              {mode === "outbound" ? <FieldLabel name={a} field={f} /> : <span className={s.fieldName}>{bpmFieldLabel(a)}</span>}
            </span>
            <span role="cell" className={s.wrapAny}>{mode === "outbound" ? <span className={s.mono}>{b}</span> : <FieldLabel name={b} field={f} />}</span>
          </div>
        );
      })}
    </div>
  );
}

function FieldLabel({ name, field }: { name: string; field?: ErpField }) {
  return (
    <>
      <span className={s.fieldName}>{field?.label ?? name}{field?.required && <span className={s.req}> required</span>}</span>
      <span className={s.fieldTech}>{name}{field ? ` · ${field.type}` : ""}</span>
    </>
  );
}

/**
 * The map as editable rows. The ERP side is a pick-list fed by the ERP's own
 * field list (display name, technical name, type, a "required" mark); the
 * BPMSquare side is a list of the fields BPMSquare offers, inserted as {field}.
 */
export default function MapEditor({ mode, rows, onRows, erpFields, allowed, issues }: {
  mode: MapMode;
  rows: MapRow[];
  onRows: (rows: MapRow[]) => void;
  erpFields: readonly ErpField[] | null;
  allowed: readonly string[];
  issues: readonly RowIssue[];
}) {
  const listId = useId();
  const known = new Map((erpFields ?? []).map((f) => [f.name, f]));
  const patch = (key: string, p: Partial<MapRow>) => onRows(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const left = mode === "outbound" ? "Field in the ERP" : "BPMSquare field";
  const right = mode === "outbound" ? "Value from BPMSquare" : "Column in the ERP";

  return (
    <div className={s.mapRows}>
      {erpFields && (
        <datalist id={listId}>
          {erpFields.map((f) => <option key={f.name} value={f.name}>{fieldOptionLabel(f)}</option>)}
        </datalist>
      )}
      <div className={`${s.mapRow} ${s.mapHead}`} aria-hidden="true" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--hint)", textTransform: "uppercase", letterSpacing: ".04em" }}>
        <span>{left}</span><span /><span>{right}</span><span />
      </div>
      {rows.map((r, i) => {
        const fi = issues.find((x) => x.row === i && x.part === "field");
        const vi = issues.find((x) => x.row === i && x.part === "value");
        const erpName = mode === "outbound" ? r.field : r.value;
        const erp = known.get(erpName.trim());
        const erpInput = (value: string, onChange: (v: string) => void, label: string, invalid: boolean) => (
          <div style={{ minWidth: 0 }}>
            <input className="bpm-input" list={erpFields ? listId : undefined} aria-label={label} aria-invalid={invalid || undefined} value={value} autoComplete="off" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
            {erp && <span className={s.fieldTech}>{erp.label} · {erp.type}{erp.required && <span className={s.req}> · required</span>}</span>}
          </div>
        );
        return (
          <div key={r.key} className={s.mapRow}>
            {mode === "outbound" ? erpInput(r.field, (v) => patch(r.key, { field: v }), `Row ${i + 1}: field in the ERP`, !!fi) : (
              <div style={{ minWidth: 0 }}>
                <select className="bpm-input" aria-label={`Row ${i + 1}: BPMSquare field`} aria-invalid={!!fi || undefined} value={r.field} onChange={(e) => patch(r.key, { field: e.target.value })}>
                  <option value="">Choose…</option>
                  {allowed.map((k) => <option key={k} value={k}>{bpmFieldLabel(k)}</option>)}
                </select>
              </div>
            )}
            <span className={s.mapArrow} aria-hidden="true">←</span>
            {mode === "outbound" ? (
              <div style={{ minWidth: 0, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <input className="bpm-input" style={{ flex: "1 1 160px" }} aria-label={`Row ${i + 1}: value`} aria-invalid={!!vi || undefined} value={r.value} autoComplete="off" spellCheck={false} onChange={(e) => patch(r.key, { value: e.target.value })} />
                <select className="bpm-input" style={{ flex: "0 1 150px" }} aria-label={`Row ${i + 1}: add a field`} value="" onChange={(e) => e.target.value && patch(r.key, { value: appendPlaceholder(r.value, e.target.value) })}>
                  <option value="">Add field…</option>
                  {allowed.map((k) => <option key={k} value={k}>{bpmFieldLabel(k)}</option>)}
                </select>
              </div>
            ) : erpInput(r.value, (v) => patch(r.key, { value: v }), `Row ${i + 1}: column in the ERP`, !!vi)}
            <Button size="sm" variant="quiet" iconOnly aria-label={`Remove row ${i + 1}`} onClick={() => onRows(rows.filter((x) => x.key !== r.key))}>
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </Button>
            {(fi || vi) && <div className={`${s.issue} ${s.fieldFull}`} style={{ gridColumn: "1 / -1" }} role="alert">Row {i + 1}: {(fi ?? vi)!.message}</div>}
          </div>
        );
      })}
      <div><Button size="sm" onClick={() => onRows([...rows, emptyRow()])}>Add a field</Button></div>
    </div>
  );
}
