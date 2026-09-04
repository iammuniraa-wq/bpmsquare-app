import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";
import { diffForLog, logChange } from "@/lib/changeLog";
import {
  PROJECT_SELECT, parseProjectBody, projectLinks, verifyProjectLinks,
  replaceProjectLinks, bodyTouchesLinks, loadTree, validateParent,
} from "@/lib/wfm/projects";
import { getWfmConfig } from "@/lib/wfm/server";
import { descendantsOf } from "@/lib/wfm/projectTree";

// GET /api/wfm/projects/[id]
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor({ feature: "wfm_projects" });
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId } = ctx;
  const { id } = await params;

  const { data, error } = await supabase
    .from("wfm_projects")
    .select(PROJECT_SELECT)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const links = await projectLinks(createAdminSupabase(), tenantId, id);
  return NextResponse.json({ ...data, ...links });
}

// PATCH /api/wfm/projects/[id] — edit (tenant admin only).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor({ feature: "wfm_projects" });
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId, userId } = ctx;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = await parseProjectBody(body, { required: false });
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const admin = createAdminSupabase();

  const { data: before } = await admin
    .from("wfm_projects").select(PROJECT_SELECT).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (parsed.values.account_id) {
    const { data: account } = await admin
      .from("accounts").select("id").eq("id", parsed.values.account_id).eq("tenant_id", tenantId).maybeSingle();
    if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 400 });
  }
  if (parsed.values.parent_id) {
    const parentId = parsed.values.parent_id as string;
    const { data: parent } = await admin
      .from("wfm_projects").select("id").eq("id", parentId).eq("tenant_id", tenantId).maybeSingle();
    if (!parent) return NextResponse.json({ error: "Unknown parent project" }, { status: 400 });

    // Catches self-parenting, loops through a descendant, and a move whose
    // whole SUBTREE would overflow the configured depth.
    const config = await getWfmConfig(admin, tenantId);
    const err = validateParent(await loadTree(admin, tenantId), config.project_levels ?? [], parentId, id);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  // A date range narrowing below an existing end can't be validated from the
  // patch alone -- check the merged result, not just what was sent.
  const mergedStart = (parsed.values.start_date ?? before.start_date) as string | null;
  const mergedEnd = (parsed.values.end_date ?? before.end_date) as string | null;
  if (mergedStart && mergedEnd && mergedEnd < mergedStart) {
    return NextResponse.json({ error: "end_date can't be before start_date" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("wfm_projects")
    .update({ ...parsed.values, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select(PROJECT_SELECT)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Links are replaced wholesale ONLY when the body mentions them, so a plain
  // status or name change never silently unlinks everything.
  if (bodyTouchesLinks(body)) {
    const links = await verifyProjectLinks(admin, tenantId, body);
    if ("error" in links) return NextResponse.json({ error: links.error }, { status: 400 });
    await replaceProjectLinks(admin, tenantId, id, links.rows);
  }

  const changes = diffForLog("wfm_projects", before as Record<string, unknown>, parsed.values);
  if (changes.length > 0) {
    await logChange(admin, {
      tenantId, objectType: "wfm_projects", objectId: id,
      objectLabel: data.name, action: "update", actorId: userId, changes,
    });
  }

  return NextResponse.json(data);
}

// DELETE /api/wfm/projects/[id] — tenant admin only.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor({ feature: "wfm_projects" });
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId, userId } = ctx;
  const { id } = await params;

  const admin = createAdminSupabase();

  const { data: before } = await admin
    .from("wfm_projects").select("id, name").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Refuse to delete something that still has sub-items. The FK would set
  // their parent to null and silently promote them to top-level projects,
  // which looks like data appearing from nowhere on the Projects screen.
  const tree = await loadTree(admin, tenantId);
  const kids = descendantsOf(tree, id);
  if (kids.length > 0) {
    return NextResponse.json(
      { error: `Delete or move its ${kids.length} sub-item(s) first.` },
      { status: 409 }
    );
  }

  // Punches keep their stamp via `on delete set null` rather than being
  // deleted with the project -- attendance evidence must survive a costing
  // decision. Hours already attributed become unassigned, which is visible
  // and fixable; deleting them would not be.
  const { count } = await admin
    .from("wfm_presence_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("project_id", id);

  const { error } = await admin
    .from("wfm_projects").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logChange(admin, {
    tenantId, objectType: "wfm_projects", objectId: id,
    objectLabel: before.name, action: "delete", actorId: userId,
  });

  return NextResponse.json({ ok: true, unattributed_events: count ?? 0 });
}
