"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { buildExportCsv, downloadCsv } from "@/lib/import/template";
import type { ExportFilter, ExportFilterOp, ExportResponse, ObjectSpec } from "@/lib/import/types";
import { banner, btn, btnGhost, card, tone } from "./ui";

const ID_COLUMN = { key: "id", label: "Record ID" };

const OPS_BY_TYPE: Record<string, { value: ExportFilterOp; label: string }[]> = {
  text:     [{ value: "contains", label: "contains" }, { value: "equals", label: "is" }, { value: "not_equals", label: "is not" }, { value: "is_empty", label: "is empty" }, { value: "is_not_empty", label: "is not empty" }],
  longtext: [{ value: "contains", label: "contains" }, { value: "is_empty", label: "is empty" }, { value: "is_not_empty", label: "is not empty" }],
  email:    [{ value: "contains", label: "contains" }, { value: "equals", label: "is" }, { value: "is_empty", label: "is empty" }, { value: "is_not_empty", label: "is not empty" }],
  enum:     [{ value: "equals", label: "is" }, { value: "not_equals", label: "is not" }],
  ref:      [{ value: "equals", label: "is" }, { value: "not_equals", label: "is not" }, { value: "is_empty", label: "is empty" }, { value: "is_not_empty", label: "is not empty" }],
  number:   [{ value: "equals", label: "=" }, { value: "gt", label: ">" }, { value: "lt", label: "<" }, { value: "is_empty", label: "is empty" }, { value: "is_not_empty", label: "is not empty" }],
  integer:  [{ value: "equals", label: "=" }, { value: "gt", label: ">" }, { value: "lt", label: "<" }, { value: "is_empty", label: "is empty" }, { value: "is_not_empty", label: "is not empty" }],
  date:     [{ value: "on", label: "on" }, { value: "before", label: "before" }, { value: "after", label: "after" }, { value: "is_empty", label: "is empty" }, { value: "is_not_empty", label: "is not empty" }],
  boolean:  [{ value: "equals", label: "is" }],
};

const VALUELESS_OPS = new Set<ExportFilterOp>(["is_empty", "is_not_empty"]);

const inputStyle: React.CSSProperties = {
  padding: "6px 9px", borderRadius: 7, border: `1px solid ${c.line}`, fontSize: 12.5,
  background: c.panel, color: c.ink, outline: "none",
};

export default function ExportFlow({ spec }: { spec: ObjectSpec }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(spec.fields.map((f) => f.key)));
  const [filters, setFilters] = useState<ExportFilter[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [lastCount, setLastCount] = useState<number | null>(null);

  const toggleColumn = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const addFilter = () => setFilters((f) => [...f, { field: spec.fields[0]?.key ?? "", op: "contains", value: "" }]);
  const updateFilter = (i: number, patch: Partial<ExportFilter>) =>
    setFilters((f) => f.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removeFilter = (i: number) => setFilters((f) => f.filter((_, idx) => idx !== i));

  async function runExport() {
    setPending(true);
    setError("");
    setLastCount(null);
    try {
      const cleanFilters = filters.filter((f) => f.field && (VALUELESS_OPS.has(f.op) || f.value.trim() !== ""));
      const res = await fetch(`/api/export/${spec.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: cleanFilters }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Export failed (${res.status})`);
        return;
      }
      const result = json as ExportResponse;
      const columns = [ID_COLUMN, ...spec.fields.filter((f) => selected.has(f.key)).map((f) => ({ key: f.key, label: f.label }))];
      downloadCsv(`bpmsquare_${spec.id}_export.csv`, buildExportCsv(columns, result.rows));
      setLastCount(result.rows.length);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <Title
          title="Choose columns"
          subtitle="Record ID is always included — it's what lets you re-upload this file under Update to change these records later."
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "8px 12px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: c.hint }}>
            <input type="checkbox" checked disabled style={{ width: 14, height: 14 }} />
            Record ID
          </label>
          {spec.fields.map((f) => (
            <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: c.ink, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={selected.has(f.key)}
                onChange={() => toggleColumn(f.key)}
                style={{ width: 14, height: 14, cursor: "pointer" }}
              />
              {f.label}
            </label>
          ))}
        </div>
      </div>

      <div style={card}>
        <Title title="Filters" subtitle="Only rows matching every filter below are exported. Leave empty to export everything." />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filters.map((f, i) => {
            const field = spec.fields.find((sf) => sf.key === f.field);
            const ops = OPS_BY_TYPE[field?.type ?? "text"] ?? OPS_BY_TYPE.text;
            const needsValue = !VALUELESS_OPS.has(f.op);
            return (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select value={f.field} onChange={(e) => updateFilter(i, { field: e.target.value, op: "equals" })} style={{ ...inputStyle, minWidth: 150 }}>
                  {spec.fields.map((sf) => <option key={sf.key} value={sf.key}>{sf.label}</option>)}
                </select>
                <select value={f.op} onChange={(e) => updateFilter(i, { op: e.target.value as ExportFilterOp })} style={{ ...inputStyle, minWidth: 110 }}>
                  {ops.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {needsValue && (
                  field?.type === "enum" && field.options?.length ? (
                    <select value={f.value} onChange={(e) => updateFilter(i, { value: e.target.value })} style={{ ...inputStyle, minWidth: 140 }}>
                      <option value="">— select —</option>
                      {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type={field?.type === "date" ? "date" : field?.type === "number" || field?.type === "integer" ? "number" : "text"}
                      value={f.value}
                      onChange={(e) => updateFilter(i, { value: e.target.value })}
                      style={{ ...inputStyle, minWidth: 140 }}
                    />
                  )
                )}
                <button onClick={() => removeFilter(i)} style={{ ...btnGhost, padding: "5px 10px", fontSize: 12 }}>Remove</button>
              </div>
            );
          })}
        </div>
        <button onClick={addFilter} style={{ ...btnGhost, marginTop: filters.length > 0 ? 10 : 0 }}>+ Add filter</button>
      </div>

      {error && <div style={banner(tone.bad)}>{error}</div>}
      {lastCount !== null && !error && (
        <div style={banner(tone.ok)}>{lastCount} row{lastCount === 1 ? "" : "s"} exported and downloaded.</div>
      )}

      <button onClick={runExport} disabled={pending} style={{ ...btn(pending ? c.line : c.accent), cursor: pending ? "wait" : "pointer", alignSelf: "flex-start" }}>
        {pending ? "Exporting…" : `↓ Download ${spec.label} CSV`}
      </button>
    </div>
  );
}

function Title({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: c.muted, marginTop: 3 }}>{subtitle}</div>}
    </div>
  );
}
