import { NextResponse, type NextRequest } from "next/server";
import { openAllocation } from "@/lib/contractProjects/allocationServer";
import { addBuilding, projectBuildings } from "@/lib/elements/projectServer";
import { failed, readBody, NOT_FOUND } from "@/lib/elements/respond";
import { buildingsOn } from "@/lib/elements/server";

// GET  /api/contract-projects/[id]/buildings
//        -> the Buildings view of the project: one row per building (a level-1 WBS item with a code) with its lines, elements, contract value,
//           budget, variance and the quantities per element type, the lines in no building, the element table, the element types, the pattern
//           (the project's own once a code was issued), the tolerance and why nothing can change right now (`lock`). `pending` while 0253 is
//           not applied.
// POST /api/contract-projects/[id]/buildings  { name, code } or { common: true }
//        A new building: a level-1 WBS item with a building code (1 to 6 letters or digits, unique on the project). `common` makes the
//        site-wide building COM. 201 { id, code }. Structure is editable on any revision of an open project.
// Behind contract_projects (edit for a write); a project of another workspace is a 404.

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const open = await openAllocation(id, false);
  if (!open.ok) return failed(open);
  if (!(await buildingsOn(open.req.supabase, open.req.tenantId))) return NextResponse.json({ enabled: false });
  const out = await projectBuildings(open);
  if (!out.ok) return failed(out);
  return NextResponse.json(out.data);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const open = await openAllocation(id, true);
  if (!open.ok) return failed(open);
  if (!(await buildingsOn(open.req.supabase, open.req.tenantId))) return NOT_FOUND();
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const made = await addBuilding(open, { name: body.name, code: body.code, common: body.common });
  if (!made.ok) return failed(made);
  return NextResponse.json({ id: made.id, code: made.code }, { status: 201 });
}
