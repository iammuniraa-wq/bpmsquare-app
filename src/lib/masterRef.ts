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
 * DB once per row. */
export async function nextMasterRefSeq(supabase: SupabaseClient, table: MasterRefTable, tenantId: string): Promise<number> {
  const { data } = await supabase
    .from(table)
    .select("ref")
    .eq("tenant_id", tenantId)
    .like("ref", `${PREFIX[table]}-%`);
  return nextSeqFromRefs((data ?? []).map((r: { ref: string | null }) => r.ref), new RegExp(`^${PREFIX[table]}-(\\d+)$`));
}

/** A ready-to-insert ref for a single create -- probes for the first free
 * candidate so a deleted record's number isn't blindly reissued to a
 * different concurrent insert. The partial unique index on (tenant_id, ref)
 * is the real backstop; callers retry once on 23505. */
export async function generateNextMasterRef(supabase: SupabaseClient, table: MasterRefTable, tenantId: string): Promise<string> {
  const start = await nextMasterRefSeq(supabase, table, tenantId);
  return firstFreeRef(supabase, table, tenantId, (seq) => formatMasterRef(table, seq), start);
}
