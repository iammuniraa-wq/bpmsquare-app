import { NextResponse, type NextRequest } from "next/server";
import { isPlatformAdmin, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { NOTIFY_SETTING_KEY, loadNotifyAddress } from "@/lib/studio/server";

// The platform setting behind "Talk to us": where a submitted study is emailed.
// Platform admins only. Nothing is hard-coded: with no setting and no
// PROCESS_STUDIO_NOTIFY_EMAIL the request still lands in /admin/studies and the
// client is told it is in the queue.
//
// GET -> { address, source: "setting" | "env" | "none" }
// PUT { notify_email } ("" clears the setting)

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await loadNotifyAddress());
}

export async function PUT(req: NextRequest) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { notify_email?: unknown } | null;
  const email = typeof body?.notify_email === "string" ? body.notify_email.trim() : "";
  if (email && !EMAIL.test(email)) return NextResponse.json({ error: "That doesn't look like a valid email address." }, { status: 422 });
  const user = await getAuthUser();
  const { error } = await createAdminSupabase().from("platform_settings").upsert(
    { key: NOTIFY_SETTING_KEY, value: { notify_email: email }, updated_by: user?.id ?? null, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) {
    const pending = error.code === "42P01" || error.code === "PGRST205";
    return NextResponse.json({ error: pending ? "The platform settings table is waiting for migration 0151." : error.message }, { status: pending ? 503 : 500 });
  }
  return NextResponse.json(await loadNotifyAddress());
}
