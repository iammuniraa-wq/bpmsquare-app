import { NextResponse } from "next/server";
import { guard } from "../_guard";
import { wantsSap } from "@/lib/middleware/connectorParam";
import { getDocuments } from "@/lib/middleware/ops";

// GET -- the outbound documents (today one: the Quote, source Standard Quote) as the "Links" tab reads them:
// { documents: [{ key:"quote", label, source:"standard_quote", enabled, summary ("Awarded → Dynamics 365 Sales Order"),
//     target:{key,label}, targets:[{key,label,available,hint,verified}],
//     include:[{key,label,on,allowed,hint}],          (hint = three words; `on` already accounts for what the target allows)
//     fallbackPriceListId, showFallbackPriceList,      (a Dynamics Quote or Sales Order only; used when the customer has none)
//     confirmed, confirmedAt }] }
// A quote goes to the ERP only when it is awarded; there are no per-outcome ticks and no automatic / manual choice.
// SAP S/4HANA (?connector=sap_s4) sends nothing yet: no documents, so the Links tab shows only what comes in.
export async function GET(req: Request) {
  const g = await guard();
  if (!g.ok) return g.res;
  if (wantsSap(req)) return NextResponse.json({ documents: [], webhooks: [] });
  return NextResponse.json(await getDocuments(g.ctx.admin, g.ctx.tenantId));
}
