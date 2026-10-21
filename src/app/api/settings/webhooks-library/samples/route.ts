import { NextResponse, type NextRequest } from "next/server";
import { guard, fail, objectOf } from "../_guard";
import { listSamples } from "@/lib/webhooks/loaders";

// GET ?object_type=accounts|standard_quotes -> { records: [{ id, label }] }  (the 10 newest of THIS workspace, for the Test tab)
export async function GET(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = objectOf(req.nextUrl.searchParams.get("object_type"));
  if (!o) return fail(422, "Choose an object: accounts or standard_quotes.");
  return NextResponse.json({ records: await listSamples(g.ctx.admin, g.ctx.tenantId, o) });
}
