import { NextResponse } from "next/server";
import { moduleAccess, moduleErrorResponse, pendingMessage } from "@/lib/marketing/moduleAccess";
import { runTenant } from "@/lib/marketing/attribution/runner";
import { ATTRIBUTION_SPEC } from "@/lib/marketing/attribution/server";

export const maxDuration = 60;

// POST /api/attribution/recompute -- admin only. Runs the very same function the cron runs, for THIS workspace
// (the tenant is the signed-in one, never a field of the request), inside a 40 second budget. Idempotent, and it
// changes nothing but the attribution tables.

export async function POST() {
  try {
    const ctx = await moduleAccess(ATTRIBUTION_SPEC, "edit");
    if (ctx.role !== "admin") return NextResponse.json({ error: "Only an admin can refresh the figures." }, { status: 403 });
    const r = await runTenant(ctx.admin, ctx.tenantId, { deadline: Date.now() + 40_000 });
    if (r.status === "pending_migration") return NextResponse.json({ error: pendingMessage(ATTRIBUTION_SPEC), pending_migration: true }, { status: 503 });
    if (r.status === "locked") return NextResponse.json({ error: "The figures are being refreshed already. Try again in a minute." }, { status: 409 });
    return NextResponse.json({ ok: true, events_read: r.read, touches: r.touches, rows: r.resultRows, errors: r.errors });
  } catch (e) {
    return moduleErrorResponse(ATTRIBUTION_SPEC, e);
  }
}
