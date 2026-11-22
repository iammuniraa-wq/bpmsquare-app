import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin } from "@/lib/tenant";
import { createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { registerInstance } from "@/lib/controlPlane/registry";

// POST /api/admin/instances -- register an instance in the control plane registry. Platform admin only (/admin/instances).
// Platform-level data, no tenant_id (migration 0247); the base URL goes through the SSRF guard before it is stored.

export async function POST(request: NextRequest) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const user = await getAuthUser();
  const result = await registerInstance(createAdminSupabase(), body, user?.email ?? null);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, instance: result.row }, { status: 201 });
}
