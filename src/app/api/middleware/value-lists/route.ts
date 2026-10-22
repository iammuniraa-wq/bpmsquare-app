import { NextResponse, type NextRequest } from "next/server";
import { guard } from "../_guard";
import { listsView } from "@/lib/middleware/mapping/listOps";

// GET ?connection= -> { lists: [{ kind, label, rows, default_in, counts: { rows, unused, unmapped }, unmapped: { out, in } }],
//                        standardKinds: [{ kind, label, created }] }
// Value lists belong to a connection (the communication-arrangement level) and are shared by every document of it.
export async function GET(req: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await listsView(g.ctx, req.nextUrl.searchParams.get("connection"));
  return NextResponse.json(o.body, { status: o.status });
}
