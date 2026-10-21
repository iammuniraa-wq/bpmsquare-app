import { NextResponse } from "next/server";
import { guard, fail } from "../_guard";
import { listCurrencies } from "@/lib/middleware/ops";

// GET -- the ERP's active currencies, read live.
// -> { applicable, items: [{ id, name, code }], hint? }
// Choose one by saving its `id` as config.currency_id through PUT /api/middleware/connections/dynamics365.
export const maxDuration = 60;

export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;
  const r = await listCurrencies(g.ctx.admin, g.ctx.tenantId);
  if ("error" in r) return fail(r.status, r.error);
  return NextResponse.json(r);
}
