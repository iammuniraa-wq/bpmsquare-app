// Everything the Sales Order screens decide, as plain functions: the path across the top, what is locked and why, which
// actions the state allows, when the attention banner shows, what the availability tag says and how the document flow is
// laid out. The components only draw these answers, so the rules are tested without a browser.

import {
  orderAnnotatable, orderDeletable, orderEditable,
  type OrderSourceType, type PricingMode, type SalesOrder, type SalesOrderLine, type SalesOrderType,
} from "@/lib/salesOrders/types";
import type { Attachment, ErpDocument, OrderDetail } from "@/lib/salesOrders/client";

// ── formatting ────────────────────────────────────────────────────────────────

export const fmtDate = (s: string | null | undefined): string => {
  if (!s) return "—";
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
export const fmtDateTime = (s: string | null | undefined): string => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
export const fmtSize = (n: number | null): string => (n === null ? "" : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ── status ────────────────────────────────────────────────────────────────────

export type Tone = "blue" | "amber" | "green" | "red";

export function statusLabel(o: Pick<SalesOrder, "status" | "status_label">): string {
  if (o.status_label) return o.status_label;
  return o.status === "draft" ? "Draft" : o.status === "confirmed" ? "Confirmed" : "Cancelled";
}
export function statusTone(o: Pick<SalesOrder, "spine">): Tone {
  return o.spine === "completed" ? "green" : o.spine === "cancelled" ? "red" : o.spine === "in_progress" ? "amber" : "blue";
}

// ── the path across the top ───────────────────────────────────────────────────

export type PathKey = "draft" | "confirmed" | "delivered" | "invoiced" | "paid";
export type PathStep = { key: PathKey; label: string; state: "done" | "current" | "pending"; hint: string | null };
export type PathModel = { steps: PathStep[]; cancelled: boolean };

const LABEL: Record<PathKey, string> = { draft: "Draft", confirmed: "Confirmed", delivered: "Delivered", invoiced: "Invoiced", paid: "Paid" };
const KEYS: PathKey[] = ["draft", "confirmed", "delivered", "invoiced", "paid"];

const deliveries = (docs: ErpDocument[]) => docs.filter((d) => d.kind === "delivery");
const invoices = (docs: ErpDocument[]) => docs.filter((d) => d.kind === "invoice");
const isDelivered = (d: ErpDocument) => d.delivered === true || /deliver|complete|posted|shipped/i.test(d.status ?? "");
const isPaid = (d: ErpDocument) => d.paid === true || /paid/i.test(d.status ?? "");

/**
 * Draft, Confirmed, Delivered, Invoiced, Paid. The first two come from the order itself; the last three only from what
 * the ERP has reported, so until then they stay grey and say why. A cancelled order keeps what it reached and has no
 * current step.
 */
export function orderPath(order: Pick<SalesOrder, "status" | "confirmed_at">, docs: ErpDocument[]): PathModel {
  const cancelled = order.status === "cancelled";
  const reached: Record<PathKey, boolean> = {
    draft: true,
    confirmed: order.status === "confirmed" || order.confirmed_at !== null || docs.length > 0,
    delivered: deliveries(docs).some(isDelivered),
    invoiced: invoices(docs).length > 0,
    paid: invoices(docs).length > 0 && invoices(docs).every(isPaid),
  };
  let last = 0;
  KEYS.forEach((k, i) => { if (reached[k]) last = i; });
  const steps = KEYS.map((key, i): PathStep => {
    const done = i < last || (cancelled && reached[key]);
    const current = !cancelled && i === last;
    const later = key === "delivered" || key === "invoiced" || key === "paid";
    return {
      key,
      label: LABEL[key],
      state: current ? "current" : done || (i <= last && reached[key]) ? "done" : "pending",
      hint: !reached[key] && later ? (docs.length === 0 ? "Shown once your ERP reports it" : "Waiting for the ERP") : null,
    };
  });
  return { steps, cancelled };
}

/** "Delivery 1 of 2" and "Billing paid", right-aligned under the path; each is null until the ERP reports something. */
export function subStatus(docs: ErpDocument[]): { delivery: string | null; billing: string | null } {
  const dl = deliveries(docs);
  const inv = invoices(docs);
  const done = dl.filter(isDelivered).length;
  const paid = inv.filter(isPaid).length;
  return {
    delivery: dl.length === 0 ? null : dl.length === 1 ? `Delivery: ${done ? "delivered" : "open"}` : `Delivery: ${done} of ${dl.length} delivered`,
    billing: inv.length === 0 ? null : paid === inv.length ? "Billing: paid" : inv.length === 1 ? "Billing: invoiced" : `Billing: ${paid} of ${inv.length} paid`,
  };
}

// ── locking and actions ───────────────────────────────────────────────────────

export type LockInfo = { locked: boolean; chip: string | null; reason: string | null; annotatable: boolean };

/** `locked` is exactly `!orderEditable(...)`; the chip and the reason say which of the three rules applied. */
export function lockInfo(order: Pick<SalesOrder, "origin" | "status">, erpLinked: boolean): LockInfo {
  const locked = !orderEditable(order, erpLinked);
  const annotatable = orderAnnotatable(order);
  if (!locked) return { locked, chip: null, reason: null, annotatable };
  if (order.origin === "erp") return { locked, chip: "Read-only", reason: "This order comes from your ERP, so it is changed there. Notes and files stay open only on orders made here.", annotatable };
  if (order.status === "cancelled") return { locked, chip: "Cancelled", reason: "A cancelled order cannot be changed.", annotatable };
  if (erpLinked) return { locked, chip: "In the ERP", reason: "The ERP accepted this order, so it is read-only here. Notes and files stay open.", annotatable };
  return { locked, chip: "Locked", reason: "A confirmed order is locked. Reopen it to change lines; notes and files stay open.", annotatable };
}

export type OrderActions = {
  pdf: boolean; email: boolean; whatsapp: boolean; confirm: boolean; cancel: boolean; reopen: boolean; remove: boolean; checkWithErp: boolean; editLines: boolean;
};

export function orderActions(order: Pick<SalesOrder, "origin" | "status">, erpLinked: boolean, opts: { erpAvailable: boolean }): OrderActions {
  const made = order.origin === "bpmsquare";
  const open = order.status !== "cancelled";
  return {
    pdf: true,
    email: open,
    whatsapp: open,
    confirm: orderEditable(order, erpLinked),
    cancel: made && open && !erpLinked,
    reopen: made && order.status === "confirmed" && !erpLinked,
    remove: orderDeletable(order, erpLinked),
    checkWithErp: opts.erpAvailable && made && open && !erpLinked,
    editLines: orderEditable(order, erpLinked),
  };
}

// ── the quiet pricing line (never a toggle) ───────────────────────────────────

const SOURCE_WORD: Partial<Record<OrderSourceType, string>> = { standard_quote: "quote", quotation: "quote", opportunity: "deal" };

export function pricingLine(mode: PricingMode, source: { type: OrderSourceType; ref: string | null } | null): string {
  const as = source && SOURCE_WORD[source.type] && source.ref ? `, as ${SOURCE_WORD[source.type]} ${source.ref}` : "";
  return mode === "external" ? `External pricing, supplied by the ERP${as}` : `Internal pricing${as || ", from your price list"}`;
}

// ── lines and the attention banner ────────────────────────────────────────────

export const lineNet = (l: Pick<SalesOrderLine, "qty" | "unit_price" | "discount_pct">): number =>
  l.qty * l.unit_price * (1 - Math.max(0, Math.min(100, l.discount_pct)) / 100);

export function estimateTotals(lines: Pick<SalesOrderLine, "qty" | "unit_price" | "discount_pct" | "tax_pct">[], shipping = 0) {
  const subtotal = lines.reduce((s, l) => s + lineNet(l), 0);
  const tax = lines.reduce((s, l) => s + lineNet(l) * (Math.max(0, l.tax_pct) / 100), 0);
  return { subtotal, tax, shipping, total: subtotal + tax + shipping };
}

export const isShort = (l: SalesOrderLine) => l.confirmed_qty !== null && l.confirmed_qty < l.qty;
export const isLate = (l: SalesOrderLine) => l.confirmed_date !== null && l.requested_date !== null && l.confirmed_date > l.requested_date;

export type Attention = { short: SalesOrderLine[]; late: SalesOrderLine[] };

/** The one banner on Overview: only a line that is short or will arrive after the date asked. Unchecked lines say nothing. */
export function attention(lines: SalesOrderLine[]): Attention {
  return { short: lines.filter(isShort), late: lines.filter(isLate) };
}
export function attentionText(a: Attention): string | null {
  const parts: string[] = [];
  if (a.short.length > 0) parts.push(`${a.short.length} ${a.short.length === 1 ? "line is" : "lines are"} short on stock`);
  if (a.late.length > 0) parts.push(`${a.late.length} ${a.late.length === 1 ? "line arrives" : "lines arrive"} after the date asked`);
  return parts.length === 0 ? null : `${parts.join(" and ")}.`;
}

// ── availability ──────────────────────────────────────────────────────────────

export type SourceTag = { kind: "erp" | "master" | "none"; label: string; detail: string | null };

export function sourceTag(l: Pick<SalesOrderLine, "availability_source" | "availability_at">): SourceTag {
  if (l.availability_source === "erp") return { kind: "erp", label: "ERP", detail: l.availability_at ? `fetched ${fmtDateTime(l.availability_at)}` : null };
  if (l.availability_source === "master") return { kind: "master", label: "Master data", detail: "estimate" };
  return { kind: "none", label: "Not checked", detail: null };
}

export type AvailRow = {
  line: SalesOrderLine;
  state: "ok" | "short" | "late" | "unchecked";
  tag: SourceTag;
};

export function availabilityRows(lines: SalesOrderLine[]): AvailRow[] {
  return lines.map((line) => ({
    line,
    tag: sourceTag(line),
    state: line.confirmed_qty === null && line.confirmed_date === null ? "unchecked" : isShort(line) ? "short" : isLate(line) ? "late" : "ok",
  }));
}

/** "stale" = there are confirmed values whose check time was cleared by an edit; "unchecked" = nothing was ever confirmed. */
export function availabilityStatus(lines: SalesOrderLine[]): "unchecked" | "stale" | "fresh" {
  const confirmed = lines.some((l) => l.confirmed_qty !== null || l.confirmed_date !== null);
  if (!confirmed) return "unchecked";
  return lines.some((l) => l.availability_at === null) ? "stale" : "fresh";
}

export function lastChecked(lines: SalesOrderLine[]): string | null {
  const times = lines.map((l) => l.availability_at).filter((t): t is string => t !== null).sort();
  return times.length > 0 ? times[times.length - 1] : null;
}

/** The latest confirmed date across the lines, and whether it is an ERP value or a master-data estimate. */
export function expectedDelivery(order: Pick<SalesOrder, "expected_date">, lines: SalesOrderLine[]): { date: string | null; tag: SourceTag } {
  const dated = lines.filter((l) => l.confirmed_date !== null);
  const latest = dated.map((l) => l.confirmed_date as string).sort().pop() ?? null;
  const date = order.expected_date ?? latest;
  if (!date) return { date: null, tag: { kind: "none", label: "", detail: null } };
  const master = dated.some((l) => l.availability_source === "master");
  const erp = dated.some((l) => l.availability_source === "erp");
  return { date, tag: master ? sourceTag({ availability_source: "master", availability_at: null }) : erp ? sourceTag({ availability_source: "erp", availability_at: null }) : { kind: "none", label: "", detail: null } };
}

export const tagText = (t: SourceTag): string => (t.kind === "none" ? t.label : t.kind === "master" ? "Master data (estimate)" : "ERP");

// ── the parties on Overview ───────────────────────────────────────────────────

export type PartyBlock = { name: string; lines: string[] };

export function partyBlocks(d: Pick<OrderDetail, "order" | "account" | "contact">): { soldTo: PartyBlock; billTo: PartyBlock | null; shipTo: PartyBlock | null; merged: boolean } {
  const soldTo: PartyBlock = { name: d.account?.name ?? "—", lines: [d.contact?.name].filter((x): x is string => !!x) };
  const b = d.order.bill_to;
  const merged = !b || (b.name.trim().toLowerCase() === soldTo.name.trim().toLowerCase() && !b.address);
  const block = (p: { name: string; address?: string | null; contact?: string | null }): PartyBlock => ({
    name: p.name, lines: [p.address, p.contact].filter((x): x is string => !!x),
  });
  return { soldTo, billTo: merged || !b ? null : block(b), shipTo: d.order.ship_to ? block(d.order.ship_to) : null, merged };
}

export function customerPoFact(order: Pick<SalesOrder, "customer_po">, attachments: Attachment[] | null): { number: string | null; files: number | null } {
  return { number: order.customer_po, files: attachments === null ? null : attachments.filter((a) => a.kind === "customer_po").length };
}

// ── document flow (the swimlane) ──────────────────────────────────────────────

export type FlowKind = "email" | "source" | "order" | "delivery" | "invoice";
export type FlowTone = "done" | "active" | "planned" | "bad" | "neutral";
export type FlowNode = {
  id: string; kind: FlowKind; title: string; ref: string; amount: number | null;
  tone: FlowTone; statusLabel: string; planned: boolean; href: string | null; current: boolean; col: number; row: number;
};
export type FlowLink = { from: string; to: string; planned: boolean };
export type FlowModel = { nodes: FlowNode[]; links: FlowLink[]; cols: number; rows: number };

const SOURCE_TITLE: Record<OrderSourceType, string> = {
  standard_quote: "Standard quote", quotation: "Quotation", opportunity: "Deal", lead: "Lead", email: "Email", order: "Copied from", direct: "Direct", erp: "ERP",
};
const SOURCE_STATUS: Partial<Record<OrderSourceType, string>> = { standard_quote: "Accepted", quotation: "Won", opportunity: "Won", order: "Order" };

export type FlowRoutes = {
  standardQuote: (id: string) => string; quotation: (id: string) => string; deal: (id: string) => string; order: (id: string) => string;
};

export function sourceHref(type: OrderSourceType, id: string | null, r: FlowRoutes): string | null {
  if (!id) return null;
  return type === "standard_quote" ? r.standardQuote(id) : type === "quotation" ? r.quotation(id) : type === "opportunity" ? r.deal(id) : type === "order" ? r.order(id) : null;
}

export function documentFlow(d: Pick<OrderDetail, "order" | "erpDocuments" | "source">, routes: FlowRoutes): FlowModel {
  const { order } = d;
  const src = d.source && d.source.type !== "direct" ? d.source : null;
  const kinds: FlowKind[] = [];
  if (src?.type === "email") kinds.push("email");
  else if (src) kinds.push("source");
  kinds.push("order", "delivery", "invoice");
  const col = (k: FlowKind) => kinds.indexOf(k);

  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];

  if (src) {
    const kind: FlowKind = src.type === "email" ? "email" : "source";
    nodes.push({
      id: "source", kind, title: SOURCE_TITLE[src.type], ref: src.ref ?? "", amount: null, tone: src.type === "email" ? "neutral" : "done",
      statusLabel: SOURCE_STATUS[src.type] ?? "", planned: false, href: sourceHref(src.type, src.id, routes), current: false, col: col(kind), row: 0,
    });
  }

  nodes.push({
    id: "order", kind: "order", title: "Sales order", ref: order.ref, amount: order.total,
    tone: order.status === "cancelled" ? "bad" : order.status === "confirmed" ? "active" : "neutral",
    statusLabel: statusLabel(order), planned: false, href: routes.order(order.id), current: true, col: col("order"), row: 0,
  });
  if (src) links.push({ from: "source", to: "order", planned: false });

  const dels = deliveries(d.erpDocuments);
  const invs = invoices(d.erpDocuments);
  const byDelivery = new Map<string, ErpDocument[]>();
  const loose: ErpDocument[] = [];
  for (const inv of invs) {
    if (inv.delivery_id && dels.some((x) => x.id === inv.delivery_id)) byDelivery.set(inv.delivery_id, [...(byDelivery.get(inv.delivery_id) ?? []), inv]);
    else loose.push(inv);
  }

  let row = 0;
  const docNode = (x: ErpDocument, kind: "delivery" | "invoice", r: number): FlowNode => {
    const finished = kind === "delivery" ? isDelivered(x) : isPaid(x);
    return {
      id: `${kind}-${x.id}`, kind, title: kind === "delivery" ? "Delivery" : "Invoice", ref: x.number ?? "", amount: x.amount,
      tone: finished ? "done" : "active", statusLabel: x.status ?? (kind === "delivery" ? "Open" : "Invoiced"), planned: false, href: x.href ?? null,
      current: false, col: col(kind), row: r,
    };
  };
  const planned = (kind: "delivery" | "invoice", id: string, r: number): FlowNode => ({
    id, kind, title: kind === "delivery" ? "Delivery" : "Invoice", ref: "", amount: null, tone: "planned", statusLabel: "Planned", planned: true, href: null, current: false, col: col(kind), row: r,
  });

  if (dels.length === 0 && loose.length === 0) {
    nodes.push(planned("delivery", "planned-delivery", 0), planned("invoice", "planned-invoice", 0));
    links.push({ from: "order", to: "planned-delivery", planned: true }, { from: "planned-delivery", to: "planned-invoice", planned: true });
    row = 1;
  } else {
    for (const del of dels) {
      const dn = docNode(del, "delivery", row);
      nodes.push(dn);
      links.push({ from: "order", to: dn.id, planned: false });
      const mine = byDelivery.get(del.id) ?? [];
      if (mine.length === 0) {
        const pid = `planned-invoice-${del.id}`;
        nodes.push(planned("invoice", pid, row));
        links.push({ from: dn.id, to: pid, planned: true });
        row += 1;
      }
      for (const inv of mine) {
        const inode = docNode(inv, "invoice", row);
        nodes.push(inode);
        links.push({ from: dn.id, to: inode.id, planned: false });
        row += 1;
      }
    }
    for (const inv of loose) {
      const inode = docNode(inv, "invoice", row);
      nodes.push(inode);
      links.push({ from: "order", to: inode.id, planned: false });
      row += 1;
    }
  }
  return { nodes, links, cols: kinds.length, rows: Math.max(1, row) };
}

export type Orientation = "across" | "down";
export const FLOW_BOX = { w: 156, h: 62, gapAlong: 52, gapAcross: 16, pad: 8 };

export type FlowLayout = {
  width: number; height: number; orientation: Orientation;
  nodes: (FlowNode & { x: number; y: number })[];
  links: (FlowLink & { d: string })[];
};

/** Positions the boxes and draws each link as a curve. "across" flows left to right; "down" flows top to bottom (phones). */
export function layoutFlow(m: FlowModel, orientation: Orientation): FlowLayout {
  const { w, h, gapAlong, gapAcross, pad } = FLOW_BOX;
  const across = orientation === "across";
  const place = (n: FlowNode) => across
    ? { x: pad + n.col * (w + gapAlong), y: pad + n.row * (h + gapAcross) }
    : { x: pad + n.row * (w + gapAcross), y: pad + n.col * (h + gapAlong) };
  const nodes = m.nodes.map((n) => ({ ...n, ...place(n) }));
  const at = new Map(nodes.map((n) => [n.id, n]));
  const links = m.links.flatMap((l) => {
    const a = at.get(l.from);
    const b = at.get(l.to);
    if (!a || !b) return [];
    const d = across
      ? (() => { const x1 = a.x + w, y1 = a.y + h / 2, x2 = b.x, y2 = b.y + h / 2, k = (x2 - x1) / 2; return `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`; })()
      : (() => { const x1 = a.x + w / 2, y1 = a.y + h, x2 = b.x + w / 2, y2 = b.y, k = (y2 - y1) / 2; return `M${x1},${y1} C${x1},${y1 + k} ${x2},${y2 - k} ${x2},${y2}`; })();
    return [{ ...l, d }];
  });
  const width = across ? pad * 2 + m.cols * w + (m.cols - 1) * gapAlong : pad * 2 + m.rows * w + (m.rows - 1) * gapAcross;
  const height = across ? pad * 2 + m.rows * h + (m.rows - 1) * gapAcross : pad * 2 + m.cols * h + (m.cols - 1) * gapAlong;
  return { width, height, orientation, nodes, links };
}

// ── sending ───────────────────────────────────────────────────────────────────

export function orderWhatsAppMessage(v: { customer: string; company: string; ref: string; total: string; link: string | null }): string {
  return [
    `Hello ${v.customer},`,
    `Your sales order ${v.ref} from ${v.company} (total ${v.total}) is ready.`,
    v.link ? `View it here: ${v.link}` : "",
    `Thank you,\n${v.company}`,
  ].filter(Boolean).join("\n\n");
}

// ── create form ───────────────────────────────────────────────────────────────

/** A type chosen by the person, else none (the server then picks by the rules, then the default). */
export function typeOptions(types: SalesOrderType[]): SalesOrderType[] {
  return types.filter((t) => t.active).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}
