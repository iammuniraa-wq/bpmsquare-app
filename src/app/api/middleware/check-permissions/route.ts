import { NextResponse } from "next/server";
import { guard, fail } from "../_guard";
import { checkPermissions } from "@/lib/middleware/ops";

// POST -- what the connected app user can and cannot do. Read probes (customers, contacts,
// products, price lists, quotes / projects) plus a look-up of the create / close privileges.
// Creates nothing. A check that cannot be made from here has ok:null and says to use the test quote.
// -> { checks: [{ id, label, ok: true|false|null, fix: string|null }] }
export const maxDuration = 60;

export async function POST() {
  const g = await guard();
  if (!g.ok) return g.res;
  const r = await checkPermissions(g.ctx.admin, g.ctx.tenantId);
  if ("error" in r) return fail(r.status, r.error);
  return NextResponse.json(r);
}
