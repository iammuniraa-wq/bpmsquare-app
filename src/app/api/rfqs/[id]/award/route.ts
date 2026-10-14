import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse, awardLine } from "@/lib/rfq/server";
import type { Rfq } from "@/lib/rfq/types";

// POST { line_id, response_id | null, fx_rate? }   -- award one line (null = no award)
// POST { rfq_supplier_id, all: true, fx_rate? }     -- award every line that
//                                                       supplier quoted
// The award is a COST: for a catalog product it becomes a confirmed cost
// input the pricing engine uses on the next Price; the rep re-prices.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await rfqAccess(true);
    const { id } = await params;
    const { data: rfq } = await ctx.admin.from("rfqs").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    if (["cancelled", "closed", "draft"].includes(rfq.status as string)) return NextResponse.json({ error: rfq.status === "draft" ? "Send the RFQ before awarding." : "This RFQ is closed." }, { status: 409 });
    const body = (await req.json().catch(() => ({}))) as { line_id?: string; response_id?: string | null; rfq_supplier_id?: string; all?: boolean; fx_rate?: number | string | null };
    const fx = body.fx_rate === undefined || body.fx_rate === null || body.fx_rate === "" ? null : Number(body.fx_rate);

    if (body.all && body.rfq_supplier_id) {
      const { data: rs } = await ctx.admin.from("rfq_suppliers").select("id").eq("id", body.rfq_supplier_id).eq("tenant_id", ctx.tenantId).eq("rfq_id", id).maybeSingle();
      if (!rs) return NextResponse.json({ error: "Supplier not on this RFQ" }, { status: 404 });
      const { data: resps } = await ctx.admin.from("rfq_responses").select("id, rfq_line_id, status, unit_price").eq("tenant_id", ctx.tenantId).eq("rfq_supplier_id", rs.id);
      const priced = ((resps ?? []) as { id: string; rfq_line_id: string; status: string; unit_price: number | null }[]).filter((r) => r.status !== "no_quote" && r.unit_price !== null);
      if (!priced.length) return NextResponse.json({ error: "That supplier hasn't quoted any line." }, { status: 422 });
      const results = [];
      for (const r of priced) {
        results.push({ line_id: r.rfq_line_id, ...(await awardLine(ctx.admin, ctx, { rfq: rfq as Rfq, lineId: r.rfq_line_id, responseId: r.id, fxRate: fx })) });
      }
      return NextResponse.json({ ok: true, results });
    }

    if (!body.line_id) return NextResponse.json({ error: "line_id is required" }, { status: 422 });
    const result = await awardLine(ctx.admin, ctx, { rfq: rfq as Rfq, lineId: body.line_id, responseId: body.response_id ?? null, fxRate: fx });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return errorResponse(e);
  }
}
