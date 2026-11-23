import type { PdfDesign, PdfFrameToken } from "@/lib/constants";

// The page frame a workspace chooses for its PDFs (tenants.config.pdf_design). Pure and client-safe: the Settings screen
// previews with it, the route validates with it, the frame resolver reads it. A workspace with no design has no value
// here at all, and every renderer then takes today's code path (src/lib/pdf/frame.ts: resolvePdfFrame returns null).

const HEX = /^#[0-9a-fA-F]{6}$/;

export const FRAME_TOKENS = ["entity_name", "entity_name_ar", "address", "phones", "email", "web", "cr", "vat", "extra_ids"] as const;
export const MAX_LITERAL = 80;
export const MAX_TOKENS_PER_AREA = 6;

export const TOKEN_LABEL: Record<(typeof FRAME_TOKENS)[number], string> = {
  entity_name: "Company name",
  entity_name_ar: "Company name (Arabic)",
  address: "Address",
  phones: "Phone numbers",
  email: "Email",
  web: "Web address",
  cr: "Commercial registration",
  vat: "VAT number",
  extra_ids: "Extra ids (for example a vendor number)",
};

export const DEFAULT_PDF_DESIGN: PdfDesign = {
  page: { size: "A4", margins_mm: { top: 38, right: 12, bottom: 24, left: 19 } },
  font: "arial_like",
  base_pt: 10,
  colors: { text: "#000000", band: "#7f7f7f", band_text: "#ffffff", sub_band: "#ffd700", table_head: "#dbe5f1", rule: "#7f7f7f" },
  header: { logo: "left", logo_height_mm: 17, lines: ["extra_ids"], title_band: true },
  footer: { rule: true, left: ["address", "cr", "vat"], right: ["phones", "email", "web"], page_numbers: true, strip: ["#7f7f7f", "#ffd700", "#7f7f7f"] },
  table: { borders: "grid", zebra: false },
};

export function isFrameToken(v: unknown): v is PdfFrameToken {
  if (typeof v !== "string") return false;
  if ((FRAME_TOKENS as readonly string[]).includes(v)) return true;
  return v.startsWith("text:") && v.length > 5 && v.length <= 5 + MAX_LITERAL;
}

const num = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const hex = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback);
const tokens = (v: unknown, fallback: PdfFrameToken[]): PdfFrameToken[] => {
  if (!Array.isArray(v)) return fallback;
  const out: PdfFrameToken[] = [];
  for (const t of v) {
    if (isFrameToken(t) && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TOKENS_PER_AREA) break;
  }
  return out;
};

/** Never trust a stored or posted design as-is: unknown keys are dropped, numbers clamped, colours must be #rrggbb, lines
 *  must be known tokens or a short literal. Returns null for anything that is not an object (= no design). */
export function sanitizePdfDesign(input: unknown): PdfDesign | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const d = input as Record<string, unknown>;
  const D = DEFAULT_PDF_DESIGN;
  const page = (d.page ?? {}) as Record<string, unknown>;
  const m = (page.margins_mm ?? {}) as Record<string, unknown>;
  const colors = (d.colors ?? {}) as Record<string, unknown>;
  const header = (d.header ?? {}) as Record<string, unknown>;
  const footer = (d.footer ?? {}) as Record<string, unknown>;
  const table = (d.table ?? {}) as Record<string, unknown>;
  const strip = Array.isArray(footer.strip) ? (footer.strip as unknown[]).filter((c): c is string => typeof c === "string" && HEX.test(c)).map((c) => c.toLowerCase()).slice(0, 5) : null;
  return {
    page: {
      size: page.size === "Letter" ? "Letter" : "A4",
      margins_mm: {
        top: num(m.top, 20, 60, D.page.margins_mm.top),
        right: num(m.right, 8, 40, D.page.margins_mm.right),
        bottom: num(m.bottom, 14, 50, D.page.margins_mm.bottom),
        left: num(m.left, 8, 40, D.page.margins_mm.left),
      },
    },
    font: d.font === "print_sans" ? "print_sans" : "arial_like",
    base_pt: d.base_pt === 9 || d.base_pt === 11 ? d.base_pt : 10,
    colors: {
      text: hex(colors.text, D.colors.text), band: hex(colors.band, D.colors.band), band_text: hex(colors.band_text, D.colors.band_text),
      sub_band: hex(colors.sub_band, D.colors.sub_band), table_head: hex(colors.table_head, D.colors.table_head), rule: hex(colors.rule, D.colors.rule),
    },
    header: {
      logo: header.logo === "center" || header.logo === "right" || header.logo === "none" ? header.logo : "left",
      logo_height_mm: num(header.logo_height_mm, 8, 30, D.header.logo_height_mm),
      lines: tokens(header.lines, D.header.lines),
      title_band: header.title_band === false ? false : true,
    },
    footer: {
      rule: footer.rule === false ? false : true,
      left: tokens(footer.left, D.footer.left),
      right: tokens(footer.right, D.footer.right),
      page_numbers: footer.page_numbers === false ? false : true,
      strip: strip && strip.length > 0 ? strip : footer.strip === null ? null : D.footer.strip,
    },
    table: { borders: table.borders === "rows" ? "rows" : "grid", zebra: table.zebra === true },
  };
}

/** What the saved value looks like against the standard look, for the change history line. */
export function describePdfDesign(d: PdfDesign | null | undefined): string {
  if (!d) return "Standard look";
  return `${d.page.size}, ${d.font === "arial_like" ? "Arial-like" : "print sans"} ${d.base_pt} pt, logo ${d.header.logo}`;
}
