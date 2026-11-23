import { NextResponse, type NextRequest } from "next/server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { failResponse, jsonBody } from "@/lib/drawings/http";
import { openDrawing } from "@/lib/drawings/open";
import { DRAWING_COLS, loadRevisions, loadType, namesFor, verifyLinks } from "@/lib/drawings/server";
import { deleteDrawing } from "@/lib/drawings/writes";
import { drawingNoProblem, normaliseDrawingNo, numberingProblem } from "@/lib/drawings/rules";

// GET    /api/drawings/[id]   the drawing, its type and its revisions (every one stays readable, superseded included), with names.
// PATCH  /api/drawings/[id]   header fields only. The number and the type are fixed once any revision was submitted: the type decides who may
//        release, so it must not change under a revision that is waiting for review. Status and revisions have their own routes.
// DELETE /api/drawings/[id]   only while nothing was ever submitted; afterwards the drawing is archived (PATCH archived: true), never removed.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const opened = await openDrawing(id);
  if (!opened.ok) return failResponse(opened);
  const { admin, tenantId } = opened.req;
  const [{ rows }, type] = await Promise.all([loadRevisions(admin, tenantId, id), loadType(admin, tenantId, opened.drawing.type_id)]);
  const names = await namesFor(admin, tenantId, rows.flatMap((r) => [r.submitted_by, r.released_by, r.created_by]));
  const nameOf = (u: string | null) => (u ? names.get(u) ?? null : null);
  return NextResponse.json({
    drawing: opened.drawing, type,
    revisions: rows.map((r) => ({ ...r, submitted_by_name: nameOf(r.submitted_by), released_by_name: nameOf(r.released_by) })),
  });
}

const EDITABLE = ["title", "external_no", "opportunity_id", "project_id", "wbs_item_id", "type_id", "drawing_no", "custom_data"] as const;

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const opened = await openDrawing(id, { write: true });
  if (!opened.ok) return failResponse(opened);
  const { admin, supabase, tenantId, userId } = opened.req;
  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const before = opened.drawing;

  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE) if (key in body) patch[key] = body[key];
  if (typeof patch.title === "string") { patch.title = patch.title.trim().slice(0, 200); if (!patch.title) return NextResponse.json({ error: "A title is needed" }, { status: 422 }); }
  else if ("title" in patch) delete patch.title;
  if ("external_no" in patch) patch.external_no = typeof patch.external_no === "string" && patch.external_no.trim() ? patch.external_no.trim().slice(0, 80) : null;
  for (const k of ["opportunity_id", "project_id", "wbs_item_id", "type_id"] as const) if (k in patch) patch[k] = typeof patch[k] === "string" && patch[k] ? patch[k] : null;
  if ("custom_data" in patch) {
    const cd = patch.custom_data;
    patch.custom_data = cd && typeof cd === "object" && !Array.isArray(cd)
      ? { ...(before.custom_data ?? {}), ...Object.fromEntries(Object.entries(cd as Record<string, unknown>).filter(([k]) => k.startsWith("cf_"))) }
      : before.custom_data ?? {};
  }
  if ("archived" in body) patch.archived_at = body.archived === true ? new Date().toISOString() : null;

  const { rows } = await loadRevisions(admin, tenantId, id);
  const submitted = rows.some((r) => r.status !== "draft" || !!r.submitted_at);
  if (submitted && ("drawing_no" in patch || "type_id" in patch)) {
    const changed = ("drawing_no" in patch && normaliseDrawingNo(String(patch.drawing_no ?? "")) !== before.drawing_no) || ("type_id" in patch && patch.type_id !== before.type_id);
    if (changed) return NextResponse.json({ error: "The number and the type are fixed once a revision was submitted" }, { status: 409 });
    delete patch.drawing_no; delete patch.type_id;
  }
  if ("drawing_no" in patch) {
    const problem = drawingNoProblem(String(patch.drawing_no ?? ""));
    if (problem) return NextResponse.json({ error: problem }, { status: 422 });
    patch.drawing_no = normaliseDrawingNo(String(patch.drawing_no));
  }
  const links = {
    type_id: "type_id" in patch ? (patch.type_id as string | null) : null,
    opportunity_id: "opportunity_id" in patch ? (patch.opportunity_id as string | null) : null,
    project_id: "project_id" in patch ? (patch.project_id as string | null) : null,
    wbs_item_id: "wbs_item_id" in patch ? (patch.wbs_item_id as string | null) : null,
  };
  // A building is checked against the tender it will be filed under: the new one if the tender is changing, else the current one.
  const linkProblem = await verifyLinks(admin, tenantId, { ...links, opportunity_id: links.wbs_item_id ? ("opportunity_id" in patch ? links.opportunity_id : before.opportunity_id) : links.opportunity_id });
  if (linkProblem) return NextResponse.json({ error: linkProblem }, { status: 422 });
  if ("type_id" in patch && patch.type_id === null) delete patch.type_id;
  const nextType = await loadType(admin, tenantId, (patch.type_id as string | undefined) ?? before.type_id);
  if ("drawing_no" in patch || "type_id" in patch) {
    const problem = numberingProblem(nextType?.numbering_pattern, String(patch.drawing_no ?? before.drawing_no));
    if (problem) return NextResponse.json({ error: problem }, { status: 422 });
  }
  if (Object.keys(patch).length === 0) return NextResponse.json(before);

  const { data, error } = await admin.from("drawings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenantId).select(DRAWING_COLS).single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "That drawing number is already used in this workspace" : error.message }, { status: error.code === "23505" ? 409 : 500 });

  const user = await getAuthUser();
  const changes = diffForLog("drawings", before as unknown as Record<string, unknown>, patch);
  if (changes.length > 0) await logChange(supabase, { tenantId, objectType: "drawings", objectId: id, objectLabel: `${before.drawing_no} ${before.title}`, action: "update", actorId: user?.id ?? userId, actorEmail: user?.email, changes });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const opened = await openDrawing(id, { write: true });
  if (!opened.ok) return failResponse(opened);
  const done = await deleteDrawing(opened.req, opened.drawing);
  if (!done.ok) return failResponse(done);
  return new NextResponse(null, { status: 204 });
}
