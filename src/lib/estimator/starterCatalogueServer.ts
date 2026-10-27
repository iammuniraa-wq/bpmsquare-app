import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatMasterRef, isMasterRefCollision, nextMasterRefSeq } from "@/lib/masterRef";
import { logChangeBatch } from "@/lib/changeLog";
import { productRowFor } from "./starterCatalogue";
import type { StarterCatalogueItem } from "./starterCatalogue";
import { isMissingRelation } from "./server";

// Adds the catalogue items a starter template prices from to THIS workspace's products (the same thing the seed does for a demo
// tenant). An item is added only when the workspace has no product with that SKU, so an item that was edited, deleted-and-renamed
// or repriced from a rate sheet is never overwritten. Every read and write carries the tenant id (MULTI_TENANT_GUARDRAILS.md);
// the session client is used, so the products RLS policy is the backstop.

export type InstallCatalogueResult = { added: number; kept: number; skipped: boolean };

const CHUNK = 100;

export async function installStarterCatalogue(
  supabase: SupabaseClient, tenantId: string, actor: { id: string; email: string | null }, items: readonly StarterCatalogueItem[],
): Promise<InstallCatalogueResult> {
  const wanted = [...new Map(items.map((i) => [i.sku, i])).values()];
  if (wanted.length === 0) return { added: 0, kept: 0, skipped: false };

  const have = new Set<string>();
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const { data, error } = await supabase.from("products").select("sku").eq("tenant_id", tenantId).in("sku", wanted.slice(i, i + CHUNK).map((w) => w.sku));
    if (error) {
      // No products table yet: the template is installed; its catalogue lines stay unresolved until it exists.
      if (isMissingRelation(error)) return { added: 0, kept: 0, skipped: true };
      throw { status: 500, message: error.message };
    }
    for (const r of (data ?? []) as { sku: string | null }[]) if (r.sku) have.add(r.sku);
  }
  const missing = wanted.filter((w) => !have.has(w.sku));
  if (missing.length === 0) return { added: 0, kept: wanted.length, skipped: false };

  let inserted: { id: string; name: string; sku: string | null; cost_price: number | null }[] = [];
  for (let attempt = 0; ; attempt++) {
    const start = await nextMasterRefSeq(supabase, "products", tenantId);
    const rows = missing.map((m, n) => ({ tenant_id: tenantId, ref: formatMasterRef("products", start + n), ...productRowFor(m) }));
    const { data, error } = await supabase.from("products").insert(rows).select("id, name, sku, cost_price");
    if (!error) { inserted = (data ?? []) as typeof inserted; break; }
    if (attempt >= 2 || !isMasterRefCollision(error)) throw { status: 500, message: error.message };
  }

  await logChangeBatch(supabase, inserted.map((p) => ({
    tenantId, objectType: "products", objectId: p.id, objectLabel: p.name, action: "create" as const, actorId: actor.id, actorEmail: actor.email,
    changes: [{ field: "sku", from: null, to: p.sku }, { field: "cost_price", from: null, to: p.cost_price }, { field: "added by", from: null, to: "starter template (illustrative cost)" }],
  })));
  return { added: inserted.length, kept: wanted.length - inserted.length, skipped: false };
}
