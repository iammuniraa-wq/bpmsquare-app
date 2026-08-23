import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";

const ROLES = ["owner", "overlay", "service"] as const;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let supabase, tenantId, role, userId;
  try {
    ({ supabase, tenantId, role, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminSupabase();
  const { data: before } = await admin.from("coverages").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const { role: coverageRole, priority, erp_endpoint_id, effective_from, effective_to } = body as {
    role?: string; priority?: number; erp_endpoint_id?: string | null; effective_from?: string; effective_to?: string | null;
  };

  const patch: Record<string, unknown> = {};
  if (coverageRole !== undefined) {
    if (!ROLES.includes(coverageRole as (typeof ROLES)[number])) {
      return NextResponse.json({ error: `role must be one of: ${ROLES.join(", ")}` }, { status: 400 });
    }
    patch.role = coverageRole;
  }
  if (Number.isFinite(priority)) patch.priority = priority;
  if (effective_from !== undefined) patch.effective_from = effective_from;
  if (effective_to !== undefined) patch.effective_to = effective_to;
  if (erp_endpoint_id !== undefined) {
    if (erp_endpoint_id === null) {
      patch.erp_endpoint_id = null;
    } else {
      const { data: tenant } = await admin.from("tenants").select("config").eq("id", tenantId).maybeSingle();
      const endpoints = (tenant?.config as { integration_push?: { endpoints?: { id: string }[] } } | null)?.integration_push?.endpoints ?? [];
      patch.erp_endpoint_id = endpoints.some((e) => e.id === erp_endpoint_id) ? erp_endpoint_id : null;
    }
  }

  const { data: coverage, error } = await admin
    .from("coverages").update(patch).eq("id", id).eq("tenant_id", tenantId).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const changes = diffForLog("coverages", before, patch);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "coverages", objectId: id,
      objectLabel: `${coverage.role} coverage`, action: "update", actorId: userId, changes,
    });
  }
  return NextResponse.json(coverage);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let supabase, tenantId, role, userId;
  try {
    ({ supabase, tenantId, role, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminSupabase();
  const { data: before } = await admin.from("coverages").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await admin.from("coverages").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logChange(supabase, {
    tenantId, objectType: "coverages", objectId: id,
    objectLabel: `${before.role} coverage`, action: "delete", actorId: userId,
  });
  return NextResponse.json({ ok: true });
}
