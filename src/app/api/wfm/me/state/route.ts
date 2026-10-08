import { NextResponse } from "next/server";
import { requireWfm } from "@/lib/wfm/server";
import { buildWfmMeState } from "@/lib/wfm/meState";


// Capped per route, not via vercel.json. That config carried
// "src/app/api/wfm/**": { maxDuration: 60 } from 2026-10-03 and it never
// took effect -- on 2026-10-07 these routes still ran the full 300s during a
// Supabase connectivity blip, while /api/wfm/summary, the one route with this
// export, stopped at 60. The glob matches directories, not source files. A
// hung request holds a Fluid instance other requests are sharing, so this
// bounds the blast radius as much as the bill.
export const maxDuration = 60;

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
