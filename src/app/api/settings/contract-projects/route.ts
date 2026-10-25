import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { logChange } from "@/lib/changeLog";
import { contractProjectSettings } from "@/lib/contractProjects/fromTender";

// GET / PUT /api/settings/contract-projects -- the one workspace setting of the module: the default margin assumed for a tender line whose
// cost is not recorded (tenants.config.contract_projects.default_margin_pct, default 15). The code lists have their own routes
// (/api/contract-projects/masters). Admin-only in both directions; a workspace without the module gets a 404.

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

export async function GET() {
  let tenantId;
  try { ({ tenantId } = await guard()); } catch (e) { return fail(e); }
  const { data } = await createAdminSupabase().from("tenants").select("config").eq("id", tenantId).single();
  return NextResponse.json({ default_margin_pct: contractProjectSettings(data?.config as Parameters<typeof contractProjectSettings>[0]).defaultMarginPct });
}

export async function PUT(request: NextRequest) {
  let supabase, tenantId;
  try { ({ supabase, tenantId } = await guard()); } catch (e) { return fail(e); }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const pct = Number(body.default_margin_pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 95) return NextResponse.json({ error: "The default margin is a number from 0 to 95" }, { status: 422 });

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin.from("tenants").select("config").eq("id", tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  const config = (current?.config ?? {}) as Record<string, unknown>;
  const before = contractProjectSettings(config as Parameters<typeof contractProjectSettings>[0]).defaultMarginPct;
  const kept = (config.contract_projects && typeof config.contract_projects === "object" ? config.contract_projects : {}) as Record<string, unknown>;
  const { error } = await admin.from("tenants").update({ config: { ...config, contract_projects: { ...kept, default_margin_pct: Math.round(pct * 10) / 10 } } }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  if (before !== pct) {
    await logChange(supabase, {
      tenantId, objectType: "tenants", objectId: tenantId, objectLabel: "Contract project settings", action: "update", actorId: user?.id, actorEmail: user?.email,
      changes: [{ field: "Default margin for estimated costs (%)", from: before, to: pct }],
    });
  }
  return NextResponse.json({ ok: true });
}
