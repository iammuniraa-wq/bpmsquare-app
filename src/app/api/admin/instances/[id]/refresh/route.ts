import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin } from "@/lib/tenant";
import { createAdminSupabase } from "@/lib/supabase-server";
import { controlPlanePrivateKey } from "@/lib/controlPlane/crypto";
import { getInstance, refreshInstance } from "@/lib/controlPlane/registry";

// POST /api/admin/instances/[id]/refresh -- signed pull of one instance's summary, stored on its registry row.
// Platform admin only. The id names a registry row (platform-level, no tenant); the URL fetched is that row's own base_url.

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const priv = controlPlanePrivateKey();
  if (!priv) return NextResponse.json({ error: "The control plane signing key is not configured (CONTROL_PLANE_PRIVATE_KEY)." }, { status: 503 });
  const admin = createAdminSupabase();
  const row = await getInstance(admin, id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status === "planned") return NextResponse.json({ error: "A planned instance is not live yet." }, { status: 409 });
  const result = await refreshInstance(admin, row, priv);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
