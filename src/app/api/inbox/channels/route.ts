import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { listTenantConnectors } from "@/lib/connectors/server";
import { diffForLog, logChange } from "@/lib/changeLog";
import type { TenantFeatures } from "@/lib/constants";
import { MAX_CHANNELS, PENDING_MESSAGE } from "@/lib/inbox/types";
import { channelAddress, newAliasKey } from "@/lib/inbox/rules";
import { parseChannelInput } from "@/lib/inbox/channelInput";
import { isMissingRelation, loadChannels, errorResponse, toChannel } from "@/lib/inbox/server";
import { verifyChannelRefs } from "@/lib/inbox/channelRefs";

// Settings, Inbox channels. Admin only, and only in a workspace that owns the Inbox module (404 otherwise).
//   GET  -> { channels, roles, connectors, templates, inbound_domain, ... }
//   POST { name, role_ids?, default_action?, default_template_id?, reply_from?, reply_name?, connector_id? } -> 201 channel
// A channel's address is generated here (inbox-<random>@INBOUND_EMAIL_DOMAIN); nobody types it.

async function adminOnly() {
  const a = await requireTenantUser();
  if (a.role !== "admin") throw { status: 403, message: "Forbidden" };
  const admin = createAdminSupabase();
  const { data } = await admin.from("tenants").select("features").eq("id", a.tenantId).maybeSingle();
  const features = (data?.features ?? {}) as Partial<TenantFeatures>;
  if (!features.inbox) throw { status: 404, message: "Not found" };
  return { ...a, admin, features };
}

export async function GET() {
  try {
    const { supabase, tenantId, admin, features } = await adminOnly();
    const { channels, missing } = await loadChannels(admin, tenantId);
    const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase() || null;
    const [roles, connectorRows, states, templates] = await Promise.all([
      admin.from("business_roles").select("id, name").eq("tenant_id", tenantId).order("name"),
      listTenantConnectors(supabase, tenantId),
      admin.from("inbox_mailbox_state").select("connector_id, last_polled_at, last_error").eq("tenant_id", tenantId),
      features.estimator ? admin.from("estimate_templates").select("id, name").eq("tenant_id", tenantId).eq("is_active", true).order("name") : Promise.resolve({ data: [] }),
    ]);
    const stateOf = new Map(((states.data ?? []) as { connector_id: string; last_polled_at: string | null; last_error: string | null }[]).map((s) => [s.connector_id, s]));
    const connected = new Set(connectorRows.filter((c) => c.status === "connected").map((c) => c.connector_id));
    return NextResponse.json({
      channels: channels.map((c) => ({
        ...c, address: channelAddress(c.address_alias, domain),
        mailbox_connected: c.connector_id ? connected.has(c.connector_id) : null,
        last_polled_at: c.connector_id ? stateOf.get(c.connector_id)?.last_polled_at ?? null : null,
        last_error: c.connector_id ? stateOf.get(c.connector_id)?.last_error ?? null : null,
      })),
      roles: roles.data ?? [],
      connectors: { gmail: connected.has("gmail"), mail_server: connected.has("mail_server") },
      templates: templates.data ?? [],
      estimator: !!features.estimator,
      inbound_domain: domain,
      sending_configured: !!process.env.RESEND_API_KEY,
      ...(missing ? { pending_migration: true, message: PENDING_MESSAGE } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { tenantId, userId, admin, features } = await adminOnly();
    const parsed = parseChannelInput(await req.json().catch(() => null), { create: true });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const bad = await verifyChannelRefs(admin, tenantId, parsed.values, !!features.estimator);
    if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status });

    const existing = await loadChannels(admin, tenantId);
    if (existing.missing) return NextResponse.json({ error: PENDING_MESSAGE, pending_migration: true }, { status: 503 });
    if (existing.channels.length >= MAX_CHANNELS) return NextResponse.json({ error: `A workspace can have at most ${MAX_CHANNELS} channels.` }, { status: 422 });

    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await admin.from("inbox_channels").insert({
        tenant_id: tenantId, address_alias: newAliasKey(randomBytes(16)), created_by: userId, ...parsed.values,
      }).select("*").single();
      if (!error && data) {
        const ch = toChannel(data as Record<string, unknown>);
        const user = await getAuthUser();
        await logChange(admin, {
          tenantId, objectType: "inbox_channels", objectId: ch.id, objectLabel: ch.name, action: "create", actorId: userId, actorEmail: user?.email,
          changes: diffForLog("inbox_channels", {}, { name: ch.name, default_action: ch.default_action, connector_id: ch.connector_id, role_ids: ch.role_ids }),
        });
        return NextResponse.json({ ...ch, address: channelAddress(ch.address_alias, process.env.INBOUND_EMAIL_DOMAIN) }, { status: 201 });
      }
      if (error?.code === "23505" && /connector/i.test(`${error.message} ${error.details ?? ""}`)) {
        return NextResponse.json({ error: "That mailbox already feeds another channel." }, { status: 409 });
      }
      if (error?.code !== "23505") {
        if (isMissingRelation(error)) return NextResponse.json({ error: PENDING_MESSAGE, pending_migration: true }, { status: 503 });
        return NextResponse.json({ error: error?.message ?? "Could not create the channel." }, { status: 500 });
      }
    }
    return NextResponse.json({ error: "Could not allocate an address; try again." }, { status: 500 });
  } catch (e) {
    return errorResponse(e);
  }
}
