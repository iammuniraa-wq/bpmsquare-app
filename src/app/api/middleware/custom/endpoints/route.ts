import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody } from "../../_guard";
import { createEndpoints, listEndpoints } from "@/lib/connections/endpointOps";

// The endpoints of one connection (it starts with none). Admin of the workspace; the connection id is resolved with the session's
// tenant before anything is read or inserted, so another workspace's id is a 404.
//   GET  ?connection_id=<uuid> -> { endpoints: PublicEndpoint[] }
//   POST { connection_id, items: [{ name, method?, path, direction: "in"|"out", object_type, run_mode?, schedule?, enabled?, origin?, template_key? }] }
//        -> { endpoints, created, skipped }   (1 to 50 items; all or nothing; picked rows already on the connection are skipped)
export async function GET(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await listEndpoints(g.ctx, req.nextUrl.searchParams.get("connection_id") ?? "");
  return NextResponse.json(o.body, { status: o.status });
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await createEndpoints(g.ctx, await jsonBody(req));
  return NextResponse.json(o.body, { status: o.status });
}
