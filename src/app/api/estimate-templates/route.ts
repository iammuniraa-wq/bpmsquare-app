import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { validateTemplate } from "@/lib/estimator/template";
import { parseTemplateHeader } from "@/lib/estimator/requests";
import { estimatorAccess, errorResponse, pendingResponse, listTemplates, insertTemplate } from "@/lib/estimator/server";

// Estimate templates (tenant data; edited in Settings).
//
// GET  /api/estimate-templates[?active=1] -> { templates: [{ id, name, ..., estimate_count }], pending_migration? }
// POST /api/estimate-templates { name, description?, trade?, quote_granularity?, geometry?, inputs, rates, rules }
//   -> 201 { template }; 422 { error, issues } with EVERY problem found, not just the first.
// Reading is open to anyone who can view Estimates (the New Estimate form needs the list);
// writing needs admin or edit on Estimates.

export async function GET(req: NextRequest) {
  try {
    const { supabase, tenantId } = await estimatorAccess("view");
    const r = await listTemplates(supabase, tenantId, { activeOnly: req.nextUrl.searchParams.get("active") === "1" });
    return NextResponse.json({ templates: r.rows, ...(r.missing ? { pending_migration: true } : {}) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, tenantId, userId, email } = await estimatorAccess("edit");
    const body = await req.json().catch(() => null);
    const header = parseTemplateHeader(body, { requireName: true });
    if (!header.ok) return NextResponse.json({ error: header.error }, { status: 422 });
    const b = body as Record<string, unknown>;

    const v = validateTemplate({ geometry: header.header.geometry ?? undefined, inputs: b.inputs, rates: b.rates, rules: b.rules, drawing_map: b.drawing_map, visual: b.visual });
    if (!v.ok || !v.template) {
      return NextResponse.json({ error: `The template has ${v.issues.length} problem${v.issues.length === 1 ? "" : "s"}.`, issues: v.issues, warnings: v.warnings }, { status: 422 });
    }

    const r = await insertTemplate(supabase, tenantId, userId, {
      name: header.header.name as string, description: header.header.description, trade: header.header.trade,
      quote_granularity: header.header.quote_granularity, keywords: header.header.keywords, icon: header.header.icon,
    }, v.template);
    if (!r.data) {
      if (r.status === 503) return pendingResponse();
      return NextResponse.json({ error: r.error }, { status: r.status });
    }
    await logChange(supabase, {
      tenantId, objectType: "estimate_templates", objectId: r.data.id, objectLabel: r.data.name, action: "create", actorId: userId, actorEmail: email,
      changes: [{ field: "rules", from: null, to: `${v.template.rules.length} rule lines` }],
    });
    return NextResponse.json({ template: r.data, warnings: v.warnings }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
