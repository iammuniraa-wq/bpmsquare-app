import { NextResponse, type NextRequest } from "next/server";
import { requireMarketingAccess } from "@/lib/marketingAccess";
import { resolveCampaignContent } from "@/lib/marketingCampaignContent";
import { sanitizeSegmentFilters, sanitizeMatch } from "@/lib/marketingSegmentation";
import { newsletterFieldsForCreate } from "@/lib/newsletter/campaignFields";

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

export async function GET() {
  const guard = await requireMarketingAccess(["marketing"], "view");
  if ("error" in guard) return guard.error;
  const { supabase, tenantId } = guard.auth;

  const { data, error } = await supabase
    .from("marketing_campaigns")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const guard = await requireMarketingAccess(["marketing"], "edit");
  if ("error" in guard) return guard.error;
  const { supabase, tenantId, userId } = guard.auth;

  const body = await request.json();
  const { name, subject, html, account_types, include_account_ids, exclude_account_ids, manual_emails, filters, match, template_id, custom_message } = body;

  if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });

  // A campaign that sends a newsletter version (Newsletter Studio, 0142). Only a body that names a
  // version takes this branch; every other campaign is created exactly as before.
  let newsletter: Record<string, unknown> | null = null;
  if (body.newsletter_version_id !== undefined) {
    const r = await newsletterFieldsForCreate(tenantId, body);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    newsletter = r.fields;
  }

  const content = newsletter
    ? { subject: String(newsletter.subject), body: String(newsletter.body), template_id: null, custom_message: null }
    : resolveCampaignContent({ template_id, custom_message, subject, html });

  const { data, error } = await supabase
    .from("marketing_campaigns")
    .insert({
      tenant_id: tenantId,
      name: name.trim(),
      subject: content.subject,
      body: content.body,
      template_id: content.template_id,
      custom_message: content.custom_message,
      ...(newsletter ? { newsletter_version_id: newsletter.newsletter_version_id, languages: newsletter.languages, fallback_language: newsletter.fallback_language, topic: newsletter.topic } : {}),
      account_types: Array.isArray(account_types) ? account_types : [],
      include_account_ids: Array.isArray(include_account_ids) ? include_account_ids : [],
      exclude_account_ids: Array.isArray(exclude_account_ids) ? exclude_account_ids : [],
      manual_emails: cleanEmails(manual_emails),
      filters: sanitizeSegmentFilters(filters),
      match: sanitizeMatch(match),
      created_by: userId,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
