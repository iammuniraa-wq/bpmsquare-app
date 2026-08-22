// Code + description picklists (owner decision 2026-08-22).
//
// Every configurable list value (territory, sales org, product category /
// sub-category) is a { code, name } pair: the CODE is short, stable and
// immutable once used — it is what records store and what integrations match
// on (SAP-style; an ERP's VKORG can literally be the code). The NAME is the
// display label and can be renamed freely without orphaning any data.
//
// Records created before this change stored the display text itself;
// migration 0100 backfills them to derived codes using the same derivation
// rule as deriveCode() below — keep the two in sync if either ever changes.
// The normalize* helpers accept both the legacy shapes (plain strings /
// {name, subs}) and the coded shapes, so the app renders correctly whether
// or not the owner has run 0100 yet.

export type PicklistItem = { code: string; name: string };
export type ProductCategoryNode = { code: string; name: string; subs: PicklistItem[] };

/** "West India" -> "WEST_INDIA". Idempotent: deriveCode(code) === code. */
export function deriveCode(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 40);
}

function toItem(raw: unknown): PicklistItem | null {
  if (typeof raw === "string") {
    const name = raw.trim();
    return name ? { code: deriveCode(name), name } : null;
  }
  if (raw && typeof raw === "object") {
    const o = raw as { code?: unknown; name?: unknown };
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name) return null;
    const code = typeof o.code === "string" && o.code.trim() ? deriveCode(o.code) : deriveCode(name);
    return { code, name };
  }
  return null;
}

export function normalizePicklist(raw: unknown): PicklistItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PicklistItem[] = [];
  for (const entry of raw) {
    const item = toItem(entry);
    if (!item || seen.has(item.code)) continue;
    seen.add(item.code);
    out.push(item);
  }
  return out;
}

export function normalizeCategoryTree(raw: unknown): ProductCategoryNode[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ProductCategoryNode[] = [];
  for (const entry of raw) {
    const item = toItem(entry);
    if (!item || seen.has(item.code)) continue;
    seen.add(item.code);
    const subsRaw = entry && typeof entry === "object" ? (entry as { subs?: unknown }).subs : undefined;
    out.push({ ...item, subs: normalizePicklist(subsRaw) });
  }
  return out;
}

/** Display name for a stored code; falls back to the code itself so a value
 * removed from the config (or a legacy free-typed one) still renders. */
export function picklistLabel(list: PicklistItem[], code: string | null | undefined): string {
  if (!code) return "";
  return list.find((i) => i.code === code)?.name ?? code;
}

export function categoryLabel(tree: ProductCategoryNode[], code: string | null | undefined): string {
  if (!code) return "";
  return tree.find((n) => n.code === code)?.name ?? code;
}

export function subCategoryLabel(tree: ProductCategoryNode[], code: string | null | undefined): string {
  if (!code) return "";
  for (const node of tree) {
    const hit = node.subs.find((s) => s.code === code);
    if (hit) return hit.name;
  }
  return code;
}
