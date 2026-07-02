"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { useSettings, ACCENT_PRESETS } from "@/lib/settings";

type ObjectType = "account" | "contact" | "case" | "quote" | "work_order" | "asset";
type FieldType = "text" | "number" | "date" | "select" | "checkbox" | "textarea";

interface CustomField {
  id: string;
  object_type: ObjectType;
  field_key: string;
  field_label: string;
  field_type: FieldType;
  options: string[] | null;
  is_required: boolean;
  position: number;
}

const OBJECTS: { key: ObjectType; label: string; icon: string }[] = [
  { key: "account",    label: "Account",    icon: "▣" },
  { key: "contact",    label: "Contact",    icon: "◉" },
  { key: "case",       label: "Case",       icon: "☎" },
  { key: "quote",      label: "Quote",      icon: "₹" },
  { key: "work_order", label: "Work Order", icon: "▤" },
  { key: "asset",      label: "Asset",      icon: "⚙" },
];

const FIELD_TYPES: { key: FieldType; label: string }[] = [
  { key: "text",     label: "Text" },
  { key: "number",   label: "Number" },
  { key: "date",     label: "Date" },
  { key: "select",   label: "Dropdown (select)" },
  { key: "checkbox", label: "Checkbox (yes/no)" },
  { key: "textarea", label: "Long text" },
];

const FIELD_TYPE_ICON: Record<FieldType, string> = {
  text: "T",
  number: "#",
  date: "📅",
  select: "▾",
  checkbox: "☑",
  textarea: "¶",
};

function toKey(label: string): string {
  const raw = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `cf_${raw}`;
}

// ── Empty add-form state ──────────────────────────────────────────────────────

function emptyForm() {
  return { field_label: "", field_type: "text" as FieldType, is_required: false, options_raw: "" };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CustomFieldsPage() {
  const router = useRouter();
  const { settings } = useSettings();
  const accent = ACCENT_PRESETS[settings.accentPreset].color;

  const [activeObj, setActiveObj] = useState<ObjectType>("account");
  const [fields, setFields]       = useState<CustomField[]>([]);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const [form, setForm]           = useState(emptyForm());
  const [showForm, setShowForm]   = useState(false);

  const [editId, setEditId]       = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const [deleting, setDeleting]   = useState<string | null>(null);

  const fetchFields = useCallback(async (obj: ObjectType) => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/settings/custom-fields?object=${obj}`);
    const json = await res.json();
    setLoading(false);
    if (!res.ok) { setError(json.error); return; }
    setFields(json);
  }, []);

  useEffect(() => { fetchFields(activeObj); }, [activeObj, fetchFields]);

  const switchObject = (obj: ObjectType) => {
    setActiveObj(obj);
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm());
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.field_label.trim()) return;
    setSaving(true);
    setError(null);

    const options =
      form.field_type === "select"
        ? form.options_raw.split(",").map((s) => s.trim()).filter(Boolean)
        : null;

    const res = await fetch("/api/settings/custom-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        object_type: activeObj,
        field_label: form.field_label.trim(),
        field_type:  form.field_type,
        is_required: form.is_required,
        options,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok) { setError(json.error); return; }
    setFields((prev) => [...prev, json]);
    setForm(emptyForm());
    setShowForm(false);
  };

  const startEdit = (f: CustomField) => {
    setEditId(f.id);
    setEditLabel(f.field_label);
  };

  const saveEdit = async (f: CustomField) => {
    if (!editLabel.trim() || editLabel === f.field_label) { setEditId(null); return; }
    const res = await fetch(`/api/settings/custom-fields/${f.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field_label: editLabel.trim() }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error); return; }
    setFields((prev) => prev.map((x) => x.id === f.id ? json : x));
    setEditId(null);
  };

  const deleteField = async (id: string) => {
    if (!window.confirm("Delete this custom field? Existing data in this field will be lost.")) return;
    setDeleting(id);
    const res = await fetch(`/api/settings/custom-fields/${id}`, { method: "DELETE" });
    setDeleting(null);
    if (!res.ok) { const j = await res.json(); setError(j.error); return; }
    setFields((prev) => prev.filter((f) => f.id !== id));
  };

  const toggleRequired = async (f: CustomField) => {
    const res = await fetch(`/api/settings/custom-fields/${f.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_required: !f.is_required }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error); return; }
    setFields((prev) => prev.map((x) => x.id === f.id ? json : x));
  };

  const generatedKey = toKey(form.field_label);

  return (
    <div style={{ maxWidth: 720 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 19, margin: 0, fontWeight: 600, paddingLeft: 12, borderLeft: `3px solid ${accent}` }}>
            Custom Fields
          </h1>
          <p style={{ margin: "4px 0 0 12px", fontSize: 12, color: c.muted }}>
            Add fields to any object — they are automatically included in the API and MCP
          </p>
        </div>
        <button
          onClick={() => router.push(ROUTES.settings)}
          style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: accent, color: "#fff", border: "none", cursor: "pointer" }}
        >
          ← Settings
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 14, padding: "10px 14px", background: "#fcebeb", color: "#791f1f", borderRadius: 8, fontSize: 13, border: "1px solid #f5c5c5" }}>
          {error}
        </div>
      )}

      {/* Object tab bar */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {OBJECTS.map((obj) => {
          const active = activeObj === obj.key;
          return (
            <button
              key={obj.key}
              onClick={() => switchObject(obj.key)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: active ? 600 : 400,
                border: active ? `2px solid ${accent}` : `1px solid ${c.line}`,
                background: active ? `${accent}18` : "#fff",
                color: active ? accent : c.muted,
                cursor: "pointer", transition: "all 0.12s",
              }}
            >
              <span style={{ fontSize: 14 }}>{obj.icon}</span>
              {obj.label}
            </button>
          );
        })}
      </div>

      {/* Field list */}
      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: c.ink }}>
              {OBJECTS.find((o) => o.key === activeObj)?.label} fields
            </div>
            <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>
              {fields.length === 0 ? "No custom fields yet" : `${fields.length} field${fields.length !== 1 ? "s" : ""}`}
            </div>
          </div>
          <button
            onClick={() => { setShowForm((v) => !v); setEditId(null); setForm(emptyForm()); }}
            style={{ padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: showForm ? c.panel2 : accent, color: showForm ? c.muted : "#fff", border: showForm ? `1px solid ${c.line}` : "none", cursor: "pointer" }}
          >
            {showForm ? "Cancel" : "+ Add field"}
          </button>
        </div>

        {/* Add form */}
        {showForm && (
          <form onSubmit={handleAdd} style={{ background: c.panel2, borderRadius: 10, padding: 14, marginBottom: 14, border: `1px solid ${c.line}` }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  Field label *
                </label>
                <input
                  value={form.field_label}
                  onChange={(e) => setForm((f) => ({ ...f, field_label: e.target.value }))}
                  placeholder="e.g. Machine serial number"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${c.line}`, fontSize: 13, color: c.ink, boxSizing: "border-box", outline: "none" }}
                />
                {form.field_label && (
                  <div style={{ fontSize: 10.5, color: c.hint, marginTop: 3 }}>
                    API key: <code style={{ fontFamily: "monospace" }}>{generatedKey}</code>
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  Field type *
                </label>
                <select
                  value={form.field_type}
                  onChange={(e) => setForm((f) => ({ ...f, field_type: e.target.value as FieldType }))}
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${c.line}`, fontSize: 13, color: c.ink, background: "#fff", boxSizing: "border-box" }}
                >
                  {FIELD_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
            </div>

            {form.field_type === "select" && (
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: c.muted, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  Options (comma-separated) *
                </label>
                <input
                  value={form.options_raw}
                  onChange={(e) => setForm((f) => ({ ...f, options_raw: e.target.value }))}
                  placeholder="e.g. Low, Medium, High"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${c.line}`, fontSize: 13, color: c.ink, boxSizing: "border-box", outline: "none" }}
                />
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: c.ink }}>
                <input
                  type="checkbox"
                  checked={form.is_required}
                  onChange={(e) => setForm((f) => ({ ...f, is_required: e.target.checked }))}
                  style={{ width: 15, height: 15, accentColor: accent }}
                />
                Required field
              </label>
              <button
                type="submit"
                disabled={saving || !form.field_label.trim()}
                style={{ padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: saving || !form.field_label.trim() ? c.line : accent, color: saving || !form.field_label.trim() ? c.hint : "#fff", border: "none", cursor: saving || !form.field_label.trim() ? "default" : "pointer" }}
              >
                {saving ? "Saving…" : "Add field"}
              </button>
            </div>
          </form>
        )}

        {/* Field rows */}
        {loading ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: c.muted, fontSize: 13 }}>Loading…</div>
        ) : fields.length === 0 ? (
          <div style={{ textAlign: "center", padding: "28px 0", color: c.hint, fontSize: 13 }}>
            No custom fields for {OBJECTS.find((o) => o.key === activeObj)?.label} yet.
            <br />
            <span style={{ fontSize: 12 }}>Click "Add field" to create the first one.</span>
          </div>
        ) : (
          <div>
            {fields.map((field, idx) => (
              <div
                key={field.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "11px 0",
                  borderTop: idx > 0 ? `1px solid ${c.line}` : undefined,
                }}
              >
                {/* Type badge */}
                <div style={{ width: 30, height: 30, borderRadius: 7, background: `${accent}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 13, fontWeight: 700, color: accent }}>
                  {FIELD_TYPE_ICON[field.field_type]}
                </div>

                {/* Label + meta */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editId === field.id ? (
                    <input
                      autoFocus
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onBlur={() => saveEdit(field)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(field); if (e.key === "Escape") setEditId(null); }}
                      style={{ padding: "4px 8px", borderRadius: 6, border: `1px solid ${accent}`, fontSize: 13, color: c.ink, width: "100%", outline: "none" }}
                    />
                  ) : (
                    <div
                      onClick={() => startEdit(field)}
                      style={{ fontSize: 13, fontWeight: 500, color: c.ink, cursor: "text" }}
                      title="Click to rename"
                    >
                      {field.field_label}
                    </div>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                    <code style={{ fontSize: 10.5, color: c.hint, fontFamily: "monospace" }}>{field.field_key}</code>
                    <span style={{ fontSize: 10.5, color: c.hint }}>·</span>
                    <span style={{ fontSize: 10.5, color: c.hint }}>{FIELD_TYPES.find((t) => t.key === field.field_type)?.label}</span>
                    {field.options && (
                      <>
                        <span style={{ fontSize: 10.5, color: c.hint }}>·</span>
                        <span style={{ fontSize: 10.5, color: c.hint }}>{field.options.join(", ")}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Required toggle */}
                <button
                  onClick={() => toggleRequired(field)}
                  title={field.is_required ? "Required — click to make optional" : "Optional — click to make required"}
                  style={{ padding: "3px 8px", borderRadius: 5, fontSize: 10.5, fontWeight: 600, border: "1px solid", cursor: "pointer", flexShrink: 0, background: field.is_required ? "#faeeda" : c.panel2, color: field.is_required ? "#633806" : c.hint, borderColor: field.is_required ? "#f0d09e" : c.line, transition: "all 0.12s" }}
                >
                  {field.is_required ? "Required" : "Optional"}
                </button>

                {/* Delete */}
                <button
                  onClick={() => deleteField(field.id)}
                  disabled={deleting === field.id}
                  title="Delete field"
                  style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${c.line}`, background: "#fff", cursor: "pointer", fontSize: 14, color: "#e05252", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: deleting === field.id ? 0.4 : 1 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info callout */}
      <div style={{ ...cardStyle, background: `${accent}0c`, border: `1px solid ${accent}30` }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: accent, marginBottom: 6 }}>How custom fields work</div>
        <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: 12.5, color: c.muted, lineHeight: 1.8 }}>
          <li>Fields use a <code style={{ fontFamily: "monospace", background: c.panel2, padding: "1px 5px", borderRadius: 4 }}>cf_</code> prefix to mark them as tenant-specific</li>
          <li>Values are stored in a <code style={{ fontFamily: "monospace", background: c.panel2, padding: "1px 5px", borderRadius: 4 }}>custom_data</code> column on each object record</li>
          <li>Custom fields appear automatically in <strong>/api/v1</strong> responses under the <code style={{ fontFamily: "monospace", background: c.panel2, padding: "1px 5px", borderRadius: 4 }}>custom_data</code> key</li>
          <li>MCP tools include field definitions so AI assistants know what data exists</li>
          <li>Renaming a label is safe — the API key (<code style={{ fontFamily: "monospace" }}>cf_*</code>) never changes after creation</li>
        </ul>
      </div>
    </div>
  );
}
