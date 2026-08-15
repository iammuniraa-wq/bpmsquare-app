import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { deliverWebhook, type WebhookRow } from "@/lib/webhooks/dispatch";

// GET /api/webhooks/cron — periodic Vercel cron (vercel.json).
// Drains every active webhook's change_log backlog and POSTs it, signed, to the
// registered URL. Platform-wide (a cron is not per-tenant); each webhook row
// carries its own tenant_id and the dispatcher filters every query by it.
//
// SCHEDULE CONSTRAINT: the Vercel account is on the Hobby plan, which allows
// at most 2 cron jobs and ONLY once-per-day schedules -- a more frequent
// schedule in vercel.json makes EVERY deployment fail config validation
// (this exact mistake stalled all deploys for 11h on 2026-08-15). Until the
// account moves to Pro, the cron runs daily; for near-real-time delivery,
// call this endpoint (with the CRON_SECRET bearer) from an external
// scheduler, or trigger a manual drain via the webhook "Test" flow.
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminSupabase();
  const { data: webhooks, error } = await admin
    .from("webhooks")
    .select("id, tenant_id, url, secret, object_types, cursor_ts, cursor_id, failure_count")
    .eq("active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { id: string; delivered: number; ok: boolean }[] = [];
  for (const wh of (webhooks ?? []) as WebhookRow[]) {
    const r = await deliverWebhook(admin, wh);
    if (!r.skipped) results.push({ id: wh.id, delivered: r.delivered, ok: r.ok });
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
