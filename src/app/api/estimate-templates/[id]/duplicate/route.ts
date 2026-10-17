import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { validateTemplate } from "@/lib/estimator/template";
import { isUuid, MAX_TEMPLATE_NAME } from "@/lib/estimator/requests";
import { estimatorAccess, errorResponse, pendingResponse, loadTemplate, templateBody, insertTemplate } from "@/lib/estimator/server";

// POST /api/estimate-templates/[id]/duplicate { name? } -> 201 { template }
// A copy at version 1, active, named "<name> (copy)" unless a name is given. This is how a
// workspace starts from a template and makes it its own.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, tenantId, userId, email } = await estimatorAccess("edit");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    const t = await loadTemplate(supabase, tenantId, id);
    if (t.missing) return pendingResponse();
    if (!t.data) return NextResponse.json({ error: "Template not found" }, { status: 404 });

    const body = (await req.json().catch(() => ({}))) as { name?: unknown };
    const given = typeof body?.name === "string" ? body.name.trim() : "";
    if (given.length > MAX_TEMPLATE_NAME) return NextResponse.json({ error: `Template name can be at most ${MAX_TEMPLATE_NAME} characters.` }, { status: 422 });

    // Copy what is stored, in the validator's canonical form; a template that no
    // longer validates (it predates a rule) is copied as it is rather than refused.
    const v = validateTemplate(templateBody(t.data));
    const content = v.ok && v.template ? v.template : templateBody(t.data);

    const base = (given || `${t.data.name} (copy)`).slice(0, MAX_TEMPLATE_NAME);
    let r = await insertTemplate(supabase, tenantId, userId, { name: base, description: t.data.description, trade: t.data.trade, quote_granularity: t.data.quote_granularity }, content);
    // A name collision on the generated name tries "(copy 2)", "(copy 3)", ...
    for (let n = 2; !given && r.status === 409 && n <= 20; n++) {
      const name = `${t.data.name} (copy ${n})`.slice(0, MAX_TEMPLATE_NAME);
      r = await insertTemplate(supabase, tenantId, userId, { name, description: t.data.description, trade: t.data.trade, quote_granularity: t.data.quote_granularity }, content);
    }
    if (!r.data) {
      if (r.status === 503) return pendingResponse();
      return NextResponse.json({ error: r.error }, { status: r.status });
    }
    await logChange(supabase, {
      tenantId, objectType: "estimate_templates", objectId: r.data.id, objectLabel: r.data.name, action: "create", actorId: userId, actorEmail: email,
      changes: [{ field: "duplicated from", from: null, to: t.data.name }],
    });
    return NextResponse.json({ template: r.data }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
