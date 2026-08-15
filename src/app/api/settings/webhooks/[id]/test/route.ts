import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { postSigned } from "@/lib/webhooks/dispatch";

// POST /api/settings/webhooks/[id]/test — send a signed sample "ping" to the
// endpoint so an admin can confirm their receiver accepts BPMSquare's signature
// before real events flow. Does not touch the cursor; logs a delivery row.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let tenantId: string;
  try {
    const auth = await requireTenantUser();
    if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    tenantId = auth.tenantId;
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }

  const { id } = await params;
  const admin = createAdminSupabase();
  const { data: wh } = await admin
    .from("webhooks").select("id, url, secret").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!wh) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });

  const deliveryId = crypto.randomUUID();
  const payload = {
    delivery_id: deliveryId,
    sent_at: new Date().toISOString(),
    events: [{ id: deliveryId, object_type: "ping", object_id: id, object_label: "Test ping", action: "ping", changes: null, actor: null, at: new Date().toISOString() }],
  };

  const result = await postSigned(wh.url as string, wh.secret as string, payload, deliveryId);

  await admin.from("webhook_deliveries").insert({
    tenant_id: tenantId, webhook_id: id, event_count: 1,
    status: result.status, ok: result.ok, error: result.error ?? null, duration_ms: result.ms,
  });

  if (!result.ok) return NextResponse.json({ ok: false, status: result.status, error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, status: result.status });
}
