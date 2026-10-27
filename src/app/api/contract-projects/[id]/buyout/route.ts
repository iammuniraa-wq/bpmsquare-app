import { NextResponse, type NextRequest } from "next/server";
import { buildSummary, openBuyoutRequest, needsBuyoutUpdate } from "@/lib/contractProjects/buyout/server";

// GET /api/contract-projects/[id]/buyout
//   The Buy-out tab of a contract project made from a tender (docs/design/contract-buyout.md section 5).
//   -> { baseline: { revision_id, rev_no } | null, group: { id, name } | null, restricted: boolean, currency,
//        tiles: { budget, committed, best_vs_budget, needs_decision, packages, project_budget, unassigned_budget },
//        packages: PackageRow[], unassigned_lines: BudgetLineRow[], committed_by_line: { [line_key]: awarded amount }, can_edit, can_send_rounds }
//   PackageRow: { id, ref, name, kind, status, line_count, budget, bid_cost, best_quote|null, committed|null, against_budget|null,
//                 current_round|null, rounds, handover: { state: "not_ready"|"ready"|"sent", sent_at|null }, note, awarded_supplier_id, awarded_supplier_name }
//   The shapes are typed in src/lib/contractProjects/buyout/rules.ts. Money is the internal COST side; positive best_vs_budget / against_budget is under budget.
// Behind the platform-admin flags contract_projects + gcc_tender and a project made from a tender: anything else is a 404.
// While migration 0234 is pending: 503 with needsDatabaseUpdate.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBuyoutRequest(id);
  if (!gate.ok) return NextResponse.json({ error: gate.error, ...(gate.extra ?? {}) }, { status: gate.status });
  const summary = await buildSummary(gate.req);
  if (summary.pending) return NextResponse.json({ error: needsBuyoutUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  const { pending: _pending, ...body } = summary;
  void _pending;
  return NextResponse.json(body);
}
