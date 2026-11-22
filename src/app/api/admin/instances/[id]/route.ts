import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin } from "@/lib/tenant";
import { createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { INSTANCE_STATUSES, getInstance, recordEvent, type InstanceStatus } from "@/lib/controlPlane/registry";

// PATCH /api/admin/instances/[id] -- the one edit the console offers: planned -> active -> retired. Platform admin only.

const UUID = /^[0-9a-f-]{36}$/i;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
  const status = body?.status as InstanceStatus;
  if (!INSTANCE_STATUSES.includes(status)) return NextResponse.json({ error: "Status must be planned, active or retired" }, { status: 422 });
  const admin = createAdminSupabase();
  const row = await getInstance(admin, id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { error } = await admin.from("platform_instances").update({ status }).eq("id", id);
  if (error) return NextResponse.json({ error: "The status could not be saved" }, { status: 500 });
  const user = await getAuthUser();
  await recordEvent(admin, id, "status_changed", user?.email ?? null, { from: row.status, to: status });
  return NextResponse.json({ ok: true });
}
