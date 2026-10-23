import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { contextForAccount, pickOrderType } from "./rules";
import { loadTypes, pending, shapeType } from "./server";
import type { OrderSourceType, SalesOrderType } from "./types";

export type TypeChoice =
  | { ok: true; type: SalesOrderType; via: "chosen" | "rule" | "default" | "first" | "created" }
  | { ok: false; status: number; error: string; needsUpdate?: boolean };

/**
 * The order type a new order gets. A type id from the request must be an active type of this tenant (404
 * otherwise, never silently ignored); without one the rules pick, then the default type. A workspace that has
 * no types at all (the module was just switched on) gets a default "Standard order" type made for it, so the
 * first order never dead-ends on a settings screen.
 */
export async function chooseOrderType(
  db: SupabaseClient,
  tenantId: string,
  opts: { typeId?: string | null; account?: { type?: string | null; state?: string | null; country?: string | null; custom_data?: Record<string, unknown> | null } | null; sourceType: OrderSourceType },
): Promise<TypeChoice> {
  const { types, pending: missing } = await loadTypes(db, tenantId);
  if (missing) return { ok: false, status: 503, error: "A database update is needed before Sales Orders can be used.", needsUpdate: true };

  if (opts.typeId) {
    const t = types.find((x) => x.id === opts.typeId);
    if (!t) return { ok: false, status: 404, error: "Order type not found" };
    if (!t.active) return { ok: false, status: 422, error: "That order type is switched off" };
    return { ok: true, type: t, via: "chosen" };
  }

  const picked = pickOrderType(types, contextForAccount(opts.account ?? null, opts.sourceType));
  if (picked) return { ok: true, type: picked.type, via: picked.via };

  if (types.length > 0) return { ok: false, status: 422, error: "Every order type is switched off. Switch one on in Settings." };

  const admin = createAdminSupabase() as unknown as SupabaseClient;
  const { data, error } = await admin
    .from("sales_order_types")
    .insert({ tenant_id: tenantId, name: "Standard order", prefix: "SO", pricing_mode: "internal", template: {}, rules: [], is_default: types.length === 0, active: true, sort_order: 0 })
    .select("*")
    .single();
  if (error || !data) {
    if (pending(error)) return { ok: false, status: 503, error: "A database update is needed before Sales Orders can be used.", needsUpdate: true };
    // Another request made it first (unique name): read it back.
    const again = await loadTypes(db, tenantId, { activeOnly: true });
    if (again.types[0]) return { ok: true, type: again.types[0], via: "first" };
    return { ok: false, status: 500, error: error?.message ?? "Could not create the default order type" };
  }
  return { ok: true, type: shapeType(data as Record<string, unknown>), via: "created" };
}
