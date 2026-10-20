import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { canCreateWorkcenter, canDeleteWorkcenter, canEditWorkcenter, canViewWorkcenter, requireWorkcenterView, resolvePermissions } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { isSchemaPending } from "@/lib/marketing/pending";
import { journeysEnabled, loadTenantEnv, type TenantEnv } from "./env";

// The start of every journey route and page. How tenant isolation holds here
// (MULTI_TENANT_GUARDRAILS.md):
//   - every route begins with journeyAccess() -> requireTenantUser(); the tenantId
//     used afterwards is only the one that returns, never a body or query field;
//   - the workspace must own BOTH `marketing` and the platform-admin flag `journeys`,
//     otherwise the answer is 404, the same as a route that does not exist;
//   - journeys and run data are select-only for members (0165-0168), so writes use
//     the service-role client, and EVERY query on it chains .eq("tenant_id", tenantId);
//   - a foreign id in a body (a newsletter version, a contact to try) is loaded with
//     its own tenant filter before it is used.

export const PENDING_MESSAGE = "Journeys are waiting for a database update (migrations 0165 to 0169 have not been applied to this database).";

export type JourneyAction = "view" | "create" | "edit" | "delete";

export type JourneyCtx = {
  /** The session client: RLS applies. */
  supabase: SupabaseClient;
  /** The service-role client: bypasses RLS. Always with a tenant filter. */
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  env: TenantEnv;
  can: { view: boolean; create: boolean; edit: boolean; delete: boolean };
};

export async function journeyAccess(action: JourneyAction): Promise<JourneyCtx> {
  const a = await requireTenantUser();
  const admin = createAdminSupabase();
  const env = await loadTenantEnv(admin, a.tenantId);
  if (!env || !journeysEnabled(env.features)) throw { status: 404, message: "Not found" };
  const perms = await resolvePermissions(a.supabase, a.tenantId, a.userId, a.role);
  const can = {
    view: canViewWorkcenter(perms, "marketing_journeys"), create: canCreateWorkcenter(perms, "marketing_journeys"),
    edit: canEditWorkcenter(perms, "marketing_journeys"), delete: canDeleteWorkcenter(perms, "marketing_journeys"),
  };
  if (!can[action]) throw { status: 403, message: "Forbidden" };
  return { ...a, admin, env, can };
}

export function errorResponse(e: unknown): Response {
  const err = e as { status?: number; message?: string; code?: string; extra?: Record<string, unknown> };
  if (typeof err.status !== "number") {
    if (isSchemaPending(err)) return pendingResponse();
    console.error("journeys route failed:", e);
  }
  return Response.json({ error: typeof err.status === "number" ? (err.message ?? "Unexpected error") : "Unexpected error", ...(typeof err.status === "number" ? (err.extra ?? {}) : {}) }, { status: err.status ?? 500 });
}

export const pendingResponse = (): Response => Response.json({ error: PENDING_MESSAGE, pending_migration: true }, { status: 503 });

/** The start of every journey page: the workcenter, both flags, then the context. A workspace without journeys gets "not found". */
export async function journeyPage(action: JourneyAction = "view"): Promise<JourneyCtx> {
  await requireWorkcenterView("marketing_journeys");
  await requireFeature("marketing");
  await requireFeature("journeys");
  try {
    return await journeyAccess(action);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 404 || status === 403) notFound();
    throw e;
  }
}
