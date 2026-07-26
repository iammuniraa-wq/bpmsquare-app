import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolveMarketingRecipients } from "@/lib/data";
import { renderTemplate } from "@/lib/emailTemplates";
import { richTextToPlainText } from "@/lib/sanitizeHtml";
import { signUnsubscribeToken } from "@/lib/marketingUnsubscribe";
import { buildAbsoluteUrl } from "@/lib/quotePublicLink";
import { ROUTES } from "@/lib/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sequential with a small delay between sends -- keeps this simple (no queue/
// worker) while staying under Resend's per-second rate limit. Fine for the
// campaign sizes this targets; a genuinely large list (this loop plus
// maxDuration above caps it at roughly 150-200 recipients per send) would
// need real batching/background processing instead.
const SEND_DELAY_MS = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email sending isn't configured yet (missing RESEND_API_KEY)." }, { status: 500 });
  }

  const { id } = await params;
  const { data: campaign } = await supabase.from("marketing_campaigns").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.status !== "draft") return NextResponse.json({ error: "This campaign has already been sent" }, { status: 409 });
  if (!campaign.subject?.trim()) return NextResponse.json({ error: "Add a subject before sending" }, { status: 400 });
  if (!campaign.body?.trim()) return NextResponse.json({ error: "Add a message before sending" }, { status: 400 });

  const { data: tenantRow } = await supabase.from("tenants").select("name, slug, company_info").eq("id", tenantId).single();
  const companyName = tenantRow?.name || "our team";
  const replyTo = (tenantRow?.company_info as { email?: string } | null)?.email || undefined;
  const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
  const fromLocalPart = (tenantRow?.slug || "marketing").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const fromAddress = `${companyName} <${fromLocalPart}@${sendingDomain}>`;

  await supabase.from("marketing_campaigns").update({ status: "sending" }).eq("id", id).eq("tenant_id", tenantId);

  const candidates = await resolveMarketingRecipients(tenantId, {
    account_types: campaign.account_types ?? [],
    include_account_ids: campaign.include_account_ids ?? [],
    exclude_account_ids: campaign.exclude_account_ids ?? [],
    manual_emails: campaign.manual_emails ?? [],
    filters: campaign.filters ?? [],
    match: campaign.match ?? "all",
  });

  const resend = new Resend(process.env.RESEND_API_KEY);
  let sent = 0, failed = 0, skipped = 0;

  for (const candidate of candidates) {
    const target = { account_id: candidate.account_id, manual_email: candidate.manual_email };

    if (candidate.marketing_opt_out) {
      await supabase.from("marketing_campaign_recipients").insert({
        tenant_id: tenantId, campaign_id: id, ...target,
        email: null, status: "skipped_opt_out",
      });
      skipped++;
      continue;
    }
    if (!candidate.email) {
      await supabase.from("marketing_campaign_recipients").insert({
        tenant_id: tenantId, campaign_id: id, ...target,
        email: null, status: "skipped_no_email",
      });
      skipped++;
      continue;
    }

    const vars = { account_name: candidate.account_name, company_name: companyName };
    const subject = renderTemplate(campaign.subject, vars);
    const bodyHtml = renderTemplate(campaign.body, vars);

    // Manually-typed recipients have no account row to flag opted-out, so
    // there's nothing for an unsubscribe link to update -- skip it for them.
    const unsubToken = candidate.account_id ? signUnsubscribeToken(candidate.account_id) : null;
    const unsubUrl = unsubToken && candidate.account_id ? await buildAbsoluteUrl(ROUTES.marketingUnsubscribe(candidate.account_id, unsubToken)) : null;
    const footer = unsubUrl
      ? `<p style="font-size:11px;color:#8a96a5;margin-top:24px;">You're receiving this because you're a contact of ${companyName}. <a href="${unsubUrl}">Unsubscribe</a></p>`
      : "";
    const textFooter = unsubUrl ? `\n\n---\nUnsubscribe: ${unsubUrl}` : "";

    const { error: sendError } = await resend.emails.send({
      from: fromAddress,
      to: candidate.email,
      replyTo,
      subject,
      html: bodyHtml + footer,
      text: richTextToPlainText(bodyHtml) + textFooter,
    });

    if (sendError) {
      await supabase.from("marketing_campaign_recipients").insert({
        tenant_id: tenantId, campaign_id: id, ...target,
        email: candidate.email, status: "failed", error: sendError.message,
      });
      failed++;
    } else {
      await supabase.from("marketing_campaign_recipients").insert({
        tenant_id: tenantId, campaign_id: id, ...target,
        email: candidate.email, status: "sent", sent_at: new Date().toISOString(),
      });
      sent++;
    }
    await sleep(SEND_DELAY_MS);
  }

  await supabase.from("marketing_campaigns").update({
    status: "sent",
    sent_count: sent,
    failed_count: failed,
    skipped_count: skipped,
    sent_at: new Date().toISOString(),
  }).eq("id", id).eq("tenant_id", tenantId);

  return NextResponse.json({ sent, failed, skipped });
}
