import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { getStandardQuoteLive } from "@/lib/data/live";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { renderTemplate } from "@/lib/emailTemplates";
import { logEmail } from "@/lib/emailLog";
import { emailOutputFor, resolveOutbound } from "@/lib/emailOutput";
import { Resend } from "resend";
import { getGmailConnectorCredentials, findOriginalMessage, sendViaGmail, stripReplyPrefixes, buildReplySubject } from "@/lib/connectors/gmailReply";
import { blockingLines, flaggedLinesOf } from "@/lib/pricing/quoteLineFlags";

export const runtime = "nodejs";
export const maxDuration = 60;

// Mirrors api/quotes/[id]/email/route.ts's mechanics (reuse the /pdf route's
// render, Resend send, per-tenant from-address) but with its own fixed
// subject/body -- no tenant-configurable email_templates category for
// Standard Quote yet, deliberately, since the object itself is meant to
// start minimal.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
    return NextResponse.json({ error: "Standard Quotes isn't enabled for your workspace" }, { status: 403 });
  }

  const { id } = await params;

  const { data: quoteRow } = await supabase.from("standard_quotes").select("id, sent_at").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!quoteRow) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  // Pricing guardrails (0114, same gate as api/quotes/[id]/email): a line
  // the engine flagged under a "block" policy holds the quote until it is
  // re-priced or approved (approvals arrive in batch 3).
  const blocked = blockingLines(await flaggedLinesOf(supabase, "standard_quote_lines", "standard_quote_id", tenantId, id));
  if (blocked.length > 0) {
    return NextResponse.json({
      error: `This quote can't be sent: ${blocked.map((b) => `line ${b.label} is below the ${b.flag.floor_pct}% margin floor (${b.flag.actual_pct}%)`).join("; ")}. Re-price it, or wait for pricing approval.`,
      pricing_blocked: blocked,
    }, { status: 409 });
  }

  const [data, tenant] = await Promise.all([getStandardQuoteLive(id), getTenant()]);
  if (!data || !tenant) return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  const { quote, account, contact } = data;

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email sending isn't configured yet (missing RESEND_API_KEY)." }, { status: 500 });
  }

  const reqBody = await request.json().catch(() => ({}));
  const overrideEmail = typeof reqBody?.email === "string" ? reqBody.email.trim() : "";
  const recipient = overrideEmail || contact?.email || contact?.email2 || account?.email || account?.email2;
  if (!recipient) {
    return NextResponse.json({ error: "No email address on file for this contact or account." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return NextResponse.json({ error: "That doesn't look like a valid email address." }, { status: 400 });
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const pdfUrl = new URL(`/api/standard-quotes/${id}/pdf`, request.nextUrl.origin).toString();
  const pdfRes = await fetch(pdfUrl, { headers: cookieHeader ? { cookie: cookieHeader } : {} });
  if (!pdfRes.ok) {
    return NextResponse.json({ error: "Failed to generate the quote PDF" }, { status: 502 });
  }
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

  const companyName = tenant.name || "our team";
  const replyTo = tenant.company_info?.email || undefined;
  const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
  const fromLocalPart = (tenant.slug || "quotes").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const fromAddress = `${companyName} <${fromLocalPart}@${sendingDomain}>`;

  const vars = {
    customer_name: contact?.name ?? "Sir/Madam",
    company_name: companyName,
    quote_ref: quote.ref,
    quote_total: "₹" + quote.total.toLocaleString("en-IN", { maximumFractionDigits: 0 }),
    valid_until: quote.valid_until ? new Date(quote.valid_until).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—",
  };
  const rawSubject = typeof reqBody?.subject === "string" && reqBody.subject
    ? reqBody.subject
    : renderTemplate("Quotation {{quote_ref}} from {{company_name}}", vars);
  const rawText = typeof reqBody?.body === "string" && reqBody.body
    ? reqBody.body
    : renderTemplate("Dear {{customer_name}},\n\nPlease find attached our quotation {{quote_ref}}.\n\nRegards,\n{{company_name}}", vars);

  // The email output channel decides where this really goes (a demo
  // workspace never reaches a customer) -- see src/lib/emailOutput.ts.
  const routed = resolveOutbound(emailOutputFor(tenant), { to: [recipient], subject: rawSubject, text: rawText });
  if (!routed.ok) return NextResponse.json({ error: routed.error }, { status: 400 });
  const mail = routed.email;
  const subject = mail.subject;
  const text = mail.text;

  // Same best-effort Gmail reply-threading as api/quotes/[id]/email/route.ts
  // -- see gmailReply.ts. Falls back to Resend on no connector/no match/any
  // failure. Never for a redirected message.
  let sendError: { message: string } | null = null;
  let sentViaGmail = false;
  let finalSubject = subject;

  const gmailCreds = !mail.redirected && (await tenantHasFeature(supabase, tenantId, "gmail_reply_threading"))
    ? await getGmailConnectorCredentials(supabase, tenantId)
    : null;
  if (gmailCreds) {
    try {
      const original = await findOriginalMessage(gmailCreds, recipient, subject);
      if (original) {
        const threadedSubject = buildReplySubject(stripReplyPrefixes(original.subject) || stripReplyPrefixes(subject));
        const result = await sendViaGmail(gmailCreds, {
          fromDisplayName: companyName,
          to: recipient,
          subject: threadedSubject,
          text,
          attachments: [{ filename: `${quote.ref}.pdf`, content: pdfBuffer }],
          inReplyTo: original.messageId,
          references: original.messageId,
        });
        if (result.ok) {
          sentViaGmail = true;
          finalSubject = threadedSubject;
        }
      }
    } catch (e) {
      console.error("[standard-quotes/email] Gmail threaded send failed, falling back to Resend", e);
    }
  }

  if (!sentViaGmail) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: fromAddress,
      to: mail.to,
      replyTo,
      subject,
      text,
      attachments: [{ filename: `${quote.ref}.pdf`, content: pdfBuffer }],
    });
    sendError = result.error ?? null;
  }

  const user = await getAuthUser();
  await logEmail(supabase, {
    tenantId, kind: "quote", toEmail: mail.to.join(", "), subject: sentViaGmail ? finalSubject : subject,
    status: sendError ? "failed" : "sent",
    error: sendError?.message,
    relatedObjectType: "standard_quotes", relatedObjectId: quote.id, relatedObjectLabel: quote.ref,
    actorId: user?.id, actorEmail: user?.email,
  });

  if (sendError) {
    console.error("[standard-quotes/email] send failed", sendError);
    return NextResponse.json({ error: "Failed to send email" }, { status: 502 });
  }

  // Submitted-to-customer stamp (0059): an actual successful send is the
  // authoritative event -- "Mark as sent" also stamps it, first one wins.
  if (!quoteRow.sent_at) {
    await supabase
      .from("standard_quotes")
      .update({ sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", tenantId);
  }

  if (account) {
    await supabase.from("activities").insert({
      tenant_id: tenantId,
      account_id: account.id,
      pillar: "sales",
      text: mail.redirected
        ? `Standard Quote ${quote.ref} emailed to ${mail.to.join(", ")} (redirected; addressed to ${recipient})`
        : `Standard Quote ${quote.ref} emailed to ${recipient}`,
    });
  }

  return NextResponse.json({ ok: true, sentTo: mail.to.join(", "), redirected: mail.redirected, intended: recipient });
}
