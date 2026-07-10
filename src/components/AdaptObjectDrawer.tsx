"use client";

import { useState, useEffect, useTransition } from "react";
import { c } from "@/lib/theme";

type FieldType = "text" | "number" | "date" | "select" | "checkbox" | "textarea";

interface CFDef {
  id: string;
  field_key: string;
  field_label: string;
  field_type: FieldType;
  field_section: string | null;
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

const SECTIONS: Record<string, string[]> = {
  account: ["Identity", "Address", "Communication", "Business", "Notes"],
  contact: ["Identity", "Phone numbers", "Email & web", "Address", "Notes"],
  case:       ["General"],
  quote:      ["General"],
  work_order: ["General"],
  asset:      ["General"],
};

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 13,
  border: "1px solid #1e2d3d", borderRadius: 6,
  background: "#0a1520", color: "#e2e8f0", outline: "none", fontFamily: "inherit",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 10.5, fontWeight: 700, color: "#64748b",
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
};

/** Fires whenever custom fields for an object type change (add or delete). */
export function dispatchCFChanged(objectType: string) {
  window.dispatchEvent(new CustomEvent("bpm:cf-changed", { detail: { objectType } }));
}

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
  const [saveErr, setSaveErr] = useState("");

  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<FieldType>("text");
  const [newSection, setNewSection] = useState("");
  const [newOptions, setNewOptions] = useState("");

  const sectionOptions = SECTIONS[objectType] ?? ["General"];

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSaveErr("");
    fetch(`/api/settings/custom-fields?object=${objectType}`)
      .then((r) => r.json())
      .then((data) => { setFields(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open, objectType]);

  // Default section when objectType changes
  useEffect(() => {
    setNewSection(sectionOptions[0] ?? "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectType]);

  if (!isAdmin) return null;

  function addField() {
    setSaveErr("");
    const label = newLabel.trim();
    if (!label) { setSaveErr("Label is required"); return; }
    if (newType === "select") {
      const opts = newOptions.split(",").map((s) => s.trim()).filter(Boolean);
      if (opts.length < 2) { setSaveErr("Dropdown needs at least 2 comma-separated options"); return; }
    }

    startSave(async () => {
      const options =
        newType === "select"
          ? newOptions.split(",").map((s) => s.trim()).filter(Boolean)
          : null;

      let res: Response, json: CFDef & { error?: string };
      try {
        res = await fetch("/api/settings/custom-fields", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            object_type: objectType,
            field_label: label,
            field_type: newType,
            field_section: newSection || null,
            options,
            is_required: false,
          }),
        });
        json = await res.json();
      } catch {
        setSaveErr("Network error — could not save field");
        return;
      }

      if (!res.ok) { setSaveErr(json.error ?? `Error ${res.status}`); return; }
      setFields((prev) => [...prev, json]);
      setNewLabel("");
      setNewType("text");
      setNewOptions("");
      setNewSection(sectionOptions[0] ?? "");
      dispatchCFChanged(objectType);
    });
  }

  function removeField(id: string) {
    setDeleting(id);
    fetch(`/api/settings/custom-fields/${id}`, { method: "DELETE" })
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setSaveErr(j.error ?? "Could not delete field");
        } else {
          setFields((prev) => prev.filter((f) => f.id !== id));
          dispatchCFChanged(objectType);
        }
        setDeleting(null);
      })
      .catch(() => { setSaveErr("Network error — could not delete field"); setDeleting(null); });
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
            position: "fixed", top: 0, right: 0, width: 340, height: "100vh",
            background: "#0e1a28", zIndex: 201, display: "flex", flexDirection: "column",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.45)",
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
                style={{ background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer", lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
              {/* Existing fields */}
              {loading ? (
                <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: "24px 0" }}>Loading…</div>
              ) : fields.length === 0 ? (
                <div style={{ textAlign: "center", padding: "20px 0 8px", color: "#64748b", fontSize: 13 }}>
                  No custom fields yet.<br />Add one below.
                </div>
              ) : (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
                    Current custom fields ({fields.length})
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
                            {f.field_section && <span style={{ marginLeft: 6, color: "#475569" }}>· {f.field_section}</span>}
                            {f.field_type === "select" && f.options && <span style={{ marginLeft: 6 }}>· {f.options.join(", ")}</span>}
                          </div>
                          <div style={{ fontFamily: "monospace", fontSize: 10.5, color: "#475569", marginTop: 2 }}>{f.field_key}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeField(f.id)}
                          disabled={deleting === f.id}
                          style={{
                            background: "none", border: "1px solid #2d3748", borderRadius: 5,
                            color: "#ef4444", cursor: "pointer", fontSize: 13, padding: "3px 8px", flexShrink: 0,
                            opacity: deleting === f.id ? 0.4 : 1,
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
                  <label style={lbl}>Field label</label>
                  <input
                    style={inp}
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addField(); } }}
                    placeholder="e.g. Territory"
                  />
                </div>

                <div style={{ marginBottom: 10 }}>
                  <label style={lbl}>Type</label>
                  <select style={{ ...inp, cursor: "pointer" }} value={newType} onChange={(e) => setNewType(e.target.value as FieldType)}>
                    {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <label style={lbl}>Section (where it appears in the form)</label>
                  <select style={{ ...inp, cursor: "pointer" }} value={newSection} onChange={(e) => setNewSection(e.target.value)}>
                    {sectionOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                {newType === "select" && (
                  <div style={{ marginBottom: 10 }}>
                    <label style={lbl}>Options (comma-separated)</label>
                    <input
                      style={inp}
                      value={newOptions}
                      onChange={(e) => setNewOptions(e.target.value)}
                      placeholder="North, South, East, West"
                    />
                  </div>
                )}

                {saveErr && (
                  <div style={{ fontSize: 12, color: "#ef4444", marginBottom: 8, padding: "7px 10px", background: "#1a0a0a", borderRadius: 6, border: "1px solid #3d1a1a" }}>
                    {saveErr}
                  </div>
                )}

                <button
                  type="button"
                  onClick={addField}
                  disabled={saving}
                  style={{
                    width: "100%", padding: "9px 0", borderRadius: 7, border: "none",
                    background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13,
                    cursor: saving ? "wait" : "pointer", opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? "Saving…" : "+ Add field"}
                </button>
              </div>

              <div style={{ marginTop: 14, padding: "10px 12px", background: "#0a1520", borderRadius: 7, border: "1px solid #1e2d3d" }}>
                <div style={{ fontSize: 11.5, color: "#64748b", lineHeight: 1.6 }}>
                  Fields appear in the chosen section on create and edit screens, and in the Data Workbench export.
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
