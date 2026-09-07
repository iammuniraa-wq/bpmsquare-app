import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const [{ data, error }, { data: gates }] = await Promise.all([
    supabase.from("fence_projects").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("fence_gates").select("*").eq("fence_project_id", id).eq("tenant_id", tenantId).order("created_at"),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...data, gates: gates ?? [] });
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const body = await request.json();

  const allowed = ["name", "account_id", "contact_id", "security_profile_id", "layout", "total_length_m", "fabric_height_m", "mesh_spec", "coating", "status", "custom_data"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) patch[key] = body[key];
  if ("total_length_m" in patch) patch.total_length_m = num(patch.total_length_m);
  if ("fabric_height_m" in patch) patch.fabric_height_m = num(patch.fabric_height_m);
  patch.updated_at = new Date().toISOString();

  // Foreign ids from the body -- verified tenant-scoped before use, per
  // MULTI_TENANT_GUARDRAILS.md (same shape as the fence quote-assembly fix).
  if (patch.account_id) {
    const { data: acct } = await supabase.from("accounts").select("id").eq("id", patch.account_id).eq("tenant_id", tenantId).maybeSingle();
    if (!acct) return NextResponse.json({ error: "Account not found for this tenant" }, { status: 404 });
  }
  if (patch.contact_id) {
    const { data: contact } = await supabase.from("contacts").select("id").eq("id", patch.contact_id).eq("tenant_id", tenantId).maybeSingle();
    if (!contact) return NextResponse.json({ error: "Contact not found for this tenant" }, { status: 404 });
  }
  if (patch.security_profile_id) {
    const { data: profile } = await supabase.from("fence_security_profiles").select("id").eq("id", patch.security_profile_id).eq("tenant_id", tenantId).maybeSingle();
    if (!profile) return NextResponse.json({ error: "Security profile not found for this tenant" }, { status: 404 });
  }

  const { data: before } = await supabase.from("fence_projects").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("fence_projects")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Gates are a full replace-on-save set (edited only as a whole via the
  // configurator sliders, never addressed individually elsewhere yet) --
  // deleting by fence_project_id + tenant_id, both already ownership-checked
  // above, then reinserting is simpler and just as safe as a per-row diff.
  if (Array.isArray(body.gates)) {
    const { error: delErr } = await supabase.from("fence_gates").delete().eq("fence_project_id", id).eq("tenant_id", tenantId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    const cleanGates = (body.gates as { type?: string; width_m?: unknown }[])
      .filter((g) => g?.type && Number(g.width_m) > 0)
      .slice(0, 100)
      .map((g) => ({ tenant_id: tenantId, fence_project_id: id, gate_type: g.type, width_m: num(g.width_m) }));
    if (cleanGates.length > 0) {
      const { error: insErr } = await supabase.from("fence_gates").insert(cleanGates);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  const user = await getAuthUser();
  const changes = diffForLog("fence_projects", (before as Record<string, unknown>) ?? {}, patch);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "fence_projects", objectId: id, objectLabel: (data as { name?: string }).name ?? null,
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data: snap } = await supabase.from("fence_projects").select("name").eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  // fence_gates cascades via the FK's "on delete cascade" -- no separate delete needed.
  const { error } = await supabase.from("fence_projects").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (snap) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "fence_projects", objectId: id, objectLabel: snap.name,
      action: "delete", actorId: user?.id, actorEmail: user?.email,
    });
  }

  return new NextResponse(null, { status: 204 });
}
