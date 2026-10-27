import { NextResponse, type NextRequest } from "next/server";
import { epromisGuard } from "@/lib/connectors/epromis/guard";
import { disconnectEpromis, EpromisSaveError, loadEpromis, publicState, saveEpromisConnection, type EpromisSaveBody } from "@/lib/connectors/epromis/server";

// The ePROMIS connection of this workspace. Admin only, in a workspace with the tender module (epromisGuard).
//   GET    -> { config, secret_stored: boolean, status: "connected"|"error"|"not_connected", last_error }
//   PUT    { config: { base_url, auth_type, key_header?, username?, company_name?, company_value?, company_in?, endpoints? },
//            secrets?: { secret? } }
//          The credential is WRITE-ONLY: blank or missing = unchanged (unless the address or sign-in type changed, which
//          needs it again), never cleared, never returned. Bad input is 422 with the problem in words.
//   DELETE -> disconnect.
// Test: POST /api/connectors/epromis/test. There is deliberately no POST here: the generic /api/connectors/[id] route
// must not be able to create an ePROMIS row with no configuration.

export async function GET() {
  const g = await epromisGuard();
  if (!g.ok) return g.res;
  return NextResponse.json(publicState(await loadEpromis(g.ctx.admin, g.ctx.tenantId)));
}

export async function PUT(req: NextRequest) {
  const g = await epromisGuard();
  if (!g.ok) return g.res;
  const body = (await req.json().catch(() => null)) as EpromisSaveBody | null;
  try {
    return NextResponse.json(await saveEpromisConnection(g.ctx.admin, g.ctx.tenantId, g.ctx.userId, body));
  } catch (e) {
    if (e instanceof EpromisSaveError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Could not save the connection." }, { status: 500 });
  }
}

export async function DELETE() {
  const g = await epromisGuard();
  if (!g.ok) return g.res;
  await disconnectEpromis(g.ctx.admin, g.ctx.tenantId);
  return NextResponse.json({ ok: true });
}
