import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody } from "../../../_guard";
import { discover } from "@/lib/connections/endpointOps";

// What the system says it offers. POST { connection_id, spec_path? } -> { source: "odata"|"openapi", items: [{ name, path, method, summary, object_type }] }.
// OData reads $metadata; a REST connection reads an OpenAPI description at `spec_path` (default /openapi.json) on its own server.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await discover(g.ctx, await jsonBody(req));
  return NextResponse.json(o.body, { status: o.status });
}
