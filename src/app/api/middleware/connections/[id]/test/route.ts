import { NextResponse } from "next/server";
import { guard, fail } from "../../../_guard";
import { CONNECTOR_ID } from "@/lib/connectors/d365/server";
import { testConnectionOp } from "@/lib/middleware/ops";

// POST -- Test connection: a real, authenticated call against the ERP.
// -> { ok: true, message }  or 400 { error }   (the connection's status is updated either way)
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  if ((await params).id !== CONNECTOR_ID) return fail(404, "Connection not found.");
  const r = await testConnectionOp(g.ctx.admin, g.ctx.tenantId);
  return r.ok ? NextResponse.json(r) : fail(r.status, r.error);
}
