import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse, isMissingRelation } from "@/lib/rfq/server";

// GET ?supplier_id= -- how this supplier performs on RFQs: how often asked,
// how often they reply and how fast, how often they win, and their latest
// RFQs. For the supplier's own page. Counts and dates only; prices stay on
// the RFQ screens.
export async function GET(req: NextRequest) {
  try {
    const { admin, tenantId } = await rfqAccess(false);
    const supplierId = req.nextUrl.searchParams.get("supplier_id") ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(supplierId)) return NextResponse.json({ error: "supplier_id is required" }, { status: 422 });
    const { data: rows, error } = await admin.from("rfq_suppliers")
      .select("id, rfq_id, status, sent_at, replied_at, rfqs(ref, title, status, created_at)")
      .eq("tenant_id", tenantId).eq("supplier_id", supplierId).order("created_at", { ascending: false }).limit(500);
    if (error) return NextResponse.json({ stats: null, recent: [], pending_migration: isMissingRelation(error) });
    const list = (rows ?? []) as unknown as { id: string; rfq_id: string; status: string; sent_at: string | null; replied_at: string | null; rfqs: { ref: string; title: string; status: string; created_at: string } | null }[];
    const asked = list.filter((r) => r.sent_at);
    const replied = asked.filter((r) => r.status === "replied" && r.replied_at);
    const hours = replied.map((r) => (Date.parse(r.replied_at!) - Date.parse(r.sent_at!)) / 3_600_000).filter((h) => h >= 0).sort((a, b) => a - b);
    const median = hours.length ? hours[Math.floor(hours.length / 2)] : null;
    let won = 0;
    if (list.length) {
      const { count } = await admin.from("rfq_responses").select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("is_awarded", true).in("rfq_supplier_id", list.map((r) => r.id));
      won = count ?? 0;
    }
    return NextResponse.json({
      stats: {
        asked: asked.length,
        replied: replied.length,
        declined: asked.filter((r) => r.status === "declined").length,
        reply_rate: asked.length ? Math.round((replied.length / asked.length) * 100) : null,
        median_reply_hours: median === null ? null : Math.round(median * 10) / 10,
        lines_won: won,
      },
      recent: list.slice(0, 8).map((r) => ({ rfq_id: r.rfq_id, ref: r.rfqs?.ref ?? null, title: r.rfqs?.title ?? "", rfq_status: r.rfqs?.status ?? null, status: r.status, sent_at: r.sent_at })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
