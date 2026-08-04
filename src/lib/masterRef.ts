import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextSeqFromRefs, firstFreeRef } from "./refSeq";

// Business IDs for master data (0061): ACC-0001 / CON-0001 / AST-0001 /
// SUP-0001 / INV-0001, tenant-scoped, sequential, no yearly reset (master
// data identity shouldn't change meaning in January). Display/reference
// only -- every mutation still keys on the UUID `id`, per bpmsquarecore.md
// §3.

export const MASTER_REF_TABLES = ["accounts", "contacts", "assets", "suppliers", "inventory_items"] as const;
export type MasterRefTable = (typeof MASTER_REF_TABLES)[number];

const PREFIX: Record<MasterRefTable, string> = {
  accounts: "ACC",
  contacts: "CON",
  assets: "AST",
  suppliers: "SUP",
  inventory_items: "INV",
};

export function formatMasterRef(table: MasterRefTable, seq: number): string {
  return `${PREFIX[table]}-${String(seq).padStart(4, "0")}`;
}

/** The next unused sequence number for this tenant+table -- used by bulk
 * import, which assigns a contiguous block in memory instead of probing the
 * DB once per row. Paginated for the same reason lib/import/server.ts's
 * fetchAllRows exists: PostgREST caps one response at ~1000 rows, and a
 * tenant past the cap would otherwise silently derive too low a max and
 * seed a colliding block. */
export async function nextMasterRefSeq(supabase: SupabaseClient, table: MasterRefTable, tenantId: string): Promise<number> {
  const PAGE = 1000;
  const refs: (string | null)[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await supabase
      .from(table)
      .select("ref")
      .eq("tenant_id", tenantId)
      .like("ref", `${PREFIX[table]}-%`)
      .range(from, from + PAGE - 1);
    const batch = (data ?? []) as { ref: string | null }[];
    refs.push(...batch.map((r) => r.ref));
    if (batch.length < PAGE) break;
  }
  return nextSeqFromRefs(refs, new RegExp(`^${PREFIX[table]}-(\\d+)$`));
}

/** A ready-to-insert ref for a single create -- probes for the first free
 * candidate so a deleted record's number isn't blindly reissued to a
 * different concurrent insert. The partial unique index on (tenant_id, ref)
 * is the real backstop -- use insertWithMasterRef() for the retry. */
export async function generateNextMasterRef(supabase: SupabaseClient, table: MasterRefTable, tenantId: string): Promise<string> {
  const start = await nextMasterRefSeq(supabase, table, tenantId);
  return firstFreeRef(supabase, table, tenantId, (seq) => formatMasterRef(table, seq), start);
}

export function isMasterRefCollision(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "23505" && (error.message ?? "").includes("_tenant_ref_uniq");
}

/**
 * Insert with a generated ref, retrying with a fresh ref when two concurrent
 * creates in the same tenant race between probe and insert (the unique index
 * turns the race into a clean 23505 instead of a duplicate). Any other error
 * -- including a 23505 from a DIFFERENT constraint, e.g. inventory's SKU
 * uniqueness -- is returned to the caller untouched.
 */
export async function insertWithMasterRef<T = { id: string; name?: string | null } & Record<string, unknown>>(
  supabase: SupabaseClient,
  table: MasterRefTable,
  tenantId: string,
  record: Record<string, unknown>,
  select: string
): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  for (let attempt = 0; ; attempt++) {
    const ref = await generateNextMasterRef(supabase, table, tenantId);
    const { data, error } = await supabase.from(table).insert({ ...record, ref }).select(select).single();
    if (!error || attempt >= 2 || !isMasterRefCollision(error)) {
      return { data: (data as T | null) ?? null, error };
    }
  }
}
