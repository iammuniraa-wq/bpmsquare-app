import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { recomputeTenant } from "@/lib/signals/recompute";

export const maxDuration = 60;
const BUDGET_MS = 50_000;

// GET /api/signals/cron/rescore -- every few hours (vercel.json). For each tenant
// that owns Marketing AND the platform-admin flag buying_signals, rescore its
// accounts from the first-party events and store the result.
//
// Scales by bounding, not by hoping (the RFQ mailbox poller's shape): tenants are
// taken least recently scored first, so a large fleet is covered round-robin;
// the run stops starting work after a time budget; and inside a tenant the
// accounts least recently scored go first, so the next run carries on where this
// one stopped. A tenant without the flag is never selected: no flag, no work.
// Running it twice changes nothing the second time (see recompute.ts).

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const admin = createAdminSupabase();
  const { data: tenants, error } = await admin.from("tenants").select("id, slug").contains("features", { marketing: true, buying_signals: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const list = (tenants ?? []) as { id: string; slug: string }[];

  const lastRun = new Map<string, string>();
  await Promise.all(list.map(async (t) => {
    const { data } = await admin.from("signal_runs").select("finished_at").eq("tenant_id", t.id).order("finished_at", { ascending: false }).limit(1);
    lastRun.set(t.id, (data as { finished_at: string | null }[] | null)?.[0]?.finished_at ?? "");
  }));
  list.sort((a, b) => (lastRun.get(a.id) ?? "").localeCompare(lastRun.get(b.id) ?? ""));

  const results: { tenant: string; scored?: number; stage_changes?: number; alerts?: number; partial?: boolean; error?: string }[] = [];
  for (const t of list) {
    if (Date.now() - started > BUDGET_MS) break;
    const r = await recomputeTenant(admin, t.id, { source: "cron", deadline: started + BUDGET_MS });
    results.push({ tenant: t.slug, scored: r.scored, stage_changes: r.stageChanges, alerts: r.alerts, partial: r.partial, ...(r.error ? { error: r.error } : {}) });
  }
  return NextResponse.json({ ok: true, tenants: list.length, results });
}
