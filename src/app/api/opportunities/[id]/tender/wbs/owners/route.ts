import { NextResponse, type NextRequest } from "next/server";
import { openBoqRequest } from "@/lib/tender/boq/server";
import { loadEmployeeChoices } from "@/lib/contractProjects/workPackagesServer";

// GET /api/opportunities/[id]/tender/wbs/owners
// The active employees of THIS workspace an item can be given as its owner. Only a person who can edit the tender is told who they are. A bid-time
// owner needs no login (the project asks for one), so every active employee is listed, with whether they have one.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openBoqRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const employees = await loadEmployeeChoices(gate.req.admin, gate.req.tenantId);
  return NextResponse.json({ employees: employees.map((e) => ({ id: e.id, name: e.name, code: e.code, has_login: e.has_login })) });
}
