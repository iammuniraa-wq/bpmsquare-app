import { NextResponse, type NextRequest } from "next/server";
import { parsePackage } from "@/lib/contractProjects/buyout/rules";
import { buildDetail, needsBuyoutUpdate, openPackageRequest } from "@/lib/contractProjects/buyout/server";
import { deletePackage, updatePackage } from "@/lib/contractProjects/buyout/writes";

// GET    /api/contract-projects/[id]/buyout/packages/[pid]
//          -> { package: PackageRow & { currency, current_rfq_id, awarded_rfq_id, award_reason, awarded_by_name, awarded_at, erp_ref, created_at },
//               lines: [{ id, line_key, item_no, description, qty, uom, cost_code, cost_in_bid, budget }],
//               rounds: [{ rfq_id, ref, round, created_at, created_by, status, respond_by, is_current, suppliers_total, suppliers_replied,
//                          quotes: [{ supplier_id, supplier_name, total|null, lines_quoted, lines_total, lead_days|null, valid, lowest_valid,
//                                     replied_at|null, status, awarded }] }]   (newest round first; every round is kept),
//               budget_bars: { budget, bid_cost, best_quote|null, committed|null, max },
//               handover: { state, sent_at|null, sent_by_name|null, erp_ref|null }, can_edit, can_send_rounds, lines_locked }
// PATCH  /api/contract-projects/[id]/buyout/packages/[pid]  { name?, kind?, note?, budget_line_ids? }  -> PackageRow
//          budget_line_ids REPLACES the lines, and only before the first round was sent and while the package is not awarded (409 otherwise).
// DELETE /api/contract-projects/[id]/buyout/packages/[pid]  -> { ok: true }, only for a package that was never sent (rounds are kept for the record).

type Ctx = { params: Promise<{ id: string; pid: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id, pid } = await params;
  const gate = await openPackageRequest(id, pid);
  if (!gate.ok) return NextResponse.json({ error: gate.error, ...(gate.extra ?? {}) }, { status: gate.status });
  const detail = await buildDetail(gate.req, pid);
  if (detail && "pending" in detail) return NextResponse.json({ error: needsBuyoutUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id, pid } = await params;
  const gate = await openPackageRequest(id, pid, { write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error, ...(gate.extra ?? {}) }, { status: gate.status });
  const parsed = parsePackage(await request.json().catch(() => null), "update");
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const made = await updatePackage(gate.req, gate.pkg, parsed.value);
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  return NextResponse.json(made.row);
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id, pid } = await params;
  const gate = await openPackageRequest(id, pid, { write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error, ...(gate.extra ?? {}) }, { status: gate.status });
  const done = await deletePackage(gate.req, gate.pkg);
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ ok: true });
}
