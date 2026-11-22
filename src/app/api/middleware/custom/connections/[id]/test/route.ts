import { NextResponse } from "next/server";
import { guard } from "../../../../_guard";
import { testSaved } from "@/lib/connections/ops";

// Test a saved connection. POST -> { result: { ok, message, fix, httpStatus, reference, note }, connection }.
// The result is kept on the row (the table's status chip). A failed test is still a 200: the answer is the result.
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (!g.ok) return g.res;
  const o = await testSaved(g.ctx, (await params).id);
  return NextResponse.json(o.body, { status: o.status });
}
