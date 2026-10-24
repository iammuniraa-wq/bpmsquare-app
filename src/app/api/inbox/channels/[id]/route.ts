import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";
import type { TenantFeatures } from "@/lib/constants";
import { channelAddress, newAliasKey } from "@/lib/inbox/rules";
import { parseChannelInput } from "@/lib/inbox/channelInput";
import { verifyChannelRefs } from "@/lib/inbox/channelRefs";
import { errorResponse, loadChannel } from "@/lib/inbox/server";

// PATCH  /api/inbox/channels/[id]  any of: name, role_ids, default_action, default_template_id, reply_from, reply_name,
//                                  connector_id, active, rotate_alias: true (a new address; the old one stops working)
// DELETE /api/inbox/channels/[id]  only a channel with no mail; otherwise pause it (mail is correspondence, never lost by a click)
// Admin only; the channel is looked up by id AND this workspace.

async function adminOnly() {
  const a = await requireTenantUser();
  if (a.role !== "admin") throw { status: 403, message: "Forbidden" };
  const admin = createAdminSupabase();
  const { data } = await admin.from("tenants").select("features").eq("id", a.tenantId).maybeSingle();
  const features = (data?.features ?? {}) as Partial<TenantFeatures>;
  if (!features.inbox) throw { status: 404, message: "Not found" };
  return { ...a, admin, features };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId, userId, admin, features } = await adminOnly();
    const { id } = await params;
    const before = await loadChannel(admin, tenantId, id);
    if (!before) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const parsed = parseChannelInput(await req.json().catch(() => null), { create: false });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const bad = await verifyChannelRefs(admin, tenantId, parsed.values, !!features.estimator);
    if (bad) return NextResponse.json({ error: bad.error }, { status: bad.status });

    const patch: Record<string, unknown> = { ...parsed.values, updated_at: new Date().toISOString() };
    if (parsed.rotate) patch.address_alias = newAliasKey(randomBytes(16));
    const { data, error } = await admin.from("inbox_channels").update(patch).eq("id", id).eq("tenant_id", tenantId).select("*").single();
    if (error || !data) {
      if (error?.code === "23505") return NextResponse.json({ error: "That mailbox already feeds another channel." }, { status: 409 });
      return NextResponse.json({ error: error?.message ?? "Could not save the channel." }, { status: 500 });
    }
    const after = data as Record<string, unknown>;
    const user = await getAuthUser();
    await logChange(admin, {
      tenantId, objectType: "inbox_channels", objectId: id, objectLabel: (after.name as string) ?? before.name, action: "update", actorId: userId, actorEmail: user?.email,
      changes: diffForLog("inbox_channels", before as unknown as Record<string, unknown>, {
        ...parsed.values, ...(parsed.rotate ? { address_alias: "[rotated]" } : {}),
      }),
    });
    return NextResponse.json({ ...after, address: channelAddress(after.address_alias as string, process.env.INBOUND_EMAIL_DOMAIN) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId, userId, admin } = await adminOnly();
    const { id } = await params;
    const ch = await loadChannel(admin, tenantId, id);
    if (!ch) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    const { count } = await admin.from("inbound_emails").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("channel_id", id);
    if ((count ?? 0) > 0) return NextResponse.json({ error: "This channel has mail in it. Pause it instead; the mail is cleared on its own schedule." }, { status: 409 });
    const { error } = await admin.from("inbox_channels").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const user = await getAuthUser();
    await logChange(admin, { tenantId, objectType: "inbox_channels", objectId: id, objectLabel: ch.name, action: "delete", actorId: userId, actorEmail: user?.email });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
