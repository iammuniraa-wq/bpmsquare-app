// CRUD for fence_projects (0122, Fence Configurator Phase C/D wiring,
// docs/fence-configurator-architecture.md). Mirrors purchase_orders'
// parent+children insert shape: insertWithMasterRef (FNC-#### already
// registered in masterRef.ts) for the parent, then fence_gates rows
// referencing the new id. account_id/contact_id/security_profile_id are
// foreign ids from the request body -- verified tenant-scoped before use
// per MULTI_TENANT_GUARDRAILS.md.

import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { insertWithMasterRef } from "@/lib/masterRef";
import { diffForLog, logChange } from "@/lib/changeLog";

export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { data, error } = await supabase
    .from("fence_projects")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    if (error.code === "42P01") return NextResponse.json([]); // 0122 pending -- empty, never a crash
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const { name, account_id, contact_id, security_profile_id, layout, total_length_m, fabric_height_m, mesh_spec, coating, custom_data, gates } = body;

  if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (layout !== "open_run" && layout !== "closed_perimeter") return NextResponse.json({ error: "layout must be open_run or closed_perimeter" }, { status: 400 });
  if (!(Number(total_length_m) > 0)) return NextResponse.json({ error: "total_length_m must be a positive number" }, { status: 400 });

  if (account_id) {
    const { data: acct } = await supabase.from("accounts").select("id").eq("id", account_id).eq("tenant_id", tenantId).maybeSingle();
    if (!acct) return NextResponse.json({ error: "Account not found for this tenant" }, { status: 404 });
  }
  if (contact_id) {
    const { data: contact } = await supabase.from("contacts").select("id").eq("id", contact_id).eq("tenant_id", tenantId).maybeSingle();
    if (!contact) return NextResponse.json({ error: "Contact not found for this tenant" }, { status: 404 });
  }
  if (security_profile_id) {
    const { data: profile } = await supabase.from("fence_security_profiles").select("id").eq("id", security_profile_id).eq("tenant_id", tenantId).maybeSingle();
    if (!profile) return NextResponse.json({ error: "Security profile not found for this tenant" }, { status: 404 });
  }

  const record = {
    tenant_id: tenantId,
    name: name.trim(),
    account_id: account_id || null,
    contact_id: contact_id || null,
    security_profile_id: security_profile_id || null,
    layout,
    total_length_m: num(total_length_m),
    fabric_height_m: num(fabric_height_m) ?? 2,
    mesh_spec: mesh_spec || null,
    coating: coating || null,
    status: "draft",
    custom_data: custom_data ?? null,
    created_by: userId,
  };

  const { data, error } = await insertWithMasterRef<{ id: string; ref: string; name: string }>(supabase, "fence_projects", tenantId, record, "*");
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });

  const cleanGates = Array.isArray(gates)
    ? gates
        .filter((g) => g?.type && Number(g.width_m) > 0)
        .slice(0, 100)
        .map((g) => ({ tenant_id: tenantId, fence_project_id: data.id, gate_type: g.type, width_m: num(g.width_m) }))
    : [];
  if (cleanGates.length > 0) {
    const { error: gatesErr } = await supabase.from("fence_gates").insert(cleanGates);
    if (gatesErr) return NextResponse.json({ error: gatesErr.message }, { status: 500 });
  }

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "fence_projects", objectId: data.id, objectLabel: data.name,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("fence_projects", {}, record as unknown as Record<string, unknown>),
  });

  return NextResponse.json(data, { status: 201 });
}
