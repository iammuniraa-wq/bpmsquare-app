"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { c } from "@/lib/theme";
import {
  FIELD_REGISTRY, isPilotObjectType,
  type EffectiveField, type ConditionNode, type ConditionGroup, type FieldCondition,
  type ConditionOperator, type FieldRuleEffect, type FieldRule,
} from "@/lib/fieldRegistry";

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

type ConfigSection = { label: string; fields: EffectiveField[] };

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Yes / No" },
  { value: "textarea", label: "Long text" },
];

const OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
  { value: "in", label: "is one of (comma-separated)" },
  { value: "not_in", label: "is not one of (comma-separated)" },
];

const EFFECTS: { value: FieldRuleEffect; label: string }[] = [
  { value: "hide", label: "Hide" },
  { value: "show", label: "Show" },
  { value: "require", label: "Require" },
  { value: "optional", label: "Make optional" },
];

const LEGACY_SECTIONS: Record<string, string[]> = {
  case: ["General"],
  quote: ["General"],
  work_order: ["General"],
  asset: ["General"],
  supplier: ["General"],
  inventory: ["General"],
  purchase_order: ["General"],
  invoice: ["General"],
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
const sectionHead: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase",
  letterSpacing: 0.5, margin: "16px 0 8px",
};

/** Fires whenever custom fields, overrides, or rules for an object type change. */
export function dispatchCFChanged(objectType: string) {
  window.dispatchEvent(new CustomEvent("bpm:cf-changed", { detail: { objectType } }));
}

function newFieldCondition(): FieldCondition {
  return { type: "condition", field_key: "", operator: "equals", value: "" };
}
function newConditionGroup(): ConditionGroup {
  return { type: "group", logic: "AND", children: [newFieldCondition()] };
}

interface Props {
  objectType: string;
  objectLabel: string;
  isAdmin: boolean;
}

export default function AdaptObjectDrawer({ objectType, objectLabel, isAdmin }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"fields" | "rules">("fields");
  const supportsRules = isPilotObjectType(objectType);

  const [sections, setSections] = useState<ConfigSection[]>([]);
  const [rules, setRules] = useState<FieldRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadConfig = useCallback(() => {
    setLoading(true);
    setError("");
    fetch(`/api/settings/field-config?object=${objectType}`)
      .then((r) => r.json())
      .then((data: { sections?: ConfigSection[]; rules?: FieldRule[] }) => {
        setSections(data.sections ?? []);
        setRules(data.rules ?? []);
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, [objectType]);

  useEffect(() => { if (open) loadConfig(); }, [open, loadConfig]);
  useEffect(() => { setTab("fields"); }, [objectType]);

  if (!isAdmin) return null;

  const sectionNames = isPilotObjectType(objectType)
    ? FIELD_REGISTRY[objectType].sections
    : (LEGACY_SECTIONS[objectType] ?? ["General"]);
  const allFields = sections.flatMap((s) => s.fields);

  function refetchAndNotify() {
    loadConfig();
    dispatchCFChanged(objectType);
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
            position: "fixed", top: 0, right: 0, width: 380, height: "100vh",
            background: "#0e1a28", zIndex: 201, display: "flex", flexDirection: "column",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.45)",
          }}>
            <div style={{
              padding: "18px 20px 0", borderBottom: "1px solid #1e2d3d",
              display: "flex", alignItems: "flex-start", justifyContent: "space-between",
            }}>
              <div style={{ paddingBottom: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>Adapt {objectLabel}</div>
                <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>Fields, layout and rules</div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{ background: "none", border: "none", color: "#64748b", fontSize: 20, cursor: "pointer", lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            {supportsRules && (
              <div style={{ display: "flex", borderBottom: "1px solid #1e2d3d" }}>
                {(["fields", "rules"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    style={{
                      flex: 1, padding: "10px 0", background: "none", border: "none", cursor: "pointer",
                      fontSize: 12.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5,
                      color: tab === t ? c.accent : "#64748b",
                      borderBottom: tab === t ? `2px solid ${c.accent}` : "2px solid transparent",
                    }}
                  >
                    {t === "fields" ? "Fields" : "Rules"}
                  </button>
                ))}
              </div>
            )}

            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
              {loading ? (
                <div style={{ color: "#64748b", fontSize: 13, textAlign: "center", padding: "24px 0" }}>Loading…</div>
              ) : error ? (
                <div style={{ color: "#ef4444", fontSize: 13, textAlign: "center", padding: "24px 0" }}>{error}</div>
              ) : tab === "fields" ? (
                <FieldsTab
                  objectType={objectType}
                  sections={sections}
                  sectionNames={sectionNames}
                  onChanged={refetchAndNotify}
                />
              ) : (
                <RulesTab
                  objectType={objectType}
                  allFields={allFields}
                  rules={rules}
                  onChanged={refetchAndNotify}
                />
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── Fields tab ────────────────────────────────────────────────────────────────

function FieldsTab({ objectType, sections, sectionNames, onChanged }: {
  objectType: string;
  sections: ConfigSection[];
  sectionNames: string[];
  onChanged: () => void;
}) {
  const [saveErr, setSaveErr] = useState("");
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<FieldType>("text");
  const [newSection, setNewSection] = useState(sectionNames[0] ?? "General");
  const [newOptions, setNewOptions] = useState("");
  const [newRequired, setNewRequired] = useState(false);

  const dragKey = useRef<string | null>(null);
  const dragOver = useRef<string | null>(null);
  const [dragActive, setDragActive] = useState<string | null>(null);

  async function saveOverride(fieldKey: string, patch: { label?: string; is_hidden?: boolean; section?: string; position?: number }) {
    setSaveErr("");
    const res = await fetch("/api/settings/field-overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ object_type: objectType, field_key: fieldKey, ...patch }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setSaveErr(j.error ?? "Could not save change");
      return;
    }
    onChanged();
  }

  function startRename(f: EffectiveField) {
    setEditingLabel(f.field_key);
    setLabelDraft(f.label);
  }
  function commitRename(f: EffectiveField) {
    const label = labelDraft.trim();
    setEditingLabel(null);
    if (label && label !== f.label) saveOverride(f.field_key, { label });
  }

  function toggleHidden(f: EffectiveField) {
    if (f.locked) return;
    saveOverride(f.field_key, { is_hidden: !f.hidden });
  }

  function reassignSection(f: EffectiveField, section: string) {
    if (section === f.section) return;
    saveOverride(f.field_key, { section });
  }

  function handleDragEnd(section: ConfigSection) {
    if (!dragKey.current || !dragOver.current || dragKey.current === dragOver.current) {
      setDragActive(null); dragKey.current = null; dragOver.current = null; return;
    }
    const reordered = [...section.fields];
    const fromIdx = reordered.findIndex((f) => f.field_key === dragKey.current);
    const toIdx = reordered.findIndex((f) => f.field_key === dragOver.current);
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setDragActive(null); dragKey.current = null; dragOver.current = null;
    startSave(async () => {
      await Promise.all(reordered.map((f, i) => saveOverride(f.field_key, { position: i })));
    });
  }

  function removeCustomField(id: string) {
    setDeleting(id);
    fetch(`/api/settings/custom-fields/${id}`, { method: "DELETE" })
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setSaveErr(j.error ?? "Could not delete field");
        } else {
          onChanged();
        }
        setDeleting(null);
      })
      .catch(() => { setSaveErr("Network error — could not delete field"); setDeleting(null); });
  }

  function addField() {
    setSaveErr("");
    const label = newLabel.trim();
    if (!label) { setSaveErr("Label is required"); return; }
    if (newType === "select") {
      const opts = newOptions.split(",").map((s) => s.trim()).filter(Boolean);
      if (opts.length < 2) { setSaveErr("Dropdown needs at least 2 comma-separated options"); return; }
    }

    startSave(async () => {
      const options = newType === "select" ? newOptions.split(",").map((s) => s.trim()).filter(Boolean) : null;
      let res: Response, json: CFDef & { error?: string };
      try {
        res = await fetch("/api/settings/custom-fields", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            object_type: objectType, field_label: label, field_type: newType,
            field_section: newSection || null, options, is_required: newRequired,
          }),
        });
        json = await res.json();
      } catch {
        setSaveErr("Network error — could not save field");
        return;
      }
      if (!res.ok) { setSaveErr(json.error ?? `Error ${res.status}`); return; }
      setNewLabel(""); setNewType("text"); setNewOptions(""); setNewRequired(false);
      onChanged();
    });
  }

  return (
    <>
      {sections.length === 0 ? (
        <div style={{ textAlign: "center", padding: "20px 0 8px", color: "#64748b", fontSize: 13 }}>
          No fields yet.
        </div>
      ) : (
        sections.map((section) => (
          <div key={section.label} style={{ marginBottom: 18 }}>
            <div style={sectionHead}>{section.label}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {section.fields.map((f) => {
                const isDragging = dragActive === f.field_key;
                return (
                  <div
                    key={f.field_key}
                    draggable
                    onDragStart={() => { dragKey.current = f.field_key; setDragActive(f.field_key); }}
                    onDragEnter={() => { dragOver.current = f.field_key; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnd={() => handleDragEnd(section)}
                    style={{
                      background: isDragging ? "#132335" : "#0a1520", border: "1px solid #1e2d3d", borderRadius: 8,
                      padding: "9px 10px", opacity: isDragging ? 0.5 : f.hidden ? 0.55 : 1,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "#475569", fontSize: 12, cursor: "grab", flexShrink: 0 }}>⠿</span>
                      {editingLabel === f.field_key ? (
                        <input
                          autoFocus
                          style={{ ...inp, padding: "3px 6px", fontSize: 12.5 }}
                          value={labelDraft}
                          onChange={(e) => setLabelDraft(e.target.value)}
                          onBlur={() => commitRename(f)}
                          onKeyDown={(e) => { if (e.key === "Enter") commitRename(f); if (e.key === "Escape") setEditingLabel(null); }}
                        />
                      ) : (
                        <span
                          onClick={() => startRename(f)}
                          style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", cursor: "pointer", flex: 1, minWidth: 0 }}
                          title="Click to rename"
                        >
                          {f.label}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleHidden(f)}
                        disabled={f.locked}
                        title={f.locked ? "This field can't be hidden" : f.hidden ? "Hidden — click to show" : "Visible — click to hide"}
                        style={{
                          background: "none", border: "1px solid #2d3748", borderRadius: 5,
                          color: f.locked ? "#334155" : f.hidden ? "#64748b" : c.accent,
                          cursor: f.locked ? "not-allowed" : "pointer", fontSize: 11, padding: "3px 7px", flexShrink: 0,
                        }}
                      >
                        {f.hidden ? "Hidden" : "Visible"}
                      </button>
                      {f.kind === "custom" && f.id && (
                        <button
                          type="button"
                          onClick={() => removeCustomField(f.id!)}
                          disabled={deleting === f.id}
                          style={{ background: "none", border: "1px solid #2d3748", borderRadius: 5, color: "#ef4444", cursor: "pointer", fontSize: 12, padding: "3px 7px", flexShrink: 0, opacity: deleting === f.id ? 0.4 : 1 }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 10.5, color: "#475569" }}>{f.field_key}</span>
                      <select
                        value={f.section}
                        onChange={(e) => reassignSection(f, e.target.value)}
                        style={{ ...inp, padding: "2px 6px", fontSize: 11, width: "auto", marginLeft: "auto" }}
                      >
                        {sectionNames.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      <div style={{ borderTop: "1px solid #1e2d3d", paddingTop: 16, marginTop: 4 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
          Add custom field
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={lbl}>Field label</label>
          <input style={inp} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. Warranty Type" />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={lbl}>Type</label>
          <select style={{ ...inp, cursor: "pointer" }} value={newType} onChange={(e) => setNewType(e.target.value as FieldType)}>
            {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={lbl}>Section</label>
          <select style={{ ...inp, cursor: "pointer" }} value={newSection} onChange={(e) => setNewSection(e.target.value)}>
            {sectionNames.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {newType === "select" && (
          <div style={{ marginBottom: 10 }}>
            <label style={lbl}>Options (comma-separated)</label>
            <input style={inp} value={newOptions} onChange={(e) => setNewOptions(e.target.value)} placeholder="North, South, East, West" />
          </div>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} style={{ width: 14, height: 14, accentColor: c.accent }} />
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Required</span>
        </label>

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
    </>
  );
}

// ── Rules tab ─────────────────────────────────────────────────────────────────

function ruleSummary(rule: FieldRule, fieldLabel: (key: string) => string): string {
  const effectLabel = EFFECTS.find((e) => e.value === rule.effect)?.label ?? rule.effect;
  return `${effectLabel} ${fieldLabel(rule.target_field_key)} when ${describeNode(rule.conditions, fieldLabel)}`;
}

function describeNode(node: ConditionNode, fieldLabel: (key: string) => string): string {
  if (node.type === "condition") {
    const op = OPERATORS.find((o) => o.value === node.operator)?.label ?? node.operator;
    const val = Array.isArray(node.value) ? node.value.join(", ") : node.value;
    return node.operator === "is_empty" || node.operator === "is_not_empty"
      ? `${fieldLabel(node.field_key)} ${op}`
      : `${fieldLabel(node.field_key)} ${op} "${val ?? ""}"`;
  }
  return node.children.map((child) => describeNode(child, fieldLabel)).join(` ${node.logic} `);
}

function RulesTab({ objectType, allFields, rules, onChanged }: {
  objectType: string;
  allFields: EffectiveField[];
  rules: FieldRule[];
  onChanged: () => void;
}) {
  const [saveErr, setSaveErr] = useState("");
  const [building, setBuilding] = useState(false);
  const [saving, startSave] = useTransition();

  const [targetKey, setTargetKey] = useState(allFields[0]?.field_key ?? "");
  const [effect, setEffect] = useState<FieldRuleEffect>("hide");
  const [root, setRoot] = useState<ConditionGroup>(newConditionGroup());

  const fieldLabel = useCallback(
    (key: string) => allFields.find((f) => f.field_key === key)?.label ?? key,
    [allFields],
  );

  function toggleActive(rule: FieldRule) {
    fetch(`/api/settings/field-rules/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !rule.is_active }),
    }).then(() => onChanged());
  }

  function deleteRule(rule: FieldRule) {
    fetch(`/api/settings/field-rules/${rule.id}`, { method: "DELETE" }).then(() => onChanged());
  }

  function saveNewRule() {
    setSaveErr("");
    if (!targetKey) { setSaveErr("Choose a target field"); return; }
    startSave(async () => {
      const res = await fetch("/api/settings/field-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object_type: objectType, target_field_key: targetKey, effect, conditions: root }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setSaveErr(j.error ?? "Could not save rule");
        return;
      }
      setBuilding(false);
      setRoot(newConditionGroup());
      onChanged();
    });
  }

  return (
    <>
      {rules.length === 0 ? (
        <div style={{ textAlign: "center", padding: "20px 0 8px", color: "#64748b", fontSize: 13 }}>
          No rules yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
          {rules.map((rule) => (
            <div key={rule.id} style={{
              background: "#0a1520", border: "1px solid #1e2d3d", borderRadius: 8,
              padding: "9px 10px", opacity: rule.is_active ? 1 : 0.5,
            }}>
              <div style={{ fontSize: 12.5, color: "#e2e8f0", lineHeight: 1.5 }}>{ruleSummary(rule, fieldLabel)}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => toggleActive(rule)}
                  style={{ background: "none", border: "1px solid #2d3748", borderRadius: 5, color: rule.is_active ? c.accent : "#64748b", cursor: "pointer", fontSize: 11, padding: "3px 8px" }}
                >
                  {rule.is_active ? "Active" : "Inactive"}
                </button>
                <button
                  type="button"
                  onClick={() => deleteRule(rule)}
                  style={{ background: "none", border: "1px solid #2d3748", borderRadius: 5, color: "#ef4444", cursor: "pointer", fontSize: 12, padding: "3px 8px" }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!building ? (
        <button
          type="button"
          onClick={() => setBuilding(true)}
          style={{
            width: "100%", padding: "9px 0", borderRadius: 7, border: `1px dashed #2d3748`,
            background: "none", color: c.accent, fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}
        >
          + New rule
        </button>
      ) : (
        <div style={{ borderTop: "1px solid #1e2d3d", paddingTop: 16 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={lbl}>Target field</label>
            <select style={{ ...inp, cursor: "pointer" }} value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>
              {allFields.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={lbl}>Effect</label>
            <select style={{ ...inp, cursor: "pointer" }} value={effect} onChange={(e) => setEffect(e.target.value as FieldRuleEffect)}>
              {EFFECTS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>
          <label style={lbl}>When</label>
          <ConditionGroupEditor group={root} onChange={setRoot} fields={allFields} />

          {saveErr && (
            <div style={{ fontSize: 12, color: "#ef4444", margin: "10px 0", padding: "7px 10px", background: "#1a0a0a", borderRadius: 6, border: "1px solid #3d1a1a" }}>
              {saveErr}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              onClick={saveNewRule}
              disabled={saving}
              style={{ flex: 1, padding: "9px 0", borderRadius: 7, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: saving ? "wait" : "pointer" }}
            >
              {saving ? "Saving…" : "Save rule"}
            </button>
            <button
              type="button"
              onClick={() => { setBuilding(false); setRoot(newConditionGroup()); setSaveErr(""); }}
              style={{ padding: "9px 14px", borderRadius: 7, border: "1px solid #2d3748", background: "none", color: "#94a3b8", fontWeight: 500, fontSize: 13, cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ConditionGroupEditor({ group, onChange, fields, depth = 0 }: {
  group: ConditionGroup;
  onChange: (group: ConditionGroup) => void;
  fields: EffectiveField[];
  depth?: number;
}) {
  function updateChild(index: number, node: ConditionNode) {
    const children = [...group.children];
    children[index] = node;
    onChange({ ...group, children });
  }
  function removeChild(index: number) {
    const children = group.children.filter((_, i) => i !== index);
    onChange({ ...group, children: children.length > 0 ? children : [newFieldCondition()] });
  }

  return (
    <div style={{
      border: "1px solid #1e2d3d", borderRadius: 7, padding: 10,
      background: depth % 2 === 0 ? "#0a1520" : "#0e1a28",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <select
          value={group.logic}
          onChange={(e) => onChange({ ...group, logic: e.target.value as "AND" | "OR" })}
          style={{ ...inp, width: "auto", padding: "3px 8px", fontSize: 11.5, fontWeight: 700 }}
        >
          <option value="AND">ALL of (AND)</option>
          <option value="OR">ANY of (OR)</option>
        </select>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {group.children.map((child, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              {child.type === "condition" ? (
                <FieldConditionEditor condition={child} onChange={(c) => updateChild(i, c)} fields={fields} />
              ) : (
                <ConditionGroupEditor group={child} onChange={(g) => updateChild(i, g)} fields={fields} depth={depth + 1} />
              )}
            </div>
            <button
              type="button"
              onClick={() => removeChild(i)}
              style={{ background: "none", border: "1px solid #2d3748", borderRadius: 5, color: "#ef4444", cursor: "pointer", fontSize: 11, padding: "3px 7px", flexShrink: 0 }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => onChange({ ...group, children: [...group.children, newFieldCondition()] })}
          style={{ fontSize: 11, color: c.accent, background: "none", border: "1px dashed #2d3748", borderRadius: 5, padding: "4px 8px", cursor: "pointer" }}
        >
          + Add condition
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...group, children: [...group.children, newConditionGroup()] })}
          style={{ fontSize: 11, color: "#94a3b8", background: "none", border: "1px dashed #2d3748", borderRadius: 5, padding: "4px 8px", cursor: "pointer" }}
        >
          + Add group
        </button>
      </div>
    </div>
  );
}

function FieldConditionEditor({ condition, onChange, fields }: {
  condition: FieldCondition;
  onChange: (c: FieldCondition) => void;
  fields: EffectiveField[];
}) {
  const needsValue = condition.operator !== "is_empty" && condition.operator !== "is_not_empty";
  const field = fields.find((f) => f.field_key === condition.field_key);
  const valueOptions = field?.widget === "select" ? field.options : field?.widget === "enum" ? field.enumOptions?.map((o) => o.value) : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "#0e1a28", border: "1px solid #1e2d3d", borderRadius: 6, padding: 8 }}>
      <select
        value={condition.field_key}
        onChange={(e) => onChange({ ...condition, field_key: e.target.value })}
        style={{ ...inp, fontSize: 11.5 }}
      >
        <option value="">— field —</option>
        {fields.map((f) => <option key={f.field_key} value={f.field_key}>{f.label}</option>)}
      </select>
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as ConditionOperator })}
        style={{ ...inp, fontSize: 11.5 }}
      >
        {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {needsValue && (
        valueOptions ? (
          <select
            value={String(condition.value ?? "")}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            style={{ ...inp, fontSize: 11.5 }}
          >
            <option value="">— value —</option>
            {valueOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        ) : (
          <input
            value={String(condition.value ?? "")}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            style={{ ...inp, fontSize: 11.5 }}
            placeholder="Value"
          />
        )
      )}
    </div>
  );
}
