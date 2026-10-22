import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail } from "../../_guard";
import { resetMappingOp } from "@/lib/middleware/mappingOps";
import { resetEngine } from "@/lib/middleware/mapping/engineOps";
import { wantsSap } from "@/lib/middleware/connectorParam";
import { resetSapMapping } from "@/lib/connectors/sap_s4/server";

// POST { document: "quote" | "customers" | "contacts" | "products" | "projects", connection? } -- "Reset to standard": the saved
// override is removed and the preset applies again. -> the mapping, as GET /api/middleware/mapping?document=... returns it.
// On Dynamics 365 this clears both the older per-section override (connector config) and every saved version of the engine mapping,
// so the preset lane runs exactly as it did before any mapping was saved.
export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  if (wantsSap(req)) {
    const s = await resetSapMapping(g.ctx.admin, g.ctx.tenantId, await jsonBody(req));
    return s.ok ? NextResponse.json(s.view) : fail(s.status, s.error, s.errors ? { errors: s.errors } : {});
  }
  const body = await jsonBody(req);
  const adapter = body.connection === undefined || body.connection === null || body.connection === "" || body.connection === "dynamics365";
  if (adapter) {
    const legacy = await resetMappingOp(g.ctx.admin, g.ctx.tenantId, body);
    if (!legacy.ok) return fail(legacy.status, legacy.error, legacy.errors ? { errors: legacy.errors } : {});
    const e = await resetEngine(g.ctx, body);
    // The engine tables are not there yet: the preset was reset, which is all there is to reset.
    if (e.body.needsDatabaseUpdate) return NextResponse.json({ ...legacy.view, ...e.body });
    return NextResponse.json(e.body, { status: e.status });
  }
  const e = await resetEngine(g.ctx, body);
  return NextResponse.json(e.body, { status: e.status });
}
