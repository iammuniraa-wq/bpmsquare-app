import { NextResponse, type NextRequest } from "next/server";
import { logChange, diffForLog } from "@/lib/changeLog";
import { linkEstimateToEmail } from "@/lib/inbox/estimateLink";
import { validateTemplate } from "@/lib/estimator/template";
import { parseEstimateCreate, parseListParams, isUuid } from "@/lib/estimator/requests";
import {
  estimatorAccess, errorResponse, pendingResponse, isMissingRelation, listEstimates, loadTemplate, templateBody,
  verifyForeignIds, insertEstimate, recomputeEstimate, loadTenantMeta, PENDING_MESSAGE,
} from "@/lib/estimator/server";

// Estimates (0131, docs/estimator-architecture.md).
//
// GET  /api/estimates?q=&status=&account_id=&template_id=&sort=&dir=&page=&page_size=
//   -> { estimates, total, page, page_size, pages, pending_migration? }
// POST /api/estimates { name, template_id, account_id?, contact_id?, params?, margin_pct?, notes?, custom_data? }
//   -> 201 { id, ref, estimate, lines, totals, warnings }; the estimate is computed
//      on creation, and an estimate whose inputs do not compute is not created.

export async function GET(req: NextRequest) {
  try {
    const ctx = await estimatorAccess("view");
    const p = parseListParams(req.nextUrl.searchParams);
    const r = await listEstimates(ctx.supabase, ctx.tenantId, p);
    return NextResponse.json({
      estimates: r.rows, total: r.total, page: p.page, page_size: p.page_size,
      pages: Math.max(1, Math.ceil(r.total / p.page_size)),
      ...(r.missing ? { pending_migration: true } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await estimatorAccess("create");
    const { supabase, tenantId, userId, email } = ctx;
    const raw = await req.json().catch(() => null);
    const parsed = parseEstimateCreate(raw);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const v = parsed.value;

    const bad = await verifyForeignIds(supabase, tenantId, { account_id: v.account_id, contact_id: v.contact_id });
    if (bad) return NextResponse.json({ error: bad }, { status: 404 });

    // An estimate made for a tender deal (GCC tender deals, slice 3c-1). Absent for every standard estimate, which is then untouched.
    const rawDeal = (raw as { opportunity_id?: unknown } | null)?.opportunity_id;
    let dealId: string | null = null;
    if (rawDeal !== undefined && rawDeal !== null && rawDeal !== "") {
      if (!isUuid(rawDeal)) return NextResponse.json({ error: "opportunity_id must be an id." }, { status: 422 });
      const { openTenderDealRequest } = await import("@/lib/tender/dealAccess");
      const gate = await openTenderDealRequest(rawDeal, false);
      if (!gate.ok) return NextResponse.json({ error: "Tender deal not found." }, { status: 404 });
      dealId = gate.req.opp.id;
    }

    const tpl = await loadTemplate(supabase, tenantId, v.template_id);
    if (tpl.missing) return pendingResponse();
    if (!tpl.data) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    if (!tpl.data.is_active) return NextResponse.json({ error: "This template is inactive; choose another or reactivate it." }, { status: 409 });
    const valid = validateTemplate(templateBody(tpl.data));
    if (!valid.ok) return NextResponse.json({ error: "This template has problems and cannot be used yet.", issues: valid.issues }, { status: 422 });

    const meta = await loadTenantMeta(tenantId);
    const { data: created, error } = await insertEstimate(supabase, tenantId, {
      tenant_id: tenantId, name: v.name, account_id: v.account_id, contact_id: v.contact_id,
      template_id: tpl.data.id, template_version: tpl.data.version, status: "draft",
      params: v.params, currency: meta.currency, margin_pct: v.margin_pct, notes: v.notes,
      custom_data: Object.keys(v.custom_data).length > 0 ? v.custom_data : null, created_by: userId,
      ...(dealId ? { opportunity_id: dealId } : {}),
    });
    if (error || !created) {
      if (isMissingRelation(error)) return NextResponse.json({ error: PENDING_MESSAGE, pending_migration: true }, { status: 503 });
      return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
    }

    const calc = await recomputeEstimate(ctx, created.id);
    if (!calc.ok) {
      // Nothing is left half-made: an estimate whose inputs do not compute is removed.
      await supabase.from("estimates").delete().eq("id", created.id).eq("tenant_id", tenantId);
      return NextResponse.json({ error: calc.error, issues: calc.issues }, { status: calc.status });
    }

    await logChange(supabase, {
      tenantId, objectType: "estimates", objectId: created.id, objectLabel: created.ref ?? created.name,
      action: "create", actorId: userId, actorEmail: email,
      changes: [
        ...diffForLog("estimates", {}, { name: v.name, account_id: v.account_id, template_id: tpl.data.id, margin_pct: v.margin_pct }),
        ...(dealId ? [{ field: "Tender deal", from: null, to: dealId }] : []),
      ],
    });
    // Started from the shared Inbox: link the email to this estimate and copy its files across (ignored if the person may not).
    const fromEmail = (raw as { source_email_id?: unknown } | null)?.source_email_id;
    if (fromEmail) await linkEstimateToEmail({ sourceEmailId: fromEmail, estimate: { id: created.id, label: created.ref ?? created.name }, accountId: v.account_id });
    return NextResponse.json({
      id: created.id, ref: created.ref, estimate: calc.estimate, lines: calc.lines, totals: calc.totals,
      warnings: calc.totals.warnings ?? [],
    }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
