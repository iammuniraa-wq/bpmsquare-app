import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser, createAdminSupabase } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { decryptAccount, decryptContact } from "@/lib/encryption";
import { renderTemplate, DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates";
import { logEmail } from "@/lib/emailLog";
import { emailOutputFor, resolveOutbound } from "@/lib/emailOutput";
import { Resend } from "resend";
import type { Account, Contact } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 10;

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

async function loadInvoice(tenantId: string, id: string) {
  const admin = createAdminSupabase();
  const { data: invoice } = await admin
    .from("invoices").select("id, ref, status, total, due_date, issued_at, account_id, contact_id")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!invoice) return null;
  const [{ data: account }, { data: contacts }] = await Promise.all([
    admin.from("accounts").select("*").eq("id", invoice.account_id).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("contacts").select("*").eq("account_id", invoice.account_id).eq("tenant_id", tenantId).order("name"),
  ]);
  return {
    invoice,
    account: account ? decryptAccount(account as Account) : null,
    contacts: ((contacts ?? []) as Contact[]).map(decryptContact),
  };
}

/** Who this invoice could go to: the account's contacts with an address,
 *  then the account itself. The client adds any typed-in addresses. */
function suggestions(account: Account | null, contacts: Contact[], contactId: string | null) {
  const out: { name: string; email: string; preferred: boolean }[] = [];
  const seen = new Set<string>();
  const push = (name: string, email: string | null | undefined, preferred: boolean) => {
    const e = (email ?? "").trim().toLowerCase();
    if (!e || seen.has(e) || !EMAIL_RE.test(e)) return;
    seen.add(e);
    out.push({ name, email: e, preferred });
  };
  for (const ct of contacts) {
    push(ct.name, ct.email, ct.id === contactId);
    push(ct.name, ct.email2, false);
  }
  if (account) {
    push(account.name, account.email, out.length === 0);
    push(account.name, (account as { email2?: string | null }).email2, false);
  }
  return out;
}

// GET /api/invoices/[id]/email — what the compose screen starts from:
// suggested recipients and the tenant's invoice template resolved for this
// invoice. Nothing is sent.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { id } = await params;
  const loaded = await loadInvoice(tenantId, id);
  if (!loaded) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  const { invoice, account, contacts } = loaded;
  const tenant = await getTenant();

  const { data: template } = await supabase
    .from("email_templates").select("subject, body")
    .eq("tenant_id", tenantId).eq("category", "invoice").eq("is_default", true).maybeSingle();
  const fallback = template ?? DEFAULT_EMAIL_TEMPLATES.invoice;
  const preferred = contacts.find((ct) => ct.id === invoice.contact_id) ?? contacts[0] ?? null;
  const vars = {
    customer_name: preferred?.name ?? "Sir/Madam",
    company_name: tenant?.name ?? "our team",
    invoice_ref: invoice.ref as string,
    invoice_total: "₹" + Number(invoice.total).toLocaleString("en-IN", { maximumFractionDigits: 0 }),
    due_date: fmtDate(invoice.due_date as string | null),
  };

  return NextResponse.json({
    suggestions: suggestions(account, contacts, invoice.contact_id as string | null),
    subject: renderTemplate(fallback.subject, vars),
    body: renderTemplate(fallback.body, vars),
    configured: !!process.env.RESEND_API_KEY,
  });
}

// POST /api/invoices/[id]/email — send the invoice PDF to one or more
// addresses. Body: { to: string[], subject?, body? }. Mirrors the quote
// email route: the PDF comes from /api/invoices/[id]/pdf so the attachment
// is byte-for-byte what "Download PDF" gives. A draft becomes "sent" on the
// first successful send, the same stamp "Mark as sent" applies by hand.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { id } = await params;
  const loaded = await loadInvoice(tenantId, id);
  if (!loaded) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  const { invoice, account } = loaded;
  if (invoice.status === "cancelled") return NextResponse.json({ error: "A cancelled invoice can't be sent." }, { status: 400 });

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Email sending isn't configured yet (missing RESEND_API_KEY)." }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as { to?: unknown; subject?: unknown; body?: unknown };
  const raw = Array.isArray(body.to) ? body.to : typeof body.to === "string" ? [body.to] : [];
  const to = [...new Set(raw.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (to.length === 0) return NextResponse.json({ error: "Add at least one recipient." }, { status: 400 });
  if (to.length > MAX_RECIPIENTS) return NextResponse.json({ error: `At most ${MAX_RECIPIENTS} recipients per send.` }, { status: 400 });
  const badAddress = to.find((x) => !EMAIL_RE.test(x));
  if (badAddress) return NextResponse.json({ error: `"${badAddress}" doesn't look like a valid email address.` }, { status: 400 });

  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  const cookieHeader = request.headers.get("cookie") ?? "";
  const pdfRes = await fetch(new URL(`/api/invoices/${id}/pdf`, request.nextUrl.origin).toString(), {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
  if (!pdfRes.ok) return NextResponse.json({ error: "Failed to generate the invoice PDF" }, { status: 502 });
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

  const companyName = tenant.name || "our team";
  const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
  const fromLocalPart = (tenant.slug || "invoices").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const fromAddress = `${companyName} <${fromLocalPart}@${sendingDomain}>`;
  const replyTo = tenant.company_info?.email || undefined;

  let subject = typeof body.subject === "string" ? body.subject.trim() : "";
  let text = typeof body.body === "string" ? body.body : "";
  if (!subject || !text) {
    const { data: template } = await supabase
      .from("email_templates").select("subject, body")
      .eq("tenant_id", tenantId).eq("category", "invoice").eq("is_default", true).maybeSingle();
    const fallback = template ?? DEFAULT_EMAIL_TEMPLATES.invoice;
    const vars = {
      customer_name: "Sir/Madam", company_name: companyName, invoice_ref: invoice.ref as string,
      invoice_total: "₹" + Number(invoice.total).toLocaleString("en-IN", { maximumFractionDigits: 0 }),
      due_date: fmtDate(invoice.due_date as string | null),
    };
    subject = subject || renderTemplate(fallback.subject, vars);
    text = text || renderTemplate(fallback.body, vars);
  }

  // The email output channel decides where this really goes (a demo
  // workspace never reaches a customer) -- see src/lib/emailOutput.ts.
  const routed = resolveOutbound(emailOutputFor(tenant), { to, subject, text });
  if (!routed.ok) return NextResponse.json({ error: routed.error }, { status: 400 });
  const mail = routed.email;

  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: fromAddress, to: mail.to, replyTo, subject: mail.subject, text: mail.text,
    attachments: [{ filename: `${invoice.ref}.pdf`, content: pdfBuffer }],
  });
  const sendError = result.error ?? null;

  const user = await getAuthUser();
  await Promise.all(mail.to.map((addr) => logEmail(supabase, {
    tenantId, kind: "invoice", toEmail: addr, subject: mail.subject,
    status: sendError ? "failed" : "sent", error: sendError?.message,
    relatedObjectType: "invoices", relatedObjectId: invoice.id as string, relatedObjectLabel: invoice.ref as string,
    actorId: user?.id, actorEmail: user?.email,
  })));

  if (sendError) {
    console.error("[invoices/email] send failed", sendError);
    return NextResponse.json({ error: "Failed to send email" }, { status: 502 });
  }

  if (invoice.status === "draft") {
    await supabase.from("invoices")
      .update({ status: "sent", issued_at: invoice.issued_at ?? new Date().toISOString() })
      .eq("id", id).eq("tenant_id", tenantId);
  }
  if (account) {
    await supabase.from("activities").insert({
      tenant_id: tenantId, account_id: account.id, pillar: "sales",
      text: mail.redirected
        ? `Invoice ${invoice.ref} emailed to ${mail.to.join(", ")} (redirected; addressed to ${mail.intended.join(", ")})`
        : `Invoice ${invoice.ref} emailed to ${mail.to.join(", ")}`,
    });
  }

  return NextResponse.json({ ok: true, sentTo: mail.to, redirected: mail.redirected, intended: mail.intended });
}
