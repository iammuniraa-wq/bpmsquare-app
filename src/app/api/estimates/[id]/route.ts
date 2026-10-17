import { NextResponse, type NextRequest } from "next/server";
import { logChange, diffForLog } from "@/lib/changeLog";
import { parseEstimatePatch, isUuid } from "@/lib/estimator/requests";
import {
  estimatorAccess, errorResponse, pendingResponse, isMissingRelation, loadEstimate, loadEstimateBundle,
  verifyForeignIds, recomputeEstimate,
} from "@/lib/estimator/server";

// One estimate.
//
// GET    -> { estimate (incl. totals and the 3D model snapshot), lines, template, template_outdated, account, contact, quote }
// PATCH  { name?, account_id?, contact_id?, notes?, margin_pct?, status?, params?, custom_data? }
//        margin_pct, params and a change of account recalculate the estimate first (nothing is
//        written if the new inputs do not compute). An estimate that already has a quote cannot
//        change its numbers: 409.
// DELETE -> removes the estimate and its lines (a quote made from it is kept).

const QUOTED_MESSAGE = "This estimate already has a quote, so its numbers can no longer change. Create a new estimate to revise it.";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, tenantId } = await estimatorAccess("view");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    const r = await loadEstimateBundle(supabase, tenantId, id);
    if (r.missing) return pendingResponse();
    if (!r.bundle) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    return NextResponse.json(r.bundle);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await estimatorAccess("edit");
    const { supabase, tenantId, userId, email } = ctx;
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    const before = await loadEstimate(supabase, tenantId, id);
    if (before.missing) return pendingResponse();
    if (!before.data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    const est = before.data;

    const parsed = parseEstimatePatch(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

    const bad = await verifyForeignIds(supabase, tenantId, parsed.verify);
    if (bad) return NextResponse.json({ error: bad }, { status: 404 });

    const accountChanged = "account_id" in parsed.patch && (parsed.patch.account_id ?? null) !== (est.account_id ?? null);
    const recompute = parsed.recompute || accountChanged;
    if (recompute && est.standard_quote_id) return NextResponse.json({ error: QUOTED_MESSAGE }, { status: 409 });

    const patch: Record<string, unknown> = { ...parsed.patch };
    if (parsed.custom_data) {
      patch.custom_data = { ...(est.custom_data ?? {}), ...parsed.custom_data };
    }

    // Recalculate first: invalid inputs must not leave the header half-updated.
    const logged: Record<string, unknown> = { ...patch };
    if (recompute) {
      const calc = await recomputeEstimate(ctx, id, {
        params: parsed.params,
        // A margin-only change keeps the stored unit costs (no pricing calls); new inputs or a
        // new account price the product lines again.
        reprice: !!parsed.params || accountChanged,
        margin_pct: typeof parsed.patch.margin_pct === "number" ? parsed.patch.margin_pct : undefined,
        account_id: "account_id" in parsed.patch ? (parsed.patch.account_id as string | null) : undefined,
      });
      if (!calc.ok) return NextResponse.json({ error: calc.error, issues: calc.issues }, { status: calc.status });
      if (parsed.params) logged.params = calc.estimate.params;
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from("estimates").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenantId);
      if (error) {
        if (isMissingRelation(error)) return pendingResponse();
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    const changes = diffForLog("estimates", est as unknown as Record<string, unknown>, logged);
    if (changes.length > 0) {
      await logChange(supabase, { tenantId, objectType: "estimates", objectId: id, objectLabel: est.ref ?? est.name, action: "update", actorId: userId, actorEmail: email, changes });
    }

    const r = await loadEstimateBundle(supabase, tenantId, id);
    return NextResponse.json(r.bundle ?? { ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, tenantId, userId, email } = await estimatorAccess("delete");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    const before = await loadEstimate(supabase, tenantId, id);
    if (before.missing) return pendingResponse();
    if (!before.data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    const { error } = await supabase.from("estimates").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logChange(supabase, { tenantId, objectType: "estimates", objectId: id, objectLabel: before.data.ref ?? before.data.name, action: "delete", actorId: userId, actorEmail: email });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
