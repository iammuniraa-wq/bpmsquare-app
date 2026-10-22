import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { MappingDocument } from "./types";

// Rows of integration_mappings (spec section 1). Service role only: the table has RLS on and no policy, so EVERY query here
// names the tenant. Nothing is edited in place: a save inserts the next version and demotes the old active row; the last ten
// previous versions are kept. A missing table is "pending", never a crash.

export const MAPPINGS_TABLE = "integration_mappings";
const COLS = "id, connection_id, document, direction, version, status, doc, created_at, updated_at, updated_by";
export const KEEP_PREVIOUS = 10;

export type MappingRow = {
  id: string; connection_id: string; document: string; direction: "out" | "in"; version: number;
  status: "active" | "previous" | "draft"; doc: MappingDocument; created_at: string; updated_at: string; updated_by: string | null;
};

type Pending = { pending: true };
export type Got<T> = { pending: false; value: T } | Pending;
const PENDING: Pending = { pending: true };

const scoped = (admin: SupabaseClient, tenantId: string, connection: string, document: string) =>
  admin.from(MAPPINGS_TABLE).select(COLS).eq("tenant_id", tenantId).eq("connection_id", connection).eq("document", document);

export async function getActive(admin: SupabaseClient, tenantId: string, connection: string, document: string): Promise<Got<MappingRow | null>> {
  const { data, error } = await scoped(admin, tenantId, connection, document).eq("status", "active").maybeSingle();
  if (isSchemaPending(error)) return PENDING;
  return { pending: false, value: error ? null : ((data as MappingRow | null) ?? null) };
}

export async function getDraft(admin: SupabaseClient, tenantId: string, connection: string, document: string): Promise<Got<MappingRow | null>> {
  const { data, error } = await scoped(admin, tenantId, connection, document).eq("status", "draft").maybeSingle();
  if (isSchemaPending(error)) return PENDING;
  return { pending: false, value: error ? null : ((data as MappingRow | null) ?? null) };
}

/** An active row by its id, for a pointer that came from a request body (a webhook's mapping_id). Tenant and connection are checked. */
export async function getActiveById(admin: SupabaseClient, tenantId: string, id: string, connection?: string): Promise<MappingRow | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{32,40}$/i.test(id)) return null;
  let q = admin.from(MAPPINGS_TABLE).select(COLS).eq("id", id).eq("tenant_id", tenantId).eq("status", "active");
  if (connection) q = q.eq("connection_id", connection);
  const { data, error } = await q.maybeSingle();
  return error ? null : ((data as MappingRow | null) ?? null);
}

export async function listVersions(admin: SupabaseClient, tenantId: string, connection: string, document: string): Promise<{ version: number; at: string; by: string | null; status: string }[]> {
  const { data, error } = await scoped(admin, tenantId, connection, document).in("status", ["active", "previous"]).order("version", { ascending: false }).limit(KEEP_PREVIOUS + 2);
  if (error) return [];
  return ((data ?? []) as MappingRow[]).map((r) => ({ version: r.version, at: r.created_at, by: r.updated_by, status: r.status }));
}

export async function getVersion(admin: SupabaseClient, tenantId: string, connection: string, document: string, version: number): Promise<MappingRow | null> {
  const { data, error } = await scoped(admin, tenantId, connection, document).eq("version", version).in("status", ["active", "previous"]).maybeSingle();
  return error ? null : ((data as MappingRow | null) ?? null);
}

export async function listActive(admin: SupabaseClient, tenantId: string, connection: string): Promise<MappingRow[]> {
  const { data, error } = await admin.from(MAPPINGS_TABLE).select(COLS).eq("tenant_id", tenantId).eq("connection_id", connection).eq("status", "active");
  return error ? [] : ((data ?? []) as MappingRow[]);
}

export type Saved = { ok: true; version: number; id: string } | { ok: false; error: string; pending?: true };

export async function saveActive(admin: SupabaseClient, tenantId: string, userId: string | null, connection: string, document: string, direction: "out" | "in", doc: MappingDocument): Promise<Saved> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await scoped(admin, tenantId, connection, document).in("status", ["active", "previous"]);
    if (isSchemaPending(error)) return { ok: false, error: "pending", pending: true };
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as MappingRow[];
    const next = rows.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    const active = rows.find((r) => r.status === "active");
    if (active) {
      const demote = await admin.from(MAPPINGS_TABLE).update({ status: "previous", updated_at: new Date().toISOString() }).eq("id", active.id).eq("tenant_id", tenantId);
      if (demote.error) return { ok: false, error: demote.error.message };
    }
    const ins = await admin.from(MAPPINGS_TABLE).insert({
      tenant_id: tenantId, connection_id: connection, document, direction, version: next, status: "active", doc, updated_by: userId,
    }).select("id").single();
    if (ins.error || !ins.data) {
      // Put the old version back so there is never a moment without an active mapping that had one.
      if (active) await admin.from(MAPPINGS_TABLE).update({ status: "active" }).eq("id", active.id).eq("tenant_id", tenantId);
      if (ins.error?.code === "23505" && attempt === 0) continue;
      return { ok: false, error: ins.error?.message ?? "could not save" };
    }
    await prune(admin, tenantId, connection, document);
    await admin.from(MAPPINGS_TABLE).delete().eq("tenant_id", tenantId).eq("connection_id", connection).eq("document", document).eq("status", "draft");
    return { ok: true, version: next, id: (ins.data as { id: string }).id };
  }
  return { ok: false, error: "could not save" };
}

async function prune(admin: SupabaseClient, tenantId: string, connection: string, document: string): Promise<void> {
  const { data } = await scoped(admin, tenantId, connection, document).eq("status", "previous").order("version", { ascending: false });
  const old = ((data ?? []) as MappingRow[]).slice(KEEP_PREVIOUS).map((r) => r.id);
  if (old.length) await admin.from(MAPPINGS_TABLE).delete().eq("tenant_id", tenantId).in("id", old);
}

/** A fetched field list that is not a saved mapping yet (one per connection and document). */
export async function saveDraft(admin: SupabaseClient, tenantId: string, userId: string | null, connection: string, document: string, direction: "out" | "in", doc: MappingDocument): Promise<Saved> {
  const existing = await getDraft(admin, tenantId, connection, document);
  if (existing.pending) return { ok: false, error: "pending", pending: true };
  if (existing.value) {
    const { error } = await admin.from(MAPPINGS_TABLE).update({ doc, updated_at: new Date().toISOString(), updated_by: userId }).eq("id", existing.value.id).eq("tenant_id", tenantId);
    return error ? { ok: false, error: error.message } : { ok: true, version: existing.value.version, id: existing.value.id };
  }
  const ins = await admin.from(MAPPINGS_TABLE).insert({ tenant_id: tenantId, connection_id: connection, document, direction, version: 0, status: "draft", doc, updated_by: userId }).select("id").single();
  if (ins.error || !ins.data) {
    if (ins.error?.code === "23505") return saveDraft(admin, tenantId, userId, connection, document, direction, doc);
    return { ok: false, error: ins.error?.message ?? "could not save" };
  }
  return { ok: true, version: 0, id: (ins.data as { id: string }).id };
}

/** "Reset to standard": every version goes. A webhook connection keeps the last field list as a draft so Reset can re-propose from it. */
export async function resetAll(admin: SupabaseClient, tenantId: string, connection: string, document: string, opts: { keepDraft?: boolean } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const statuses = opts.keepDraft ? ["active", "previous"] : ["active", "previous", "draft"];
  const { error } = await admin.from(MAPPINGS_TABLE).delete().eq("tenant_id", tenantId).eq("connection_id", connection).eq("document", document).in("status", statuses);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Deleting a mapping a webhook points at: the pointer goes back to the standard payload and the webhook is flagged. */
export async function detachWebhooks(admin: SupabaseClient, tenantId: string, mappingId: string): Promise<void> {
  const { error } = await admin.from("webhooks").update({ payload_mode: "standard", mapping_id: null, paused_reason: "Its mapping was removed: choose a payload on the Request tab." })
    .eq("tenant_id", tenantId).eq("mapping_id", mappingId);
  void error;
}
