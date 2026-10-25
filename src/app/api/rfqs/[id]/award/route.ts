import { NextResponse, type NextRequest } from "next/server";
import { rfqAccess, errorResponse } from "@/lib/rfq/server";
import { awardWithDecision, AwardError, type AwardTarget } from "@/lib/rfq/awards";
import { rfqConfig, type Rfq } from "@/lib/rfq/types";
import type { TenantConfig } from "@/lib/constants";

// POST { line_id, response_id | null, fx_rate?, reason?, replace? }   -- award one line (null = no award)
// POST { rfq_supplier_id, all: true, fx_rate?, reason?, replace? }     -- award every line that supplier quoted
// The award is a COST: for a catalog product it becomes a confirmed cost input the pricing engine uses on the next Price; the
// rep re-prices. Since slice 3b the award is also a RECORDED DECISION (rfq_line_awards): who chose it, when, and a reason when
// the chosen answer is not the lowest valid price. 422 {code: "reason_required"} asks for it; 409 {code: "already_awarded"}
// means the line has an award and `replace: true` was not sent; 503 means migration 0224 has not run.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await rfqAccess(true);
    const { id } = await params;
    const { data: rfq } = await ctx.admin.from("rfqs").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    if (["cancelled", "closed", "draft"].includes(rfq.status as string)) return NextResponse.json({ error: rfq.status === "draft" ? "Send the RFQ before awarding." : "This RFQ is closed." }, { status: 409 });
    const body = (await req.json().catch(() => ({}))) as { line_id?: string; response_id?: string | null; rfq_supplier_id?: string; all?: boolean; fx_rate?: number | string | null; reason?: unknown; replace?: unknown };

    const { data: t } = await ctx.admin.from("tenants").select("config").eq("id", ctx.tenantId).maybeSingle();
    const cfg = rfqConfig((t?.config as TenantConfig | null)?.rfq);

    let targets: AwardTarget[];
    if (body.all && body.rfq_supplier_id) {
      const { data: rs } = await ctx.admin.from("rfq_suppliers").select("id").eq("id", body.rfq_supplier_id).eq("tenant_id", ctx.tenantId).eq("rfq_id", id).maybeSingle();
      if (!rs) return NextResponse.json({ error: "Supplier not on this RFQ" }, { status: 404 });
      const { data: resps } = await ctx.admin.from("rfq_responses").select("id, rfq_line_id, status, unit_price").eq("tenant_id", ctx.tenantId).eq("rfq_supplier_id", rs.id);
      const priced = ((resps ?? []) as { id: string; rfq_line_id: string; status: string; unit_price: number | null }[]).filter((r) => r.status !== "no_quote" && r.unit_price !== null);
      if (!priced.length) return NextResponse.json({ error: "That supplier hasn't quoted any line." }, { status: 422 });
      targets = priced.map((r) => ({ lineId: r.rfq_line_id, responseId: r.id }));
    } else {
      if (!body.line_id) return NextResponse.json({ error: "line_id is required" }, { status: 422 });
      targets = [{ lineId: body.line_id, responseId: body.response_id ?? null }];
    }

    const results = await awardWithDecision(ctx.admin, ctx, {
      rfq: rfq as Rfq, targets, reason: body.reason, replace: body.replace === true, fxRate: body.fx_rate, staleDays: cfg.price_valid_days,
    });
    // The single-line shape the screen has always read stays at the top level.
    const first = results[0];
    return NextResponse.json({ ok: true, ...(results.length === 1 ? first : {}), results });
  } catch (e) {
    if (e instanceof AwardError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
    return errorResponse(e);
  }
}
