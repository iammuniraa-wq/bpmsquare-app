import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { getStandardQuoteLive } from "@/lib/data/live";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { renderTemplate } from "@/lib/emailTemplates";
import { logEmail } from "@/lib/emailLog";
import { Resend } from "resend";
import { getGmailConnectorCredentials, findOriginalMessage, sendViaGmail, stripReplyPrefixes, buildReplySubject } from "@/lib/connectors/gmailReply";

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
  const subject = typeof reqBody?.subject === "string" && reqBody.subject
    ? reqBody.subject
    : renderTemplate("Quotation {{quote_ref}} from {{company_name}}", vars);
  const text = typeof reqBody?.body === "string" && reqBody.body
    ? reqBody.body
    : renderTemplate("Dear {{customer_name}},\n\nPlease find attached our quotation {{quote_ref}}.\n\nRegards,\n{{company_name}}", vars);

  // Same best-effort Gmail reply-threading as api/quotes/[id]/email/route.ts
  // -- see gmailReply.ts. Falls back to Resend on no connector/no match/any
  // failure.
  let sendError: { message: string } | null = null;
  let sentViaGmail = false;
  let finalSubject = subject;

  const gmailCreds = (await tenantHasFeature(supabase, tenantId, "gmail_reply_threading"))
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
      to: recipient,
      replyTo,
      subject,
      text,
      attachments: [{ filename: `${quote.ref}.pdf`, content: pdfBuffer }],
    });
    sendError = result.error ?? null;
  }

  const user = await getAuthUser();
  await logEmail(supabase, {
    tenantId, kind: "quote", toEmail: recipient, subject: sentViaGmail ? finalSubject : subject,
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
      text: `Standard Quote ${quote.ref} emailed to ${recipient}`,
    });
  }

  return NextResponse.json({ ok: true, sentTo: recipient });
}
