import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import type { TenantConfig, RfqConfig } from "@/lib/constants";
import { rfqConfig } from "@/lib/rfq/types";
import { rfqSecretConfigured } from "@/lib/rfq/token";

// GET/PUT /api/settings/rfq -- config.rfq (admin only). GET also reports what
// the platform has set up, so the screen can say honestly which channels
// work: a reply link needs RFQ_LINK_SECRET, platform replies need
// INBOUND_EMAIL_DOMAIN, mailbox mode needs a connected mailbox.

async function admin() {
  const a = await requireTenantUser();
  if (a.role !== "admin") throw { status: 403, message: "Forbidden" };
  return a;
}

async function readiness(tenantId: string, cfg: ReturnType<typeof rfqConfig>) {
  const db = createAdminSupabase();
  const { data: conns } = await db.from("tenant_connectors").select("connector_id, status").eq("tenant_id", tenantId).in("connector_id", ["gmail", "mail_server"]);
  const connected = ((conns ?? []) as { connector_id: string; status: string }[]).filter((c) => c.status === "connected").map((c) => c.connector_id);
  const { data: state } = await db.from("rfq_mailbox_state").select("last_polled_at, last_error").eq("tenant_id", tenantId).eq("connector_id", cfg.mailbox_connector).maybeSingle();
  return {
    reply_link: rfqSecretConfigured(),
    platform_send: !!process.env.RESEND_API_KEY,
    platform_receive: !!process.env.INBOUND_EMAIL_DOMAIN && !!process.env.RESEND_INBOUND_WEBHOOK_SECRET,
    inbound_domain: process.env.INBOUND_EMAIL_DOMAIN ?? null,
    mailboxes_connected: connected,
    mailbox_last_polled_at: (state?.last_polled_at as string | null) ?? null,
    mailbox_last_error: (state?.last_error as string | null) ?? null,
  };
}

export async function GET() {
  try {
    const { tenantId } = await admin();
    const { data } = await createAdminSupabase().from("tenants").select("config").eq("id", tenantId).maybeSingle();
    const cfg = rfqConfig((data?.config as TenantConfig | null)?.rfq);
    return NextResponse.json({ config: cfg, readiness: await readiness(tenantId, cfg) });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { tenantId } = await admin();
    const body = (await req.json().catch(() => null)) as Partial<RfqConfig> | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    const db = createAdminSupabase();
    const { data: current, error } = await db.from("tenants").select("config").eq("id", tenantId).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const config = (current?.config ?? {}) as TenantConfig;
    const merged = rfqConfig({ ...(config.rfq ?? {}), ...body });
    if (merged.mail_mode === "mailbox") {
      const r = await readiness(tenantId, merged);
      if (!r.mailboxes_connected.includes(merged.mailbox_connector)) {
        return NextResponse.json({ error: `Connect the ${merged.mailbox_connector === "gmail" ? "Gmail" : "Mail server"} connector first (Settings → Connectors).` }, { status: 422 });
      }
    }
    const next: TenantConfig = { ...config, rfq: merged };
    const { error: upErr } = await db.from("tenants").update({ config: next }).eq("id", tenantId);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    return NextResponse.json({ config: merged, readiness: await readiness(tenantId, merged) });
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
}
