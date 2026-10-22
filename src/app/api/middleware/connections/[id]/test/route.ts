import { NextResponse } from "next/server";
import { guard, fail } from "../../../_guard";
import { CONNECTOR_ID } from "@/lib/connectors/d365/server";
import { connectionCheck } from "@/lib/middleware/ops";
import { testSap } from "@/lib/connectors/sap_s4/server";
import { SAP_CONNECTOR_ID } from "@/lib/connectors/sap_s4/types";

// POST -- Test: a real, authenticated call against the ERP AND the permission probes, as ONE answer.
// -> { ok, line, failures: [{ label, fix }] }   (line = one plain sentence; failures = only what failed, for the Details toggle)
// The connection's status is updated either way. A refused connection answers 400 with the same body plus `error`; the older
// `message` is kept on success. POST /api/middleware/check-permissions still works on its own.
// SAP S/4HANA: one read per scenario (business partners, products) and the field list; a missing scenario is named.
export const maxDuration = 90;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const id = (await params).id;
  if (id === SAP_CONNECTOR_ID) {
    const { status, ...body } = await testSap(g.ctx.admin, g.ctx.tenantId);
    return NextResponse.json(body, { status: body.error ? status : 200 });
  }
  if (id !== CONNECTOR_ID) return fail(404, "Connection not found.");
  const { status, ...body } = await connectionCheck(g.ctx.admin, g.ctx.tenantId);
  return NextResponse.json(body, { status: body.error ? status : 200 });
}
