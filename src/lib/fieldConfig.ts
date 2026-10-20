import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_FIELD_RULES, FIELD_REGISTRY, isPilotObjectType,
  type EffectiveField, type FieldRule, type PilotObjectType,
} from "@/lib/fieldRegistry";
import { normalizeCategoryTree, type ProductCategoryNode } from "@/lib/picklists";
import { selectableItemTypes } from "@/lib/products/itemTypes";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { isSchemaPending } from "@/lib/marketing/pending";

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

export type FieldConfigSection = { label: string; fields: EffectiveField[] };
export type FieldConfigResult = { sections: FieldConfigSection[]; rules: FieldRule[] };

/**
 * Single source of truth for "what fields does this object have, in this
 * tenant, right now" — standard registry fields + tenant custom fields,
 * with tenant field_overrides (rename/hide/reorder) and field_rules
 * (code-level defaults + tenant-authored) merged in. Used by both the
 * Adapt UI's /api/settings/field-config route and Data Workbench
 * (templates, import, export) — one merge implementation, not two.
 */
export async function getEffectiveFieldConfig(
  supabase: SupabaseClient,
  tenantId: string,
  objectType: string
): Promise<FieldConfigResult> {
  const [{ data: customFieldRows }, { data: overrideRows }, { data: ruleRows }] = await Promise.all([
    supabase.from("custom_fields").select("*").eq("tenant_id", tenantId).eq("object_type", objectType).order("position"),
    supabase.from("field_overrides").select("*").eq("tenant_id", tenantId).eq("object_type", objectType),
    supabase.from("field_rules").select("*").eq("tenant_id", tenantId).eq("object_type", objectType).order("position"),
  ]);

  // Item type options are the tenant's own list, so product fields need the config.
  const itemTypeOptions = objectType === "product"
    ? await supabase.from("tenants").select("config").eq("id", tenantId).single().then(({ data }) =>
        selectableItemTypes((data?.config ?? {}) as TenantConfig).map((x) => ({ value: x.key, label: x.label })))
    : null;

  // A field that belongs to a platform-admin feature (preferred_language: Newsletter Studio) is offered only to a
  // workspace that has the feature AND only once the database has the column, so a workspace without it sees no
  // new field on a form, an export or an import, and a pending migration can never turn a save into an error.
  const gated = isPilotObjectType(objectType) ? FIELD_REGISTRY[objectType].fields.filter((f) => f.requiresFeature) : [];
  const allowedGated = new Set<string>();
  if (gated.length > 0) {
    const { data: t } = await supabase.from("tenants").select("features").eq("id", tenantId).maybeSingle();
    const features = (t?.features ?? {}) as Partial<TenantFeatures>;
    const table = objectType === "account" ? "accounts" : objectType === "contact" ? "contacts" : null;
    for (const f of gated) {
      if (!f.requiresFeature || features[f.requiresFeature] !== true || !table) continue;
      const probe = await supabase.from(table).select(f.key).eq("tenant_id", tenantId).limit(1);
      if (!probe.error || !isSchemaPending(probe.error)) allowedGated.add(f.key);
    }
  }

  const overridesByKey = new Map<string, OverrideRow>(
    ((overrideRows ?? []) as OverrideRow[]).map((o) => [o.field_key, o]),
  );

  const fields: EffectiveField[] = [];
  const sectionOrder: string[] = [];

  if (isPilotObjectType(objectType)) {
    sectionOrder.push(...FIELD_REGISTRY[objectType].sections);

    FIELD_REGISTRY[objectType].fields.forEach((def, index) => {
      if (def.requiresFeature && !allowedGated.has(def.key)) return;
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
        exportOnly: def.exportOnly,
        kind: "standard",
        selectSource: def.selectSource,
        enumOptions: def.selectSource === "product_item_type" ? itemTypeOptions ?? [] : def.enumOptions,
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

  const defaultRules = isPilotObjectType(objectType) ? DEFAULT_FIELD_RULES[objectType as PilotObjectType] ?? [] : [];
  const rules = [...defaultRules, ...((ruleRows ?? []) as FieldRule[])];

  return { sections, rules };
}

export type SalesConfig = {
  product_categories: ProductCategoryNode[];
};

// normalize* tolerates both the coded shape and the legacy plain-string
// shape, so the app works whether or not migration 0100 has run yet.
export async function getSalesConfig(supabase: SupabaseClient, tenantId: string): Promise<SalesConfig> {
  const { data } = await supabase.from("tenants").select("config").eq("id", tenantId).single();
  const cfg = (data?.config ?? {}) as Record<string, unknown>;
  return {
    product_categories: normalizeCategoryTree(cfg.product_categories),
  };
}
