"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";

export type SectionCustomFieldDef = {
  id: string; field_key: string; field_label: string;
  field_type: "text" | "number" | "date" | "select" | "checkbox" | "textarea";
  field_section: string | null;
  options: string[] | null; is_required: boolean;
};

/**
 * The tenant's custom-field definitions for one object (re-fetched when the
 * Adapt drawer changes them), plus the value map, for create forms that lay
 * custom fields out inside their own sections.
 */
export function useSectionCustomFields(object: string) {
  const [defs, setDefs] = useState<SectionCustomFieldDef[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    const load = () =>
      fetch(`/api/settings/custom-fields?object=${object}`)
        .then((r) => r.json())
        .then((data) => { if (Array.isArray(data)) setDefs(data); })
        .catch(() => {});
    load();
    window.addEventListener("bpm:cf-changed", load);
    return () => window.removeEventListener("bpm:cf-changed", load);
  }, [object]);

  return { defs, values, setValue: (key: string, v: unknown) => setValues((old) => ({ ...old, [key]: v })) };
}

/** The inputs for the custom fields filed under `section`; renders nothing when there are none. */
export default function SectionCustomFields({
  defs, values, setValue, section,
}: {
  defs: SectionCustomFieldDef[];
  values: Record<string, unknown>;
  setValue: (key: string, v: unknown) => void;
  section: string;
}) {
  const fields = defs.filter((f) => f.field_section === section);
  if (fields.length === 0) return null;
  return (
    <>
      {fields.map((f) => (
        <Field key={f.id} label={f.field_label} required={f.is_required}>
          {f.field_type === "select" && f.options ? (
            <Select value={(values[f.field_key] as string) ?? ""} onChange={(e) => setValue(f.field_key, e.target.value)}>
              <option value="">— select —</option>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          ) : f.field_type === "checkbox" ? (
            <span style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: c.ink, marginTop: 4, textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
              <input type="checkbox" checked={!!values[f.field_key]} onChange={(e) => setValue(f.field_key, e.target.checked)} style={{ width: 15, height: 15 }} />
              {values[f.field_key] ? "Yes" : "No"}
            </span>
          ) : f.field_type === "textarea" ? (
            <Textarea value={(values[f.field_key] as string) ?? ""} onChange={(e) => setValue(f.field_key, e.target.value)} />
          ) : (
            <Input type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"} value={(values[f.field_key] as string) ?? ""} onChange={(e) => setValue(f.field_key, e.target.value)} />
          )}
        </Field>
      ))}
    </>
  );
}
