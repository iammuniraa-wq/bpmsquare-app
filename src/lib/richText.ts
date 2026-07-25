// Pure, dependency-free helpers for RichTextEditor.tsx (Tiptap) HTML -- safe to
// import from client components. The real sanitizer (which needs the
// sanitize-html package) lives server-only in lib/sanitizeHtml.ts.

/** Tiptap serializes an untouched/cleared editor as "<p></p>", not "" -- treat
 * markup with no real text the same as genuinely empty input everywhere. */
export function isRichTextEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  return html.replace(/<[^>]*>/g, "").trim().length === 0;
}

const HTML_TAG_PROBE = /<(p|ul|ol|li|strong|em|br)[\s/>]/i;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Renders a scope_of_work/etc value for on-screen or PDF display via
 * dangerouslySetInnerHTML. The value is already sanitized at write time
 * (sanitizeRichText, run in every create/edit/import route) -- this only
 * decides HOW to render it: real tiptap-authored HTML is used as-is, while
 * legacy or imported plain text (no tags) is escaped and its newlines turned
 * into <br> so multi-line content still breaks visually. */
export function richTextToDisplayHtml(value: string | null | undefined): string {
  if (!value) return "";
  if (HTML_TAG_PROBE.test(value)) return value;
  return escapeHtml(value).replace(/\n/g, "<br>");
}
