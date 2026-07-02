"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { c } from "@/lib/theme";
import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import { cardStyle } from "@/components/Shell";

type FieldType = "text" | "number" | "date" | "select" | "checkbox" | "textarea";

interface CustomField {
  id: string;
  field_key: string;
  field_label: string;
  field_type: FieldType;
  options: string[] | null;
  is_required: boolean;
  position: number;
}

interface Props {
  objectType: "account" | "contact" | "case" | "quote" | "work_order" | "asset";
  recordId: string;
  /** The current custom_data JSONB value from the parent record */
  customData?: Record<string, unknown> | null;
  /** API path to PATCH custom_data on the record, e.g. /api/accounts/123 */
  patchUrl: string;
}

export default function CustomFieldsSection({ objectType, recordId: _recordId, customData, patchUrl }: Props) {
  const { settings } = useSettings();
  const accent = ACCENT_PRESETS[settings.accentPreset].color;

  const [fields, setFields]   = useState<CustomField[]>([]);
  const [data, setData]       = useState<Record<string, unknown>>(customData ?? {});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft]     = useState<unknown>("");
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  // Drag-to-reorder
  const dragId   = useRef<string | null>(null);
  const dragOver = useRef<string | null>(null);
  const [dragActive, setDragActive] = useState<string | null>(null);

  const fetchFields = useCallback(async () => {
    const res = await fetch(`/api/settings/custom-fields?object=${objectType}`);
    if (res.ok) setFields(await res.json());
  }, [objectType]);

  useEffect(() => { fetchFields(); }, [fetchFields]);

  const handleDragEnd = async () => {
    if (!dragId.current || !dragOver.current || dragId.current === dragOver.current) {
      setDragActive(null); dragId.current = null; dragOver.current = null; return;
    }
    const reordered = [...fields];
    const fromIdx = reordered.findIndex((f) => f.id === dragId.current);
    const toIdx   = reordered.findIndex((f) => f.id === dragOver.current);
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const withPos = reordered.map((f, i) => ({ ...f, position: i }));
    setFields(withPos);
    setDragActive(null); dragId.current = null; dragOver.current = null;
    await Promise.all(
      withPos.map((f) => fetch(`/api/settings/custom-fields/${f.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: f.position }),
      }))
    );
  };

  if (fields.length === 0) return null;

  const startEdit = (field: CustomField) => {
    setEditing(field.field_key);
    setDraft(data[field.field_key] ?? "");
  };

  const saveField = async (field: CustomField) => {
    setSaving(true);
    const updated = { ...data, [field.field_key]: draft };
    const res = await fetch(patchUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custom_data: updated }),
    });
    setSaving(false);
    if (res.ok) {
      setData(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    }
    setEditing(null);
  };

  const cancelEdit = () => { setEditing(null); };

  const displayValue = (field: CustomField): string => {
    const v = data[field.field_key];
    if (v === null || v === undefined || v === "") return "—";
    if (field.field_type === "checkbox") return v ? "Yes" : "No";
    return String(v);
  };

  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>Custom fields</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10.5, color: c.hint }}>⠿ drag to reorder</span>
          {saved && <span style={{ fontSize: 11, color: "#1d9e75", fontWeight: 500 }}>✓ Saved</span>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {fields.map((field) => {
          const isEditing = editing === field.field_key;
          const isDragging = dragActive === field.id;
          return (
            <div
              key={field.id}
              draggable
              onDragStart={() => { dragId.current = field.id; setDragActive(field.id); }}
              onDragEnter={() => { dragOver.current = field.id; }}
              onDragOver={(e) => e.preventDefault()}
              onDragEnd={handleDragEnd}
              style={{
                padding: "10px 12px", background: isDragging ? c.accentbg : c.panel2,
                borderRadius: 8, border: `1px solid ${isDragging ? accent : c.line}`,
                cursor: isEditing ? "default" : "grab", opacity: isDragging ? 0.5 : 1,
                transition: "border-color 0.15s, background 0.15s",
              }}
              onClick={() => !isEditing && startEdit(field)}
            >
              <div style={{ fontSize: 10.5, color: c.hint, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: c.hint, opacity: 0.4, fontSize: 12, cursor: "grab" }}>⠿</span>
                {field.field_label}
                {field.is_required && <span style={{ color: "#e05252", marginLeft: 3 }}>*</span>}
              </div>

              {isEditing ? (
                <div onClick={(e) => e.stopPropagation()}>
                  {field.field_type === "select" && field.options ? (
                    <select
                      autoFocus
                      value={draft as string}
                      onChange={(e) => setDraft(e.target.value)}
                      style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: `1px solid ${accent}`, fontSize: 13, outline: "none" }}
                    >
                      <option value="">— select —</option>
                      {field.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : field.field_type === "checkbox" ? (
                    <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 13 }}>
                      <input
                        autoFocus
                        type="checkbox"
                        checked={!!draft}
                        onChange={(e) => setDraft(e.target.checked)}
                        style={{ width: 15, height: 15, accentColor: accent }}
                      />
                      {draft ? "Yes" : "No"}
                    </label>
                  ) : field.field_type === "textarea" ? (
                    <textarea
                      autoFocus
                      value={draft as string}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={3}
                      style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: `1px solid ${accent}`, fontSize: 13, outline: "none", resize: "vertical", boxSizing: "border-box" }}
                    />
                  ) : (
                    <input
                      autoFocus
                      type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"}
                      value={draft as string}
                      onChange={(e) => setDraft(e.target.value)}
                      style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: `1px solid ${accent}`, fontSize: 13, outline: "none", boxSizing: "border-box" }}
                    />
                  )}
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button
                      onClick={() => saveField(field)}
                      disabled={saving}
                      style={{ padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: accent, color: "#fff", border: "none", cursor: "pointer" }}
                    >
                      {saving ? "…" : "Save"}
                    </button>
                    <button
                      onClick={cancelEdit}
                      style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, background: c.panel2, color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: data[field.field_key] ? c.ink : c.hint, minHeight: 20 }}>
                  {displayValue(field)}
                  <span style={{ float: "right", fontSize: 10, color: c.hint, opacity: 0.5 }}>✎</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
