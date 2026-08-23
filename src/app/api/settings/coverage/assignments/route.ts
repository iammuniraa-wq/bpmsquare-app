import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";

const ROLES = ["owner", "overlay", "service"] as const;

async function validateErpEndpointId(admin: ReturnType<typeof createAdminSupabase>, tenantId: string, erpEndpointId: unknown): Promise<string | null | undefined> {
  if (erpEndpointId === undefined) return undefined;
  if (erpEndpointId === null) return null;
  if (typeof erpEndpointId !== "string") return undefined;
  const { data: tenant } = await admin.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const endpoints = (tenant?.config as { integration_push?: { endpoints?: { id: string }[] } } | null)?.integration_push?.endpoints ?? [];
  return endpoints.some((e) => e.id === erpEndpointId) ? erpEndpointId : null;
}

export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { data, error } = await supabase
    .from("coverages").select("*, segments(code, name), teams(name)")
    .eq("tenant_id", tenantId).order("created_at");
  if (error) {
    if ((error as { code?: string }).code === "42P01") return NextResponse.json([]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  let supabase, tenantId, role, userId;
  try {
    ({ supabase, tenantId, role, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { segment_id, team_id, role: coverageRole, priority, erp_endpoint_id, effective_from, effective_to } = body as {
    segment_id?: string; team_id?: string; role?: string; priority?: number;
    erp_endpoint_id?: string | null; effective_from?: string; effective_to?: string | null;
  };
  if (!segment_id || !team_id || !ROLES.includes(coverageRole as (typeof ROLES)[number])) {
    return NextResponse.json({ error: `segment_id, team_id and a role in [${ROLES.join(", ")}] are required` }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const [{ data: segment }, { data: team }] = await Promise.all([
    admin.from("segments").select("id").eq("id", segment_id).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("teams").select("id").eq("id", team_id).eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (!segment) return NextResponse.json({ error: "Segment not found" }, { status: 404 });
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  const resolvedEndpointId = await validateErpEndpointId(admin, tenantId, erp_endpoint_id);

  const { data: coverage, error } = await admin
    .from("coverages")
    .insert({
      tenant_id: tenantId, segment_id, team_id, role: coverageRole,
      priority: Number.isFinite(priority) ? priority : 100,
      erp_endpoint_id: resolvedEndpointId ?? null,
      effective_from: effective_from || new Date().toISOString().slice(0, 10),
      effective_to: effective_to || null,
    })
    .select("*").single();
  if (error) {
    if (error.code === "42P01") return NextResponse.json({ error: "Coverage isn't set up on the server yet." }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logChange(supabase, {
    tenantId, objectType: "coverages", objectId: coverage.id,
    objectLabel: `${coverageRole} coverage`, action: "create", actorId: userId,
  });
  return NextResponse.json(coverage, { status: 201 });
}
