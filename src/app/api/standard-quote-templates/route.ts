import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import {
  defaultStandardQuoteBlocks, sanitizeStandardQuoteBlocks, HEX_COLOR_RE, LOGO_POSITIONS,
} from "@/lib/standardQuoteTemplateBlocks";

export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { data, error } = await supabase
    .from("standard_quote_templates")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// Template management is admin-gated -- it changes a brand-facing document
// every future quote in the tenant renders with, same trust level as
// Settings -> General's letterhead/branding config.
export async function POST(request: NextRequest) {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const accentColor = typeof body.accent_color === "string" && HEX_COLOR_RE.test(body.accent_color) ? body.accent_color : null;
  const logoPosition = LOGO_POSITIONS.has(body.logo_position) ? body.logo_position : "left";
  const blocks = Array.isArray(body.blocks) ? sanitizeStandardQuoteBlocks(body.blocks) : defaultStandardQuoteBlocks();
  const isDefault = !!body.is_default;

  if (isDefault) {
    await supabase.from("standard_quote_templates").update({ is_default: false }).eq("tenant_id", tenantId).eq("is_default", true);
  }

  const { data, error } = await supabase
    .from("standard_quote_templates")
    .insert({
      tenant_id: tenantId, name, accent_color: accentColor, logo_position: logoPosition,
      blocks, is_default: isDefault,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "A template with this name already exists" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
