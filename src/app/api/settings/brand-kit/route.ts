import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { resolveBrandKit, sanitizeBrandKit } from "@/lib/newsletter/brandKit";
import { FONT_PAIRINGS } from "@/lib/newsletter/types";
import { studioEnabled } from "@/lib/newsletter/server";

// Settings -> Marketing -> Brand kit. Admin only; 404 without the Newsletter Studio.
// The kit lives in tenants.config.brand_kit (strict #rrggbb colours, a known font
// pairing, https links only). Counting opens is not here: it lives with consent
// (Settings, Marketing, Consent) because it needs a lawful basis.

async function gate() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return { ok: false as const, response: NextResponse.json({ error: err.message }, { status: err.status }) };
  }
  if (role !== "admin") return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const admin = createAdminSupabase();
  const { data, error } = await admin.from("tenants").select("name, logo_url, features, config").eq("id", tenantId).single();
  if (error || !data) return { ok: false as const, response: NextResponse.json({ error: "Workspace not found" }, { status: 500 }) };
  if (!studioEnabled(data.features as Partial<TenantFeatures>)) return { ok: false as const, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { ok: true as const, admin, tenantId, name: data.name as string, logoUrl: (data.logo_url as string | null) ?? null, config: (data.config ?? {}) as TenantConfig };
}

function payload(config: TenantConfig, name: string, logoUrl: string | null) {
  return {
    brand_kit: sanitizeBrandKit(config.brand_kit),
    resolved: resolveBrandKit(config.brand_kit, { name, logo_url: logoUrl }),
    fonts: Object.entries(FONT_PAIRINGS).map(([key, f]) => ({ key, label: f.label })),
  };
}

export async function GET() {
  const g = await gate();
  if (!g.ok) return g.response;
  return NextResponse.json(payload(g.config, g.name, g.logoUrl));
}

export async function PUT(request: NextRequest) {
  const g = await gate();
  if (!g.ok) return g.response;
  const body = (await request.json().catch(() => null)) as { brand_kit?: unknown } | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const config: TenantConfig = {
    ...g.config,
    brand_kit: sanitizeBrandKit(body.brand_kit),
  };
  const { error } = await g.admin.from("tenants").update({ config }).eq("id", g.tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(payload(config, g.name, g.logoUrl));
}
