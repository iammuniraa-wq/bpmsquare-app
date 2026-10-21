import { NextResponse } from "next/server";
import { guard, fail } from "../_guard";
import { listPriceLists } from "@/lib/middleware/ops";

// GET -- the ERP's active price lists, read live, so nobody types a GUID.
// -> { applicable, items: [{ id, name, code }], hint? }   (applicable=false for F&O / Business Central)
// Choose one by saving its `id` as config.price_list_id through PUT /api/middleware/connections/dynamics365.
export const maxDuration = 60;

export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;
  const r = await listPriceLists(g.ctx.admin, g.ctx.tenantId);
  if ("error" in r) return fail(r.status, r.error);
  return NextResponse.json(r);
}
