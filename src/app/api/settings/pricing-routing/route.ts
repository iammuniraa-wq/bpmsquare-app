import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import type { PricingRouting, RoutingRule } from "@/lib/pricing/routing";

// Which Price Book a quote line prices against (spec §16.4 defect #2: "no
// per-line book routing" -- built here). config.pricing.routing is read by
// routeToArea() (src/lib/pricing/routing.ts) on every priceDocumentLine()
// call; this is the only place it is written. Tenant-wide, not per-area --
// routing decides which area a line goes to, so it can't live inside one
// area's own Advanced config.

function normalizeRouting(body: Record<string, unknown>): PricingRouting {
  const rawRules = Array.isArray(body.rules) ? body.rules : [];
  const rules: RoutingRule[] = rawRules
    .map((r) => (r ?? {}) as Record<string, unknown>)
    .map((r) => ({
      attribute: typeof r.attribute === "string" ? r.attribute.trim() : "",
      value: typeof r.value === "string" ? r.value.trim() : "",
      area: typeof r.area === "string" ? r.area.trim() : "",
    }))
    .filter((r) => r.attribute && r.value && r.area);
  const default_area = typeof body.default_area === "string" && body.default_area.trim() ? body.default_area.trim() : "default";
  return { rules, default_area };
}

export async function GET() {
  let tenantId: string;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { data, error } = await createAdminSupabase().from("tenants").select("config").eq("id", tenantId).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const cfg = (data?.config ?? {}) as { pricing?: { routing?: PricingRouting } };
  const routing: PricingRouting = cfg.pricing?.routing ?? { rules: [], default_area: "default" };
  return NextResponse.json({ rules: routing.rules ?? [], default_area: routing.default_area ?? "default" });
}

export async function PUT(request: NextRequest) {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const routing = normalizeRouting(body);

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin.from("tenants").select("config").eq("id", tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const currentConfig = (current?.config ?? {}) as { pricing?: Record<string, unknown> };
  const merged = { ...currentConfig, pricing: { ...(currentConfig.pricing ?? {}), routing } };
  const { error } = await admin.from("tenants").update({ config: merged }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...routing });
}
