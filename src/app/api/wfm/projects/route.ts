import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";
import { insertWithMasterRef } from "@/lib/masterRef";
import { logChange } from "@/lib/changeLog";
import {
  PROJECT_SELECT, PROJECT_STATUSES, parseProjectBody, verifyProjectLinks,
  replaceProjectLinks, loadTree, validateParent, insertChildProject,
} from "@/lib/wfm/projects";

// Projects are the cost object worked hours are attributed to (0104,
// WFM_PROJECT_COSTING.md). Gated on features.wfm_projects separately from
// `wfm` -- an attendance-only tenant must not gain any of this.

// GET /api/wfm/projects — list (supervisor/admin).
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor({ feature: "wfm_projects" });
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId } = ctx;

  const status = request.nextUrl.searchParams.get("status");
  let query = supabase
    .from("wfm_projects")
    .select(PROJECT_SELECT)
    .eq("tenant_id", tenantId)
    .order("name");
  if (status && (PROJECT_STATUSES as readonly string[]).includes(status)) {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  // 42P01 = 0104 not applied yet. §3b: a pending migration renders as an
  // empty list, never a crash.
  if (error) {
    if (error.code === "42P01") return NextResponse.json([]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

// POST /api/wfm/projects — create (tenant admin only). A project drives cost
// and, later, billing, so creation is admin-gated rather than supervisor-wide.
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor({ feature: "wfm_projects" });
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId, userId } = ctx;

  const body = await request.json().catch(() => null);
  const parsed = await parseProjectBody(body, { required: true });
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const admin = createAdminSupabase();

  // Every foreign id below arrives in the request body, so each is
  // tenant-verified before use per MULTI_TENANT_GUARDRAILS.md.
  const links = await verifyProjectLinks(admin, tenantId, body);
  if ("error" in links) return NextResponse.json({ error: links.error }, { status: 400 });

  if (parsed.values.account_id) {
    const { data: account } = await admin
      .from("accounts").select("id").eq("id", parsed.values.account_id).eq("tenant_id", tenantId).maybeSingle();
    if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 400 });
  }
  let parentRef: string | null = null;
  if (parsed.values.parent_id) {
    const parentId = parsed.values.parent_id as string;
    const { data: parent } = await admin
      .from("wfm_projects").select("id, ref").eq("id", parentId).eq("tenant_id", tenantId).maybeSingle();
    if (!parent) return NextResponse.json({ error: "Unknown parent project" }, { status: 400 });
    parentRef = (parent.ref as string | null) ?? null;

    // The UI hides the "Add" link at the deepest level, but the screen is
    // never the gate.
    const err = validateParent(await loadTree(admin, tenantId), parentId, null);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  // A part is numbered inside its parent (PRJ-0003.1); only a top-level
  // project draws from the workspace PRJ sequence.
  const record = { ...parsed.values, tenant_id: tenantId };
  const { data, error } = parentRef
    ? await insertChildProject<{ id: string; name: string; ref: string | null }>(
        admin, tenantId, parentRef, record, PROJECT_SELECT
      )
    : await insertWithMasterRef<{ id: string; name: string; ref: string | null }>(
        admin, "wfm_projects", tenantId, record, PROJECT_SELECT
      );
  if (error || !data) {
    if (error?.code === "42P01") {
      return NextResponse.json({ error: "Project costing isn't set up on this database yet." }, { status: 503 });
    }
    return NextResponse.json({ error: error?.message ?? "Could not create project" }, { status: 500 });
  }

  await replaceProjectLinks(admin, tenantId, data.id, links.rows);

  await logChange(admin, {
    tenantId, objectType: "wfm_projects", objectId: data.id,
    objectLabel: data.name, action: "create", actorId: userId,
  });

  return NextResponse.json(data);
}
