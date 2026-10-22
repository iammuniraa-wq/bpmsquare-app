import { NextResponse } from "next/server";
import { guard, jsonBody } from "../../_guard";
import { proposeOp } from "@/lib/middleware/mapping/engineOps";

// POST { connection, document, mode: "fill" | "replace" } -> { rows: { header, lines }, lists: [proposed value list], missingRequired }
// The deterministic proposal (name, label, known pairs, type). Nothing is saved: the tab shows it and Save keeps what is shown.
export async function POST(req: Request) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await proposeOp(g.ctx, await jsonBody(req));
  return NextResponse.json(o.body, { status: o.status });
}
