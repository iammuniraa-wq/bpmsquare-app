import { NextResponse, type NextRequest } from "next/server";
import { parseWorkPackage } from "@/lib/contractProjects/allocation";
import { deletePackage, draftRevision, openAllocation, updatePackage } from "@/lib/contractProjects/allocationServer";
import { loadLines, UUID_RE } from "@/lib/contractProjects/server";
import { loadPackage } from "@/lib/contractProjects/workPackagesServer";

// PATCH  /api/contract-projects/[id]/work-packages/[pid]  { code?, name?, owner_employee_id?, line_keys?, note? }
//          line_keys REPLACES the set of lines the package holds (a line already in another package: 409 `<item> is already in <code>`).
//          A new owner must be an employee of this workspace with a login. In package mode a change of lines spreads the package's cost again.
// DELETE /api/contract-projects/[id]/work-packages/[pid]
//          Removes the package; in package mode the lines it held go back to not allocated.
// Both need the project's DRAFT revision (409 `locked` otherwise); the package is matched by id AND project AND workspace.

type Ctx = { params: Promise<{ id: string; pid: string }> };

async function open(params: Ctx["params"], write: boolean) {
  const { id, pid } = await params;
  const opened = await openAllocation(id, write);
  if (!opened.ok) return { fail: NextResponse.json({ error: opened.error, ...(opened.extra ?? {}) }, { status: opened.status }) };
  const pkg = UUID_RE.test(pid) ? await loadPackage(opened.req.admin, opened.req.tenantId, id, pid) : null;
  if (!pkg) return { fail: NextResponse.json({ error: "Work package not found" }, { status: 404 }) };
  const draft = await draftRevision(opened, null);
  if (!draft.ok) return { fail: NextResponse.json({ error: draft.error, ...(draft.extra ?? {}) }, { status: draft.status }) };
  return { ctx: opened, pkg, revision: draft.revision };
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const o = await open(params, true);
  if (o.fail) return o.fail;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const keys = new Set((await loadLines(o.ctx.req.admin, o.ctx.req.tenantId, o.revision.id)).map((l) => l.line_key));
  const parsed = parseWorkPackage(body, keys, "update");
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const done = await updatePackage(o.ctx, o.revision, o.pkg, parsed.value);
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const o = await open(params, true);
  if (o.fail) return o.fail;
  const done = await deletePackage(o.ctx, o.revision, o.pkg);
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ ok: true });
}
