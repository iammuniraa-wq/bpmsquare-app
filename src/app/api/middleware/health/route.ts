import { NextResponse } from "next/server";
import { guard } from "../_guard";
import { wantsSap } from "@/lib/middleware/connectorParam";
import { health } from "@/lib/middleware/ops";
import { sapHealth } from "@/lib/connectors/sap_s4/server";

// GET -- only what needs attention:
// { problems: [{ kind: "database" | "connection" | "secret", message, bundle? }],   (empty when all is fine; `bundle` names the SQL file)
//   secretSoon?: { days },                                                         (only when the client secret expires within 30 days)
//   connection: { connected, product } }
export async function GET(req: Request) {
  const g = await guard();
  if (!g.ok) return g.res;
  if (wantsSap(req)) return NextResponse.json(await sapHealth(g.ctx.admin, g.ctx.tenantId));
  return NextResponse.json(await health(g.ctx.admin, g.ctx.tenantId));
}
