import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { getAuthUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { CURRENCIES, DEFAULT_CURRENCY, formatMoney, isCurrencyCode } from "@/lib/currency";
import { renderTemplate } from "@/lib/emailTemplates";
import { logEmail } from "@/lib/emailLog";
import { emailOutputFor, resolveOutbound } from "@/lib/emailOutput";
import { emitOrderSent } from "@/lib/events/emitters";
import { printUrlToPdf } from "@/lib/pdf/printUrlToPdf";
import { logChange } from "@/lib/changeLog";
import { failure, guard, loadOrder, needsUpdate } from "@/lib/salesOrders/server";
import { loadOrderPrintData } from "@/lib/salesOrders/printData";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/sales-orders/[id]/email { email?, subject?, body? }
//   Sends the order PDF to the contact (else the customer account) or to the address given. The output channel decides
//   where it really goes (a demo workspace is redirected, never reaching a customer: resolveOutbound), the send is
//   written to the Outbound Emails log as kind "order", sent_at is stamped, an activity is added to the account and
//   order.sent is emitted. A cancelled order is not sent.
//   -> { ok, sentTo, redirected, intended }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId } = ctx;
  const { id } = await params;
  const loaded = await loadOrder(supabase, tenantId, id);
  if (loaded.kind === "pending") return needsUpdate();
  if (loaded.kind === "error") return NextResponse.json({ error: loaded.message }, { status: 500 });
  if (loaded.kind === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { order } = loaded.value;
  if (order.status === "cancelled") return NextResponse.json({ error: "A cancelled order can't be sent." }, { status: 409 });

  const [data, tenant] = await Promise.all([loadOrderPrintData(supabase, tenantId, id), getTenant()]);
  if (!data || !tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { account, contact } = data;

  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: "Email sending isn't configured yet (missing RESEND_API_KEY)." }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { email?: unknown; subject?: unknown; body?: unknown };
  const override = typeof body.email === "string" ? body.email.trim() : "";
  const recipient = override || contact?.email || contact?.email2 || account?.email || account?.email2;
  if (!recipient) return NextResponse.json({ error: "No email address on file for this contact or account." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return NextResponse.json({ error: "That doesn't look like a valid email address." }, { status: 400 });

  const pdf = await printUrlToPdf(new URL(`/sales-orders/${id}/print`, new URL(req.url).origin).toString(), { cookie: req.headers.get("cookie") ?? "" });
  if (!pdf.ok) return NextResponse.json({ error: "Failed to generate the order PDF" }, { status: 502 });

  const companyName = tenant.name || "our team";
  const currency = CURRENCIES[isCurrencyCode(order.currency) ? order.currency : DEFAULT_CURRENCY];
  const vars = {
    customer_name: contact?.name ?? "Sir/Madam",
    company_name: companyName,
    order_ref: order.ref,
    order_total: formatMoney(Number(order.total), currency),
  };
  const rawSubject = typeof body.subject === "string" && body.subject ? body.subject : renderTemplate("Sales order {{order_ref}} from {{company_name}}", vars);
  const rawText = typeof body.body === "string" && body.body
    ? body.body
    : renderTemplate("Dear {{customer_name}},\n\nPlease find attached our sales order {{order_ref}} for {{order_total}}.\n\nRegards,\n{{company_name}}", vars);

  const routed = resolveOutbound(emailOutputFor(tenant), { to: [recipient], subject: rawSubject, text: rawText });
  if (!routed.ok) return NextResponse.json({ error: routed.error }, { status: 400 });
  const mail = routed.email;

  const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
  const fromLocalPart = (tenant.slug || "orders").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: `${companyName} <${fromLocalPart}@${sendingDomain}>`,
    to: mail.to,
    replyTo: tenant.company_info?.email || undefined,
    subject: mail.subject,
    text: mail.text,
    attachments: [{ filename: `${order.ref}.pdf`, content: pdf.pdf }],
  });
  const sendError = result.error ?? null;

  const user = await getAuthUser();
  await logEmail(supabase, {
    tenantId, kind: "order", toEmail: mail.to.join(", "), subject: mail.subject, status: sendError ? "failed" : "sent", error: sendError?.message,
    relatedObjectType: "sales_orders", relatedObjectId: id, relatedObjectLabel: order.ref, actorId: user?.id, actorEmail: user?.email,
  });
  if (sendError) {
    console.error("[sales-orders/email] send failed", sendError);
    return NextResponse.json({ error: "Failed to send email" }, { status: 502 });
  }

  const now = new Date().toISOString();
  await supabase.from("sales_orders").update({ sent_at: now, updated_at: now }).eq("id", id).eq("tenant_id", tenantId);
  await logChange(supabase, {
    tenantId, objectType: "sales_orders", objectId: id, objectLabel: order.ref, action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Emailed", from: null, to: mail.redirected ? `${mail.to.join(", ")} (redirected; addressed to ${recipient})` : recipient }],
  });
  if (account) {
    await supabase.from("activities").insert({
      tenant_id: tenantId, account_id: account.id, pillar: "sales",
      text: mail.redirected ? `Sales order ${order.ref} emailed to ${mail.to.join(", ")} (redirected; addressed to ${recipient})` : `Sales order ${order.ref} emailed to ${recipient}`,
    });
  }
  await emitOrderSent(tenantId, { orderId: id, ref: order.ref, total: Number(order.total), accountId: order.account_id, contactId: order.contact_id, actorId: user?.id, redirected: mail.redirected });

  return NextResponse.json({ ok: true, sentTo: mail.to.join(", "), redirected: mail.redirected, intended: recipient });
}
