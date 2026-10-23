import { objectDef, type AssistantObjectType, type ObjectDef } from "@/lib/assistant/objects";
import type { BriefingLine } from "./types";

/**
 * "Yesterday: what you did", from the person's own change_log and comment rows. Only record families the product has a
 * screen for are named here; settings, webhooks and other configuration history never reach a briefing. The caller
 * passes `canSee`, the same feature + workcenter check the rest of the assistant uses, so a family the person may not
 * view is dropped before anything is worded. Pure.
 */

// change_log.object_type / record_comments.object_type -> the assistant's object. Both spellings occur in the history.
const FAMILY: Record<string, AssistantObjectType> = {
  accounts: "account", account: "account", contacts: "contact", contact: "contact",
  quotes: "quote", quote: "quote", standard_quotes: "standard_quote", standard_quote: "standard_quote",
  sales_orders: "sales_order", sales_order: "sales_order",
  products: "product", product: "product", leads: "lead", lead: "lead", opportunities: "opportunity", opportunity: "opportunity",
  estimates: "estimate", estimate: "estimate", cases: "case", case: "case", invoices: "invoice", invoice: "invoice",
  assets: "asset", asset: "asset", suppliers: "supplier", supplier: "supplier", rfqs: "rfq", rfq: "rfq",
  work_orders: "work_order", work_order: "work_order",
};

export const familyOf = (objectType: unknown): ObjectDef | null => {
  const t = typeof objectType === "string" ? FAMILY[objectType] : undefined;
  return t ? objectDef(t) : null;
};

export type ChangeRow = { object_type: string; object_id: string; object_label: string | null; action: string; created_at: string };
export type CommentRow = { object_type: string; object_id: string; created_at: string };

const VERB: Record<string, string> = { create: "Created", update: "Updated", reopen: "Reopened", delete: "Deleted" };
const VERB_ORDER = ["create", "update", "reopen", "delete"];

const plural = (def: ObjectDef, n: number) => (n === 1 ? def.noun : `${def.noun}s`);
const MAX_LINES = 6;
const MAX_ITEMS = 3;

export function yesterdayLines(
  changes: readonly ChangeRow[],
  comments: readonly CommentRow[],
  canSee: (def: ObjectDef) => boolean,
): BriefingLine[] {
  // One entry per record per action: ten edits of the same account are one "updated" account, not ten.
  const groups = new Map<string, { def: ObjectDef; action: string; ids: Map<string, string> }>();
  for (const r of changes) {
    const def = familyOf(r.object_type);
    if (!def || !VERB[r.action] || !canSee(def)) continue;
    const key = `${def.type}:${r.action}`;
    const g = groups.get(key) ?? { def, action: r.action, ids: new Map<string, string>() };
    if (!g.ids.has(r.object_id)) g.ids.set(r.object_id, r.object_label ?? "");
    groups.set(key, g);
  }

  const lines: BriefingLine[] = [...groups.values()]
    .sort((a, b) => VERB_ORDER.indexOf(a.action) - VERB_ORDER.indexOf(b.action) || b.ids.size - a.ids.size || (a.def.type < b.def.type ? -1 : 1))
    .map((g) => {
      const n = g.ids.size;
      const entries = [...g.ids.entries()];
      const deleted = g.action === "delete";
      return {
        id: `yesterday:${g.def.type}:${g.action}`,
        label: `${VERB[g.action]} ${n} ${plural(g.def, n)}`,
        href: n === 1 && !deleted ? g.def.detail(entries[0][0]) : g.def.list,
        objectType: g.def.type,
        count: n,
        // A deleted record has no page to open, so it is counted, not named.
        items: deleted ? undefined : entries.slice(0, MAX_ITEMS).filter(([, label]) => label).map(([id, label]) => ({ label, href: g.def.detail(id) })),
      };
    });

  const seen = new Set<string>();
  let latest: { def: ObjectDef; id: string; at: string } | null = null;
  for (const c of comments) {
    const def = familyOf(c.object_type);
    if (!def || !canSee(def)) continue;
    seen.add(`${c.object_type}:${c.object_id}:${c.created_at}`);
    if (!latest || c.created_at > latest.at) latest = { def, id: c.object_id, at: c.created_at };
  }
  if (latest) {
    const n = seen.size;
    lines.push({
      id: "yesterday:comments",
      label: `Wrote ${n} ${n === 1 ? "comment" : "comments"}`,
      href: latest.def.detail(latest.id),
      objectType: latest.def.type,
      count: n,
    });
  }
  return lines.slice(0, MAX_LINES);
}
