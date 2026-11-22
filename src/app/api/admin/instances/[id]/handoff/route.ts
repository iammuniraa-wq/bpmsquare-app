import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin } from "@/lib/tenant";
import { createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { controlPlanePrivateKey, mintHandoffToken } from "@/lib/controlPlane/crypto";
import { getInstance, recordEvent } from "@/lib/controlPlane/registry";
import { safeInternalPath } from "@/lib/safeRedirect";

// POST /api/admin/instances/[id]/handoff -- mint a 2-minute, single-use, Ed25519-signed token that opens THIS person's admin on
// ONE registered instance, and return the URL to open. Platform admin only. The token names the instance slug, so it is useless
// on any other instance; the instance still checks the person is a platform admin in its own database. The event is the audit
// trail on this side (who, which instance, where it lands).

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const user = await getAuthUser();
  if (!user?.email) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const priv = controlPlanePrivateKey();
  if (!priv) return NextResponse.json({ error: "The control plane signing key is not configured (CONTROL_PLANE_PRIVATE_KEY)." }, { status: 503 });

  const admin = createAdminSupabase();
  const row = await getInstance(admin, id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status !== "active") return NextResponse.json({ error: "Only an active instance can be opened." }, { status: 409 });

  const body = (await request.json().catch(() => null)) as { next?: unknown } | null;
  const next = safeInternalPath(typeof body?.next === "string" ? body.next : null, "/admin/tenants");
  const { token, claims } = mintHandoffToken(priv, { sub: user.email.toLowerCase(), inst: row.slug });
  await recordEvent(admin, row.id, "open_admin", user.email, { slug: row.slug, next, jti: claims.jti });

  const url = `${row.base_url}/api/platform/handoff?t=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
  return NextResponse.json({ ok: true, url });
}
