import { NextResponse } from "next/server";
import { guard, needsUpdate } from "../_guard";
import { sendTestQuote } from "@/lib/middleware/dispatch";

// POST -- "Send a test quote". Builds a clearly named sample (ref starts with ZZ-TEST) for the
// connected product, sends it through the real path, and answers with its readable number and
// an Open link. The sample is never deleted by the product.
// -> { ok:true, ref, number, link, messageId }  or  { ok:false, headline, fix }
export const maxDuration = 120;

export async function POST() {
  const g = await guard();
  if (!g.ok) return g.res;
  const r = await sendTestQuote(g.ctx.admin, g.ctx.tenantId, g.ctx.userId);
  if (!r.ok && /database update/i.test(r.headline)) return needsUpdate();
  return NextResponse.json(r, { status: r.ok ? 200 : 422 });
}
