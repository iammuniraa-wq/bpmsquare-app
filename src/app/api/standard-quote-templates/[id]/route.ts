import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { sanitizeStandardQuoteBlocks, HEX_COLOR_RE, LOGO_POSITIONS } from "@/lib/standardQuoteTemplateBlocks";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data, error } = await supabase.from("standard_quote_templates").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { data: existing } = await supabase.from("standard_quote_templates").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const patch: Record<string, unknown> = {};

  if ("name" in body) {
    const name = (body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    patch.name = name;
  }
  if ("accent_color" in body) {
    patch.accent_color = typeof body.accent_color === "string" && HEX_COLOR_RE.test(body.accent_color) ? body.accent_color : null;
  }
  if ("logo_position" in body) {
    patch.logo_position = LOGO_POSITIONS.has(body.logo_position) ? body.logo_position : "left";
  }
  if ("blocks" in body) {
    patch.blocks = sanitizeStandardQuoteBlocks(body.blocks);
  }
  if ("is_default" in body) {
    const isDefault = !!body.is_default;
    if (isDefault) {
      await supabase.from("standard_quote_templates").update({ is_default: false }).eq("tenant_id", tenantId).eq("is_default", true).neq("id", id);
    }
    patch.is_default = isDefault;
  }

  const { data, error } = await supabase
    .from("standard_quote_templates")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "A template with this name already exists" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const { data: existing } = await supabase.from("standard_quote_templates").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // standard_quotes.template_id is ON DELETE SET NULL -- any quote using this
  // template falls back to the built-in default block layout, it never
  // breaks.
  const { error } = await supabase.from("standard_quote_templates").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return new NextResponse(null, { status: 204 });
}
