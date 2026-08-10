"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { c } from "@/lib/theme";
import type { PilotObjectType } from "@/lib/fieldRegistry";
import type { EffectiveField } from "@/lib/fieldRegistry";
import {
  OPS_BY_TYPE, OP_LABEL, VALUELESS_OPS, widgetToFilterType,
  parseConds, encodeConds,
  type FilterCond, type FilterValueType,
} from "@/lib/advancedFilter";

type FieldDef = {
  key: string;
  label: string;
  type: FilterValueType;
  kind: "standard" | "custom";
  options?: { value: string; label: string }[];
};

type SavedQuery = { id: string; name: string; conditions: FilterCond[]; created_at: string };

const field: React.CSSProperties = {
  padding: "6px 9px", borderRadius: 7, border: `1px solid ${c.line}`,
  fontSize: 12.5, color: c.ink, background: "var(--panel)", outline: "none",
};

/**
 * Advanced filtering for the object list pages: arbitrary (field, operator,
 * value) conditions over EVERY field the object has -- the same standard +
 * custom field catalog the Adapt drawer manages (/api/settings/field-config),
 * so a field a tenant added via Adapt is immediately filterable here with no
 * extra wiring. Conditions travel in the `af` searchParam (shareable,
 * back-button friendly, evaluated server-side by the page), and can be saved
 * as personal named queries (saved_queries table, per user per object).
 */
export default function AdvancedFilterPanel({ object }: { object: PilotObjectType }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const applied = useMemo(() => parseConds(searchParams.get("af")), [searchParams]);
  const [open, setOpen] = useState(false);
  const [conds, setConds] = useState<FilterCond[]>(applied);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Re-sync the draft whenever the applied URL state changes (back button,
  // saved query loaded, Clear on the basic bar).
  useEffect(() => { setConds(applied); }, [applied]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/settings/field-config?object=${object}`)
      .then((r) => r.json())
      .then((json: { sections?: { label: string; fields: EffectiveField[] }[] }) => {
        if (cancelled || !json.sections) return;
        const defs: FieldDef[] = [];
        const seen = new Set<string>();
        for (const section of json.sections) {
          for (const f of section.fields) {
            if (seen.has(f.field_key)) continue;
            seen.add(f.field_key);
            const type = widgetToFilterType(f.widget);
            const options =
              f.enumOptions ??
              (f.options ? f.options.map((o) => ({ value: o, label: o })) : undefined);
            // A "select" with no resolvable option list (selectSource fields
            // resolve via sales config we don't have here) degrades to text.
            defs.push({
              key: f.field_key, label: f.label, kind: f.kind,
              type: type === "select" && !options ? "text" : type,
              options,
            });
          }
        }
        setFields(defs);
      })
      .catch(() => {});
    fetch(`/api/saved-queries?object=${object}`)
      .then((r) => r.json())
      .then((json: { queries?: { id: string; name: string; conditions: unknown; created_at: string }[] }) => {
        if (cancelled || !json.queries) return;
        setSaved(json.queries.map((q) => ({ ...q, conditions: parseConds(JSON.stringify(q.conditions)) })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [object]);

  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);

  function pushConds(next: FilterCond[]) {
    const params = new URLSearchParams(searchParams.toString());
    const complete = next.filter((cn) => VALUELESS_OPS.has(cn.op) || (cn.value !== undefined && cn.value !== ""));
    if (complete.length > 0) params.set("af", encodeConds(complete));
    else params.delete("af");
    params.delete("page"); // filters changed -- stale page numbers make no sense
    router.push(`${pathname}?${params.toString()}`);
  }

  function updateCond(i: number, patch: Partial<FilterCond>) {
    setConds((prev) => prev.map((cn, j) => (j === i ? { ...cn, ...patch } : cn)));
  }

  function setCondField(i: number, key: string) {
    const def = fieldByKey.get(key);
    if (!def) return;
    updateCond(i, { field: key, t: def.type, op: OPS_BY_TYPE[def.type][0], value: "", value2: undefined });
  }

  function addCond() {
    const first = fields[0];
    if (!first) return;
    setConds((prev) => [...prev, { field: first.key, t: first.type, op: OPS_BY_TYPE[first.type][0], value: "" }]);
  }

  async function saveCurrent() {
    const name = window.prompt("Name this query:");
    if (!name?.trim()) return;
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/saved-queries", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object, name: name.trim(), conditions: encodeConds(conds) }),
      });
      const json = await res.json();
      if (!res.ok) { setMsg(json.error ?? "Save failed"); return; }
      setSaved((prev) => [...prev, { ...json.query, conditions: parseConds(JSON.stringify(json.query.conditions)) }].sort((a, b) => a.name.localeCompare(b.name)));
      setMsg("Saved.");
    } finally { setBusy(false); }
  }

  async function deleteSaved(id: string) {
    if (!window.confirm("Delete this saved query?")) return;
    const res = await fetch(`/api/saved-queries/${id}`, { method: "DELETE" });
    if (res.ok) setSaved((prev) => prev.filter((q) => q.id !== id));
  }

  function loadSaved(id: string) {
    const q = saved.find((s) => s.id === id);
    if (!q) return;
    setConds(q.conditions);
    setOpen(true);
    pushConds(q.conditions);
  }

  const activeCount = applied.length;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 11px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            border: `1px solid ${activeCount > 0 ? `var(--modern-accent, ${c.accent})` : c.line}`,
            background: "var(--panel)", color: activeCount > 0 ? `var(--modern-accent, ${c.accent})` : c.muted,
          }}
        >
          ⛛ Advanced filters
          {activeCount > 0 && (
            <span style={{
              minWidth: 17, height: 17, borderRadius: 9, padding: "0 5px",
              background: `var(--modern-accent, ${c.accent})`, color: "#fff",
              fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>{activeCount}</span>
          )}
          <span style={{ fontSize: 10, color: c.hint }}>{open ? "▲" : "▼"}</span>
        </button>

        {saved.length > 0 && (
          <select value="" onChange={(e) => e.target.value && loadSaved(e.target.value)} style={{ ...field, color: c.hint, cursor: "pointer" }}>
            <option value="">My saved queries…</option>
            {saved.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
        )}
        {msg && <span style={{ fontSize: 11.5, color: c.hint }}>{msg}</span>}
      </div>

      {open && (
        <div style={{
          marginTop: 8, padding: 12, borderRadius: 10,
          border: `1px solid ${c.line}`, background: "var(--panel)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          {conds.length === 0 && (
            <div style={{ fontSize: 12, color: c.hint }}>
              No conditions yet — add one below. Every field on this object (including custom fields) is available.
            </div>
          )}

          {conds.map((cn, i) => {
            const def = fieldByKey.get(cn.field);
            const ops = OPS_BY_TYPE[cn.t] ?? OPS_BY_TYPE.text;
            const valueless = VALUELESS_OPS.has(cn.op);
            return (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <select value={cn.field} onChange={(e) => setCondField(i, e.target.value)} style={{ ...field, maxWidth: 190 }}>
                  {!def && <option value={cn.field}>{cn.field}</option>}
                  <optgroup label="Standard fields">
                    {fields.filter((f) => f.kind === "standard").map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </optgroup>
                  {fields.some((f) => f.kind === "custom") && (
                    <optgroup label="Custom fields">
                      {fields.filter((f) => f.kind === "custom").map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </optgroup>
                  )}
                </select>

                <select value={cn.op} onChange={(e) => updateCond(i, { op: e.target.value as FilterCond["op"] })} style={{ ...field, maxWidth: 140 }}>
                  {ops.map((op) => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
                </select>

                {!valueless && cn.t === "select" && def?.options && (
                  <select value={cn.value ?? ""} onChange={(e) => updateCond(i, { value: e.target.value })} style={{ ...field, maxWidth: 180 }}>
                    <option value="">Choose…</option>
                    {def.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {!valueless && cn.t === "checkbox" && (
                  <select value={cn.value ?? ""} onChange={(e) => updateCond(i, { value: e.target.value })} style={{ ...field, maxWidth: 120 }}>
                    <option value="">Choose…</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                )}
                {!valueless && cn.t !== "select" && cn.t !== "checkbox" && (
                  <>
                    <input
                      type={cn.t === "number" ? "number" : cn.t === "date" ? "date" : "text"}
                      value={cn.value ?? ""}
                      onChange={(e) => updateCond(i, { value: e.target.value })}
                      placeholder="Value"
                      style={{ ...field, width: cn.t === "text" ? 170 : 140 }}
                    />
                    {cn.op === "between" && (
                      <>
                        <span style={{ fontSize: 11.5, color: c.hint }}>and</span>
                        <input
                          type={cn.t === "number" ? "number" : "date"}
                          value={cn.value2 ?? ""}
                          onChange={(e) => updateCond(i, { value2: e.target.value })}
                          style={{ ...field, width: 140 }}
                        />
                      </>
                    )}
                  </>
                )}

                <button
                  onClick={() => setConds((prev) => prev.filter((_, j) => j !== i))}
                  title="Remove condition"
                  style={{ border: "none", background: "none", cursor: "pointer", color: c.hint, fontSize: 14, padding: 4 }}
                >✕</button>
              </div>
            );
          })}

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
            <button onClick={addCond} disabled={fields.length === 0} style={{
              padding: "6px 11px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              border: `1px dashed ${c.line}`, background: "transparent", color: c.muted,
            }}>+ Add condition</button>

            <button onClick={() => pushConds(conds)} disabled={conds.length === 0 && activeCount === 0} style={{
              padding: "6px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              border: "none", background: `var(--modern-accent, ${c.accent})`, color: "#fff",
            }}>Apply</button>

            {(conds.length > 0 || activeCount > 0) && (
              <button onClick={() => { setConds([]); pushConds([]); }} style={{
                padding: "6px 11px", borderRadius: 7, fontSize: 12.5, cursor: "pointer",
                border: "none", background: "transparent", color: c.hint,
              }}>Clear</button>
            )}

            {conds.length > 0 && (
              <button onClick={saveCurrent} disabled={busy} style={{
                padding: "6px 11px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                border: `1px solid ${c.line}`, background: "transparent", color: c.muted, marginLeft: "auto",
              }}>💾 Save query…</button>
            )}
          </div>

          {saved.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderTop: `1px solid ${c.line}`, paddingTop: 8 }}>
              {saved.map((q) => (
                <span key={q.id} style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "3px 9px", borderRadius: 12, fontSize: 11.5,
                  border: `1px solid ${c.line}`, color: c.muted,
                }}>
                  <button onClick={() => loadSaved(q.id)} style={{ border: "none", background: "none", cursor: "pointer", color: "inherit", fontSize: "inherit", padding: 0 }}>{q.name}</button>
                  <button onClick={() => deleteSaved(q.id)} title="Delete saved query" style={{ border: "none", background: "none", cursor: "pointer", color: c.hint, fontSize: 11, padding: 0 }}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
