import { STANDARD_QUOTE_REQUIRED_BLOCKS, type StandardQuoteTemplateBlock, type StandardQuoteTemplateBlockType } from "@/lib/types";

// The block set every new template starts from, and what a quote with no
// template_id (created before this feature existed, or whose template was
// later deleted) falls back to -- keeps the original Standard Quote print
// layout as the zero-config default.
export function defaultStandardQuoteBlocks(): StandardQuoteTemplateBlock[] {
  const order: { type: StandardQuoteTemplateBlockType; visible: boolean; content?: string }[] = [
    { type: "letterhead", visible: true },
    { type: "quote_meta", visible: true },
    { type: "bill_to", visible: true },
    { type: "intro_text", visible: false, content: "" },
    { type: "line_items", visible: true },
    { type: "totals", visible: true },
    { type: "notes", visible: true },
    { type: "terms", visible: true },
    { type: "signature", visible: false },
    { type: "footer_text", visible: false, content: "" },
  ];
  return order.map((b, i) => ({ id: `${b.type}-${i}`, type: b.type, visible: b.visible, content: b.content }));
}

export const STANDARD_QUOTE_BLOCK_TYPES = new Set<string>([
  "letterhead", "quote_meta", "bill_to", "intro_text", "line_items",
  "totals", "notes", "terms", "signature", "footer_text",
]);
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const LOGO_POSITIONS = new Set(["left", "center", "right"]);

/** Never trust a client-supplied blocks array as-is: drop unknown/duplicate
 * types, cap content length, and force the structural blocks to stay visible
 * regardless of what the client sent. */
export function sanitizeStandardQuoteBlocks(input: unknown): StandardQuoteTemplateBlock[] {
  const seen = new Set<string>();
  const rows: StandardQuoteTemplateBlock[] = [];
  if (Array.isArray(input)) {
    for (const b of input as { type?: unknown; visible?: unknown; content?: unknown }[]) {
      const type = typeof b?.type === "string" ? b.type : "";
      if (!STANDARD_QUOTE_BLOCK_TYPES.has(type) || seen.has(type)) continue;
      seen.add(type);
      const t = type as StandardQuoteTemplateBlockType;
      rows.push({
        id: type,
        type: t,
        visible: STANDARD_QUOTE_REQUIRED_BLOCKS.includes(t) ? true : !!b?.visible,
        content: typeof b?.content === "string" ? b.content.slice(0, 4000) : undefined,
      });
    }
  }
  for (const req of STANDARD_QUOTE_REQUIRED_BLOCKS) {
    if (!seen.has(req)) rows.push({ id: req, type: req, visible: true });
  }
  return rows;
}
