import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail } from "../_guard";
import { previewQuoteOutcome } from "@/lib/middleware/dispatch";
import { OUTCOMES, type Outcome } from "@/lib/middleware/types";

// POST { quote_id, outcome? } -- what would be sent for this quote. Nothing is sent or recorded.
// -> { ok:true, words: string[]   (read first: customer, lines, total, what is included / not sent),
//      body: object | null        (the exact raw body, behind a toggle; it holds no secrets),
//      extras: { tasks, bom, costs }, included: string[], refused: [{ part, hint }],
//      problems: [{ code, message, fix }]  (what would stop it: customer not synced, no price list ...),
//      target: "quote" | "project", outcome, nothingToSend: string | null }
export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const body = await jsonBody<{ quote_id?: string; outcome?: string }>(req);
  const id = String(body.quote_id ?? "");
  if (!/^[0-9a-f-]{32,40}$/i.test(id)) return fail(422, "Choose a quote to preview.");
  if (body.outcome !== undefined && !(OUTCOMES as readonly string[]).includes(body.outcome)) return fail(422, "outcome must be awarded or rejected.");
  const r = await previewQuoteOutcome(g.ctx.admin, g.ctx.tenantId, id, { outcome: body.outcome as Outcome | undefined });
  if (!r.ok) return fail(r.state === "not_found" ? 404 : r.state === "not_connected" ? 400 : 409, r.message, { state: r.state });
  return NextResponse.json(r);
}
