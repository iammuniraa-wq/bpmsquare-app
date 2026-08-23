import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { createAdminSupabase } from "@/lib/supabase-server";
import type { TenantConfig } from "@/lib/constants";
import { HEX_COLOR_RE } from "@/lib/standardQuoteTemplateBlocks";

export async function GET() {
  let tenantId;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("tenants")
    .select("config")
    .eq("id", tenantId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data?.config as TenantConfig) ?? { entities: [], tax: { label: "GST", rate: 18, inclusive: false } });
}

export async function PATCH(request: NextRequest) {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body: Partial<TenantConfig> = await request.json();

  // nova_accent_color is rendered server-side into a raw <style> tag
  // ((app)/layout.tsx) with no further escaping -- unlike every other
  // appearance field (enums/booleans, harmless if malformed), an
  // unvalidated string here is a stored-injection vector any tenant admin
  // could use to break out of that <style> block. Reject anything that
  // isn't a real #rrggbb hex, same validator/shape the existing
  // accent_color field already enforces (api/settings/workspace).
  const novaAccent = body.appearance?.nova_accent_color;
  if (novaAccent !== undefined && novaAccent !== null && novaAccent !== "" && !HEX_COLOR_RE.test(novaAccent)) {
    return NextResponse.json({ error: "appearance.nova_accent_color must be a hex colour like #E84393" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // Merge patch — read current config first so we don't overwrite unrelated keys
  const { data: current, error: readErr } = await admin
    .from("tenants")
    .select("config")
    .eq("id", tenantId)
    .single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const merged = { ...(current?.config ?? {}), ...body };

  const { error } = await admin
    .from("tenants")
    .update({ config: merged })
    .eq("id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(merged);
}
