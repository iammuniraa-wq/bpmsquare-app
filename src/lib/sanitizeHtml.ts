import sanitizeHtml from "sanitize-html";
import { isRichTextEmpty } from "@/lib/richText";

// Allowlist matches exactly what RichTextEditor.tsx's toolbar can produce
// (bold/italic/bullet+numbered lists/paragraphs) -- nothing else survives.
// Server-only choke point: called once at write time (quote create/edit/revise),
// so every reader (print/PDF, exports, email) trusts what's already in the DB.
const ALLOWED_TAGS = ["p", "br", "strong", "em", "ul", "ol", "li"];

export function sanitizeRichText(html: string | null | undefined): string | null {
  if (!html || isRichTextEmpty(html)) return null;
  const clean = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {},
    disallowedTagsMode: "discard",
  }).trim();
  return clean || null;
}

/** For plain-text destinations (CSV export) -- also the safe path for legacy
 * values saved before this field became rich text, which pass through untouched
 * since there are no tags to strip. */
export function richTextToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  const withBreaks = html.replace(/<\/(p|li)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n");
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return stripped.replace(/\n{2,}/g, "\n").trim();
}
