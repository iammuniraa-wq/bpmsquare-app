import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { getAuthUser, createAdminSupabase } from "@/lib/supabase-server";
import { plainCampaignConsent } from "@/lib/newsletter/send";
import { requireMarketingAccess } from "@/lib/marketingAccess";
import { resolveMarketingRecipients } from "@/lib/data";
import { renderTemplate, escapeHtml } from "@/lib/emailTemplates";
import { richTextToPlainText } from "@/lib/sanitizeHtml";
import { signUnsubscribeToken } from "@/lib/marketingUnsubscribe";
import { signCampaignInterestToken } from "@/lib/campaignInterestLink";
import { buildAbsoluteUrl } from "@/lib/quotePublicLink";
import { ROUTES } from "@/lib/constants";
import { logEmail } from "@/lib/emailLog";
import { loadEmailOutput, resolveOutbound } from "@/lib/emailOutput";
import { emitCampaignSent } from "@/lib/events/emitters";
import { sendNewsletterBranch } from "@/lib/newsletter/sendRoute";
import { countStatuses, recipientKey, restCandidates } from "@/lib/marketing/sendProgress";

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
  const guard = await requireMarketingAccess(["marketing"], "edit");
  if ("error" in guard) return guard.error;
  const { supabase, tenantId } = guard.auth;

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email sending isn't configured yet (missing RESEND_API_KEY)." }, { status: 500 });
  }

  const { id } = await params;
  const { data: campaign } = await supabase.from("marketing_campaigns").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  // "Send the rest": a campaign that already went out, sent again to the people who failed or were never reached. Never
  // to anyone already sent, and through the same consent gate below.
  const retry = new URL(request.url).searchParams.get("retry") === "rest";
  if (retry) {
    if (campaign.newsletter_version_id) return NextResponse.json({ error: "Send the rest is for plain emails. Send the newsletter again from the studio." }, { status: 400 });
    if (campaign.status === "draft") return NextResponse.json({ error: "This campaign has not been sent yet" }, { status: 409 });
  } else if (campaign.status !== "draft") return NextResponse.json({ error: "This campaign has already been sent" }, { status: 409 });
  // A campaign that sends a newsletter version takes the studio's branch (consent per person, a
  // language per person, tracked links). Every other campaign continues below, unchanged.
  if (campaign.newsletter_version_id) return sendNewsletterBranch({ supabase, tenantId, campaign });
  if (!campaign.subject?.trim()) return NextResponse.json({ error: "Add a subject before sending" }, { status: 400 });
  if (!campaign.body?.trim()) return NextResponse.json({ error: "Add a message before sending" }, { status: 400 });

  const { data: tenantRow } = await supabase.from("tenants").select("name, slug, company_info").eq("id", tenantId).single();
  const companyName = tenantRow?.name || "our team";
  const replyTo = (tenantRow?.company_info as { email?: string } | null)?.email || undefined;
  const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
  const fromLocalPart = (tenantRow?.slug || "marketing").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const fromAddress = `${companyName} <${fromLocalPart}@${sendingDomain}>`;

  if (retry) {
    // Claim it atomically: two presses of the button must not send twice.
    const { data: claimed } = await supabase.from("marketing_campaigns").update({ status: "sending" }).eq("id", id).eq("tenant_id", tenantId).in("status", ["sent", "failed"]).select("id");
    if (!claimed?.length) return NextResponse.json({ error: "This campaign is already being sent" }, { status: 409 });
  } else {
    await supabase.from("marketing_campaigns").update({ status: "sending" }).eq("id", id).eq("tenant_id", tenantId);
  }

  const everyone = await resolveMarketingRecipients(tenantId, {
    account_types: campaign.account_types ?? [],
    include_account_ids: campaign.include_account_ids ?? [],
    exclude_account_ids: campaign.exclude_account_ids ?? [],
    manual_emails: campaign.manual_emails ?? [],
    filters: campaign.filters ?? [],
    match: campaign.match ?? "all",
  });

  // What was already recorded for this campaign, so the rest never repeats a send and a retried failure is updated in place.
  const { data: existingRows } = retry
    ? await supabase.from("marketing_campaign_recipients").select("id, account_id, manual_email, status").eq("campaign_id", id).eq("tenant_id", tenantId)
    : { data: [] as { id: string; account_id: string | null; manual_email: string | null; status: string }[] };
  const recorded = existingRows ?? [];
  const candidates = retry ? restCandidates(everyone, recorded) : everyone;
  const failedRowOf = new Map(recorded.filter((r) => r.status === "failed").map((r) => [recipientKey(r), r.id]));
  // Insert a new recipient row, or (sending the rest) update the failed one this person already has.
  const writeRow = async (target: { account_id: string | null; manual_email: string | null }, row: Record<string, unknown>) => {
    const rowId = retry ? failedRowOf.get(recipientKey(target)) : undefined;
    if (rowId) return supabase.from("marketing_campaign_recipients").update({ error: null, ...row }).eq("id", rowId).eq("tenant_id", tenantId);
    return supabase.from("marketing_campaign_recipients").insert({ tenant_id: tenantId, campaign_id: id, ...target, ...row });
  };

  const resend = new Resend(process.env.RESEND_API_KEY);
  const output = await loadEmailOutput(supabase, tenantId);
  const user = await getAuthUser();
  let sent = 0, failed = 0, skipped = 0;

  // The same per-person consent gate the newsletter, journeys and WhatsApp use, for the campaign's topic.
  const consentFor = await plainCampaignConsent({ admin: createAdminSupabase(), tenantId, topic: (campaign.topic as string | null | undefined) ?? null, candidates });

  for (const candidate of candidates) {
    const target = { account_id: candidate.account_id, manual_email: candidate.manual_email };

    const verdict = await consentFor(candidate);
    if (!verdict.ok) {
      const plain = verdict.status === "skipped_opt_out" || verdict.status === "skipped_no_email";
      await writeRow(target, plain
        ? { email: null, status: verdict.status }
        : { email: candidate.email, status: verdict.status, error: verdict.reason, contact_id: verdict.contact?.id ?? null });
      skipped++;
      continue;
    }
    if (!candidate.email) continue; // unreachable: the gate above already skipped a missing address

    const vars = { account_name: candidate.account_name, company_name: companyName };
    const subject = renderTemplate(campaign.subject, vars);
    // The body is real HTML (a template or sanitized rich text) -- unlike the
    // plain-text subject, account_name/company_name here must be
    // HTML-escaped before substitution, since an account name is free text
    // any tenant user can set and has no reason to ever contain markup.
    const htmlVars = { account_name: escapeHtml(candidate.account_name), company_name: escapeHtml(companyName) };
    const bodyHtml = renderTemplate(campaign.body, htmlVars);

    // Manually-typed recipients have no account row to flag opted-out or
    // attribute a lead to, so there's nothing for an unsubscribe or interest
    // link to act on -- skip both for them.
    const unsubToken = candidate.account_id ? signUnsubscribeToken(candidate.account_id) : null;
    const unsubUrl = unsubToken && candidate.account_id ? await buildAbsoluteUrl(ROUTES.marketingUnsubscribe(candidate.account_id, unsubToken)) : null;
    const interestToken = candidate.account_id ? signCampaignInterestToken(id, candidate.account_id) : null;
    const interestUrl = interestToken && candidate.account_id ? await buildAbsoluteUrl(ROUTES.marketingInterest(id, candidate.account_id, interestToken)) : null;

    const interestBlock = interestUrl
      ? `<div style="text-align:center;margin:22px 0 4px;"><a href="${interestUrl}" style="display:inline-block;padding:11px 24px;border-radius:8px;background:#378add;color:#ffffff;font-size:13.5px;font-weight:600;text-decoration:none;">Interested? Tell us more</a></div>`
      : "";
    const footer = unsubUrl
      ? `<p style="font-size:11px;color:#8a96a5;margin-top:24px;">You're receiving this because you're a contact of ${companyName}. <a href="${unsubUrl}">Unsubscribe</a></p>`
      : "";
    const textFooter = [interestUrl ? `\nInterested? Tell us more: ${interestUrl}` : "", unsubUrl ? `\n\n---\nUnsubscribe: ${unsubUrl}` : ""].join("");

    // The email output channel decides where this really goes (a demo
    // workspace never reaches a customer) -- see src/lib/emailOutput.ts.
    const routed = resolveOutbound(output, {
      to: [candidate.email], subject,
      html: bodyHtml + interestBlock + footer,
      text: richTextToPlainText(bodyHtml) + textFooter,
    });
    const sendError = routed.ok
      ? (await resend.emails.send({
          from: fromAddress,
          to: routed.email.to,
          replyTo,
          subject: routed.email.subject,
          html: routed.email.html,
          text: routed.email.text,
        })).error
      : { message: routed.error };

    if (sendError) {
      await Promise.all([
        writeRow(target, { email: candidate.email, status: "failed", error: sendError.message }),
        logEmail(supabase, {
          tenantId, kind: "campaign", toEmail: candidate.email, subject,
          status: "failed", error: sendError.message,
          relatedObjectType: "marketing_campaigns", relatedObjectId: id, relatedObjectLabel: campaign.name,
          actorId: user?.id, actorEmail: user?.email,
        }),
      ]);
      failed++;
    } else {
      await Promise.all([
        writeRow(target, { email: candidate.email, status: "sent", sent_at: new Date().toISOString() }),
        logEmail(supabase, {
          tenantId, kind: "campaign", toEmail: candidate.email, subject,
          status: "sent",
          relatedObjectType: "marketing_campaigns", relatedObjectId: id, relatedObjectLabel: campaign.name,
          actorId: user?.id, actorEmail: user?.email,
        }),
      ]);
      sent++;
    }
    await sleep(SEND_DELAY_MS);
  }

  // After sending the rest the totals are the whole campaign's, not this run's.
  if (retry) {
    const { data: all } = await supabase.from("marketing_campaign_recipients").select("status").eq("campaign_id", id).eq("tenant_id", tenantId);
    ({ sent, failed, skipped } = countStatuses(all ?? []));
  }
  await supabase.from("marketing_campaigns").update({
    status: "sent",
    sent_count: sent,
    failed_count: failed,
    skipped_count: skipped,
    ...(retry ? {} : { sent_at: new Date().toISOString() }),
  }).eq("id", id).eq("tenant_id", tenantId);

  // The "sent" event fires once, for the first send; sending the rest must not announce the campaign again.
  if (!retry) await emitCampaignSent(tenantId, { campaignId: id, name: campaign.name, sent, failed, skipped, actorId: user?.id });

  return NextResponse.json({ sent, failed, skipped });
}
