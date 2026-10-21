import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody, fail, needsUpdate } from "../_guard";
import { dispatchQuoteOutcome } from "@/lib/middleware/dispatch";
import { describeDispatch } from "@/lib/middleware/ops";
import { OUTCOMES, type Outcome } from "@/lib/middleware/types";

// POST { quote_id, outcome? } -- "Send now" for one Standard Quote, whatever the rule's mode.
// The quote is looked up by id AND this workspace; a foreign id is a 404.
// `outcome` defaults to the quote's own status (accepted = awarded, rejected = rejected).
// -> { ok, message, number?, link? }  or  { ok:false, headline, fix }
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const body = await jsonBody<{ quote_id?: string; outcome?: string }>(req);
  const id = String(body.quote_id ?? "");
  if (!/^[0-9a-f-]{32,40}$/i.test(id)) return fail(422, "Choose a quote to send.");
  if (body.outcome !== undefined && !(OUTCOMES as readonly string[]).includes(body.outcome)) return fail(422, "outcome must be awarded or rejected.");
  const r = describeDispatch(await dispatchQuoteOutcome(g.ctx.admin, g.ctx.tenantId, id, { trigger: "send_now", userId: g.ctx.userId, outcome: body.outcome as Outcome | undefined }));
  if (!r.ok && r.needsDatabaseUpdate) return needsUpdate();
  return NextResponse.json(r, { status: r.ok ? 200 : r.status });
}
