import {
  STANDARD_QUOTE_REQUIRED_BLOCKS, type ClauseItem, type FrontField, type FrontRow, type MatrixRow, type StandardQuoteBlockData,
  type StandardQuoteTemplateBlock, type StandardQuoteTemplateBlockType,
} from "@/lib/types";

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
    { type: "specs_table", visible: false, content: "" },
    { type: "notes", visible: true },
    { type: "terms", visible: true },
    { type: "signature", visible: false },
    { type: "cta_banner", visible: false, content: "" },
    { type: "footer_text", visible: false, content: "" },
  ];
  return order.map((b, i) => ({ id: `${b.type}-${i}`, type: b.type, visible: b.visible, content: b.content }));
}

export const STANDARD_QUOTE_BLOCK_TYPES = new Set<string>([
  "letterhead", "quote_meta", "bill_to", "intro_text", "line_items",
  "totals", "notes", "terms", "signature", "footer_text",
  "specs_table", "cta_banner",
  "front_block", "clause_section", "scope_matrix", "closing",
]);
/** Types that may appear more than once in a layout (a section per lettered clause, a matrix per scope part). */
export const REPEATABLE_BLOCK_TYPES = new Set<string>(["clause_section", "scope_matrix"]);
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const LOGO_POSITIONS = new Set(["left", "center", "right"]);
/** Upper bound on one layout, structured data included (a layout is a settings row, not a document store). */
export const MAX_LAYOUT_JSON = 150_000;

const FRONT_FIELDS = new Set<string>([
  "date", "ref", "account", "account_phone", "account_email", "contact", "contact_phone", "contact_email",
  "project_title", "subject", "valid_until", "inquiry_date",
]);
export const isFrontField = (v: unknown): v is FrontField => typeof v === "string" && (FRONT_FIELDS.has(v) || /^cf:[a-z0-9_]{1,40}$/i.test(v));
const ID_RE = /^[a-z0-9_-]{1,24}$/i;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const optStr = (v: unknown, max: number) => { const t = str(v, max).trim(); return t ? t : undefined; };
const freshId = (prefix: string, taken: Set<string>) => {
  let n = taken.size + 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};
const keepId = (raw: unknown, prefix: string, taken: Set<string>) => {
  const id = typeof raw === "string" && ID_RE.test(raw) && !taken.has(raw) ? raw : freshId(prefix, taken);
  taken.add(id);
  return id;
};

export function cleanBlockData(type: StandardQuoteTemplateBlockType, raw: unknown): StandardQuoteBlockData | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const d = raw as Record<string, unknown>;
  switch (type) {
    case "front_block": {
      const rows: FrontRow[] = [];
      for (const r of (Array.isArray(d.rows) ? d.rows : []).slice(0, 14) as Record<string, unknown>[]) {
        if (!isFrontField(r?.field)) continue;
        const row: FrontRow = { label: str(r.label, 40).trim(), field: r.field };
        if (isFrontField(r.field2)) { row.field2 = r.field2; row.label2 = str(r.label2, 40).trim(); }
        rows.push(row);
      }
      return { rows, greeting: optStr(d.greeting, 200), opening: optStr(d.opening, 1000), title: optStr(d.title, 60), reference_label: optStr(d.reference_label, 30) };
    }
    case "clause_section": {
      const ids = new Set<string>();
      const items: ClauseItem[] = (Array.isArray(d.items) ? d.items : []).slice(0, 40).map((it) => {
        const i = (it ?? {}) as Record<string, unknown>;
        const sub = (Array.isArray(i.sub) ? i.sub : []).slice(0, 14).map((x) => str(x, 2000).trim()).filter(Boolean);
        return {
          id: keepId(i.id, "i", ids), heading: optStr(i.heading, 120), text: str(i.text, 4000),
          ...(sub.length > 0 ? { sub } : {}), ...(i.edit === true ? { edit: true } : {}), ...(i.band === true ? { band: true } : {}),
        };
      });
      return { title: str(d.title, 120).trim(), numbered: d.numbered === true, items, ...(d.optional === true ? { optional: true } : {}), ...(d.page_break === true ? { page_break: true } : {}) };
    }
    case "scope_matrix": {
      const ids = new Set<string>();
      const cols = (Array.isArray(d.columns) ? d.columns : []).map((c) => str(c, 30).trim());
      const columns: [string, string, string] = [cols[0] || "Supplier", cols[1] || "Client", cols[2] || "N/A"];
      const rows: MatrixRow[] = (Array.isArray(d.rows) ? d.rows : []).slice(0, 50).map((r) => {
        const x = (r ?? {}) as Record<string, unknown>;
        return { id: keepId(x.id, "r", ids), text: str(x.text, 300) };
      }).filter((r) => r.text.trim() !== "");
      return { title: str(d.title, 120).trim(), columns, remark: d.remark !== false, rows };
    }
    case "line_items":
      return { ...(d.preset === "boq" ? { preset: "boq" as const } : {}), total_label: optStr(d.total_label, 80), note: optStr(d.note, 400) };
    case "closing":
      return { text: str(d.text, 1000), regards: str(d.regards, 60).trim(), signatory_name: optStr(d.signatory_name, 80), signatory_title: optStr(d.signatory_title, 80) };
    default:
      return undefined;
  }
}

/** Never trust a client-supplied blocks array as-is: drop unknown/duplicate
 * types, cap content length, and force the structural blocks to stay visible
 * regardless of what the client sent. A repeatable type (clause_section,
 * scope_matrix) may appear several times, each under its own id; structured
 * `data` is validated and capped per type. */
export function sanitizeStandardQuoteBlocks(input: unknown): StandardQuoteTemplateBlock[] {
  const seen = new Set<string>();
  const ids = new Set<string>();
  const rows: StandardQuoteTemplateBlock[] = [];
  if (Array.isArray(input)) {
    for (const b of input as { id?: unknown; type?: unknown; visible?: unknown; content?: unknown; data?: unknown }[]) {
      const type = typeof b?.type === "string" ? b.type : "";
      if (!STANDARD_QUOTE_BLOCK_TYPES.has(type)) continue;
      const repeatable = REPEATABLE_BLOCK_TYPES.has(type);
      if (!repeatable && seen.has(type)) continue;
      seen.add(type);
      const t = type as StandardQuoteTemplateBlockType;
      const id = repeatable ? keepId(b?.id, `${type === "clause_section" ? "sec" : "mx"}-`, ids) : type;
      const data = cleanBlockData(t, b?.data);
      rows.push({
        id,
        type: t,
        visible: STANDARD_QUOTE_REQUIRED_BLOCKS.includes(t) ? true : !!b?.visible,
        content: typeof b?.content === "string" ? b.content.slice(0, 4000) : undefined,
        ...(data ? { data } : {}),
      });
    }
  }
  for (const req of STANDARD_QUOTE_REQUIRED_BLOCKS) {
    if (!seen.has(req)) rows.push({ id: req, type: req, visible: true });
  }
  return rows;
}

export function layoutTooLarge(blocks: StandardQuoteTemplateBlock[]): boolean {
  return JSON.stringify(blocks).length > MAX_LAYOUT_JSON;
}
