import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import type { TenantFeatures } from "@/lib/constants";
import { pollInboxMailboxes } from "@/lib/inbox/poll";
import { errorResponse, loadChannel } from "@/lib/inbox/server";

// POST /api/inbox/channels/[id]/poll  "Read mail now": the same read the 5-minute job does, for this one channel.
// Admin only; the channel is looked up by id AND this workspace. Read-only on the mailbox, like the scheduled run.

export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const a = await requireTenantUser();
    if (a.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const admin = createAdminSupabase();
    const { data } = await admin.from("tenants").select("features").eq("id", a.tenantId).maybeSingle();
    if (!((data?.features ?? {}) as Partial<TenantFeatures>).inbox) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { id } = await params;
    const channel = await loadChannel(admin, a.tenantId, id);
    if (!channel) return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    if (!channel.connector_id) return NextResponse.json({ error: "This channel has no mailbox to read." }, { status: 422 });
    if (!channel.active) return NextResponse.json({ error: "This channel is paused. Tick “Take in new mail” and save first." }, { status: 409 });
    const r = await pollInboxMailboxes(admin, { only: { tenantId: a.tenantId, channelId: id } });
    return NextResponse.json({ ok: true, ...(r.results[0] ?? {}) });
  } catch (e) {
    return errorResponse(e);
  }
}
