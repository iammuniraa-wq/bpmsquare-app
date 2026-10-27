import { NextResponse, type NextRequest } from "next/server";
import { parseRound } from "@/lib/contractProjects/buyout/rules";
import { openPackageRequest } from "@/lib/contractProjects/buyout/server";
import { createRound } from "@/lib/contractProjects/buyout/writes";

// POST /api/contract-projects/[id]/buyout/packages/[pid]/rounds  { supplier_ids: string[], reply_by?: "YYYY-MM-DD", note?: string }
//   A new round: one RFQ holding every line of the package, created and sent by the RFQ module's own code (rfqs.package_id points back). Earlier
//   rounds are never changed or deleted. The suppliers must be on the client's approved list when it has one (422 { code: "outside_approved_list",
//   not_allowed: [{ supplier_id, name }] } naming them); an inactive supplier is a 422, and a package that is awarded, handed over or has no lines is a 409.
//   Needs the RFQ module and the RFQ edit grant (403 otherwise).
//   -> 201 { rfq_id, ref, round, sent: [{ supplier, ok, reason?, redirected? }] }

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  const gate = await openPackageRequest(id, pid, { write: true, rfq: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error, ...(gate.extra ?? {}) }, { status: gate.status });
  const parsed = parseRound(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const made = await createRound(gate.req, gate.pkg, parsed.value);
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  const { ok: _ok, ...body } = made;
  void _ok;
  return NextResponse.json(body, { status: 201 });
}
