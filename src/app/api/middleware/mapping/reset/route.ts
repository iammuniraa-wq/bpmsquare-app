import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail } from "../../_guard";
import { resetMappingOp } from "@/lib/middleware/mappingOps";

// POST { document: "quote" | "customers" | "contacts" | "products" | "projects" } -- "Reset to standard": the saved
// override is removed and the preset applies again. -> the mapping, as GET /api/middleware/mapping?document=... returns it.
export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const r = await resetMappingOp(g.ctx.admin, g.ctx.tenantId, await jsonBody(req));
  return r.ok ? NextResponse.json(r.view) : fail(r.status, r.error, r.errors ? { errors: r.errors } : {});
}
