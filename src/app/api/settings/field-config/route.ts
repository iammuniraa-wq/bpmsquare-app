import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { DEFAULT_FIELD_RULES, FIELD_REGISTRY, isPilotObjectType, type EffectiveField, type FieldRule, type PilotObjectType } from "@/lib/fieldRegistry";

type CustomFieldRow = {
  id: string;
  field_key: string;
  field_label: string;
  field_type: "text" | "number" | "date" | "select" | "checkbox" | "textarea";
  field_section: string | null;
  options: string[] | null;
  is_required: boolean;
  position: number;
};

type OverrideRow = {
  field_key: string;
  label: string | null;
  is_hidden: boolean | null;
  section: string | null;
  position: number | null;
};

const FALLBACK_SECTION = "Other";

export async function GET(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { searchParams } = new URL(request.url);
  const objectType = searchParams.get("object");
  if (!objectType) return NextResponse.json({ error: "object is required" }, { status: 400 });

  const [{ data: customFieldRows }, { data: overrideRows }, { data: ruleRows }] = await Promise.all([
    supabase.from("custom_fields").select("*").eq("tenant_id", tenantId).eq("object_type", objectType).order("position"),
    supabase.from("field_overrides").select("*").eq("tenant_id", tenantId).eq("object_type", objectType),
    supabase.from("field_rules").select("*").eq("tenant_id", tenantId).eq("object_type", objectType).order("position"),
  ]);

  const overridesByKey = new Map<string, OverrideRow>(
    ((overrideRows ?? []) as OverrideRow[]).map((o) => [o.field_key, o]),
  );

  const fields: EffectiveField[] = [];
  const sectionOrder: string[] = [];

  if (isPilotObjectType(objectType)) {
    sectionOrder.push(...FIELD_REGISTRY[objectType].sections);

    FIELD_REGISTRY[objectType].fields.forEach((def, index) => {
      const override = overridesByKey.get(def.key);
      fields.push({
        field_key: def.key,
        label: override?.label ?? def.defaultLabel,
        widget: def.widget,
        section: override?.section ?? def.defaultSection,
        position: override?.position ?? index,
        hidden: override?.is_hidden ?? def.hiddenByDefault ?? false,
        required: false,
        locked: def.locked ?? false,
        editable: def.editable ?? true,
        kind: "standard",
        selectSource: def.selectSource,
        enumOptions: def.enumOptions,
        placeholder: def.placeholder,
      });
    });
  }

  ((customFieldRows ?? []) as CustomFieldRow[]).forEach((row) => {
    const override = overridesByKey.get(row.field_key);
    const section = override?.section ?? row.field_section ?? FALLBACK_SECTION;
    if (!sectionOrder.includes(section)) sectionOrder.push(section);
    fields.push({
      field_key: row.field_key,
      label: override?.label ?? row.field_label,
      widget: row.field_type,
      section,
      position: override?.position ?? row.position,
      hidden: override?.is_hidden ?? false,
      required: row.is_required,
      locked: false,
      editable: true,
      kind: "custom",
      id: row.id,
      options: row.options ?? undefined,
    });
  });

  if (!sectionOrder.includes(FALLBACK_SECTION) && fields.some((f) => f.section === FALLBACK_SECTION)) {
    sectionOrder.push(FALLBACK_SECTION);
  }

  fields.sort((a, b) => {
    const sa = sectionOrder.indexOf(a.section);
    const sb = sectionOrder.indexOf(b.section);
    if (sa !== sb) return sa - sb;
    return a.position - b.position;
  });

  const sections = sectionOrder
    .map((label) => ({ label, fields: fields.filter((f) => f.section === label) }))
    .filter((s) => s.fields.length > 0);

  // Code-level defaults (e.g. "hide nameplate fields unless kind = motor") are
  // universal across every tenant — merged in ahead of tenant-authored rules,
  // which can still add their own on top.
  const defaultRules = isPilotObjectType(objectType) ? DEFAULT_FIELD_RULES[objectType as PilotObjectType] ?? [] : [];
  const rules = [...defaultRules, ...((ruleRows ?? []) as FieldRule[])];

  return NextResponse.json({ sections, rules });
}
