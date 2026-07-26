import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { sanitizeRichText } from "@/lib/sanitizeHtml";
import { getMarketingCampaign } from "@/lib/data";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireTenantUser();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const data = await getMarketingCampaign(id);
  if (!data) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  return NextResponse.json(data);
}

// Only draft campaigns can be edited -- once a send starts, the campaign
// becomes a record of what was actually sent, not something to keep changing.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data: existing } = await supabase.from("marketing_campaigns").select("status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (existing.status !== "draft") return NextResponse.json({ error: "Only draft campaigns can be edited" }, { status: 409 });

  const body = await request.json();
  const { name, subject, html, account_types, include_account_ids, exclude_account_ids } = body;

  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = String(name).trim();
  if (subject !== undefined) patch.subject = subject;
  if (html !== undefined) patch.body = sanitizeRichText(html) ?? "";
  if (Array.isArray(account_types)) patch.account_types = account_types;
  if (Array.isArray(include_account_ids)) patch.include_account_ids = include_account_ids;
  if (Array.isArray(exclude_account_ids)) patch.exclude_account_ids = exclude_account_ids;

  const { error } = await supabase.from("marketing_campaigns").update(patch).eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data: existing } = await supabase.from("marketing_campaigns").select("status").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (existing.status !== "draft") return NextResponse.json({ error: "Only draft campaigns can be deleted" }, { status: 409 });

  const { error } = await supabase.from("marketing_campaigns").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
