import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { logChange } from "@/lib/changeLog";
import { parsePaymentTermTemplates, readPaymentTermTemplates } from "@/lib/contractProjects/paymentTerms";
import { readMarginFloor } from "@/lib/contractProjects/budget";

// GET / PUT /api/settings/contract-projects -- the workspace settings of the module, held in tenants.config.contract_projects:
//   margin_floor_pct          the planned margin under which a project turns amber (null = no floor)
//   payment_term_templates    the few named payment schedules a tender's Bid tab chooses from (name, milestones with a trigger text)
// PUT takes either or both: { margin_floor_pct?: number | null, payment_term_templates?: [...] } and keeps everything else in the config.
// The code lists have their own routes (/api/contract-projects/masters). Admin-only in both directions; a workspace without the module
// gets a 404.

async function guard() {
  const ctx = await requireTenantUser();
  for (const key of ["contract_projects", "gcc_tender"] as const) {
    if (!(await tenantHasFeature(ctx.supabase, ctx.tenantId, key))) throw Object.assign(new Error("Not found"), { status: 404 });
  }
  if (ctx.role !== "admin") throw Object.assign(new Error("Forbidden"), { status: 403 });
  return ctx;
}
const fail = (e: unknown) => {
  const err = e as { status?: number; message: string };
  return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
};

type ConfigShape = { contract_projects?: Record<string, unknown> };

export async function GET() {
  let tenantId;
  try { ({ tenantId } = await guard()); } catch (e) { return fail(e); }
  const { data } = await createAdminSupabase().from("tenants").select("config").eq("id", tenantId).single();
  const config = (data?.config ?? null) as ConfigShape | null;
  return NextResponse.json({ margin_floor_pct: readMarginFloor(config), payment_term_templates: readPaymentTermTemplates(config) });
}

export async function PUT(request: NextRequest) {
  let supabase, tenantId;
  try { ({ supabase, tenantId } = await guard()); } catch (e) { return fail(e); }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const next: Record<string, unknown> = {};
  if ("margin_floor_pct" in body) {
    if (body.margin_floor_pct === null || body.margin_floor_pct === "") next.margin_floor_pct = null;
    else {
      const pct = Number(body.margin_floor_pct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 95) return NextResponse.json({ error: "The margin floor is a number from 0 to 95" }, { status: 422 });
      next.margin_floor_pct = Math.round(pct * 10) / 10;
    }
  }
  let templates: ReturnType<typeof readPaymentTermTemplates> | null = null;
  if ("payment_term_templates" in body) {
    const parsed = parsePaymentTermTemplates(body.payment_term_templates, randomUUID);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    templates = parsed.templates;
    next.payment_term_templates = templates;
  }
  if (Object.keys(next).length === 0) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin.from("tenants").select("config").eq("id", tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  const config = (current?.config ?? {}) as ConfigShape & Record<string, unknown>;
  const kept = (config.contract_projects && typeof config.contract_projects === "object" ? config.contract_projects : {}) as Record<string, unknown>;
  const floorBefore = readMarginFloor(config);
  const namesBefore = readPaymentTermTemplates(config).map((t) => t.name).join(", ");
  // The retired default-margin key is dropped on the first save so it stops looking like a setting.
  const { default_margin_pct: _retired, ...rest } = kept;
  const { error } = await admin.from("tenants").update({ config: { ...config, contract_projects: { ...rest, ...next } } }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  if ("margin_floor_pct" in next && floorBefore !== next.margin_floor_pct) changes.push({ field: "Margin floor (%)", from: floorBefore, to: next.margin_floor_pct });
  if (templates && namesBefore !== templates.map((t) => t.name).join(", ")) changes.push({ field: "Payment-term templates", from: namesBefore || null, to: templates.map((t) => t.name).join(", ") || null });
  if (changes.length > 0) {
    await logChange(supabase, { tenantId, objectType: "tenants", objectId: tenantId, objectLabel: "Contract project settings", action: "update", actorId: user?.id, actorEmail: user?.email, changes });
  }
  return NextResponse.json({ ok: true, ...(templates ? { payment_term_templates: templates } : {}) });
}
