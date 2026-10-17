import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { parseLineEdit, readOverride, lineCost, type LineOverride } from "@/lib/estimator/overrides";
import { isUuid } from "@/lib/estimator/requests";
import { normaliseLine } from "@/lib/estimator/lines";
import { estimatorAccess, errorResponse, pendingResponse, loadEstimate, refreshTotals, isMissingRelation } from "@/lib/estimator/server";

// One estimate line, addressed by its own id (record identity, bpmsquarecore section 3).
//
// PATCH  { qty?, unit_cost?, description?, uom?, waste_pct?, component?, wbs_code? }
//   A manual line is edited in place. A computed (rule/schedule) line is edited too, and the
//   edit is remembered on the line so a recalculation re-applies it; it adjusts that line
//   and the totals but is not seen by other rules' formulas.
// DELETE removes a manual line. A computed line cannot be deleted (a recalculation would
//   bring it back); set its quantity to 0 to leave it out.
//
// Both return { line?, lines, totals }. An estimate that already has a quote is locked (409).

const LOCKED = "This estimate already has a quote, so its lines can no longer change.";

async function loadLine(supabase: Parameters<typeof refreshTotals>[0], tenantId: string, estimateId: string, lid: string) {
  const { data, error } = await supabase.from("estimate_lines").select("*").eq("id", lid).eq("estimate_id", estimateId).eq("tenant_id", tenantId).maybeSingle();
  return { line: data ? normaliseLine(data as Record<string, unknown>) : null, error };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; lid: string }> }) {
  try {
    const { supabase, tenantId, userId, email } = await estimatorAccess("edit");
    const { id, lid } = await params;
    if (!isUuid(id) || !isUuid(lid)) return NextResponse.json({ error: "Line not found" }, { status: 404 });
    const est = await loadEstimate(supabase, tenantId, id);
    if (est.missing) return pendingResponse();
    if (!est.data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    if (est.data.standard_quote_id) return NextResponse.json({ error: LOCKED }, { status: 409 });
    const { line, error: loadErr } = await loadLine(supabase, tenantId, id, lid);
    if (loadErr && isMissingRelation(loadErr)) return pendingResponse();
    if (!line) return NextResponse.json({ error: "Line not found" }, { status: 404 });

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "A JSON body is required." }, { status: 422 });
    const parsed = parseLineEdit(body as Record<string, unknown>);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const edit: LineOverride = parsed.edit;
    if (Object.keys(edit).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 422 });

    const next = {
      qty: edit.qty ?? line.qty,
      waste_pct: edit.waste_pct ?? line.waste_pct,
      unit_cost: "unit_cost" in edit ? (edit.unit_cost ?? null) : line.unit_cost,
    };
    const patch: Record<string, unknown> = {
      qty: next.qty, waste_pct: next.waste_pct, unit_cost: next.unit_cost,
      cost_total: lineCost(next.qty, next.waste_pct, next.unit_cost),
      updated_at: new Date().toISOString(),
    };
    if (edit.description !== undefined) patch.description = edit.description;
    if ("uom" in edit) patch.uom = edit.uom ?? null;
    if (edit.component !== undefined) patch.component = edit.component;
    if ("wbs_code" in edit) patch.wbs_code = edit.wbs_code ?? null;
    if (line.source !== "manual") {
      patch.custom_data = { ...(line.custom_data ?? {}), override: { ...(readOverride(line.custom_data) ?? {}), ...edit } };
    }

    const { error } = await supabase.from("estimate_lines").update(patch).eq("id", lid).eq("estimate_id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const r = await refreshTotals(supabase, tenantId, est.data);
    await logChange(supabase, {
      tenantId, objectType: "estimates", objectId: id, objectLabel: est.data.ref ?? est.data.name, action: "update", actorId: userId, actorEmail: email,
      changes: Object.entries(edit).map(([field, to]) => ({ field: `Line "${line.description}": ${field}`, from: (line as unknown as Record<string, unknown>)[field] ?? null, to: to ?? null })),
    });
    return NextResponse.json({ line: r.lines.find((l) => l.id === lid) ?? null, lines: r.lines, totals: r.totals });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; lid: string }> }) {
  try {
    const { supabase, tenantId, userId, email } = await estimatorAccess("edit");
    const { id, lid } = await params;
    if (!isUuid(id) || !isUuid(lid)) return NextResponse.json({ error: "Line not found" }, { status: 404 });
    const est = await loadEstimate(supabase, tenantId, id);
    if (est.missing) return pendingResponse();
    if (!est.data) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    if (est.data.standard_quote_id) return NextResponse.json({ error: LOCKED }, { status: 409 });
    const { line } = await loadLine(supabase, tenantId, id, lid);
    if (!line) return NextResponse.json({ error: "Line not found" }, { status: 404 });
    if (line.source !== "manual") {
      return NextResponse.json({ error: "This line comes from the template, so a recalculation would bring it back. Set its quantity to 0 to leave it out." }, { status: 409 });
    }
    const { error } = await supabase.from("estimate_lines").delete().eq("id", lid).eq("estimate_id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const r = await refreshTotals(supabase, tenantId, est.data);
    await logChange(supabase, {
      tenantId, objectType: "estimates", objectId: id, objectLabel: est.data.ref ?? est.data.name, action: "update", actorId: userId, actorEmail: email,
      changes: [{ field: "Line removed", from: line.description, to: null }],
    });
    return NextResponse.json({ lines: r.lines, totals: r.totals });
  } catch (e) {
    return errorResponse(e);
  }
}
