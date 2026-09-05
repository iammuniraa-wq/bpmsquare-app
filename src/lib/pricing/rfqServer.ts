import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Tenant } from "@/lib/tenant";
import { renderTemplate, DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates";
import { emailOutputFor, resolveOutbound } from "@/lib/emailOutput";
import { logEmail } from "@/lib/emailLog";

// Sending an RFQ to a supplier (cost-based step 2). Same shape as the quote
// and invoice senders: tenant-derived from address, the tenant's own rfq
// template when it has one, and ALWAYS through resolveOutbound() so a demo
// workspace's request lands in the internal inbox, never at a real supplier.

export async function sendRfqEmail(admin: SupabaseClient, args: {
  tenant: Tenant; tenantId: string; rfqId: string; rfqRef: string;
  supplier: { name: string; email: string };
  product: { name: string; ref: string | null; uom: string | null };
  quantity: number | null;
  message: string | null;
  actor: { id: string; email: string | null };
}): Promise<{ ok: true; to: string[]; redirected: boolean } | { ok: false; reason: string }> {
  if (!process.env.RESEND_API_KEY) return { ok: false, reason: "Email sending isn't configured (missing RESEND_API_KEY)." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.supplier.email)) return { ok: false, reason: "The supplier's email address doesn't look valid." };

  const { data: template } = await admin
    .from("email_templates").select("subject, body")
    .eq("tenant_id", args.tenantId).eq("category", "rfq").eq("is_default", true).maybeSingle();
  const fallback = template ?? DEFAULT_EMAIL_TEMPLATES.rfq;
  const companyName = args.tenant.name || "our team";
  const vars = {
    supplier_name: args.supplier.name,
    company_name: companyName,
    rfq_ref: args.rfqRef,
    product_name: args.product.ref ? `${args.product.name} (${args.product.ref})` : args.product.name,
    quantity: args.quantity !== null ? String(args.quantity) : "—",
    uom: args.product.uom ?? "",
  };
  const subject = renderTemplate(fallback.subject, vars);
  const text = args.message?.trim() ? `${renderTemplate(fallback.body, vars)}\n\n${args.message.trim()}` : renderTemplate(fallback.body, vars);

  const routed = resolveOutbound(emailOutputFor(args.tenant), { to: [args.supplier.email], subject, text });
  if (!routed.ok) return { ok: false, reason: routed.error };
  const mail = routed.email;

  const sendingDomain = process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com";
  const fromLocalPart = (args.tenant.slug || "pricing").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: `${companyName} <${fromLocalPart}@${sendingDomain}>`,
    to: mail.to,
    replyTo: args.tenant.company_info?.email || undefined,
    subject: mail.subject,
    text: mail.text,
  });

  await logEmail(admin, {
    tenantId: args.tenantId, kind: "rfq", toEmail: mail.to.join(", "), subject: mail.subject,
    status: result.error ? "failed" : "sent", error: result.error?.message,
    relatedObjectType: "pricing_rfqs", relatedObjectId: args.rfqId, relatedObjectLabel: args.rfqRef,
    actorId: args.actor.id, actorEmail: args.actor.email ?? undefined,
  });
  if (result.error) return { ok: false, reason: `Send failed: ${result.error.message}` };

  await admin.from("pricing_rfqs")
    .update({ status: "sent", sent_to: mail.to.join(", "), sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", args.rfqId).eq("tenant_id", args.tenantId);
  return { ok: true, to: mail.to, redirected: mail.redirected };
}
