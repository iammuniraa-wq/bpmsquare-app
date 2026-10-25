import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_NAMES, orgKey, type OrgNames } from "./erpOrgPure";

// The names behind the keys of an org list: every segment and sales order type of THIS workspace, read with the tenant filter.
// A table that is not there (the coverage or sales order module was never set up) reads as no names, never an error.

export type OrgOption = { key: string; label: string; group: "Coverage" | "Order type" };
export type OrgDirectory = { names: OrgNames; options: OrgOption[] };

type SegRow = { id: string; name: string | null; code: string | null };
type TypeRow = { id: string; name: string | null; active: boolean | null };

export async function loadOrgDirectory(admin: SupabaseClient, tenantId: string): Promise<OrgDirectory> {
  const [seg, types] = await Promise.all([
    admin.from("segments").select("id, name, code").eq("tenant_id", tenantId).order("name"),
    admin.from("sales_order_types").select("id, name, active").eq("tenant_id", tenantId).order("sort_order"),
  ]);
  const names: OrgNames = { segment: { ...EMPTY_NAMES.segment }, order_type: { ...EMPTY_NAMES.order_type } };
  const options: OrgOption[] = [];
  if (!seg.error) {
    for (const r of (seg.data ?? []) as SegRow[]) {
      const name = (r.name ?? r.code ?? "").trim();
      if (!name) continue;
      names.segment[r.id.toLowerCase()] = name;
      options.push({ key: orgKey("segment", r.id), label: name, group: "Coverage" });
    }
  }
  if (!types.error) {
    for (const r of (types.data ?? []) as TypeRow[]) {
      const name = (r.name ?? "").trim();
      if (!name) continue;
      names.order_type[r.id.toLowerCase()] = name;
      if (r.active !== false) options.push({ key: orgKey("order_type", r.id), label: name, group: "Order type" });
    }
  }
  return { names, options };
}
