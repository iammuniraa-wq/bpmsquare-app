import { NextResponse } from "next/server";
import { guard } from "../_guard";
import { connectionList } from "@/lib/middleware/ops";

// GET -- the ERP connections of this workspace:
// { connections: [{ id: "dynamics365", label, kind: "erp", state: { config, secrets, status, last_error } }] }
// `secrets` says only WHICH secrets are stored (booleans); a secret value is never returned.
export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;
  return NextResponse.json({ connections: await connectionList(g.ctx.admin, g.ctx.tenantId) });
}
