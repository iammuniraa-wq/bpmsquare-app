import { NextResponse } from "next/server";
import { guard } from "../_guard";
import { getDocuments } from "@/lib/middleware/ops";

// GET -- the outbound documents (today one: the Quote, source Standard Quote) as the "Links" tab reads them:
// { documents: [{ key:"quote", label, source:"standard_quote", enabled, summary ("Awarded → Dynamics 365 Sales Order"),
//     target:{key,label}, targets:[{key,label,available,hint,verified}],
//     include:[{key,label,on,allowed,hint}],          (hint = three words; `on` already accounts for what the target allows)
//     fallbackPriceListId, showFallbackPriceList,      (a Dynamics Quote or Sales Order only; used when the customer has none)
//     confirmed, confirmedAt }] }
// A quote goes to the ERP only when it is awarded; there are no per-outcome ticks and no automatic / manual choice.
export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;
  return NextResponse.json(await getDocuments(g.ctx.admin, g.ctx.tenantId));
}
