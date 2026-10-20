import { NextResponse } from "next/server";
import { recomputeTenant } from "@/lib/signals/recompute";
import { errorResponse, pendingResponse, signalsAccess } from "@/lib/signals/access";

export const maxDuration = 60;

// POST /api/signals/rescore -- "Rescore now" (admin). Same recompute as the cron,
// for the caller's own tenant only: the tenant is the one requireTenantUser()
// returns, nothing in the body can name another.
export async function POST() {
  try {
    const ctx = await signalsAccess("admin");
    const r = await recomputeTenant(ctx.admin, ctx.tenantId, { source: "manual", deadline: Date.now() + 50_000 });
    if (r.error?.includes("not been applied")) return pendingResponse();
    return NextResponse.json({ ok: true, scored: r.scored, stage_changes: r.stageChanges, alerts: r.alerts, partial: r.partial });
  } catch (e) {
    return errorResponse(e);
  }
}
