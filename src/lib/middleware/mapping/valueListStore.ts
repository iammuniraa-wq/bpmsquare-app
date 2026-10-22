import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { ListLookup } from "./convert";
import type { ValueList, ValueListRow } from "./types";
import { MAX_UNKNOWN_IN, canAddCustom, kindLabel, mergeUnknownIn } from "./valueLists";

// Rows of integration_value_lists: one list per kind of value, per connection. Service role only (RLS on, no policy), so every
// query names the tenant. A missing table reads as "no lists", which is what the runtime needs while the update is pending.

export const LISTS_TABLE = "integration_value_lists";
const COLS = "kind, label, rows, default_in, unknown_in";

type DbList = { kind: string; label: string; rows: unknown; default_in: string | null; unknown_in: unknown };

function toList(r: DbList): ValueList {
  const rows: ValueListRow[] = Array.isArray(r.rows)
    ? (r.rows as Record<string, unknown>[]).filter((x) => x && typeof x.bpm === "string").map((x) => ({ bpm: String(x.bpm), erp: typeof x.erp === "string" ? x.erp : String(x.erp ?? ""), inbound: x.inbound === true }))
    : [];
  const unknown_in = Array.isArray(r.unknown_in) ? (r.unknown_in as unknown[]).filter((x): x is string => typeof x === "string").slice(-MAX_UNKNOWN_IN) : [];
  return { kind: r.kind, label: r.label, rows, default_in: r.default_in ?? null, unknown_in };
}

export type ListsResult = { pending: true } | { pending: false; lists: ValueList[] };

export async function listAll(admin: SupabaseClient, tenantId: string, connection: string): Promise<ListsResult> {
  const { data, error } = await admin.from(LISTS_TABLE).select(COLS).eq("tenant_id", tenantId).eq("connection_id", connection).order("kind");
  if (isSchemaPending(error)) return { pending: true };
  return { pending: false, lists: error ? [] : ((data ?? []) as DbList[]).map(toList) };
}

/** The lists the runtime reads; a pending migration or a read error is an empty set, so a send never crashes on it. */
export async function loadListMap(admin: SupabaseClient, tenantId: string, connection: string): Promise<Map<string, ValueList>> {
  const r = await listAll(admin, tenantId, connection);
  return new Map((r.pending ? [] : r.lists).map((l) => [l.kind, l]));
}

export const lookupOf = (m: Map<string, ValueList>): ListLookup => (kind) => m.get(kind);

export type SaveListResult = { ok: true; list: ValueList; before: ValueList | null } | { ok: false; status: number; error: string };

export async function saveList(
  admin: SupabaseClient, tenantId: string, userId: string | null, connection: string, kind: string,
  input: { label?: string; rows: ValueListRow[]; default_in: string | null },
): Promise<SaveListResult> {
  const all = await listAll(admin, tenantId, connection);
  if (all.pending) return { ok: false, status: 409, error: "pending" };
  const before = all.lists.find((l) => l.kind === kind) ?? null;
  const label = (input.label?.trim() || before?.label || kindLabel(kind)).slice(0, 60);
  const patch = { label, rows: input.rows, default_in: input.default_in, updated_at: new Date().toISOString(), updated_by: userId };
  if (before) {
    const { error } = await admin.from(LISTS_TABLE).update(patch).eq("tenant_id", tenantId).eq("connection_id", connection).eq("kind", kind);
    if (error) return { ok: false, status: 500, error: error.message };
    return { ok: true, before, list: { ...before, label, rows: input.rows, default_in: input.default_in } };
  }
  if (kind.startsWith("custom:") && !canAddCustom(all.lists.map((l) => l.kind))) return { ok: false, status: 422, error: "A connection holds at most 20 lists of your own." };
  const { error } = await admin.from(LISTS_TABLE).insert({ tenant_id: tenantId, connection_id: connection, kind, ...patch, unknown_in: [] });
  if (error) {
    if (error.code === "23505") return saveList(admin, tenantId, userId, connection, kind, input);
    return { ok: false, status: 500, error: error.message };
  }
  return { ok: true, before: null, list: { kind, label, rows: input.rows, default_in: input.default_in, unknown_in: [] } };
}

export async function removeList(admin: SupabaseClient, tenantId: string, connection: string, kind: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.from(LISTS_TABLE).delete().eq("tenant_id", tenantId).eq("connection_id", connection).eq("kind", kind);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** After a pull: the ERP codes no row answered, kept (distinct, the last 50) for the "unmapped" counter. */
export async function recordUnknownInbound(admin: SupabaseClient, tenantId: string, connection: string, seen: { list: string; value: string }[]): Promise<void> {
  if (!seen.length) return;
  const by = new Map<string, string[]>();
  for (const s of seen) by.set(s.list, [...(by.get(s.list) ?? []), s.value]);
  const all = await listAll(admin, tenantId, connection);
  if (all.pending) return;
  for (const [kind, codes] of by) {
    const list = all.lists.find((l) => l.kind === kind);
    if (!list) continue;
    const next = mergeUnknownIn(list.unknown_in, [...new Set(codes)]);
    await admin.from(LISTS_TABLE).update({ unknown_in: next }).eq("tenant_id", tenantId).eq("connection_id", connection).eq("kind", kind);
  }
}
