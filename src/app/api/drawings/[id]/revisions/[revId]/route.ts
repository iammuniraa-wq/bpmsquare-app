import { NextResponse, type NextRequest } from "next/server";
import { failResponse, jsonBody } from "@/lib/drawings/http";
import { openRevision } from "@/lib/drawings/open";
import { REVISION_COLS, loadRevisions, normaliseRevision } from "@/lib/drawings/server";
import { deleteDraftRevision } from "@/lib/drawings/writes";
import { revLabelProblem } from "@/lib/drawings/rules";
import { logChange } from "@/lib/changeLog";

// GET    one revision.
// PATCH  { notes?, rev_label? } on a DRAFT only. A revision that left draft is a record: the database refuses any change to its file, label and
//        number even from the service role, and this route says so first (409).
// DELETE a draft that was never submitted (its file goes too). A revision that left draft is never deleted.

type Ctx = { params: Promise<{ id: string; revId: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id, revId } = await params;
  const opened = await openRevision(id, revId);
  if (!opened.ok) return failResponse(opened);
  return NextResponse.json(opened.revision);
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id, revId } = await params;
  const opened = await openRevision(id, revId, { write: true });
  if (!opened.ok) return failResponse(opened);
  const { admin, supabase, tenantId, userId } = opened.req;
  const rev = opened.revision;
  if (rev.status !== "draft") return NextResponse.json({ error: "A revision that was submitted cannot be edited. Issue a new revision" }, { status: 409 });
  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if ("notes" in body) patch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;
  if ("rev_label" in body) {
    const label = String(body.rev_label ?? "").trim();
    const problem = revLabelProblem(label);
    if (problem) return NextResponse.json({ error: problem }, { status: 422 });
    const { rows } = await loadRevisions(admin, tenantId, id);
    if (rows.some((r) => r.id !== rev.id && r.rev_label.toLowerCase() === label.toLowerCase())) return NextResponse.json({ error: `Revision ${label} already exists` }, { status: 409 });
    patch.rev_label = label;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json(rev);
  const { data, error } = await admin.from("drawing_revisions").update(patch).eq("id", rev.id).eq("drawing_id", id).eq("tenant_id", tenantId).eq("status", "draft").select(REVISION_COLS).single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "The revision is no longer a draft" }, { status: error ? 500 : 409 });
  if ("rev_label" in patch) {
    await logChange(supabase, { tenantId, objectType: "drawings", objectId: id, objectLabel: `${opened.drawing.drawing_no} ${opened.drawing.title}`, action: "update", actorId: userId, changes: [{ field: "Revision label", from: rev.rev_label, to: String(patch.rev_label) }] });
  }
  return NextResponse.json(normaliseRevision(data as unknown as Record<string, unknown>));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id, revId } = await params;
  const opened = await openRevision(id, revId, { write: true });
  if (!opened.ok) return failResponse(opened);
  const done = await deleteDraftRevision(opened.req, opened.drawing, opened.revision);
  if (!done.ok) return failResponse(done);
  return new NextResponse(null, { status: 204 });
}
