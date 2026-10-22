import { NextResponse } from "next/server";
import { guard } from "../_guard";
import { connectionList } from "@/lib/middleware/ops";
import { loadSap, publicState as sapPublicState } from "@/lib/connectors/sap_s4/server";
import { SAP_CONNECTOR_ID, SAP_NAME } from "@/lib/connectors/sap_s4/types";

// GET -- the ERP connections of this workspace:
// { connections: [{ id: "dynamics365" | "sap_s4", label, kind: "erp", state: { config, secrets, status, last_error } }] }
// `secrets` says only WHICH secrets are stored (booleans); a secret value is never returned.
export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;
  const sap = { id: SAP_CONNECTOR_ID, label: SAP_NAME, kind: "erp" as const, state: sapPublicState(await loadSap(g.ctx.admin, g.ctx.tenantId)) };
  return NextResponse.json({ connections: [...(await connectionList(g.ctx.admin, g.ctx.tenantId)), sap] });
}
