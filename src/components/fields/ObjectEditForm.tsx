"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { applyRules, type EffectiveField } from "@/lib/fieldRegistry";
import { useEffectiveFieldConfig } from "./useEffectiveFieldConfig";
import FieldWidget from "./FieldWidget";

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
};
const fw: React.CSSProperties = { marginBottom: 12 };
const secHead: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase",
  letterSpacing: 0.5, margin: "16px 0 8px", paddingTop: 12, borderTop: `1px solid ${c.line}`,
};

export type FormHelpers = {
  setValue: (key: string, value: unknown) => void;
  setValues: (patch: Record<string, unknown>) => void;
};

type Props = {
  objectType: string;
  record: Record<string, unknown>;
  patchUrl: string;
  onSaved?: () => void;
  onCancel?: () => void;
  /** Escape hatch for bespoke per-section UI (e.g. Contact's "Copy from account" button). */
  sectionExtras?: Record<string, (helpers: FormHelpers) => React.ReactNode>;
};

export default function ObjectEditForm({ objectType, record, patchUrl, onSaved, onCancel, sectionExtras }: Props) {
  const router = useRouter();
  const { sections, rules, loading } = useEffectiveFieldConfig(objectType);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (seeded || sections.length === 0) return;
    const customData = (record.custom_data as Record<string, unknown> | null) ?? {};
    const initial: Record<string, unknown> = {};
    sections.forEach((s) => s.fields.forEach((f) => {
      initial[f.field_key] = f.kind === "custom" ? (customData[f.field_key] ?? null) : (record[f.field_key] ?? null);
    }));
    setValues(initial);
    setSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, seeded]);

  function fieldState(f: EffectiveField) {
    return applyRules(rules, f.field_key, f.hidden, f.required, values);
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
    const customDataPatch: Record<string, unknown> = { ...((record.custom_data as Record<string, unknown> | null) ?? {}) };
    for (const section of sections) {
      for (const f of section.fields) {
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
      if (res.ok) { onSaved?.(); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save"); }
    });
  }

  if (loading || sections.length === 0) return null;

  return (
    <form onSubmit={handleSave}>
      {sections.map((section, i) => {
        const visibleFields = section.fields.filter((f) => {
          if (f.editable === false) return false;
          return !fieldState(f).hidden;
        });
        const extras = sectionExtras?.[section.label]?.(helpers);
        if (visibleFields.length === 0 && !extras) return null;
        return (
          <div key={section.label} style={i === 0 ? undefined : secHead}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              {i > 0 && <span>{section.label}</span>}
              {extras}
            </div>
            {visibleFields.map((f) => {
              const { required } = fieldState(f);
              return (
                <div key={f.field_key} style={fw}>
                  <label style={lbl}>{f.label}{required ? " *" : ""}</label>
                  <FieldWidget
                    field={f}
                    mode="edit"
                    value={values[f.field_key]}
                    onChange={(v) => setValues((old) => ({ ...old, [f.field_key]: v }))}
                  />
                </div>
              );
            })}
          </div>
        );
      })}

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "#dc2626", marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={pending} style={{
          padding: "7px 16px", borderRadius: 7, border: "none",
          background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
        }}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={{
            padding: "7px 12px", borderRadius: 7, border: `1px solid ${c.line}`,
            background: "none", color: c.muted, fontWeight: 500, fontSize: 13, cursor: "pointer",
          }}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
