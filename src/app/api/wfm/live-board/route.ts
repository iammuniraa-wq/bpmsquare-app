import { NextResponse } from "next/server";
import { requireWfmSupervisor, getWfmLiveBoardSnapshot } from "@/lib/wfm/server";

// GET /api/wfm/live-board — today's attendance per employee: state,
// first-in/last-out, late and absent computation, geofence flags.
// Polled by the supervisor live board (~30 s). Shares its computation with
// the Analytics "today's attendance" / "night shift cost" metrics via
// getWfmLiveBoardSnapshot (lib/wfm/server.ts) so the two never drift.
export async function GET() {
  try {
    const { tenantId } = await requireWfmSupervisor();
    return NextResponse.json(await getWfmLiveBoardSnapshot(tenantId));
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
