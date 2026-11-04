import { NextResponse, type NextRequest } from "next/server";
import { parseWorkPackage } from "@/lib/contractProjects/allocation";
import { deletePackage, openAllocation, updatePackage, workingRevision } from "@/lib/contractProjects/allocationServer";
import { loadLines, UUID_RE } from "@/lib/contractProjects/server";
import { loadPackage } from "@/lib/contractProjects/workPackagesServer";

// PATCH  /api/contract-projects/[id]/work-packages/[pid]  { code?, name?, parent_id?, owner_employee_id?, line_keys?, note? }
//          A WBS item. Names, codes, parents and owners can change on any revision of an open project (an approved baseline fixes the money,
//          not the structure). An empty code hands the item back to the numbering. A move that would sit under itself, go deeper than three
//          levels or land under an item that holds lines is refused with the reason. line_keys REPLACES the whole lines the item holds (a line
//          already in another item: 409 `<item> is already in <code>`); in the WBS basis that needs the draft revision (409 `locked`).
//          A new owner must be an employee of this workspace with a login.
// DELETE /api/contract-projects/[id]/work-packages/[pid]
//          Removes the item: its lines go to unassigned, its shares of split lines go with it, its sub-items move up one level. After the
//          baseline is waiting or approved only an item that holds no allocation and no lines can go.
// The item is matched by id AND project AND workspace.

type Ctx = { params: Promise<{ id: string; pid: string }> };

async function open(params: Ctx["params"], write: boolean) {
  const { id, pid } = await params;
  const opened = await openAllocation(id, write);
  if (!opened.ok) return { fail: NextResponse.json({ error: opened.error, ...(opened.extra ?? {}) }, { status: opened.status }) };
  const pkg = UUID_RE.test(pid) ? await loadPackage(opened.req.admin, opened.req.tenantId, id, pid) : null;
  if (!pkg) return { fail: NextResponse.json({ error: "WBS item not found" }, { status: 404 }) };
  const work = await workingRevision(opened);
  if (!work.ok) return { fail: NextResponse.json({ error: work.error, ...(work.extra ?? {}) }, { status: work.status }) };
  return { ctx: opened, pkg, work: work.work };
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const o = await open(params, true);
  if (o.fail) return o.fail;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const keys = new Set((await loadLines(o.ctx.req.admin, o.ctx.req.tenantId, o.work.revision.id)).map((l) => l.line_key));
  const parsed = parseWorkPackage(body, keys, "update");
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const done = await updatePackage(o.ctx, o.work, o.pkg, parsed.value);
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ ok: true, code: done.code });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const o = await open(params, true);
  if (o.fail) return o.fail;
  const done = await deletePackage(o.ctx, o.work, o.pkg);
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ ok: true, lines: done.lines, parts: done.parts });
}
