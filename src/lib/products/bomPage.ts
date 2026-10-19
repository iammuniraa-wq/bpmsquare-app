import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig } from "@/lib/constants";
import { itemTypeLabel } from "@/lib/products/itemTypes";
import { loadBomGraph, rollUpFor, whereUsed } from "@/lib/products/bomServer";
import { buildBomRows } from "@/lib/products/bomView";

/** Everything the Components tab and the "Used in" list draw, loaded in one place. */
export async function loadBomPageData(
  supabase: SupabaseClient,
  tenantId: string,
  productId: string,
  config: Pick<TenantConfig, "item_types"> | null | undefined,
  isKit: boolean
) {
  const label = (key: string | null | undefined) => itemTypeLabel(config, key);
  const used = (await whereUsed(supabase, tenantId, productId)).map((u) => ({ ...u, parentTypeLabel: label(u.parent.item_type) }));
  if (!isKit) return { used, rows: [], summary: null };

  const graph = await loadBomGraph(supabase, tenantId, productId);
  const rollup = rollUpFor(graph, productId);
  const rows = buildBomRows(graph.getLines(productId), rollup, label);
  return {
    used,
    rows,
    summary: {
      total: rollup.total,
      incomplete: rollup.incomplete,
      missing: rollup.missing,
      hasLoop: rollup.errors.length > 0,
      asOf: rollup.asOf,
      undated: rollup.undated,
      lineCount: rows.length,
    },
  };
}
