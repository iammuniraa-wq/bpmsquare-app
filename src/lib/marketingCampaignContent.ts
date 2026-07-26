import "server-only";
import { sanitizeRichText } from "@/lib/sanitizeHtml";
import { getMarketingTemplate, escapeCustomMessage } from "@/lib/marketingTemplates";

/**
 * The one place a campaign's stored subject/body get decided. When a known
 * template_id is given, the HTML always comes from our own code-defined
 * template (lib/marketingTemplates.ts) with only the escaped custom message
 * merged in -- client-submitted `html` is ignored entirely in that case, so
 * there's no path for a spoofed request to smuggle arbitrary markup into an
 * outbound email by claiming to use a template. Free-hand campaigns (no
 * template) fall back to the existing rich-text-editor + sanitizeRichText path.
 */
export function resolveCampaignContent(input: {
  template_id?: string | null;
  custom_message?: string;
  subject?: string;
  html?: string;
}): { subject: string; body: string; template_id: string | null; custom_message: string | null } {
  const template = getMarketingTemplate(input.template_id);
  if (template) {
    const customMessage = typeof input.custom_message === "string" ? input.custom_message.slice(0, 2000) : "";
    return {
      subject: typeof input.subject === "string" && input.subject.trim() ? input.subject : template.defaultSubject,
      body: template.buildBodyHtml(escapeCustomMessage(customMessage)),
      template_id: template.id,
      custom_message: customMessage || null,
    };
  }
  return {
    subject: typeof input.subject === "string" ? input.subject : "",
    body: sanitizeRichText(input.html) ?? "",
    template_id: null,
    custom_message: null,
  };
}
