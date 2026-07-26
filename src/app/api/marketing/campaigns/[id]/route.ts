import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { sanitizeRichText } from "@/lib/sanitizeHtml";
import { resolveCampaignContent } from "@/lib/marketingCampaignContent";
import { getMarketingCampaign } from "@/lib/data";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmails(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const email = String(raw).trim().toLowerCase();
    if (email && EMAIL_RE.test(email) && !seen.has(email)) { seen.add(email); out.push(email); }
  }
  return out;
}

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
  const { data: existing } = await supabase.from("marketing_campaigns").select("status, template_id, custom_message, subject").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (existing.status !== "draft") return NextResponse.json({ error: "Only draft campaigns can be edited" }, { status: 409 });

  const body = await request.json();
  const { name, subject, html, account_types, include_account_ids, exclude_account_ids, manual_emails, template_id, custom_message } = body;

  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = String(name).trim();

  const effectiveTemplateId = template_id !== undefined ? template_id : existing.template_id;
  if (effectiveTemplateId) {
    // Template mode (already was, or just switched to one) -- re-render from
    // the template every time so subject/custom_message edits stay in sync.
    const content = resolveCampaignContent({
      template_id: effectiveTemplateId,
      custom_message: custom_message !== undefined ? custom_message : (existing.custom_message ?? ""),
      subject: subject !== undefined ? subject : existing.subject,
    });
    patch.subject = content.subject;
    patch.body = content.body;
    patch.template_id = content.template_id;
    patch.custom_message = content.custom_message;
  } else {
    // Free-hand mode -- only touch what's actually provided, same as before.
    if (subject !== undefined) patch.subject = subject;
    if (html !== undefined) patch.body = sanitizeRichText(html) ?? "";
    patch.template_id = null;
    patch.custom_message = null;
  }

  if (Array.isArray(account_types)) patch.account_types = account_types;
  if (Array.isArray(include_account_ids)) patch.include_account_ids = include_account_ids;
  if (Array.isArray(exclude_account_ids)) patch.exclude_account_ids = exclude_account_ids;
  if (manual_emails !== undefined) patch.manual_emails = cleanEmails(manual_emails);

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
