import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";

// PATCH /api/wfm/sites/[id] — edit / activate / deactivate (tenant admin only).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = ctx;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.lat === "number" && body.lat >= -90 && body.lat <= 90) patch.lat = body.lat;
  if (typeof body.lng === "number" && body.lng >= -180 && body.lng <= 180) patch.lng = body.lng;
  if (typeof body.radius_m === "number" && body.radius_m > 0) patch.radius_m = Math.round(body.radius_m);
  if (typeof body.active === "boolean") patch.active = body.active;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("wfm_sites")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id, name, lat, lng, radius_m, active")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
