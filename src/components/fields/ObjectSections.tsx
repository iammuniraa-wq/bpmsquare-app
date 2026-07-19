"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { applyRules } from "@/lib/fieldRegistry";
import { useEffectiveFieldConfig } from "./useEffectiveFieldConfig";
import FieldWidget from "./FieldWidget";
import { Pencil, CheckIcon } from "@/components/Icons";

export type FormHelpers = {
  setValue: (key: string, value: unknown) => void;
  setValues: (patch: Record<string, unknown>) => void;
};

type Props = {
  objectType: string;
  record: Record<string, unknown>;
  patchUrl: string;
  onSaved?: () => void;
  /** Escape hatch for bespoke per-section UI (e.g. Contact's "Copy from account" button). */
  sectionExtras?: Record<string, (helpers: FormHelpers) => React.ReactNode>;
};

/**
 * Every standard + custom field for a record, grouped into sections, shown
 * read-only -- with a single "Edit" toggle that turns the *same* fields, in
 * the *same* layout, into inputs in place. There is exactly one rendering of
 * the fields at any time (never a read-only block plus a separate edit form
 * elsewhere on the page).
 */
export default function ObjectSections({ objectType, record, patchUrl, onSaved, sectionExtras }: Props) {
  const router = useRouter();
  const { sections, rules, loading } = useEffectiveFieldConfig(objectType);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const customData = (record.custom_data as Record<string, unknown> | null) ?? {};
  const baseValues: Record<string, unknown> = { ...record, ...customData };
  const displayValues = editing ? values : baseValues;

  function startEdit() {
    setValues(baseValues);
    setError("");
    setSaved(false);
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setError("");
  }

  function fieldState(f: { field_key: string; hidden: boolean; required: boolean }) {
    return applyRules(rules, f.field_key, f.hidden, f.required, displayValues);
  }

  const helpers: FormHelpers = {
    setValue: (key, value) => setValues((old) => ({ ...old, [key]: value })),
    setValues: (patch) => setValues((old) => ({ ...old, ...patch })),
  };

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    for (const section of sections) {
      for (const f of section.fields) {
        if (f.editable === false) continue;
        const { hidden, required } = fieldState(f);
        if (hidden || !required) continue;
        const v = values[f.field_key];
        if (v === null || v === undefined || v === "") {
          setError(`${f.label} is required`);
          return;
        }
      }
    }

    const body: Record<string, unknown> = {};
    const customDataPatch: Record<string, unknown> = { ...customData };
    for (const section of sections) {
      for (const f of section.fields) {
        if (f.editable === false) continue;
        const v = values[f.field_key];
        if (f.kind === "custom") customDataPatch[f.field_key] = v;
        else body[f.field_key] = v;
      }
    }
    body.custom_data = customDataPatch;

    startTransition(async () => {
      const res = await fetch(patchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditing(false);
        setSaved(true);
        onSaved?.();
        router.refresh();
      } else {
        const j = await res.json();
        setError(j.error ?? "Failed to save");
      }
    });
  }

  if (loading || sections.length === 0) return null;

  const visibleSections = sections
    .map((section) => ({
      label: section.label,
      fields: section.fields.filter((f) => !fieldState(f).hidden),
    }))
    .filter((s) => s.fields.length > 0);

  if (visibleSections.length === 0) return null;

  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Details
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={startEdit}
            style={{
              fontSize: 12, fontWeight: 600, color: saved ? c.muted : c.accent,
              background: saved ? "none" : c.accentbg, border: `1px solid ${saved ? c.line : c.accent + "40"}`,
              borderRadius: 6, padding: "5px 12px", cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 5,
            }}
          >
            {saved ? <><CheckIcon size={12} color={c.muted} /> Saved</> : <><Pencil size={12} color={c.accent} /> Edit</>}
          </button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {error && <span style={{ fontSize: 11.5, color: "#dc2626" }}>{error}</span>}
            <button type="button" onClick={cancelEdit} disabled={pending} style={{
              padding: "5px 12px", borderRadius: 6, border: `1px solid ${c.line}`,
              background: "none", color: c.muted, fontWeight: 500, fontSize: 12, cursor: "pointer",
            }}>
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={pending} style={{
              padding: "5px 14px", borderRadius: 6, border: "none",
              background: c.accent, color: "#fff", fontWeight: 600, fontSize: 12, cursor: "pointer",
            }}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>

      {visibleSections.map((section, i) => {
        const extras = editing ? sectionExtras?.[section.label]?.(helpers) : undefined;
        return (
          <div key={section.label} style={{ marginTop: i === 0 ? 0 : 14, paddingTop: i === 0 ? 0 : 14, borderTop: i === 0 ? "none" : `1px solid ${c.line}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {section.label}
              </div>
              {extras}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px 20px" }}>
              {section.fields.map((f) => {
                const isEditable = editing && f.editable !== false;
                const { required } = fieldState(f);
                return (
                  <div key={f.field_key}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: isEditable ? 4 : 2 }}>
                      {f.label}{isEditable && required ? " *" : ""}
                    </div>
                    <div style={{ fontSize: 13, color: c.ink }}>
                      <FieldWidget
                        field={f}
                        mode={isEditable ? "edit" : "view"}
                        value={displayValues[f.field_key]}
                        onChange={isEditable ? (v) => helpers.setValue(f.field_key, v) : undefined}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}
