import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { STARTER_TEMPLATES } from "@/lib/estimator/starterTemplates";
import { validateTemplate } from "@/lib/estimator/template";
import { estimatorAccess, errorResponse, pendingResponse, insertTemplate, isMissingRelation } from "@/lib/estimator/server";

// Starter templates ship with the product as typed constants (starterTemplates.ts) and
// are ILLUSTRATIVE: placeholder rates and rules to demonstrate the estimator. A workspace
// copies one into its own data, where it is an ordinary, fully editable template.
//
// GET  /api/estimate-templates/from-starter -> { starters: [{ name, description, trade, rule_count, installed }] }
// POST /api/estimate-templates/from-starter { name? }
//   -> 201 { template, created: true }, or 200 { template, created: false } when the workspace
//   already has a template of that name (idempotent: a second click does not make a copy).
//   `name` defaults to the first starter.

export async function GET() {
  try {
    const { supabase, tenantId } = await estimatorAccess("view");
    const { data, error } = await supabase.from("estimate_templates").select("name").eq("tenant_id", tenantId);
    if (error && !isMissingRelation(error)) return NextResponse.json({ error: error.message }, { status: 500 });
    const have = new Set(((data ?? []) as { name: string }[]).map((r) => r.name.toLowerCase()));
    return NextResponse.json({
      starters: STARTER_TEMPLATES.map((s) => ({
        name: s.name, description: s.description, trade: s.trade, geometry: s.geometry ?? null, icon: s.icon ?? null, locked: s.locked === true,
        input_count: s.inputs.length, rule_count: s.rules.length, installed: have.has(s.name.toLowerCase()),
      })),
      ...(error ? { pending_migration: true } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, tenantId, userId, email } = await estimatorAccess("edit");
    const body = (await req.json().catch(() => ({}))) as { name?: unknown };
    const wanted = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : STARTER_TEMPLATES[0].name;
    const starter = STARTER_TEMPLATES.find((s) => s.name.toLowerCase() === wanted.toLowerCase());
    if (!starter) return NextResponse.json({ error: `No starter template named "${wanted.slice(0, 80)}".`, available: STARTER_TEMPLATES.map((s) => s.name) }, { status: 404 });

    const { data: existing, error: findErr } = await supabase.from("estimate_templates").select("*").eq("tenant_id", tenantId).ilike("name", starter.name).limit(1);
    if (findErr) {
      if (isMissingRelation(findErr)) return pendingResponse();
      return NextResponse.json({ error: findErr.message }, { status: 500 });
    }
    // ilike treats % and _ as wildcards; the name is a constant without either, but check exactly anyway.
    const found = ((existing ?? []) as { name: string }[]).find((t) => t.name.toLowerCase() === starter.name.toLowerCase());
    if (found) return NextResponse.json({ template: found, created: false });

    const v = validateTemplate({ geometry: starter.geometry, inputs: starter.inputs, rates: starter.rates, rules: starter.rules });
    if (!v.ok || !v.template) return NextResponse.json({ error: "The starter template failed validation.", issues: v.issues }, { status: 500 });
    const r = await insertTemplate(supabase, tenantId, userId, {
      name: starter.name, description: starter.description, trade: starter.trade, quote_granularity: starter.quote_granularity,
      keywords: starter.keywords, icon: starter.icon, locked: starter.locked, customer_visible: starter.customer_visible,
    }, v.template);
    if (!r.data) {
      if (r.status === 503) return pendingResponse();
      // Lost a race with another click: the other request made it.
      if (r.status === 409) {
        const { data: again } = await supabase.from("estimate_templates").select("*").eq("tenant_id", tenantId).eq("name", starter.name).maybeSingle();
        if (again) return NextResponse.json({ template: again, created: false });
      }
      return NextResponse.json({ error: r.error }, { status: r.status });
    }
    await logChange(supabase, {
      tenantId, objectType: "estimate_templates", objectId: r.data.id, objectLabel: r.data.name, action: "create", actorId: userId, actorEmail: email,
      changes: [{ field: "created from starter", from: null, to: starter.name }],
    });
    return NextResponse.json({ template: r.data, created: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
