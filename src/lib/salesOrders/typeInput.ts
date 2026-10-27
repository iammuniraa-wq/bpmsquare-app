import { HEX_COLOR_RE, LOGO_POSITIONS, defaultStandardQuoteBlocks, sanitizeStandardQuoteBlocks } from "@/lib/standardQuoteTemplateBlocks";
import { cleanText } from "./clean";
import { cleanPrefix, cleanRules } from "./rules";

// Order type input from Settings > Order types. The PDF template reuses the Standard Quote block model
// (standard_quote_templates, 0054), so the same sanitizer decides which blocks are real and which stay on.

export type TypeInput = {
  name?: string;
  prefix?: string;
  pricing_mode?: "internal" | "external";
  template?: { blocks: unknown[]; accent_color: string | null; logo_position: "left" | "center" | "right" };
  rules?: { field: string; equals: string }[];
  is_default?: boolean;
  active?: boolean;
  sort_order?: number;
};

/** `partial`: a PATCH, only the keys present are checked. Otherwise a create, where name and prefix are required. */
export function parseTypeInput(body: unknown, partial: boolean): { ok: true; value: TypeInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid body" };
  const b = body as Record<string, unknown>;
  const out: TypeInput = {};

  if (!partial || "name" in b) {
    const name = cleanText(b.name, 80);
    if (!name) return { ok: false, error: "A name is required" };
    out.name = name;
  }
  if (!partial || "prefix" in b) {
    const prefix = cleanPrefix(b.prefix);
    if (!prefix) return { ok: false, error: "The prefix is 2 to 10 capital letters or digits, starting with a letter (for example SO)" };
    out.prefix = prefix;
  }
  if ("pricing_mode" in b || !partial) {
    const mode = b.pricing_mode === undefined && !partial ? "internal" : b.pricing_mode;
    if (mode !== "internal" && mode !== "external") return { ok: false, error: "pricing_mode must be internal or external" };
    out.pricing_mode = mode;
  }
  if ("template" in b || "blocks" in b || "accent_color" in b || "logo_position" in b) {
    const t = (b.template && typeof b.template === "object" ? b.template : b) as Record<string, unknown>;
    out.template = {
      blocks: sanitizeStandardQuoteBlocks(t.blocks ?? defaultStandardQuoteBlocks()),
      accent_color: typeof t.accent_color === "string" && HEX_COLOR_RE.test(t.accent_color) ? t.accent_color : null,
      logo_position: LOGO_POSITIONS.has(t.logo_position as string) ? (t.logo_position as "left" | "center" | "right") : "left",
    };
  }
  if ("rules" in b) out.rules = cleanRules(b.rules);
  if ("is_default" in b) out.is_default = b.is_default === true;
  if ("active" in b) out.active = b.active !== false;
  if ("sort_order" in b) {
    const n = Math.floor(Number(b.sort_order));
    out.sort_order = Number.isFinite(n) ? Math.max(0, Math.min(1000, n)) : 0;
  }
  return { ok: true, value: out };
}
