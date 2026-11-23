import type { CurrencyCode } from "@/lib/currency";
import type { PdfDesign, TenantEntity } from "@/lib/constants";
import type { CompanyInfo } from "@/lib/tenant";
import type { Account, Contact, DocSections, StandardQuote, StandardQuoteLine, StandardQuoteTemplateBlock } from "@/lib/types";

// What an issued revision of a Standard Quote freezes (PDF design slice 2, 4.9): everything the customer's PDF printed, and
// nothing else. The shape is an EXPLICIT field list: a snapshot is built by naming what goes in, never by spreading a row, so a
// column added to standard_quotes or its lines tomorrow (a cost, a margin, a pricing flag) cannot leak into an append-only copy
// that no one can edit afterwards (the 0230 lesson). Pure: no database, so the rules are tested without one.

export type SnapLine = {
  id: string; sl_no: string | null; description: string; uom: string | null; qty: number; rate: number; discount_pct: number; amount: number;
  is_selected: boolean; show_on_pdf: boolean; group_id: string | null; group_label: string | null; group_type: string | null;
  break_of: string | null; break_qty: number | null;
};

export type StandardQuoteSnapshot = {
  v: 1;
  quote: {
    ref: string; created_at: string; valid_until: string | null; inquiry_date: string | null; terms: string | null; notes: string | null; intro_text: string | null;
    header_discount_pct: number; tax_pct: number; shipping_amount: number; subtotal: number; total: number;
    print_options: StandardQuote["print_options"] | null; project_title: string | null; subject: string | null; entity_id: string | null;
    custom_data: Record<string, unknown> | null; doc_sections: DocSections | null; account_id: string; contact_id: string | null;
  };
  lines: SnapLine[];
  account: { id: string; name: string; city: string | null; phone: string | null; email: string | null; print_ids: string[] } | null;
  contact: { id: string; name: string; phone: string | null; email: string | null } | null;
  template: { id: string | null; name: string | null; accent_color: string | null; logo_position: "left" | "center" | "right"; blocks: StandardQuoteTemplateBlock[] };
  /** The frame as it was: the design, the legal entity's details, the letterhead and the vendor-line decision (which ids printed). */
  frame: { design: PdfDesign | null; entity: TenantEntity | null; company_info: CompanyInfo; tenant_name: string; logo_url: string | null; print_ids: string[] };
  currency: CurrencyCode;
};

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
const n = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || d);

export function snapLine(l: Row): SnapLine {
  return {
    id: String(l.id), sl_no: s(l.sl_no), description: String(l.description ?? ""), uom: s(l.uom), qty: n(l.qty), rate: n(l.rate), discount_pct: n(l.discount_pct), amount: n(l.amount),
    is_selected: l.is_selected !== false, show_on_pdf: l.show_on_pdf !== false, group_id: s(l.group_id), group_label: s(l.group_label), group_type: s(l.group_type),
    break_of: s(l.break_of), break_qty: l.break_qty === null || l.break_qty === undefined ? null : n(l.break_qty),
  };
}

export type SnapshotInput = {
  quote: Row; lines: Row[]; account: Row | null; contact: Row | null;
  template: { id: string | null; name: string | null; accent_color: string | null; logo_position: "left" | "center" | "right"; blocks: StandardQuoteTemplateBlock[] };
  frame: StandardQuoteSnapshot["frame"]; currency: CurrencyCode;
};

export function buildStandardQuoteSnapshot(i: SnapshotInput): StandardQuoteSnapshot {
  const q = i.quote;
  return {
    v: 1,
    quote: {
      ref: String(q.ref), created_at: String(q.created_at), valid_until: s(q.valid_until), inquiry_date: s(q.inquiry_date), terms: s(q.terms), notes: s(q.notes), intro_text: s(q.intro_text),
      header_discount_pct: n(q.header_discount_pct), tax_pct: n(q.tax_pct), shipping_amount: n(q.shipping_amount), subtotal: n(q.subtotal), total: n(q.total),
      print_options: (q.print_options as StandardQuote["print_options"]) ?? null, project_title: s(q.project_title), subject: s(q.subject), entity_id: s(q.entity_id),
      custom_data: (q.custom_data as Record<string, unknown> | null) ?? null, doc_sections: (q.doc_sections as DocSections | null) ?? null,
      account_id: String(q.account_id), contact_id: s(q.contact_id),
    },
    lines: i.lines.map(snapLine),
    account: i.account ? { id: String(i.account.id), name: String(i.account.name ?? ""), city: s(i.account.city), phone: s(i.account.phone), email: s(i.account.email), print_ids: Array.isArray(i.account.print_ids) ? (i.account.print_ids as string[]) : [] } : null,
    contact: i.contact ? { id: String(i.contact.id), name: String(i.contact.name ?? ""), phone: s(i.contact.phone), email: s(i.contact.email) } : null,
    template: i.template,
    frame: i.frame,
    currency: i.currency,
  };
}

/** A stored snapshot read defensively: anything that is not a version-1 snapshot is not one. */
export function readSnapshot(raw: unknown): StandardQuoteSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<StandardQuoteSnapshot>;
  if (r.v !== 1 || !r.quote || !Array.isArray(r.lines) || !r.template || !r.frame) return null;
  return r as StandardQuoteSnapshot;
}

/** The snapshot shaped like the live records the print components take. */
export function snapshotForPrint(snap: StandardQuoteSnapshot, ctx: { quoteId: string; tenantId: string; status: StandardQuote["status"] }) {
  const q = snap.quote;
  const quote = {
    id: ctx.quoteId, tenant_id: ctx.tenantId, status: ctx.status, ...q, subtotal: q.subtotal, total: q.total,
    created_by: null, updated_at: q.created_at, sent_at: null, closed_at: null, template_id: snap.template.id,
  } as unknown as StandardQuote;
  const lines = snap.lines.map((l) => ({ ...l, tenant_id: ctx.tenantId, standard_quote_id: ctx.quoteId })) as unknown as StandardQuoteLine[];
  const account = snap.account ? ({ ...snap.account } as unknown as Account) : null;
  const contact = snap.contact ? ({ ...snap.contact, account_id: snap.account?.id ?? "" } as unknown as Contact) : null;
  return { quote, lines, account, contact };
}

export type SnapshotDiff = { totalDelta: number; added: number; removed: number; changed: number };

/** What changed between two revisions, in words a person reads: the total, and how many lines were added, dropped or re-priced.
 *  Lines are matched by item number and description. */
export function diffSnapshots(prev: StandardQuoteSnapshot | null, next: StandardQuoteSnapshot): SnapshotDiff {
  if (!prev) return { totalDelta: next.quote.total, added: next.lines.length, removed: 0, changed: 0 };
  const key = (l: SnapLine) => `${l.sl_no ?? ""}|${l.description}`;
  const before = new Map(prev.lines.map((l) => [key(l), l]));
  const after = new Map(next.lines.map((l) => [key(l), l]));
  let added = 0, removed = 0, changed = 0;
  for (const [k, l] of after) {
    const p = before.get(k);
    if (!p) added++;
    else if (p.qty !== l.qty || p.rate !== l.rate || p.discount_pct !== l.discount_pct || p.amount !== l.amount) changed++;
  }
  for (const k of before.keys()) if (!after.has(k)) removed++;
  return { totalDelta: Math.round((next.quote.total - prev.quote.total) * 100) / 100, added, removed, changed };
}

export function describeDiff(d: SnapshotDiff | null, money: (n: number) => string): string {
  if (!d) return "";
  const parts: string[] = [];
  if (d.totalDelta !== 0) parts.push(`${d.totalDelta > 0 ? "+" : "-"}${money(Math.abs(d.totalDelta))}`);
  if (d.added) parts.push(`${d.added} added`);
  if (d.removed) parts.push(`${d.removed} removed`);
  if (d.changed) parts.push(`${d.changed} re-priced`);
  return parts.length ? parts.join(", ") : "No change in lines or total";
}
