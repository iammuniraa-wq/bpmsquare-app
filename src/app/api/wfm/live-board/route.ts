import { NextResponse } from "next/server";
import { requireWfmSupervisor, getWfmLiveBoardSnapshot } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";


// Capped per route, not via vercel.json. That config carried
// "src/app/api/wfm/**": { maxDuration: 60 } from 2026-10-03 and it never
// took effect -- on 2026-10-07 these routes still ran the full 300s during a
// Supabase connectivity blip, while /api/wfm/summary, the one route with this
// export, stopped at 60. The glob matches directories, not source files. A
// hung request holds a Fluid instance other requests are sharing, so this
// bounds the blast radius as much as the bill.
export const maxDuration = 60;

// GET /api/wfm/live-board — today's attendance per employee: state,
// first-in/last-out, late and absent computation, geofence flags.
// Polled by the supervisor live board (~30 s). Shares its computation with
// the Analytics "today's attendance" / "night shift cost" metrics via
// getWfmLiveBoardSnapshot (lib/wfm/server.ts) so the two never drift.
export async function GET() {
  try {
    const ctx = await requireWfmSupervisor();
    const scope = await resolveWfmScope(ctx);
    return NextResponse.json(
      await getWfmLiveBoardSnapshot(ctx.tenantId, scope.unrestricted ? null : scope.employeeIds)
    );
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
