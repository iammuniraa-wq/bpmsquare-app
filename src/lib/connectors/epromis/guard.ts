import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

// Every /api/connectors/epromis route starts here: a signed-in ADMIN of this host's workspace, in a workspace that has the
// tender module (the module ePROMIS belongs to). The tenant comes from the session only -- never from the request. A
// workspace without the module gets 404, so the connector does not announce itself; a member gets 403.

export type EpromisCtx = { admin: SupabaseClient; tenantId: string; userId: string };

export async function epromisGuard(): Promise<{ ok: true; ctx: EpromisCtx } | { ok: false; res: NextResponse }> {
  let a: Awaited<ReturnType<typeof requireTenantUser>>;
  try {
    a = await requireTenantUser();
  } catch (e) {
    const x = e as { status?: number; message?: string };
    return { ok: false, res: NextResponse.json({ error: x.message ?? "Unauthorized" }, { status: x.status ?? 401 }) };
  }
  if (a.role !== "admin") return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const admin = createAdminSupabase();
  if (!(await tenantHasFeature(admin, a.tenantId, "gcc_tender"))) return { ok: false, res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { ok: true, ctx: { admin, tenantId: a.tenantId, userId: a.userId } };
}
