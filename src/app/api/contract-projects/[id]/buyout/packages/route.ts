import { NextResponse, type NextRequest } from "next/server";
import { parsePackage } from "@/lib/contractProjects/buyout/rules";
import { openBuyoutRequest } from "@/lib/contractProjects/buyout/server";
import { createPackage } from "@/lib/contractProjects/buyout/writes";

// POST /api/contract-projects/[id]/buyout/packages  { name, kind?: "supplier"|"subcontract", budget_line_ids: string[], note? }
//   A new package (ref PKG-####) of budget lines of the project's APPROVED budget. Reserve lines are refused (422); a line already in another package is
//   a 409 naming it; before the baseline is approved the answer is 409 { code: "no_baseline" }. The status, the ref and the author are the server's.
//   -> 201 PackageRow (see GET .../buyout)

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBuyoutRequest(id, { write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error, ...(gate.extra ?? {}) }, { status: gate.status });
  const parsed = parsePackage(await request.json().catch(() => null), "create");
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const made = await createPackage(gate.req, parsed.value);
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  return NextResponse.json(made.row, { status: 201 });
}
