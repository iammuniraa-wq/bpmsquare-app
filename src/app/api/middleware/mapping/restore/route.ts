import { NextResponse } from "next/server";
import { guard, jsonBody } from "../../_guard";
import { restoreEngine } from "@/lib/middleware/mapping/engineOps";

// POST { connection, document, version } -- bring a previous version back as a new version (nothing is edited in place).
// -> the mapping, as GET /api/middleware/mapping returns it.
export async function POST(req: Request) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await restoreEngine(g.ctx, await jsonBody(req));
  return NextResponse.json(o.body, { status: o.status });
}
