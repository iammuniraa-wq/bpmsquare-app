import { NextResponse } from "next/server";
import { guard, jsonBody } from "../../_guard";
import { proposeAiOp } from "@/lib/middleware/mapping/engineOps";

export const maxDuration = 60;

// POST { connection, document } -> { suggestions: [{ source, target, reason, convert, block }], usage: { percent, off } }
// For the rows the deterministic proposal left empty. Needs features.ai_assistant and a configured model; metered against the
// workspace's monthly allowance (HTTP 402 { error, code: "over_budget" } when it is spent). Only field names and types are sent,
// never a record. `convert` is the deterministic type gate's converter (null when none is needed), never the model's.
// Nothing is saved: each suggestion is accepted row by row in the tab.
export async function POST(req: Request) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await proposeAiOp(g.ctx, await jsonBody(req));
  return NextResponse.json(o.body, { status: o.status });
}
