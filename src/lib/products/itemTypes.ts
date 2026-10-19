import type { TenantConfig, CustomItemTypeDef, TenantItemTypes } from "@/lib/constants";

// Item types for products (migration 0133). Client-safe on purpose: the
// create form, the field widget and the Data Workbench all resolve a tenant's
// list from tenants.config, so nothing here may import server code.
//
// The column has no check constraint: the app validates against the tenant's
// own list, and a tenant can rename, hide or add types without a migration.
// A null / unknown item_type means "not classified yet" and behaves exactly as
// products did before types existed.

export type ItemTypeFlags = {
  /** Kept in stock (a later inventory link; informational today). */
  stocked: boolean;
  /** Can be sold on a quote. */
  sellable: boolean;
  /** Can be bought from a supplier. */
  purchasable: boolean;
  /** Can have BOM components. TRUE ONLY for bom_kit (owner decision 2026-10-19). */
  can_have_components: boolean;
};

export type ItemTypeDef = { key: string; label: string; description: string } & ItemTypeFlags;

export const KIT_ITEM_TYPE = "bom_kit";

const t = (key: string, label: string, description: string, stocked: boolean, sellable: boolean, purchasable: boolean): ItemTypeDef => ({
  key, label, description, stocked, sellable, purchasable, can_have_components: key === KIT_ITEM_TYPE,
});

export const DEFAULT_ITEM_TYPES: readonly ItemTypeDef[] = [
  t("finished_product", "Finished product", "Made by you and sold as it is", true, true, false),
  t("semi_finished", "Semi-finished", "A part you make and then use inside something else", true, false, false),
  t("raw_material", "Raw material", "Bought in bulk and consumed in making things", true, false, true),
  t("bought_out_component", "Bought-out component", "A ready-made part bought from a supplier", true, true, true),
  t("consumable", "Consumable", "Used up along the way: fasteners, gas, adhesive", true, false, true),
  t("custom_made_to_order", "Custom / made to order", "Built for one customer's order, never held in stock", false, true, false),
  t("service", "Service", "Labour, installation, a service plan", false, true, false),
  t("tool_equipment", "Tool / equipment", "Used to do the work but not consumed by it", true, false, true),
  t("certification_document", "Certification / document", "A test certificate, drawing or document that goes with an order", false, true, true),
  t("bom_kit", "BOM / kit", "A bill of materials: made up of other items, with its cost rolled up from them", false, true, false),
];

export type ResolvedItemType = ItemTypeDef & { isDefault: boolean; hidden: boolean };

const DEFAULT_KEYS = new Set(DEFAULT_ITEM_TYPES.map((d) => d.key));

const CUSTOM_KEY = /^[a-z][a-z0-9_]{1,39}$/;

function itemTypesOf(config: Pick<TenantConfig, "item_types"> | null | undefined): TenantItemTypes {
  const raw = config?.item_types;
  return raw && typeof raw === "object" ? raw : {};
}

/** The tenant's full list, in order: the built-ins (renamed / hidden as the
 *  tenant chose) then their custom types. Hidden ones are kept in the result
 *  (flagged) so records that already carry them still display. */
export function resolveItemTypes(config: Pick<TenantConfig, "item_types"> | null | undefined): ResolvedItemType[] {
  const cfg = itemTypesOf(config);
  const hidden = new Set(Array.isArray(cfg.hidden) ? cfg.hidden : []);
  const labels = cfg.labels && typeof cfg.labels === "object" ? cfg.labels : {};
  const builtIns: ResolvedItemType[] = DEFAULT_ITEM_TYPES.map((d) => {
    const renamed = typeof labels[d.key] === "string" ? labels[d.key].trim() : "";
    return { ...d, label: renamed || d.label, isDefault: true, hidden: hidden.has(d.key) };
  });
  const custom: ResolvedItemType[] = (Array.isArray(cfg.custom) ? cfg.custom : [])
    .filter((c) => c && CUSTOM_KEY.test(c.key) && !DEFAULT_KEYS.has(c.key) && typeof c.label === "string" && c.label.trim())
    .map((c) => ({
      key: c.key,
      label: c.label.trim(),
      description: c.description?.trim() ?? "",
      stocked: !!c.stocked,
      sellable: !!c.sellable,
      purchasable: !!c.purchasable,
      can_have_components: false, // only the built-in BOM / kit may
      isDefault: false,
      hidden: hidden.has(c.key),
    }));
  return [...builtIns, ...custom];
}

/** What a picker offers: visible types, plus the one a record already has. */
export function selectableItemTypes(config: Pick<TenantConfig, "item_types"> | null | undefined, current?: string | null): ResolvedItemType[] {
  return resolveItemTypes(config).filter((x) => !x.hidden || x.key === current);
}

export function itemTypeByKey(config: Pick<TenantConfig, "item_types"> | null | undefined, key: string | null | undefined): ResolvedItemType | null {
  if (!key) return null;
  return resolveItemTypes(config).find((x) => x.key === key) ?? null;
}

/** The label to show for a stored key: the tenant's name for it, or the raw
 *  key when it is no longer in the list. Null / empty = unclassified. */
export function itemTypeLabel(config: Pick<TenantConfig, "item_types"> | null | undefined, key: string | null | undefined): string | null {
  if (!key) return null;
  return itemTypeByKey(config, key)?.label ?? key;
}

/** True when this stored key is a type that may have components. */
export function canHaveComponents(config: Pick<TenantConfig, "item_types"> | null | undefined, key: string | null | undefined): boolean {
  return itemTypeByKey(config, key)?.can_have_components === true;
}

export type ItemTypeCheck = { ok: true; key: string | null } | { ok: false; message: string };

/** Validate an item_type from a request body. Empty / null clears it. An
 *  unknown key, or a hidden one the record does not already have, is refused. */
export function validateItemType(
  config: Pick<TenantConfig, "item_types"> | null | undefined,
  value: unknown,
  current?: string | null
): ItemTypeCheck {
  if (value === null || value === undefined || value === "") return { ok: true, key: null };
  if (typeof value !== "string") return { ok: false, message: "item_type must be text" };
  const hit = itemTypeByKey(config, value);
  if (!hit) return { ok: false, message: `"${value}" is not an item type in this workspace` };
  if (hit.hidden && hit.key !== current) return { ok: false, message: `"${hit.label}" is hidden in this workspace and can't be chosen` };
  return { ok: true, key: hit.key };
}

/** A typed value from a file or form: the key, or the label, case- and
 *  whitespace-insensitively. Hidden types still match (a file exported
 *  earlier may carry one); validateItemType then decides. */
export function matchItemType(config: Pick<TenantConfig, "item_types"> | null | undefined, text: string): ResolvedItemType | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const want = norm(text);
  if (!want) return null;
  const all = resolveItemTypes(config);
  return all.find((x) => norm(x.key) === want) ?? all.find((x) => norm(x.label) === want) ?? null;
}

/** A cell from a Data Workbench file: the type's key or its label. Blank =
 *  unclassified. An unknown or (for a new assignment) hidden type is an error. */
export function itemTypeFromCell(
  config: Pick<TenantConfig, "item_types"> | null | undefined,
  text: string,
  current?: string | null
): ItemTypeCheck {
  if (!text.trim()) return { ok: true, key: null };
  const hit = matchItemType(config, text);
  if (!hit) return { ok: false, message: `Item type "${text.trim()}" is not one of this workspace's item types` };
  return validateItemType(config, hit.key, current);
}

export type ItemTypeConfigResult = { ok: true; value: TenantItemTypes } | { ok: false; message: string };

/** Validate and normalise the settings payload: renames of built-ins, hidden
 *  keys, custom types. Custom types never get components, and cannot reuse a
 *  built-in key or another custom one's label. */
export function sanitizeItemTypeConfig(raw: unknown): ItemTypeConfigResult {
  if (!raw || typeof raw !== "object") return { ok: false, message: "item_types must be an object" };
  const input = raw as Record<string, unknown>;

  const labels: Record<string, string> = {};
  if (input.labels !== undefined) {
    if (!input.labels || typeof input.labels !== "object" || Array.isArray(input.labels)) return { ok: false, message: "labels must be an object" };
    for (const [k, v] of Object.entries(input.labels as Record<string, unknown>)) {
      if (!DEFAULT_KEYS.has(k)) return { ok: false, message: `"${k}" is not a built-in item type` };
      if (typeof v !== "string") return { ok: false, message: "A label must be text" };
      const label = v.trim();
      if (!label) continue;
      if (label.length > 60) return { ok: false, message: "A label can be at most 60 characters" };
      const original = DEFAULT_ITEM_TYPES.find((d) => d.key === k)!.label;
      if (label !== original) labels[k] = label;
    }
  }

  const custom: CustomItemTypeDef[] = [];
  if (input.custom !== undefined) {
    if (!Array.isArray(input.custom)) return { ok: false, message: "custom must be a list" };
    if (input.custom.length > 30) return { ok: false, message: "At most 30 custom item types" };
    for (const c of input.custom as Record<string, unknown>[]) {
      if (!c || typeof c !== "object") return { ok: false, message: "Each custom item type must be an object" };
      const key = typeof c.key === "string" ? c.key.trim() : "";
      const label = typeof c.label === "string" ? c.label.trim() : "";
      if (!CUSTOM_KEY.test(key)) return { ok: false, message: `"${key}" is not a valid key (lower-case letters, digits and underscores, starting with a letter)` };
      if (DEFAULT_KEYS.has(key)) return { ok: false, message: `"${key}" is a built-in item type` };
      if (custom.some((x) => x.key === key)) return { ok: false, message: `Duplicate key "${key}"` };
      if (!label || label.length > 60) return { ok: false, message: "Every custom item type needs a name of at most 60 characters" };
      const description = typeof c.description === "string" ? c.description.trim().slice(0, 200) : "";
      custom.push({ key, label, ...(description ? { description } : {}), stocked: c.stocked === true, sellable: c.sellable === true, purchasable: c.purchasable === true });
    }
  }

  const allLabels = [
    ...DEFAULT_ITEM_TYPES.map((d) => (labels[d.key] ?? d.label).toLowerCase()),
    ...custom.map((x) => x.label.toLowerCase()),
  ];
  if (new Set(allLabels).size !== allLabels.length) return { ok: false, message: "Two item types can't share a name" };

  const known = new Set([...DEFAULT_KEYS, ...custom.map((x) => x.key)]);
  const hidden: string[] = [];
  if (input.hidden !== undefined) {
    if (!Array.isArray(input.hidden)) return { ok: false, message: "hidden must be a list" };
    for (const k of input.hidden) {
      if (typeof k !== "string" || !known.has(k)) return { ok: false, message: `"${String(k)}" is not an item type` };
      if (!hidden.includes(k)) hidden.push(k);
    }
  }

  return {
    ok: true,
    value: {
      ...(Object.keys(labels).length ? { labels } : {}),
      ...(hidden.length ? { hidden } : {}),
      ...(custom.length ? { custom } : {}),
    },
  };
}
