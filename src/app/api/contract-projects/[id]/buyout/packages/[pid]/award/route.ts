import { NextResponse, type NextRequest } from "next/server";
import { openPackageRequest } from "@/lib/contractProjects/buyout/server";
import { awardPackage } from "@/lib/contractProjects/buyout/writes";

// POST /api/contract-projects/[id]/buyout/packages/[pid]/award  { rfq_id, supplier_id, reason? }
//   Awards the WHOLE package to one supplier from one round. The supplier must have quoted every line (422 { code: "incomplete_quote" }). When the
//   chosen total is not the lowest valid total of the CURRENT round (or the chosen answer is itself expired or stale while a valid one exists) a
//   reason is required: 422 { code: "reason_required", why: "higher"|"expired", lowest_valid, chosen_total }. The award is written to every line of
//   the round through the RFQ module's own award code (rfq_line_awards), then the package records the round, supplier, committed amount, reason,
//   who and when. Warns, never blocks, when the committed amount is over budget (the row's against_budget is negative).
//   -> { row: PackageRow, warnings: string[] }.  409 when already awarded ({ code: "already_awarded" }) or handed over.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const { id, pid } = await params;
  const gate = await openPackageRequest(id, pid, { write: true, rfq: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error, ...(gate.extra ?? {}) }, { status: gate.status });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const made = await awardPackage(gate.req, gate.pkg, body as Record<string, unknown>);
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  return NextResponse.json({ row: made.row, warnings: made.warnings });
}
