import { NextResponse } from "next/server";
import { guard } from "../_guard";
import { health } from "@/lib/middleware/ops";

// GET -- only what needs attention:
// { problems: [{ kind: "database" | "connection" | "secret", message, bundle? }],   (empty when all is fine; `bundle` names the SQL file)
//   secretSoon?: { days },                                                         (only when the client secret expires within 30 days)
//   connection: { connected, product } }
export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;
  return NextResponse.json(await health(g.ctx.admin, g.ctx.tenantId));
}
