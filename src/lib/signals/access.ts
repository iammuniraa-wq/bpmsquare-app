import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter, canEditWorkcenter } from "@/lib/permissions";
import type { TenantFeatures } from "@/lib/constants";
import { signalsEnabled } from "./flag";

// How tenant isolation holds for Buying signals (MULTI_TENANT_GUARDRAILS.md):
//  - every route starts here: requireTenantUser(), and the tenantId used after
//    that is only the one it returns, never a body or query field;
//  - the module needs BOTH `marketing` and the platform-admin flag
//    `buying_signals`; otherwise every route answers 404, as if it did not exist;
//  - all four tables are select-only for members (0175-0178), so every write is
//    on the service-role client, which bypasses RLS -- so every query on it chains
//    .eq("tenant_id", tenantId), and every account id a request carries is
//    re-verified against the tenant before it is used.

export const PENDING_MESSAGE = "Buying signals is waiting for a database update (migrations 0175 to 0178 have not been applied to this database).";

export { signalsEnabled };

export type SignalsCtx = {
  /** The session client: RLS applies. */
  supabase: SupabaseClient;
  /** The service-role client: bypasses RLS. Every query chains tenant_id. */
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  email: string | null;
  isDemo: boolean;
  can: { view: boolean; edit: boolean };
};

export async function signalsAccess(action: "view" | "edit" | "admin"): Promise<SignalsCtx> {
  const a = await requireTenantUser();
  const admin = createAdminSupabase();
  const [user, tenant] = await Promise.all([
    getAuthUser(),
    admin.from("tenants").select("is_demo, features").eq("id", a.tenantId).maybeSingle(),
  ]);
  if (!signalsEnabled(tenant.data?.features as Partial<TenantFeatures> | undefined)) throw { status: 404, message: "Not found" };
  const perms = await resolvePermissions(a.supabase, a.tenantId, a.userId, a.role);
  const can = { view: canViewWorkcenter(perms, "signals"), edit: canEditWorkcenter(perms, "signals") };
  if (action === "view" && !can.view) throw { status: 403, message: "Forbidden" };
  if (action === "edit" && !can.edit) throw { status: 403, message: "Forbidden" };
  if (action === "admin" && (a.role !== "admin" || !can.edit)) throw { status: 403, message: "Only an admin can do this" };
  return { ...a, admin, email: user?.email ?? null, isDemo: tenant.data?.is_demo === true, can };
}

export function errorResponse(e: unknown): Response {
  const err = e as { status?: number; message?: string };
  if (typeof err.status !== "number") console.error("buying signals route failed:", e);
  return Response.json({ error: typeof err.status === "number" ? (err.message ?? "Unexpected error") : "Unexpected error" }, { status: err.status ?? 500 });
}

export const pendingResponse = (): Response => Response.json({ error: PENDING_MESSAGE, pending_migration: true }, { status: 503 });

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
