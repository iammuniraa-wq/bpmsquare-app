import { NextResponse, type NextRequest } from "next/server";
import { getTenant } from "@/lib/tenant";
import { CURRENCIES, DEFAULT_CURRENCY, formatMoney, isCurrencyCode } from "@/lib/currency";
import { buildAbsoluteUrl } from "@/lib/quotePublicLink";
import { orderPublicPdfPath, orderPublicPrintPath, signOrderPublicToken } from "@/lib/salesOrderPublicLink";
import { buildOrderWhatsAppMessage, buildWhatsAppLink, sanitizePhoneForWhatsApp } from "@/lib/whatsapp";
import { loadOrderPrintData } from "@/lib/salesOrders/printData";
import { failure, guard, loadOrder, needsUpdate } from "@/lib/salesOrders/server";

// GET /api/sales-orders/[id]/share
//   What the PDF / WhatsApp buttons need, in one call:
//   -> { pdf_url, public_pdf_url, public_print_url, whatsapp_url, whatsapp_message, whatsapp_note }
//   public_* are signed, no-login links valid for 90 days on THIS workspace's host (null when QUOTE_PUBLIC_LINK_SECRET is not
//   set). whatsapp_url is a wa.me click-to-chat link to the contact's (else the account's) number, null when there is none.
//   The WhatsApp provider is sandbox-only for now: the button only opens this link, the person sends the message.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try { ctx = await guard(); } catch (e) { return failure(e); }
  const { supabase, tenantId } = ctx;
  const { id } = await params;
  const loaded = await loadOrder(supabase, tenantId, id);
  if (loaded.kind === "pending") return needsUpdate();
  if (loaded.kind === "error") return NextResponse.json({ error: loaded.message }, { status: 500 });
  if (loaded.kind === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { order } = loaded.value;

  const [data, tenant] = await Promise.all([loadOrderPrintData(supabase, tenantId, id), getTenant()]);
  const token = signOrderPublicToken(id);
  const publicPdf = token ? await buildAbsoluteUrl(orderPublicPdfPath(id, token)) : null;
  const publicPrint = token ? await buildAbsoluteUrl(orderPublicPrintPath(id, token)) : null;

  const currency = CURRENCIES[isCurrencyCode(order.currency) ? order.currency : DEFAULT_CURRENCY];
  const message = buildOrderWhatsAppMessage({
    customer_name: data?.contact?.name ?? data?.account?.name ?? "there",
    company_name: tenant?.name ?? "our team",
    order_ref: order.ref,
    order_total: formatMoney(Number(order.total), currency),
    pdfLink: publicPdf,
  });
  const phone = sanitizePhoneForWhatsApp(data?.contact?.phone || data?.contact?.phone2 || data?.contact?.phone3 || data?.account?.phone || data?.account?.phone2);

  return NextResponse.json({
    pdf_url: `/api/sales-orders/${id}/pdf`,
    public_pdf_url: publicPdf,
    public_print_url: publicPrint,
    whatsapp_url: phone ? buildWhatsAppLink(phone, message) : null,
    whatsapp_message: message,
    whatsapp_note: "WhatsApp sending is not connected yet: this opens WhatsApp with the message ready, and you press send.",
  });
}
