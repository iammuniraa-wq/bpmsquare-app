import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { isMissingRelation, tenantHasRfq } from "@/lib/rfq/server";

// GET ?line_ids=a,b,c -- where each RFQ line a document line points at
// stands, so a quote/deal editor can show "RFQ sent · 2/3 replied" or
// "Awarded — re-price" on a line after a reload. Any signed-in member of the
// tenant may ask (they can already see the document); the answer carries
// status and counts only -- never a supplier's price, which is the buyer's.

export async function GET(req: NextRequest) {
  let tenantId: string;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  const admin = createAdminSupabase();
  if (!(await tenantHasRfq(admin, tenantId))) return NextResponse.json({ lines: {} });
  const ids = (req.nextUrl.searchParams.get("line_ids") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 200);
  if (!ids.length) return NextResponse.json({ lines: {} });

  const { data: lines, error } = await admin.from("rfq_lines").select("id, rfq_id, status, awarded_unit_cost, rfqs(ref, status)").eq("tenant_id", tenantId).in("id", ids);
  if (error) return NextResponse.json({ lines: {}, pending_migration: isMissingRelation(error) });
  const rows = (lines ?? []) as unknown as { id: string; rfq_id: string; status: string; awarded_unit_cost: number | null; rfqs: { ref: string; status: string } | null }[];
  const rfqIds = [...new Set(rows.map((r) => r.rfq_id))];
  const { data: sups } = rfqIds.length
    ? await admin.from("rfq_suppliers").select("rfq_id, status").eq("tenant_id", tenantId).in("rfq_id", rfqIds)
    : { data: [] };
  const counts = new Map<string, { asked: number; replied: number }>();
  for (const s of (sups ?? []) as { rfq_id: string; status: string }[]) {
    if (s.status === "cancelled" || s.status === "pending") continue;
    const c = counts.get(s.rfq_id) ?? { asked: 0, replied: 0 };
    c.asked++;
    if (s.status === "replied" || s.status === "declined") c.replied++;
    counts.set(s.rfq_id, c);
  }
  const out: Record<string, { rfq_id: string; ref: string | null; rfq_status: string | null; line_status: string; asked: number; replied: number; awarded: boolean }> = {};
  for (const r of rows) {
    const c = counts.get(r.rfq_id) ?? { asked: 0, replied: 0 };
    out[r.id] = { rfq_id: r.rfq_id, ref: r.rfqs?.ref ?? null, rfq_status: r.rfqs?.status ?? null, line_status: r.status, asked: c.asked, replied: c.replied, awarded: r.status === "awarded" };
  }
  return NextResponse.json({ lines: out });
}
