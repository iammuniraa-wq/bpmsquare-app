import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { loadRfqBundle, sendToSupplier, loadTenantById } from "@/lib/rfq/server";
import { rfqConfig } from "@/lib/rfq/types";
import { addDays } from "@/lib/rfq/rules";
import { tenantToday } from "@/lib/tenantClock";
import type { TenantConfig } from "@/lib/constants";

// GET /api/rfqs/cron/reminders -- daily (vercel.json).
//  - A supplier still silent the day before respond_by gets one reminder,
//    and another the day after it, up to config.rfq.max_reminders (default 2).
//  - Once respond_by + link_grace_days has passed, a silent supplier is marked
//    expired (the link has stopped working by then anyway).
// Every send goes through sendToSupplier, so resolveOutbound() applies.

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminSupabase();
  const { data: tenants, error } = await admin.from("tenants").select("id, slug, config").contains("features", { rfq: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: { tenant: string; reminded: number; expired: number; error?: string }[] = [];
  for (const t of tenants ?? []) {
    const cfg = rfqConfig((t.config as TenantConfig | null)?.rfq);
    let reminded = 0;
    let expired = 0;
    try {
      const today = await tenantToday(t.id as string);
      const { data: rfqs } = await admin.from("rfqs").select("id, respond_by").eq("tenant_id", t.id).in("status", ["sent", "partially_replied"]).not("respond_by", "is", null);
      const tenant = await loadTenantById(admin, t.id as string);
      if (!tenant) continue;
      for (const r of (rfqs ?? []) as { id: string; respond_by: string }[]) {
        const before = addDays(r.respond_by, -1);
        const after = addDays(r.respond_by, 1);
        const dead = addDays(r.respond_by, cfg.link_grace_days);
        if (today > dead) {
          const { data } = await admin.from("rfq_suppliers").update({ status: "expired", updated_at: new Date().toISOString() })
            .eq("tenant_id", t.id).eq("rfq_id", r.id).in("status", ["sent", "viewed"]).select("id");
          expired += (data ?? []).length;
          continue;
        }
        if (today !== before && today !== after) continue;
        const bundle = await loadRfqBundle(admin, t.id as string, r.id, { messages: false });
        if (!bundle) continue;
        for (const rs of bundle.suppliers) {
          if (!["sent", "viewed"].includes(rs.status) || (rs.reminder_count ?? 0) >= cfg.max_reminders) continue;
          if (rs.last_reminded_at && rs.last_reminded_at.slice(0, 10) === today) continue;
          const res = await sendToSupplier(admin, { tenant, bundle, rs, kind: "reminder", actor: { id: null, email: null } });
          if (res.ok) reminded++;
        }
      }
      results.push({ tenant: t.slug as string, reminded, expired });
    } catch (e) {
      results.push({ tenant: t.slug as string, reminded, expired, error: (e as Error).message });
    }
  }
  return NextResponse.json({ ok: true, results });
}
