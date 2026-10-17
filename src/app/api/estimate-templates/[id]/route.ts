import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { validateTemplate } from "@/lib/estimator/template";
import { parseTemplateHeader, isUuid } from "@/lib/estimator/requests";
import { estimatorAccess, errorResponse, pendingResponse, isMissingRelation, loadTemplate, templateBody, templateUsage } from "@/lib/estimator/server";

// One template.
//
// GET    -> { template, estimate_count }
// PATCH  { name?, description?, trade?, is_active?, quote_granularity?, geometry?, inputs?, rates?, rules?, expected_version? }
//   Content changes (inputs, rates, rules, geometry, quote_granularity) are validated as a whole
//   (422 with every issue) and bump `version`, so an estimate can tell it was made from an older
//   one; editing never re-prices an existing estimate. Name / description / trade / is_active are
//   metadata and keep the version. expected_version (optional) turns a stale save into a 409.
// DELETE -> 409 { estimate_count } while estimates use it (deactivate instead: PATCH is_active=false).

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, tenantId } = await estimatorAccess("view");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    const t = await loadTemplate(supabase, tenantId, id);
    if (t.missing) return pendingResponse();
    if (!t.data) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    const usage = await templateUsage(supabase, tenantId, [id]);
    return NextResponse.json({ template: t.data, estimate_count: usage.get(id) ?? 0 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, tenantId, userId, email } = await estimatorAccess("edit");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    const t = await loadTemplate(supabase, tenantId, id);
    if (t.missing) return pendingResponse();
    if (!t.data) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    const before = t.data;

    const body = await req.json().catch(() => null);
    const header = parseTemplateHeader(body, { requireName: false });
    if (!header.ok) return NextResponse.json({ error: header.error }, { status: 422 });
    const b = body as Record<string, unknown>;
    if (typeof b.expected_version === "number" && b.expected_version !== before.version) {
      return NextResponse.json({ error: "This template was changed by someone else. Reload it and apply your edit again.", version: before.version }, { status: 409 });
    }

    const patch: Record<string, unknown> = {};
    const h = header.header;
    if (h.name !== undefined) patch.name = h.name;
    if (h.description !== undefined) patch.description = h.description;
    if (h.trade !== undefined) patch.trade = h.trade;
    if (h.is_active !== undefined) patch.is_active = h.is_active;

    let content = false;
    const contentKeys = ["inputs", "rates", "rules"] as const;
    const touchesBody = contentKeys.some((k) => k in b) || "geometry" in b;
    if (touchesBody) {
      const merged = {
        geometry: "geometry" in b ? (h.geometry ?? undefined) : (before.geometry ?? undefined),
        inputs: "inputs" in b ? b.inputs : before.inputs,
        rates: "rates" in b ? b.rates : before.rates,
        rules: "rules" in b ? b.rules : before.rules,
      };
      const v = validateTemplate(merged);
      if (!v.ok || !v.template) {
        return NextResponse.json({ error: `The template has ${v.issues.length} problem${v.issues.length === 1 ? "" : "s"}.`, issues: v.issues, warnings: v.warnings }, { status: 422 });
      }
      const next = v.template;
      patch.inputs = next.inputs;
      patch.rates = next.rates;
      patch.rules = next.rules;
      patch.geometry = next.geometry ?? null;
      // jsonb does not keep key order, so compare both sides in the validator's canonical form.
      const was = validateTemplate(templateBody({ ...before, geometry: before.geometry ?? null }));
      if (!was.ok || JSON.stringify(was.template) !== JSON.stringify(next)) content = true;
    }
    if (h.quote_granularity !== undefined) {
      patch.quote_granularity = h.quote_granularity;
      if (h.quote_granularity !== before.quote_granularity) content = true;
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 422 });
    if (content) patch.version = before.version + 1;

    const { data, error } = await supabase.from("estimate_templates")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id).eq("tenant_id", tenantId).select("*").single();
    if (error) {
      if (isMissingRelation(error)) return pendingResponse();
      if (error.code === "23505") return NextResponse.json({ error: `A template named "${String(patch.name)}" already exists.` }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const changes = [
      ...(patch.name !== undefined && patch.name !== before.name ? [{ field: "name", from: before.name, to: patch.name }] : []),
      ...(patch.is_active !== undefined && patch.is_active !== before.is_active ? [{ field: "is_active", from: before.is_active, to: patch.is_active }] : []),
      ...(content ? [{ field: "version", from: before.version, to: before.version + 1 }] : []),
    ];
    if (changes.length > 0) {
      await logChange(supabase, { tenantId, objectType: "estimate_templates", objectId: id, objectLabel: before.name, action: "update", actorId: userId, actorEmail: email, changes });
    }
    return NextResponse.json({ template: data });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, tenantId, userId, email } = await estimatorAccess("edit");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    const t = await loadTemplate(supabase, tenantId, id);
    if (t.missing) return pendingResponse();
    if (!t.data) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    const used = (await templateUsage(supabase, tenantId, [id])).get(id) ?? 0;
    if (used > 0) {
      return NextResponse.json({
        error: `${used} estimate${used === 1 ? " was" : "s were"} made from this template, so it cannot be deleted. Deactivate it instead to stop it being used for new estimates.`,
        estimate_count: used, deactivate: true,
      }, { status: 409 });
    }
    const { error } = await supabase.from("estimate_templates").delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logChange(supabase, { tenantId, objectType: "estimate_templates", objectId: id, objectLabel: t.data.name, action: "delete", actorId: userId, actorEmail: email });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
