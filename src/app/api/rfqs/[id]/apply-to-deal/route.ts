import { NextResponse, NextRequest } from "next/server";
import { rfqAccess, errorResponse } from "@/lib/rfq/server";
import { loadCurrentAwards, AwardError, AWARDS_PENDING_MESSAGE } from "@/lib/rfq/awards";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { loadOpportunity, loadOpportunityLines } from "@/lib/sales/opportunityServer";
import { logChange } from "@/lib/changeLog";

// POST /api/rfqs/[id]/apply-to-deal -- "Use these prices on the deal lines" (GCC tender deals, slice 3b).
// For an RFQ raised from a deal: every deal line that asked about an RFQ line with a standing award gets that award's price (the
// supplier's unit price in the workspace currency) as its rate. The write goes through the deal's OWN line save (PUT
// /api/opportunities/[id]/lines, called in-process like the Inbox creators do), so the line rules, the amount, the deal total and
// the line history all apply unchanged; this route only decides WHICH rates change and records where each price came from. The
// price is a supplier cost entered as the rate: the person adds their margin on the deal afterwards.

type Applied = { sl_no: string | null; description: string; from: number; to: number; rfq_line_id: string };

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await rfqAccess(true);
    const { id } = await params;
    const { data: rfq } = await ctx.admin.from("rfqs").select("id, ref, origin_type, origin_id").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (!rfq) return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    if (rfq.origin_type !== "opportunity" || !rfq.origin_id) return NextResponse.json({ error: "This RFQ was not raised from a deal." }, { status: 422 });
    const perms = await resolvePermissions(ctx.supabase, ctx.tenantId, ctx.userId, ctx.role);
    if (!canEditWorkcenter(perms, "pipeline")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const opp = await loadOpportunity(ctx.admin, ctx.tenantId, rfq.origin_id as string);
    if (!opp) return NextResponse.json({ error: "The deal was not found" }, { status: 404 });

    const awards = await loadCurrentAwards(ctx.admin, ctx.tenantId, id);
    if (awards.pending) return NextResponse.json({ error: AWARDS_PENDING_MESSAGE }, { status: 503 });
    if (!awards.rows.length) return NextResponse.json({ error: "Award at least one line first." }, { status: 422 });
    const priceByRfqLine = new Map(awards.rows.filter((a) => a.landed_unit !== null).map((a) => [a.rfq_line_id, a]));

    const lines = await loadOpportunityLines(ctx.admin, ctx.tenantId, opp.id);
    const applied: Applied[] = [];
    const body = lines.map((l) => {
      const link = (l as { rfq_line_id?: string | null }).rfq_line_id ?? null;
      const award = link ? priceByRfqLine.get(link) : undefined;
      const row: Record<string, unknown> = { ...l, local_id: l.id };
      if (!award || award.landed_unit === null) return row;
      const to = Math.round(award.landed_unit * 100) / 100;
      if (Number(l.rate) === to) return row;
      applied.push({ sl_no: l.sl_no ?? null, description: l.description, from: Number(l.rate), to, rfq_line_id: link as string });
      return { ...row, rate: String(to) };
    });
    if (!applied.length) return NextResponse.json({ ok: true, changed: 0, message: "The deal lines already carry these prices." });

    const { PUT } = await import("@/app/api/opportunities/[id]/lines/route");
    const res = await PUT(
      new NextRequest(new URL(`/api/opportunities/${opp.id}/lines`, "http://internal.invalid"), {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines: body }),
      }),
      { params: Promise.resolve({ id: opp.id }) },
    );
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return NextResponse.json({ error: json.error ?? "The deal lines could not be saved." }, { status: res.status >= 400 ? res.status : 500 });

    const now = new Date().toISOString();
    for (const a of applied) {
      await ctx.admin.from("rfq_line_awards").update({ applied_to_deal_at: now, applied_by: ctx.userId, applied_rate: a.to })
        .eq("tenant_id", ctx.tenantId).eq("rfq_id", id).eq("rfq_line_id", a.rfq_line_id).is("superseded_at", null);
    }
    await logChange(ctx.admin, {
      tenantId: ctx.tenantId, objectType: "opportunities", objectId: opp.id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update",
      actorId: ctx.userId, actorEmail: ctx.email,
      changes: applied.map((a) => ({ field: `line ${a.sl_no ?? ""} rate (supplier RFQ ${rfq.ref ?? ""})`.replace("  ", " "), from: a.from, to: a.to })),
    });
    return NextResponse.json({ ok: true, changed: applied.length, lines: applied.map((a) => ({ sl_no: a.sl_no, description: a.description, from: a.from, to: a.to })) });
  } catch (e) {
    if (e instanceof AwardError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
    return errorResponse(e);
  }
}
