"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";
import type { MarketingTargetGroup } from "@/lib/types";
import {
  SEGMENT_FIELDS, OPERATOR_LABEL, getSegmentField,
  type SegmentFilter, type SegmentFieldDef,
} from "@/lib/marketingSegmentation";
import { AccountIncludeExclude, ManualEmailChips, type AccountLite } from "./AudienceExtras";

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: c.muted,
  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
};
const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 8,
  padding: "8px 10px", fontSize: 13, color: c.ink, background: c.panel, outline: "none",
};

let nextId = 0;
function newFilterId(fieldKey: string) {
  nextId += 1;
  return `${fieldKey}_${nextId}`;
}

/** Rule-based "Segmentation" target-group builder -- a drag-and-drop
 * attribute palette + canvas in the style of SAP Marketing Cloud's
 * segmentation designer. The palette reads entirely from SEGMENT_FIELDS
 * (lib/marketingSegmentation.ts); adding a future signal (contact
 * enrichment score, sentiment, a news-mention flag) as a new registry entry
 * is all that's needed for it to show up here automatically. */
export default function SegmentBuilder({ accounts, initial }: { accounts: AccountLite[]; initial?: MarketingTargetGroup | null }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [filters, setFilters] = useState<SegmentFilter[]>(initial?.filters ?? []);
  const [match, setMatch] = useState<"all" | "any">(initial?.match ?? "all");
  const [includeIds, setIncludeIds] = useState<Set<string>>(new Set(initial?.include_account_ids ?? []));
  const [excludeIds, setExcludeIds] = useState<Set<string>>(new Set(initial?.exclude_account_ids ?? []));
  const [manualEmails, setManualEmails] = useState<Set<string>>(new Set(initial?.manual_emails ?? []));
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{ will_receive: number; opted_out: number; no_email: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const categories = useMemo(() => {
    const map = new Map<string, SegmentFieldDef[]>();
    for (const f of SEGMENT_FIELDS) {
      const list = map.get(f.category);
      if (list) list.push(f); else map.set(f.category, [f]);
    }
    return Array.from(map.entries());
  }, []);

  function addFilter(field: SegmentFieldDef) {
    setFilters((current) => [...current, {
      id: newFilterId(field.key),
      field: field.key,
      operator: field.operators[0],
      value: field.type === "select" ? (field.options?.[0]?.value ?? "") : "",
    }]);
  }

  function updateFilter(id: string, patch: Partial<SegmentFilter>) {
    setFilters((current) => current.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function removeFilter(id: string) {
    setFilters((current) => current.filter((f) => f.id !== id));
  }

  useEffect(() => {
    const rule = {
      account_types: [], include_account_ids: [...includeIds], exclude_account_ids: [...excludeIds],
      manual_emails: [...manualEmails], filters, match,
    };
    const timer = setTimeout(() => {
      fetch("/api/marketing/recipients-preview", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rule),
      }).then((r) => r.json()).then(setPreview).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeIds, excludeIds, manualEmails, filters, match]);

  async function save() {
    if (!name.trim()) { setError("Give this target group a name."); return; }
    setError("");
    setSaving(true);
    try {
      const payload = {
        name,
        account_types: [],
        include_account_ids: [...includeIds],
        exclude_account_ids: [...excludeIds],
        manual_emails: [...manualEmails],
        filters, match,
      };
      const res = initial
        ? await fetch(`/api/marketing/target-groups/${initial.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/marketing/target-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save");
      router.push(ROUTES.marketingSegments);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}>
      <section style={cardStyle}>
        <label style={lbl}>Target group name</label>
        <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. OEM accounts, Mumbai" />
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 14, alignItems: "start" }}>
        <section style={cardStyle}>
          <div style={{ ...lbl, marginBottom: 10 }}>Attributes</div>
          <div style={{ fontSize: 11, color: c.hint, marginBottom: 12, lineHeight: 1.5 }}>Drag an attribute onto the canvas, or click it to add.</div>
          {categories.map(([category, fields]) => (
            <div key={category} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{category}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {fields.map((f) => (
                  <div
                    key={f.key}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", f.key)}
                    onClick={() => addFilter(f)}
                    style={{
                      fontSize: 12.5, padding: "7px 10px", borderRadius: 7, border: `1px solid ${c.line}`,
                      background: c.panel2, color: c.ink, cursor: "grab", userSelect: "none",
                    }}
                  >
                    {f.label}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section
          style={{ ...cardStyle, minHeight: 220, background: dragOver ? c.accentbg : cardStyle.background, border: dragOver ? `2px dashed ${c.accent}` : cardStyle.border }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const key = e.dataTransfer.getData("text/plain");
            const field = getSegmentField(key);
            if (field) addFilter(field);
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={lbl}>Conditions</div>
            {filters.length > 1 && (
              <div style={{ display: "flex", gap: 6, fontSize: 12 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 4, color: c.ink, cursor: "pointer" }}>
                  <input type="radio" checked={match === "all"} onChange={() => setMatch("all")} /> Match ALL
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, color: c.ink, cursor: "pointer" }}>
                  <input type="radio" checked={match === "any"} onChange={() => setMatch("any")} /> Match ANY
                </label>
              </div>
            )}
          </div>

          {filters.length === 0 ? (
            <div style={{ padding: "36px 16px", textAlign: "center", color: c.hint, fontSize: 13, border: `1px dashed ${c.line}`, borderRadius: 8 }}>
              Drag an attribute here to start building a rule — e.g. "Account type is OEM" + "City contains Mumbai".
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filters.map((filter, i) => {
                const field = getSegmentField(filter.field);
                if (!field) return null;
                const needsValue = field.type !== "boolean";
                return (
                  <div key={filter.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {i > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: c.hint, width: 30 }}>{match === "all" ? "AND" : "OR"}</span>}
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: c.ink, minWidth: 120 }}>{field.label}</span>
                    <select
                      value={filter.operator}
                      onChange={(e) => updateFilter(filter.id, { operator: e.target.value as SegmentFilter["operator"] })}
                      style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel, color: c.ink }}
                    >
                      {field.operators.map((op) => <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>)}
                    </select>
                    {needsValue && (
                      field.type === "select" ? (
                        <select value={filter.value} onChange={(e) => updateFilter(filter.id, { value: e.target.value })} style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel, color: c.ink }}>
                          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <input
                          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                          value={filter.value}
                          onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                          style={{ fontSize: 12, padding: "6px 8px", borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel, color: c.ink, width: 140 }}
                        />
                      )
                    )}
                    <button onClick={() => removeFilter(filter.id)} style={{ marginLeft: "auto", background: "none", border: "none", color: c.hint, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section style={cardStyle}>
        <div style={{ ...lbl, marginBottom: 10 }}>Manual overrides (optional)</div>
        <div style={{ marginBottom: 14 }}>
          <AccountIncludeExclude accounts={accounts} includeIds={includeIds} setIncludeIds={setIncludeIds} excludeIds={excludeIds} setExcludeIds={setExcludeIds} />
        </div>
        <div style={{ paddingTop: 14, borderTop: `1px solid ${c.line}` }}>
          <ManualEmailChips manualEmails={manualEmails} setManualEmails={setManualEmails} />
        </div>
      </section>

      {preview && (
        <div style={{ fontSize: 13 }}>
          <strong style={{ color: c.ink }}>→ {preview.will_receive} recipient{preview.will_receive === 1 ? "" : "s"}</strong>
          {(preview.opted_out > 0 || preview.no_email > 0) && (
            <span style={{ color: c.hint, marginLeft: 8, fontSize: 12 }}>
              ({preview.opted_out > 0 ? `${preview.opted_out} opted out` : ""}{preview.opted_out > 0 && preview.no_email > 0 ? " · " : ""}{preview.no_email > 0 ? `${preview.no_email} no email on file` : ""})
            </span>
          )}
        </div>
      )}

      {error && <div style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}

      <div>
        <button onClick={save} disabled={saving} style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13.5, cursor: saving ? "not-allowed" : "pointer" }}>
          {saving ? "Saving…" : initial ? "Save changes" : "Create target group"}
        </button>
      </div>
    </div>
  );
}
