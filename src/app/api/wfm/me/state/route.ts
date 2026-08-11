import { NextResponse } from "next/server";
import { requireWfm } from "@/lib/wfm/server";
import { buildWfmMeState } from "@/lib/wfm/meState";

// GET /api/wfm/me/state — the punch screen's bootstrap: who am I, current
// punch state, today's events and running total, consent status. The
// payload itself is built by buildWfmMeState (lib/wfm/meState.ts), shared
// with the /wfm/me page's server render; this route is the refresh path.
export async function GET() {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json(await buildWfmMeState(ctx));
}
