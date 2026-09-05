import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { getQuote } from "@/lib/data";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { renderTemplate, DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates";
import { logEmail } from "@/lib/emailLog";
import { emailOutputFor, resolveOutbound } from "@/lib/emailOutput";
import { Resend } from "resend";
import { getGmailConnectorCredentials, findOriginalMessage, sendViaGmail, stripReplyPrefixes, buildReplySubject } from "@/lib/connectors/gmailReply";
import { blockingLines, flaggedLinesOf } from "@/lib/pricing/quoteLineFlags";

export const runtime = "nodejs";
export const maxDuration = 60;

// Sends the same PDF the "Download PDF" button produces as an email attachment.
// Reuses /api/quotes/[id]/pdf for the render (same auth, same markup, single
// source of truth) rather than re-driving Puppeteer here.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;

  // getQuote() resolves its own tenant scope from the session (see
  // currentTenantId() in lib/data/live.ts), which is a different resolution
  // path than requireTenantUser()'s hostname-based tenantId. This route
  // mutates (sends mail, logs an activity), so per MULTI_TENANT_GUARDRAILS.md
  // it gets its own explicit tenant-scoped existence check rather than
  // trusting getQuote()'s internal resolution alone.
  const { data: quoteRow } = await supabase
    .from("quotes")
    .select("id, submitted_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!quoteRow) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  const [data, tenant] = await Promise.all([getQuote(id), getTenant()]);
  if (!data || !tenant) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  const { quote, account, contact } = data;

  // Pricing guardrails (cost-based step 2, owner decision: block). A line
  // the engine flagged under a "block" policy holds the whole quote until
  // it is approved -- batch 3 adds the approval; until then it waits.
  const blocked = blockingLines(await flaggedLinesOf(supabase, "quote_lines", "quote_id", tenantId, id));
  if (blocked.length > 0) {
    return NextResponse.json({
      error: `This quote can't be sent: ${blocked.map((b) => `line ${b.label} is below the ${b.flag.floor_pct}% margin floor (${b.flag.actual_pct}%)`).join("; ")}. Re-price it, or wait for pricing approval.`,
      pricing_blocked: blocked,
    }, { status: 409 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email sending isn't configured yet (missing RESEND_API_KEY)." }, { status: 500 });
  }

  const reqBody = await request.json().catch(() => ({}));
  const overrideEmail = typeof reqBody?.email === "string" ? reqBody.email.trim() : "";
  const recipient = overrideEmail || contact?.email || contact?.email2 || account?.email || account?.email2;
  if (!recipient) {
    return NextResponse.json({ error: "No email address on file for this contact or account." }, { status: 400 });
  }
  // Basic shape check on a client-suppliable field before it reaches Resend's API.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return NextResponse.json({ error: "That doesn't look like a valid email address." }, { status: 400 });
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const pdfUrl = new URL(`/api/quotes/${id}/pdf`, request.nextUrl.origin).toString();
  const pdfRes = await fetch(pdfUrl, { headers: cookieHeader ? { cookie: cookieHeader } : {} });
  if (!pdfRes.ok) {
    return NextResponse.json({ error: "Failed to generate the quote PDF" }, { status: 502 });
  }
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

  const companyName = tenant.name || "our team";
  const replyTo = tenant.company_info?.email || undefined;
  // Sending domain is shared and verified once in Resend for all tenants, but
  // the local-part + display name are always derived per-tenant so two
  // tenants never look like they're sending as each other. Deliberately does
  // NOT read a global RESEND_FROM_EMAIL override -- that would collapse every
  // tenant's identity into one shared "from", defeating the point.
  const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
  const fromLocalPart = (tenant.slug || "quotes").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const fromAddress = `${companyName} <${fromLocalPart}@${sendingDomain}>`;

  // The compose modal sends fully-resolved (and possibly user-edited)
  // subject/body directly -- use those as-is. Any other caller that doesn't
  // supply them (a bare API call) falls back to the tenant's default "quote"
  // template, or the built-in default if none is set.
  let subject = typeof reqBody?.subject === "string" ? reqBody.subject : "";
  let text = typeof reqBody?.body === "string" ? reqBody.body : "";
  if (!subject || !text) {
    const { data: defaultTemplate } = await supabase
      .from("email_templates")
      .select("subject, body")
      .eq("tenant_id", tenantId)
      .eq("category", "quote")
      .eq("is_default", true)
      .maybeSingle();
    const fallback = defaultTemplate ?? DEFAULT_EMAIL_TEMPLATES.quote;
    const vars = {
      customer_name: contact?.name ?? "Sir/Madam",
      company_name: companyName,
      quote_ref: quote.ref,
      quote_total: "₹" + quote.total.toLocaleString("en-IN", { maximumFractionDigits: 0 }),
      valid_until: quote.valid_until ? new Date(quote.valid_until).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—",
    };
    subject = subject || renderTemplate(fallback.subject, vars);
    text = text || renderTemplate(fallback.body, vars);
  }

  // The email output channel decides where this really goes (a demo
  // workspace never reaches a customer) -- see src/lib/emailOutput.ts.
  const routed = resolveOutbound(emailOutputFor(tenant), { to: [recipient], subject, text });
  if (!routed.ok) return NextResponse.json({ error: routed.error }, { status: 400 });
  const mail = routed.email;
  subject = mail.subject;
  text = mail.text;

  // If this tenant has a connected Gmail account, try to thread this send
  // into the customer's original email as a real reply -- same App Password
  // the connector already uses to send its test email, just also used here
  // to read (IMAP) before sending (SMTP). Best-effort only: any failure at
  // any step (not connected, no match found, IMAP/SMTP error) silently falls
  // back to the existing Resend send below, which is always the safety net.
  // Never attempted for a redirected message: threading into the customer's
  // own conversation is the one thing a redirect exists to prevent.
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
        // A found-but-failed Gmail send (e.g. an app password that's since
        // been revoked) still falls through to the Resend attempt below --
        // getting the quote out unthreaded beats not sending it at all.
      }
    } catch (e) {
      console.error("[quotes/email] Gmail threaded send failed, falling back to Resend", e);
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
    relatedObjectType: "quotes", relatedObjectId: quote.id, relatedObjectLabel: quote.ref,
    actorId: user?.id, actorEmail: user?.email,
  });

  if (sendError) {
    console.error("[quotes/email] send failed", sendError);
    return NextResponse.json({ error: "Failed to send email" }, { status: 502 });
  }

  // Submitted-to-customer stamp (0059): an actual successful send is the
  // authoritative event -- a status change out of draft also stamps it,
  // first one wins.
  if (!(quoteRow as { submitted_at?: string | null }).submitted_at) {
    await supabase
      .from("quotes")
      .update({ submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", tenantId);
  }

  if (account) {
    await supabase.from("activities").insert({
      tenant_id: tenantId,
      account_id: account.id,
      pillar: "sales",
      text: mail.redirected
        ? `Quote ${quote.ref} emailed to ${mail.to.join(", ")} (redirected; addressed to ${recipient})`
        : `Quote ${quote.ref} emailed to ${recipient}`,
    });
  }

  return NextResponse.json({ ok: true, sentTo: mail.to.join(", "), redirected: mail.redirected, intended: recipient });
}
