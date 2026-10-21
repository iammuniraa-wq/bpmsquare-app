import "server-only";
import { LIST_SOURCES, type ListSource } from "@/lib/api/listSources";
import type { QueryableField } from "@/lib/api/query";
import { createAdminSupabase } from "@/lib/supabase-server";
import { canViewWorkcenter, type PermissionSet } from "@/lib/permissions";
import { OBJECT_DEFS, objectDef, type AssistantObjectType, type ObjectDef } from "./objects";
import { summarizeRow } from "./context";
import type { Related } from "./suggestions";

// The assistant reads records through the same sources the REST API and Report Builder use (LIST_SOURCES): the
// same field whitelist, the same tenant-scoped, PII-decrypting load(). One addition: Standard Quotes have no
// LIST_SOURCES entry, so a small source of the same shape is defined here, tenant-scoped by an explicit filter,
// header fields only (no terms, notes or pricing detail).

type Row = Record<string, unknown>;

const STANDARD_QUOTE_FIELDS: QueryableField[] = [
  { path: "id", type: "string" },
  { path: "ref", type: "string", searchable: true },
  { path: "status", type: "string" },
  { path: "total", type: "number" },
  { path: "valid_until", type: "date" },
  { path: "created_at", type: "date" },
  { path: "sent_at", type: "date" },
  { path: "account.id", type: "string" },
  { path: "account.name", type: "string", searchable: true },
];

export const STANDARD_QUOTES_SOURCE: ListSource = {
  label: "Standard quotes",
  description: "Standard quotes -- status, total, validity and the customer.",
  relatedWorkcenter: "standard_quotes",
  fields: STANDARD_QUOTE_FIELDS,
  load: async (tenantId) => {
    const { data } = await createAdminSupabase()
      .from("standard_quotes")
      .select("id, ref, status, total, valid_until, created_at, sent_at, accounts(id, name)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    return ((data ?? []) as Row[]).map((q) => {
      const acc = Array.isArray(q.accounts) ? q.accounts[0] : q.accounts;
      const { accounts: _a, ...rest } = q;
      return { ...rest, account: acc ? { id: (acc as Row).id, name: (acc as Row).name } : null };
    });
  },
};

export const assistantSources = (): Record<string, ListSource> => ({ ...LIST_SOURCES, standard_quotes: STANDARD_QUOTES_SOURCE });

export type AssistantCtx = {
  tenantId: string;
  perms: PermissionSet;
  features: Record<string, boolean | undefined>;
};

/** The module is on for this workspace AND the caller's Business Roles grant view on the object's workcenter. */
export function canUseObject(ctx: AssistantCtx, def: ObjectDef): boolean {
  return ctx.features[def.featureKey] === true && canViewWorkcenter(ctx.perms, def.workcenter);
}

async function loadAll(ctx: AssistantCtx, def: ObjectDef): Promise<Row[]> {
  if (!canUseObject(ctx, def)) return [];
  const src = assistantSources()[def.sourceKey];
  if (!src) return [];
  return src.load(ctx.tenantId);
}

export type LoadedRecord = { def: ObjectDef; row: Row; title: string; summary: Record<string, string | number | boolean> };

/**
 * One record by id, only when the caller may see the object. The id comes from a route the client names, so it is
 * matched against the tenant's own rows: an id from another workspace is simply not there and returns null.
 */
export async function loadRecord(ctx: AssistantCtx, type: AssistantObjectType, id: string): Promise<LoadedRecord | null> {
  const def = objectDef(type);
  const rows = await loadAll(ctx, def);
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  const src = assistantSources()[def.sourceKey];
  return { def, row, title: def.title(row), summary: summarizeRow(src.fields, row) };
}

/** Related rows for the suggestion rules. A related object the caller cannot see is left undefined, not empty. */
export async function loadRelated(ctx: AssistantCtx, type: AssistantObjectType, row: Row): Promise<Related> {
  if (type !== "account") return {};
  const id = String(row.id ?? "");
  const mine = (rows: Row[]) => rows.filter((r) => (r.account as Row | null | undefined)?.id === id);
  const get = async (t: AssistantObjectType): Promise<Row[] | undefined> => {
    const def = objectDef(t);
    if (!canUseObject(ctx, def)) return undefined;
    try { return mine(await loadAll(ctx, def)); } catch { return undefined; }
  };
  const [contacts, quotes, cases] = await Promise.all([get("contact"), get("quote"), get("case")]);
  return { contacts, quotes, cases };
}

const KEYS = ["ref", "sku", "name", "title"] as const;

/** Records of one object matching a reference or name: exact first, then contains. Up to five. */
export async function findRecords(ctx: AssistantCtx, type: AssistantObjectType, query: string): Promise<{ id: string; title: string }[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const def = objectDef(type);
  const rows = await loadAll(ctx, def);
  const values = (r: Row) => KEYS.map((k) => (typeof r[k] === "string" ? (r[k] as string).toLowerCase() : "")).filter(Boolean);
  const exact = rows.filter((r) => values(r).includes(q));
  const hits = exact.length ? exact : rows.filter((r) => values(r).some((v) => v.includes(q)));
  return hits.slice(0, 5).map((r) => ({ id: String(r.id), title: def.title(r) }));
}

/** Objects the caller can use, for the model's open_record tool. */
export function usableObjects(ctx: AssistantCtx): ObjectDef[] {
  return OBJECT_DEFS.filter((d) => canUseObject(ctx, d));
}
