import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getQuote } from "@/lib/data";
import { getTenant } from "@/lib/tenant";
import { Resend } from "resend";

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
    .select("id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!quoteRow) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  const [data, tenant] = await Promise.all([getQuote(id), getTenant()]);
  if (!data || !tenant) return NextResponse.json({ error: "Quote not found" }, { status: 404 });

  const { quote, account, contact } = data;

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email sending isn't configured yet (missing RESEND_API_KEY)." }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const overrideEmail = typeof body?.email === "string" ? body.email.trim() : "";
  const recipient = overrideEmail || contact?.email || contact?.email2 || account?.email || account?.email2;
  if (!recipient) {
    return NextResponse.json({ error: "No email address on file for this contact or account." }, { status: 400 });
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
  const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
  const fromAddress = process.env.RESEND_FROM_EMAIL || `${companyName} <quotes@${sendingDomain}>`;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error: sendError } = await resend.emails.send({
    from: fromAddress,
    to: recipient,
    replyTo,
    subject: `Quotation ${quote.ref} from ${companyName}`,
    text: `Dear ${contact?.name ?? "Sir/Madam"},\n\nPlease find attached our quotation ${quote.ref}.\n\nRegards,\n${companyName}`,
    attachments: [{ filename: `${quote.ref}.pdf`, content: pdfBuffer }],
  });

  if (sendError) {
    console.error("[quotes/email] resend send failed", sendError);
    return NextResponse.json({ error: "Failed to send email" }, { status: 502 });
  }

  if (account) {
    await supabase.from("activities").insert({
      tenant_id: tenantId,
      account_id: account.id,
      pillar: "sales",
      text: `Quote ${quote.ref} emailed to ${recipient}`,
    });
  }

  return NextResponse.json({ ok: true, sentTo: recipient });
}
