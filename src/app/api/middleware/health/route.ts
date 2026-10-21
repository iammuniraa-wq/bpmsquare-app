import { NextResponse } from "next/server";
import { guard } from "../_guard";
import { health } from "@/lib/middleware/ops";

// GET -- the Connections tab in one call:
// { connection: { connected, state, last_error, product, price_list_chosen, currency_chosen },
//   secret: { state: unknown|ok|soon|expired, expires_on, days_left },   (warns 30 days before)
//   schema: [{ table, label, exists, bundle }],   (bundle names the SQL file to run when a table is missing)
//   needsDatabaseUpdate, bundles }
export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;
  return NextResponse.json(await health(g.ctx.admin, g.ctx.tenantId));
}
