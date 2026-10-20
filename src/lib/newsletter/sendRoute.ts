import "server-only";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { resolveMarketingRecipients } from "@/lib/data";
import { loadEmailOutput } from "@/lib/emailOutput";
import { buildAbsoluteUrl } from "@/lib/quotePublicLink";
import type { TenantFeatures } from "@/lib/constants";
import { sendNewsletterCampaign, type CampaignRow } from "./send";
import { loadVersion, sendableLanguages, studioEnabled } from "./server";

// The glue between the campaign send route and the newsletter branch: everything that
// can be refused before the first email is refused here, with a plain-words reason, and
// the campaign stays a draft.

export async function sendNewsletterBranch(input: {
  supabase: SupabaseClient;
  tenantId: string;
  campaign: CampaignRow & { account_types?: string[]; include_account_ids?: string[]; exclude_account_ids?: string[]; manual_emails?: string[]; filters?: unknown; match?: string };
}): Promise<NextResponse> {
  const { supabase, tenantId, campaign } = input;
  const admin = createAdminSupabase();

  const { data: tenant } = await admin.from("tenants").select("name, slug, company_info, features").eq("id", tenantId).single();
  // Same answer as a route that does not exist: a workspace without the studio never learns it does.
  if (!studioEnabled(tenant?.features as Partial<TenantFeatures> | undefined)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!process.env.QUOTE_PUBLIC_LINK_SECRET) {
    return NextResponse.json({ error: "Sending a newsletter needs signed links (QUOTE_PUBLIC_LINK_SECRET is not set), so it was not sent." }, { status: 500 });
  }

  const version = campaign.newsletter_version_id ? await loadVersion(admin, tenantId, campaign.newsletter_version_id) : null;
  if (!version) return NextResponse.json({ error: "The newsletter this campaign uses could not be found." }, { status: 404 });

  const ready = new Set(sendableLanguages(version));
  const chosen = (campaign.languages ?? []).filter((l) => ready.has(l));
  if (chosen.length === 0) return NextResponse.json({ error: "Pick at least one language that has been checked. A language is sendable once every line has been accepted." }, { status: 400 });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Email sending isn't configured yet (missing RESEND_API_KEY)." }, { status: 500 });

  const companyName = (tenant?.name as string | undefined) || "our team";
  const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
  const fromLocalPart = ((tenant?.slug as string | undefined) || "marketing").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const replyTo = (tenant?.company_info as { email?: string } | null)?.email || undefined;

  await supabase.from("marketing_campaigns").update({ status: "sending" }).eq("id", campaign.id).eq("tenant_id", tenantId);

  const candidates = await resolveMarketingRecipients(tenantId, {
    account_types: campaign.account_types ?? [],
    include_account_ids: campaign.include_account_ids ?? [],
    exclude_account_ids: campaign.exclude_account_ids ?? [],
    manual_emails: campaign.manual_emails ?? [],
    filters: (campaign.filters ?? []) as never,
    match: (campaign.match as "all" | "any" | undefined) ?? "all",
  });

  const resend = new Resend(apiKey);
  const user = await getAuthUser();
  const result = await sendNewsletterCampaign({
    supabase, admin, tenantId, userId: user?.id ?? null, userEmail: user?.email ?? null,
    campaign: { ...campaign, languages: chosen }, version, candidates,
    resend: { emails: { send: (m) => resend.emails.send(m as never) as never } },
    output: await loadEmailOutput(supabase, tenantId),
    companyName, replyTo, fromAddress: `${companyName} <${fromLocalPart}@${sendingDomain}>`,
    absoluteUrl: buildAbsoluteUrl,
  });

  await supabase.from("marketing_campaigns").update({
    status: "sent", sent_count: result.sent, failed_count: result.failed, skipped_count: result.skipped, sent_at: new Date().toISOString(),
  }).eq("id", campaign.id).eq("tenant_id", tenantId);

  return NextResponse.json({ sent: result.sent, failed: result.failed, skipped: result.skipped, by_language: result.byLanguage });
}
