import type {
  Account, ClauseItem, ClauseSectionData, ClosingData, Contact, DocSections, FrontBlockData, FrontField, LineItemsData,
  ScopeMatrixData, StandardQuote, StandardQuoteTemplateBlock,
} from "@/lib/types";

// The pure rules behind a framed quotation body (PDF redesign, slice 1): which letter each clause section gets, what a
// front-block row shows, how a scope matrix reads for one quotation. Kept apart from the React component so the numbering
// and the per-document overrides are tested without a browser.

export const letterFor = (i: number): string => {
  let n = i;
  let out = "";
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return out;
};

export const longDate = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

export type FrontSource = { quote: StandardQuote; account: Account | null; contact: Contact | null };

export function frontValue(field: FrontField, s: FrontSource): string {
  const { quote: q, account: a, contact: c } = s;
  if (field.startsWith("cf:")) {
    const v = (q.custom_data ?? {})[field.slice(3)];
    return v === null || v === undefined ? "" : String(v);
  }
  switch (field) {
    case "date": return longDate(q.created_at);
    case "ref": return q.ref;
    case "account": return a?.name ?? "";
    case "account_phone": return a?.phone ?? "";
    case "account_email": return a?.email ?? "";
    case "contact": return c?.name ?? "";
    case "contact_phone": return c?.phone ?? "";
    case "contact_email": return c?.email ?? "";
    case "project_title": return q.project_title ?? "";
    case "subject": return q.subject ?? "";
    case "valid_until": return longDate(q.valid_until);
    case "inquiry_date": return longDate(q.inquiry_date);
    default: return "";
  }
}

/** What prints in the title band: the layout's title and reference label, the quote's own reference. */
export function frameTitleParts(blocks: StandardQuoteTemplateBlock[]): { title: string; referenceLabel: string } {
  const front = blocks.find((b) => b.type === "front_block" && b.visible)?.data as FrontBlockData | undefined;
  return { title: (front?.title || "QUOTATION").toUpperCase(), referenceLabel: front?.reference_label ?? "" };
}

export type ResolvedItem = { id: string; heading?: string; text: string; sub: string[]; band?: boolean };
export type ResolvedSection = { block: StandardQuoteTemplateBlock; letter: string; data: ClauseSectionData; items: ResolvedItem[] };
export type ResolvedMatrix = { block: StandardQuoteTemplateBlock; number: string; data: ScopeMatrixData; applicable: boolean; reason: string; rows: { id: string; text: string; tick: 0 | 1 | 2 | null; remark: string }[] };
export type ResolvedBlock =
  | { kind: "front"; block: StandardQuoteTemplateBlock; data: FrontBlockData }
  | { kind: "section"; section: ResolvedSection }
  | { kind: "matrix"; matrix: ResolvedMatrix }
  | { kind: "lines"; block: StandardQuoteTemplateBlock; data: LineItemsData }
  | { kind: "closing"; block: StandardQuoteTemplateBlock; data: ClosingData }
  | { kind: "plain"; block: StandardQuoteTemplateBlock };

/** Walk the layout once, in order: letter the visible sections A, B, C, number each matrix under the last item of the section
 *  before it (C2.1, C2.2), and fold in what this quotation holds per document. A section hidden for this quotation is
 *  skipped and the letters close up. */
export function resolveFramedBlocks(blocks: StandardQuoteTemplateBlock[], docSections: DocSections | null | undefined): ResolvedBlock[] {
  const doc = docSections ?? {};
  const out: ResolvedBlock[] = [];
  let letterIdx = 0;
  let current: { letter: string; itemCount: number } | null = null;
  let matrixIdx = 0;

  for (const block of blocks) {
    if (!block.visible) continue;
    const entry = doc[block.id];
    if (block.type === "front_block") { out.push({ kind: "front", block, data: (block.data as FrontBlockData) ?? { rows: [] } }); continue; }
    if (block.type === "clause_section") {
      const data = (block.data as ClauseSectionData | undefined) ?? { title: "", numbered: false, items: [] };
      if (data.optional && entry?.hidden) continue;
      const letter = letterFor(letterIdx++);
      const items: ResolvedItem[] = data.items.map((it: ClauseItem) => {
        const over = it.edit ? entry?.items?.[it.id] : undefined;
        return {
          id: it.id, heading: it.heading, band: it.band,
          text: over?.text ?? it.text,
          sub: over?.sub ?? it.sub ?? [],
        };
      });
      current = { letter, itemCount: items.length };
      matrixIdx = 0;
      out.push({ kind: "section", section: { block, letter, data, items } });
      continue;
    }
    if (block.type === "scope_matrix") {
      const data = (block.data as ScopeMatrixData | undefined) ?? { title: "", columns: ["Supplier", "Client", "N/A"], remark: true, rows: [] };
      matrixIdx++;
      const number = current ? `${current.letter}${Math.max(1, current.itemCount)}.${matrixIdx}` : `${matrixIdx}`;
      const rows = [...data.rows, ...(entry?.extra_rows ?? [])].map((r) => ({ id: r.id, text: r.text, tick: entry?.ticks?.[r.id] ?? null, remark: entry?.remarks?.[r.id] ?? "" }));
      const notApplicable = typeof entry?.not_applicable === "string";
      out.push({ kind: "matrix", matrix: { block, number, data, applicable: !notApplicable, reason: entry?.not_applicable || "N/A", rows } });
      continue;
    }
    if (block.type === "line_items") { out.push({ kind: "lines", block, data: (block.data as LineItemsData | undefined) ?? {} }); continue; }
    if (block.type === "closing") { out.push({ kind: "closing", block, data: (block.data as ClosingData | undefined) ?? { text: "", regards: "" } }); continue; }
    out.push({ kind: "plain", block });
  }
  return out;
}

/** Expand {QTY} and {UOM} in a BOQ total-row label ("TOTAL AMOUNT FOR {QTY} {UOM}"). {UOM} is blank when the lines mix units. */
export function boqTotalLabel(label: string | undefined, lines: { qty: number; uom: string | null }[]): string {
  const base = label?.trim() || "TOTAL";
  const qty = lines.reduce((n, l) => n + (Number(l.qty) || 0), 0);
  const units = new Set(lines.map((l) => (l.uom ?? "").trim()).filter(Boolean));
  const uom = units.size === 1 ? [...units][0] : "";
  return base.replaceAll("{QTY}", String(Math.round(qty * 1000) / 1000)).replaceAll("{UOM}", uom).replace(/\s+/g, " ").trim();
}

/** The section ids a quotation can edit per document, for the Document tab. */
export function editableSections(blocks: StandardQuoteTemplateBlock[]): { block: StandardQuoteTemplateBlock; kind: "clause" | "matrix" }[] {
  const out: { block: StandardQuoteTemplateBlock; kind: "clause" | "matrix" }[] = [];
  for (const b of blocks) {
    if (!b.visible) continue;
    if (b.type === "clause_section") {
      const d = b.data as ClauseSectionData | undefined;
      if (d && (d.optional || d.items.some((i) => i.edit))) out.push({ block: b, kind: "clause" });
    } else if (b.type === "scope_matrix") out.push({ block: b, kind: "matrix" });
  }
  return out;
}

const NUMERIC = (v: unknown, max: number) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;

/** Validate what a client posts as the per-document sections: only known block ids, known item and row ids, small strings.
 *  Anything else is dropped, never stored. */
export function cleanDocSections(input: unknown, blocks: StandardQuoteTemplateBlock[]): DocSections {
  const out: DocSections = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const raw = input as Record<string, unknown>;
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  for (const { block, kind } of editableSections(blocks)) {
    const e = raw[block.id];
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const entry: DocSections[string] = {};
    if (r.hidden === true && kind === "clause" && (block.data as ClauseSectionData).optional) entry.hidden = true;
    if (kind === "clause") {
      const items: Record<string, { text?: string; sub?: string[] }> = {};
      const known = new Set(((block.data as ClauseSectionData).items).filter((i) => i.edit).map((i) => i.id));
      for (const [id, v] of Object.entries((r.items ?? {}) as Record<string, unknown>)) {
        if (!known.has(id) || !v || typeof v !== "object") continue;
        const iv = v as Record<string, unknown>;
        const sub = Array.isArray(iv.sub) ? iv.sub.slice(0, 14).map((x) => s(x, 2000).trim()).filter(Boolean) : undefined;
        items[id] = { ...(typeof iv.text === "string" ? { text: s(iv.text, 4000) } : {}), ...(sub ? { sub } : {}) };
      }
      if (Object.keys(items).length > 0) entry.items = items;
    } else {
      const d = block.data as ScopeMatrixData;
      const extra = (Array.isArray(r.extra_rows) ? r.extra_rows : []).slice(0, 20).map((x, i) => ({ id: `x${i + 1}`, text: s((x as { text?: unknown })?.text, 300).trim() })).filter((x) => x.text);
      const rowIds = new Set([...d.rows.map((x) => x.id), ...extra.map((x) => x.id)]);
      const ticks: Record<string, 0 | 1 | 2> = {};
      for (const [id, v] of Object.entries((r.ticks ?? {}) as Record<string, unknown>)) if (rowIds.has(id) && NUMERIC(v, 2) && Number.isInteger(v)) ticks[id] = v as 0 | 1 | 2;
      const remarks: Record<string, string> = {};
      for (const [id, v] of Object.entries((r.remarks ?? {}) as Record<string, unknown>)) if (rowIds.has(id) && typeof v === "string" && v.trim()) remarks[id] = s(v, 300);
      if (Object.keys(ticks).length > 0) entry.ticks = ticks;
      if (Object.keys(remarks).length > 0) entry.remarks = remarks;
      if (extra.length > 0) entry.extra_rows = extra;
      if (typeof r.not_applicable === "string") entry.not_applicable = s(r.not_applicable, 120).trim() || "N/A";
    }
    if (Object.keys(entry).length > 0) out[block.id] = entry;
  }
  return out;
}
