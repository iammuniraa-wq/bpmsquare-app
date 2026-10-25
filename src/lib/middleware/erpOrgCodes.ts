import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ORG_KIND_LABEL, isOrgKind, orgKindsFor, parseOrgKey, type ErpOrgChip } from "./erpOrgPure";
import { listAll } from "./mapping/valueListStore";

// What the Coverage and Order types settings screens show as a small read-only chip: the ERP code the Mapping tab holds for each
// coverage (segment) and order type. Nothing is edited from there; the chip links to the one place that does.

export type ErpOrgCodes = Record<string, ErpOrgChip[]>;

const CONNECTIONS = ["sap_s4", "dynamics365"] as const;

export async function loadErpOrgCodes(admin: SupabaseClient, tenantId: string): Promise<ErpOrgCodes> {
  const out: ErpOrgCodes = {};
  for (const connection of CONNECTIONS) {
    const all = await listAll(admin, tenantId, connection);
    if (all.pending) continue;
    for (const list of all.lists) {
      if (!isOrgKind(list.kind) || !orgKindsFor(connection).includes(list.kind)) continue;
      for (const row of list.rows) {
        const key = row.bpm.toLowerCase();
        if (!row.erp.trim() || !parseOrgKey(key)) continue;
        (out[key] ??= []).push({ kind: list.kind, label: ORG_KIND_LABEL[list.kind], connection, code: row.erp.trim() });
      }
    }
  }
  return out;
}
