import { NextResponse, type NextRequest } from "next/server";
import { parseSplit } from "@/lib/contractProjects/allocation";
import { openAllocation, setLineSplit, unsplitLine, workingRevision } from "@/lib/contractProjects/allocationServer";
import { loadLines, UUID_RE } from "@/lib/contractProjects/server";

// PUT    /api/contract-projects/[id]/work-packages/split  { line_key, parts: [{ package_id, share_pct }] }
//        A budget line's split across WBS items, written as one set. The shares must add up to 100 (within 0.01), every part names a leaf, no item
//        twice; a set of one part is the line sitting whole in that item. In the WBS basis it needs the draft revision (409 `locked`).
// DELETE { line_key, package_id? }  Unsplit: the whole line goes to the named item, else to the item of its first share.
// The line must be a line of this project's current revision and every item an item of THIS project.

type Ctx = { params: Promise<{ id: string }> };

async function open(params: Ctx["params"], body: unknown) {
  const { id } = await params;
  const opened = await openAllocation(id, true);
  if (!opened.ok) return { fail: NextResponse.json({ error: opened.error, ...(opened.extra ?? {}) }, { status: opened.status }) };
  if (!body || typeof body !== "object") return { fail: NextResponse.json({ error: "Invalid body" }, { status: 400 }) };
  const work = await workingRevision(opened);
  if (!work.ok) return { fail: NextResponse.json({ error: work.error, ...(work.extra ?? {}) }, { status: work.status }) };
  const keys = new Set((await loadLines(opened.req.admin, opened.req.tenantId, work.work.revision.id)).map((l) => l.line_key));
  return { ctx: opened, work: work.work, keys };
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const body = await request.json().catch(() => null);
  const o = await open(params, body);
  if (o.fail) return o.fail;
  const parsed = parseSplit(body, o.keys);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const done = await setLineSplit(o.ctx, o.work, parsed.line_key, parsed.parts);
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ kind: done.kind });
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const o = await open(params, body);
  if (o.fail) return o.fail;
  if (typeof body?.line_key !== "string" || !o.keys.has(body.line_key)) return NextResponse.json({ error: "A line is not in this budget" }, { status: 422 });
  if (body.package_id != null && !(typeof body.package_id === "string" && UUID_RE.test(body.package_id))) return NextResponse.json({ error: "That is not a WBS item" }, { status: 422 });
  const done = await unsplitLine(o.ctx, o.work, body.line_key, (body.package_id as string | null | undefined) ?? null);
  if (!done.ok) return NextResponse.json({ error: done.error, ...(done.extra ?? {}) }, { status: done.status });
  return NextResponse.json({ package_id: done.package_id });
}
