import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody } from "../../_guard";
import { create, list } from "@/lib/connections/ops";
import type { ConnectionInput } from "@/lib/connections/spec";

// Connections you add yourself (REST API, OData service). Admin of the workspace, integration_middleware flag on; the guard
// answers 401 / 403 / 404 before anything is read. The tenant is the session's.
//   GET  -> { connections: PublicConnection[] }  (never a secret: `secretsSet` says which are stored)
//          or { needsDatabaseUpdate: true, bundle } while the database update is pending.
//   POST { name, family: "rest"|"odata", config: { base_url, auth, ... }, secrets?: { api_key|password|token|client_secret } } -> { connection }
//          422 { error, errors: [{ field, message }] }.
export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await list(g.ctx);
  return NextResponse.json(o.body, { status: o.status });
}

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await create(g.ctx, await jsonBody<ConnectionInput>(req));
  return NextResponse.json(o.body, { status: o.status });
}
