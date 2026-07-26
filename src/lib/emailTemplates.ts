import type { EmailTemplateCategory } from "@/lib/types";

// The {{variable}} tokens available per template category, shown as a
// reference in the Settings editor and resolved at send time.
export const EMAIL_TEMPLATE_VARS: Record<EmailTemplateCategory, { key: string; label: string }[]> = {
  quote: [
    { key: "customer_name", label: "Contact name" },
    { key: "company_name",  label: "Your company name" },
    { key: "quote_ref",     label: "Quote reference" },
    { key: "quote_total",   label: "Quote total (formatted, e.g. ₹86,500)" },
    { key: "valid_until",   label: "Valid-until date" },
  ],
  invoice: [
    { key: "customer_name",  label: "Contact name" },
    { key: "company_name",   label: "Your company name" },
    { key: "invoice_ref",    label: "Invoice reference" },
    { key: "invoice_total",  label: "Invoice total (formatted)" },
    { key: "due_date",       label: "Due date" },
  ],
  report: [
    { key: "customer_name", label: "Contact name" },
    { key: "company_name",  label: "Your company name" },
    { key: "case_ref",      label: "Case reference" },
    { key: "equipment",     label: "Equipment description" },
  ],
};

// One safe fallback per category so sending never breaks for a tenant who
// hasn't created or defaulted a template yet -- matches the original
// hardcoded copy the quote-email route shipped with.
export const DEFAULT_EMAIL_TEMPLATES: Record<EmailTemplateCategory, { name: string; subject: string; body: string }> = {
  quote: {
    name: "Standard",
    subject: "Quotation {{quote_ref}} from {{company_name}}",
    body: "Dear {{customer_name}},\n\nPlease find attached our quotation {{quote_ref}}.\n\nRegards,\n{{company_name}}",
  },
  invoice: {
    name: "Standard",
    subject: "Invoice {{invoice_ref}} from {{company_name}}",
    body: "Dear {{customer_name}},\n\nPlease find attached invoice {{invoice_ref}}, due {{due_date}}.\n\nRegards,\n{{company_name}}",
  },
  report: {
    name: "Standard",
    subject: "Inspection report for {{case_ref}} from {{company_name}}",
    body: "Dear {{customer_name}},\n\nPlease find attached the inspection report for {{equipment}} ({{case_ref}}).\n\nRegards,\n{{company_name}}",
  },
};

export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

/** Escapes a value that's about to be substituted into an HTML email body --
 * use this on every `vars` entry before a renderTemplate() call whose result
 * becomes `html:` (not needed for a plain-text `subject`/`text` render).
 * Untrusted values like an account name have no reason to ever contain
 * markup, but nothing stops a user from typing some. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
