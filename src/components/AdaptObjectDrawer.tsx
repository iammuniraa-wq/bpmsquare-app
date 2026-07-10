"use client";

import { useState, useEffect, useTransition } from "react";
import { c } from "@/lib/theme";

type FieldType = "text" | "number" | "date" | "select" | "checkbox" | "textarea";

interface CFDef {
  id: string;
  field_key: string;
  field_label: string;
  field_type: FieldType;
  options: string[] | null;
  is_required: boolean;
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text",     label: "Text" },
  { value: "number",   label: "Number" },
  { value: "date",     label: "Date" },
  { value: "select",   label: "Dropdown" },
  { value: "checkbox", label: "Yes / No" },
  { value: "textarea", label: "Long text" },
];

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 13,
  border: "1px solid #1e2d3d", borderRadius: 6,
  background: "#0a1520", color: "#e2e8f0", outline: "none", fontFamily: "inherit",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 10.5, fontWeight: 700, color: "#64748b",
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
};

interface Props {
  objectType: string;
  objectLabel: string;
  isAdmin: boolean;
}

export default function AdaptObjectDrawer({ objectType, objectLabel, isAdmin }: Props) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<CFDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, startSave] = useTransition();
  const [deleting, setDeleting] = useState<string | null>(null);

  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<FieldType>("text");
  const [newOptions, setNewOptions] = useState("");
  const [addError, setAddError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/settings/custom-fields?object=${objectType}`)
      .then((r) => r.json())
      .then((data) => { setFields(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open, objectType]);

  if (!isAdmin) return null;

  function addField() {
    setAddError("");
    const label = newLabel.trim();
    if (!label) { setAddError("Label is required"); return; }

    if (newType === "select") {
      const opts = newOptions.split(",").map((s) => s.trim()).filter(Boolean);
      if (opts.length < 2) { setAddError("Dropdown needs at least 2 comma-separated options"); return; }
    }

    startSave(async () => {
      const options =
        newType === "select"
          ? newOptions.split(",").map((s) => s.trim()).filter(Boolean)
          : null;

      const res = await fetch("/api/settings/custom-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          object_type: objectType,
          field_label: label,
          field_type: newType,
          options,
          is_required: false,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setAddError(json.error ?? "Failed to add field"); return; }
      setFields((prev) => [...prev, json]);
      setNewLabel("");
      setNewType("text");
      setNewOptions("");
    });
  }

  function removeField(id: string) {
    setDeleting(id);
    fetch(`/api/settings/custom-fields/${id}`, { method: "DELETE" })
      .then(() => {
        setFields((prev) => prev.filter((f) => f.id !== id));
        setDeleting(null);
      })
      .catch(() => setDeleting(null));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          fontSize: 12, fontWeight: 600, color: c.muted,
          background: "none", border: `1px solid ${c.line}`,
          borderRadius: 6, padding: "5px 12px", cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 5,
        }}
      >
        ⚙ Adapt
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200 }}
          />

          <div style={{
            position: "fixed", top: 0, right: 0, width: 320, height: "100vh",
            background: "#0e1a28", zIndex: 201, display: "flex", flexDirection: "column",
            boxShadow: "-4px 0 20px rgba(0,0,0,0.4)",
          }}>
            {/* Header */}
            <div style={{
              padding: "18px 20px 14px", borderBottom: "1px solid #1e2d3d",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>Adapt {objectLabel}</div>
                <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>Add or remove custom fields</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
              {/* Existing fields */}
              {loading ? (
                <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: "24px 0" }}>Loading…</div>
              ) : fields.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "#64748b", fontSize: 13 }}>
                  No custom fields yet.<br />Add one below.
                </div>
              ) : (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
                    Custom fields ({fields.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {fields.map((f) => (
                      <div key={f.id} style={{
                        background: "#0a1520", border: "1px solid #1e2d3d", borderRadius: 8,
                        padding: "10px 12px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8,
                      }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{f.field_label}</div>
                          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                            {FIELD_TYPES.find((t) => t.value === f.field_type)?.label ?? f.field_type}
                            {f.field_type === "select" && f.options && ` · ${f.options.join(", ")}`}
                          </div>
                          <div style={{ fontFamily: "monospace", fontSize: 10.5, color: "#475569", marginTop: 3 }}>{f.field_key}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeField(f.id)}
                          disabled={deleting === f.id}
                          style={{
                            background: "none", border: "1px solid #2d3748", borderRadius: 5,
                            color: "#ef4444", cursor: "pointer", fontSize: 12, padding: "3px 7px", flexShrink: 0,
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add new */}
              <div style={{ borderTop: "1px solid #1e2d3d", paddingTop: 16 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
                  Add custom field
                </div>

                <div style={{ marginBottom: 10 }}>
                  <label style={lbl}>Label</label>
                  <input style={inp} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Territory" />
                </div>

                <div style={{ marginBottom: 10 }}>
                  <label style={lbl}>Type</label>
                  <select style={{ ...inp, cursor: "pointer" }} value={newType} onChange={(e) => setNewType(e.target.value as FieldType)}>
                    {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>

                {newType === "select" && (
                  <div style={{ marginBottom: 10 }}>
                    <label style={lbl}>Options (comma-separated)</label>
                    <input style={inp} value={newOptions} onChange={(e) => setNewOptions(e.target.value)} placeholder="North, South, East, West" />
                  </div>
                )}

                {addError && <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 8 }}>{addError}</div>}

                <button
                  type="button"
                  onClick={addField}
                  disabled={saving}
                  style={{
                    width: "100%", padding: "9px 0", borderRadius: 7, border: "none",
                    background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: saving ? "wait" : "pointer",
                  }}
                >
                  {saving ? "Saving…" : "+ Add field"}
                </button>
              </div>

              <div style={{ marginTop: 16, padding: "10px 12px", background: "#0a1520", borderRadius: 7, border: "1px solid #1e2d3d" }}>
                <div style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.5 }}>
                  Fields added here appear automatically on the create and edit screens, and in the Data Workbench CSV export.
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
