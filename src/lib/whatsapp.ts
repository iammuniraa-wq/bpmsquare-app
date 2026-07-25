// "WhatsApp external" — a wa.me click-to-chat link, opened by a human rep from
// whichever WhatsApp (personal or business) is logged into their own device.
// No Meta Business API, no server-side send, no message-template approval —
// that's "WhatsApp embedded", which stays Coming Soon (see settings page).

/** Strips a stored phone number down to the digits wa.me needs, assuming an
 * Indian number when no country code is present (this product's tenants are
 * India-based — GSTIN, ₹ — so a bare 10-digit number is always a local one). */
export function sanitizePhoneForWhatsApp(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const hasPlus = phone.trim().startsWith("+");
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (hasPlus) return digits;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
}

export function buildWhatsAppLink(phone: string, message: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function buildQuoteWhatsAppMessage(vars: {
  customer_name: string;
  company_name: string;
  quote_ref: string;
  quote_total: string;
  valid_until: string;
  /** Signed, no-login link to the quote PDF (see lib/quotePublicLink.ts). When
   * absent (QUOTE_PUBLIC_LINK_SECRET not configured), the message asks the rep
   * to attach the PDF manually instead. */
  pdfLink?: string | null;
}): string {
  const base = `Hi ${vars.customer_name}, this is ${vars.company_name}. Your quote ${vars.quote_ref} for ${vars.quote_total} is ready (valid until ${vars.valid_until}).`;
  return vars.pdfLink
    ? `${base} View/download it here: ${vars.pdfLink}`
    : `${base} We've emailed the PDF too — happy to answer any questions!`;
}

export function buildCaseWhatsAppMessage(vars: {
  customer_name: string;
  company_name: string;
  case_ref: string;
}): string {
  return `Hi ${vars.customer_name}, this is ${vars.company_name}, following up on your service case ${vars.case_ref}.`;
}
