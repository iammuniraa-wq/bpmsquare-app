import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBoqRowsForApi, type BoqApiOpts, type BoqApiSource } from "@/lib/tender/boq/apiRows";
import { buildWbsApi, type WbsApiAnswer } from "./apiShape";
import { ownerNames } from "./read";

// The tender's WBS for the v1 API, the MCP tool and the Data Workbench export: the tree with each item's roll-up and its parts, built from
// the SAME customer-safe BOQ rows the BOQ endpoint returns (apiRows.ts), so a cost can never get in by a second route. Tenant- and deal-scoped
// through those loaders. While migration 0243 is pending the answer is empty and says so.

export type WbsForApi = WbsApiAnswer & { pending: boolean; source: BoqApiSource | null };

export async function loadWbsForApi(admin: SupabaseClient, tenantId: string, opportunityId: string, opts: BoqApiOpts = {}): Promise<WbsForApi> {
  const { source, rows, wbs } = await loadBoqRowsForApi(admin, tenantId, opportunityId, opts);
  if (wbs.pending) return { pending: true, source, items: [], ownerIds: new Map(), total: { line_count: 0, shared_count: 0, client_amount: 0 }, unassigned: { lines: 0, client_amount: 0 } };
  const names = await ownerNames(admin, tenantId, wbs.items);
  return { pending: false, source, ...buildWbsApi(opportunityId, wbs.items, names, rows, wbs.members) };
}
