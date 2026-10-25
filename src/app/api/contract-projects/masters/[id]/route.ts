import { NextResponse, type NextRequest } from "next/server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { isMissingSchema, MASTER_COLS, needsUpdate, openProjectRequest, UUID_RE } from "@/lib/contractProjects/server";
import { MASTER_KIND_LABEL, type MasterFlags, type MasterRow } from "@/lib/contractProjects/types";

// PATCH /api/contract-projects/masters/[id]  { name?, parent_code?, active?, flags? }   admin only.
// An entry is never deleted: switching it off (`active: false`) takes it out of the pickers while budget lines that already use the
// code keep it. The code itself cannot change (it is what budget lines and the ERP refer to).

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await openProjectRequest({ admin: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId } = gate.req;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: row, error: readErr } = await admin.from("erp_masters").select(MASTER_COLS).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (readErr) return isMissingSchema(readErr) ? NextResponse.json({ ...needsUpdate().extra, error: needsUpdate().error }, { status: 503 }) : NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const current = row as MasterRow;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
    if (!name) return NextResponse.json({ error: "Give it a name" }, { status: 422 });
    patch.name = name;
  }
  if ("active" in body) {
    if (typeof body.active !== "boolean") return NextResponse.json({ error: "active must be true or false" }, { status: 422 });
    patch.active = body.active;
  }
  if ("parent_code" in body) {
    const parent = typeof body.parent_code === "string" && body.parent_code.trim() ? body.parent_code.trim() : null;
    if (parent === current.code) return NextResponse.json({ error: "A code cannot be its own parent" }, { status: 422 });
    if (parent) {
      const { data } = await admin.from("erp_masters").select("id").eq("tenant_id", tenantId).eq("kind", current.kind).eq("code", parent).maybeSingle();
      if (!data) return NextResponse.json({ error: "The parent code is not in this list" }, { status: 422 });
    }
    patch.parent_code = parent;
  }
  if ("flags" in body && current.kind === "resource" && body.flags && typeof body.flags === "object") {
    const f = body.flags as Record<string, unknown>;
    const flags: MasterFlags = { ...current.flags };
    for (const k of ["link_to_inventory", "budget_validation", "revenue_side"] as const) if (k in f) { if (f[k] === true) flags[k] = true; else delete flags[k]; }
    patch.flags = flags;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  const { error } = await admin.from("erp_masters").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "contract_projects", objectId: id, objectLabel: `${MASTER_KIND_LABEL[current.kind]}: ${current.code}`, action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("contract_projects", current as unknown as Record<string, unknown>, patch),
  });
  return NextResponse.json({ ok: true });
}
