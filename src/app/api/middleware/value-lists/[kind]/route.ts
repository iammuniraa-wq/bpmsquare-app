import { NextResponse, type NextRequest } from "next/server";
import { guard, jsonBody } from "../../_guard";
import { deleteListOp, putList } from "@/lib/middleware/mapping/listOps";

type Params = { params: Promise<{ kind: string }> };

// PUT ?connection= { label?, rows: [{ bpm, erp, inbound }], default_in } -> the list (as GET returns it)
//   422 { error, errors: [{ row, message }] }: a duplicate BPMSquare value, or an ERP code with no single inbound row.
// DELETE ?connection= -> 409 { error, used_by: [{ document, field }] } while a mapping row uses the list.
// `kind` is unit | currency | country | payment_terms | incoterms | status | custom:<name>.
export async function PUT(req: NextRequest, ctx: Params) {
  const g = await guard();
  if (!g.ok) return g.res;
  const { kind } = await ctx.params;
  const o = await putList(g.ctx, req.nextUrl.searchParams.get("connection"), decodeURIComponent(kind), await jsonBody(req));
  return NextResponse.json(o.body, { status: o.status });
}

export async function DELETE(req: NextRequest, ctx: Params) {
  const g = await guard();
  if (!g.ok) return g.res;
  const { kind } = await ctx.params;
  const o = await deleteListOp(g.ctx, req.nextUrl.searchParams.get("connection"), decodeURIComponent(kind));
  return NextResponse.json(o.body, { status: o.status });
}
