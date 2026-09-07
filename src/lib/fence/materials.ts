// Server adapter over the pure materials contract in materialMatch.ts
// (Fence Configurator Phase C, docs/fence-configurator-architecture.md
// §7): fetches the tenant's tagged `products` catalog and hands it to the
// pure matcher. Split this way (matches src/lib/pricing/costSheet.ts's
// own pure/server split) so the pure matching logic can also run
// client-side in the fence-preview screen without pulling "server-only"
// into the browser bundle.

import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import { matchMaterials, type FenceCatalogRow, type FenceSelections, type MaterialRequest, type ResolvedMaterialLine } from "./materialMatch";

export type { FenceMaterialKind, MaterialRequest, ResolvedMaterialLine, FenceCatalogRow, FenceSelections } from "./materialMatch";
export { buildMaterialRequests } from "./materialMatch";

/** Every `products` row tagged `custom_data.fence_kind` for this tenant --
 *  the shared read behind resolveFenceMaterials (per-request) and the
 *  fence-preview page (fetched once, re-matched client-side on every
 *  slider change via matchMaterials, no round trip per keystroke).
 *  Degrades cleanly to [] on a pending migration (42P01), per §3b. */
export async function getFenceProductCatalog(tenantId: string): Promise<FenceCatalogRow[]> {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("products")
    .select("id, name, list_price, custom_data")
    .eq("tenant_id", tenantId)
    .not("custom_data->fence_kind", "is", null);
  if (error) return []; // 42P01 = products/0122 pending, or any other read failure -- empty, never a crash
  return (data ?? []) as FenceCatalogRow[];
}

/** Server adapter: resolves each request to a real products row tagged
 *  `custom_data.fence_kind` (+ `pipe_class`/`mesh_spec`/`coating` for the
 *  kinds that vary by them). Every read is tenant-scoped per
 *  MULTI_TENANT_GUARDRAILS. Unresolved requests come back with
 *  product_id: null -- Phase D must refuse to quote a project with any
 *  unresolved line, the one behaviour Fence Studio's tool never enforces. */
export async function resolveFenceMaterials(
  tenantId: string,
  requests: MaterialRequest[],
  selections: FenceSelections
): Promise<ResolvedMaterialLine[]> {
  const catalog = await getFenceProductCatalog(tenantId);
  return matchMaterials(requests, catalog, selections);
}
