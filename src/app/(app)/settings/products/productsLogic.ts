import { deriveCode, type PicklistItem, type ProductCategoryNode } from "@/lib/picklists";
import type { ResolvedItemType } from "@/lib/products/itemTypes";

// Pure rules behind the Products screen (categories and item types), kept apart from the React so they can be tested.

/** What the server stores for item types: renames and hides of the built-ins, plus the custom ones. */
export function toItemTypePayload(rows: ResolvedItemType[]) {
  return {
    labels: Object.fromEntries(rows.filter((r) => r.isDefault).map((r) => [r.key, r.label])),
    hidden: rows.filter((r) => r.hidden).map((r) => r.key),
    custom: rows.filter((r) => !r.isDefault).map((r) => ({
      key: r.key, label: r.label, description: r.description, stocked: r.stocked, sellable: r.sellable, purchasable: r.purchasable,
    })),
  };
}

export const slugKey = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export type NewItemType = { label: string; description: string; stocked: boolean; sellable: boolean; purchasable: boolean };
export const BLANK_ITEM_TYPE: NewItemType = { label: "", description: "", stocked: false, sellable: false, purchasable: false };

export function addItemType(rows: ResolvedItemType[], draft: NewItemType): { rows: ResolvedItemType[]; key: string } | { error: string } {
  const label = draft.label.trim();
  const key = slugKey(label);
  if (!label || key.length < 2) return { error: "Give the item type a name." };
  if (rows.some((r) => r.key === key || r.label.toLowerCase() === label.toLowerCase())) return { error: "An item type with that name already exists." };
  return { rows: [...rows, { ...draft, key, label, description: draft.description.trim(), can_have_components: false, isDefault: false, hidden: false }], key };
}

/** A custom type that products still carry can be hidden but not removed. */
export function canRemoveItemType(row: ResolvedItemType, usage: Record<string, number>): boolean {
  return !row.isDefault && (usage[row.key] ?? 0) === 0;
}

export function flagsText(r: Pick<ResolvedItemType, "stocked" | "sellable" | "purchasable" | "can_have_components">): string {
  const on = [r.stocked && "Stocked", r.sellable && "Sold", r.purchasable && "Bought", r.can_have_components && "Has components"].filter(Boolean);
  return on.length > 0 ? on.join(", ") : "None";
}

// ── Categories: two levels, code + name on both ─────────────────────────────

export function addCategory(tree: ProductCategoryNode[], name: string, code?: string): { tree: ProductCategoryNode[]; code: string } | { error: string } {
  const n = name.trim();
  if (!n) return { error: "Give the category a name." };
  const c = deriveCode(code?.trim() ? code : n);
  if (!c) return { error: "Use letters or numbers in the name." };
  if (tree.some((x) => x.code === c)) return { error: "A category with that code already exists." };
  return { tree: [...tree, { code: c, name: n, subs: [] }], code: c };
}

export function addSub(tree: ProductCategoryNode[], parentCode: string, name: string, code?: string): { tree: ProductCategoryNode[] } | { error: string } {
  const n = name.trim();
  if (!n) return { error: "Give the sub-category a name." };
  const c = deriveCode(code?.trim() ? code : n);
  const parent = tree.find((x) => x.code === parentCode);
  if (!parent || !c) return { error: "Use letters or numbers in the name." };
  if (parent.subs.some((s) => s.code === c)) return { error: "A sub-category with that code already exists." };
  const sub: PicklistItem = { code: c, name: n };
  return { tree: tree.map((x) => (x.code === parentCode ? { ...x, subs: [...x.subs, sub] } : x)) };
}

export const renameCategory = (tree: ProductCategoryNode[], code: string, name: string) => tree.map((x) => (x.code === code ? { ...x, name } : x));
export const removeCategory = (tree: ProductCategoryNode[], code: string) => tree.filter((x) => x.code !== code);
export const removeSub = (tree: ProductCategoryNode[], parentCode: string, code: string) =>
  tree.map((x) => (x.code === parentCode ? { ...x, subs: x.subs.filter((s) => s.code !== code) } : x));
export const renameSub = (tree: ProductCategoryNode[], parentCode: string, code: string, name: string) =>
  tree.map((x) => (x.code === parentCode ? { ...x, subs: x.subs.map((s) => (s.code === code ? { ...s, name } : s)) } : x));

export type ProductSaveStep =
  | { id: "categories"; url: string; body: { product_categories: ProductCategoryNode[] } }
  | { id: "types"; url: string; body: { item_types: ReturnType<typeof toItemTypePayload> } };

/** The writes a Save makes: one per group that changed, to the route that already owned it. */
export function planProductSave(
  initial: { tree: ProductCategoryNode[]; types: ResolvedItemType[] },
  draft: { tree: ProductCategoryNode[]; types: ResolvedItemType[] },
): ProductSaveStep[] {
  const steps: ProductSaveStep[] = [];
  if (JSON.stringify(initial.tree) !== JSON.stringify(draft.tree)) {
    steps.push({ id: "categories", url: "/api/settings/sales-config", body: { product_categories: draft.tree } });
  }
  if (JSON.stringify(toItemTypePayload(initial.types)) !== JSON.stringify(toItemTypePayload(draft.types))) {
    steps.push({ id: "types", url: "/api/settings/item-types", body: { item_types: toItemTypePayload(draft.types) } });
  }
  return steps;
}
