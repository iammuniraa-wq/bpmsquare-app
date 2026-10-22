import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody } from "../../_guard";
import { proposeListsOp } from "@/lib/middleware/mapping/listOps";

// POST ?connection= { kind? } -> { lists: [{ kind, label, rows: [{ bpm, erp, inbound }], default_in, proposed: true }] }
// From the codes of every choice field in the connection's field lists, named after BPMSquare's own values where they match.
// A row with an empty `bpm` is an ERP code BPMSquare has no value for yet. Nothing is saved.
export async function POST(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await proposeListsOp(g.ctx, req.nextUrl.searchParams.get("connection"), await jsonBody(req));
  return NextResponse.json(o.body, { status: o.status });
}
