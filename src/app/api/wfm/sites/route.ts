import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";
import { wfmSitesPayload } from "@/lib/wfm/bootstrap";

// GET /api/wfm/sites — list sites (supervisor/admin).
export async function GET() {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  try {
    return NextResponse.json(await wfmSitesPayload(ctx.supabase, ctx.tenantId));
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST /api/wfm/sites — create a site (tenant admin only).
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = ctx;

  const body = await request.json().catch(() => null);
  const { name, lat, lng, radius_m } = (body ?? {}) as {
    name?: string; lat?: number; lng?: number; radius_m?: number;
  };
  if (!name?.trim() || typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "name, lat and lng are required" }, { status: 400 });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("wfm_sites")
    .insert({
      tenant_id: tenantId,
      name: name.trim(),
      lat,
      lng,
      radius_m: typeof radius_m === "number" && radius_m > 0 ? Math.round(radius_m) : 150,
    })
    .select("id, name, lat, lng, radius_m, active")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
