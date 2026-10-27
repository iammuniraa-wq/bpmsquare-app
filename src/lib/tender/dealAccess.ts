import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { resolvePermissions, canViewWorkcenter, canEditWorkcenter } from "@/lib/permissions";
import { loadOpportunity } from "@/lib/sales/opportunityServer";
import { loadTender, type TenderRow } from "./server";

// The one door for the slice-4 routes (bid versions, calls, outcome): flags gcc_tender + pipeline, the caller's view (or edit, for a
// write) of the Pipeline workcenter, and a tender deal of THIS workspace. The flags are read BEFORE any table is touched, so a
// workspace without the edition costs no query. Any miss on the workspace or the deal is the same 404; the workspace always comes
// from the session, never from the request.

export type TenderDealRequest = {
  admin: SupabaseClient;
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  opp: NonNullable<Awaited<ReturnType<typeof loadOpportunity>>>;
  tender: TenderRow;
};
export type Failure = { status: number; error: string };

export async function openTenderDealRequest(opportunityId: string, write: boolean): Promise<{ ok: true; req: TenderDealRequest } | ({ ok: false } & Failure)> {
  let ctx;
  try {
    ctx = await requireTenantUser();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return { ok: false, status: err.status ?? 401, error: err.message ?? "Unauthorized" };
  }
  const { supabase, tenantId, userId, role } = ctx;
  const notFound = { ok: false as const, status: 404, error: "Not found" };
  for (const key of ["gcc_tender", "pipeline"] as const) {
    if (!(await tenantHasFeature(supabase, tenantId, key))) return notFound;
  }
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "pipeline")) return notFound;
  if (!/^[0-9a-f-]{36}$/i.test(opportunityId)) return notFound;
  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, opportunityId);
  const tender = opp ? await loadTender(admin, tenantId, opportunityId) : null;
  if (!opp || !tender) return notFound;
  if (write && !canEditWorkcenter(perms, "pipeline")) return { ok: false, status: 403, error: "You can view this deal but not change it" };
  return { ok: true, req: { admin, supabase, tenantId, userId, role, opp, tender } };
}

export const PENDING_BIDS = "Bid versions, calls and outcome facts need a database update (migration 0225). Ask your administrator to apply it.";
