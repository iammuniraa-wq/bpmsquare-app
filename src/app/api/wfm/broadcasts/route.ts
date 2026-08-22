import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm } from "@/lib/wfm/server";

// Broadcast messages — tenant-wide announcements (PagarBook parity).
// GET: every WFM member reads the active list + their own read state.
// POST: supervisors/admins compose. Deactivation lives on the [id] route.

const MAX_LIST = 50;

export async function GET() {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const admin = createAdminSupabase();
  const [{ data: rows, error }, { data: reads }] = await Promise.all([
    admin
      .from("wfm_broadcasts")
      .select("id, title, body, created_by_name, created_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(MAX_LIST),
    admin
      .from("wfm_broadcast_reads")
      .select("broadcast_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("user_id", ctx.userId),
  ]);
  if (error) {
    if ((error as { code?: string }).code === "42P01") {
      return NextResponse.json({ broadcasts: [], unread: 0, unavailable: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const readSet = new Set((reads ?? []).map((r) => r.broadcast_id as string));
  const broadcasts = (rows ?? []).map((b) => ({ ...b, read: readSet.has(b.id as string) }));
  return NextResponse.json({
    broadcasts,
    unread: broadcasts.filter((b) => !b.read).length,
    can_compose: ctx.isSupervisor,
  });
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!ctx.isSupervisor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 160) : "";
  const text = typeof body?.body === "string" ? body.body.trim().slice(0, 4000) : "";
  if (!title) return NextResponse.json({ error: "A title is required" }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: membership } = await admin
    .from("tenant_users")
    .select("display_name")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.userId)
    .maybeSingle();

  const { data: row, error } = await admin
    .from("wfm_broadcasts")
    .insert({
      tenant_id: ctx.tenantId,
      title,
      body: text,
      created_by: ctx.userId,
      created_by_name: membership?.display_name ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "42P01") {
      return NextResponse.json({ error: "Broadcasts aren't set up on the server yet." }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
}
