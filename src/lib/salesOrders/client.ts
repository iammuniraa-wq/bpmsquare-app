// The Sales Order screens' only door to the API (docs/design/sales-order-build-spec-so1.md, "Routes").
// Thin on purpose: fetch, never throw, and answer with a result the screen can draw. A missing endpoint (404/501, the
// route not deployed yet, an HTML error page, a dropped connection) is `missing: true`, so a screen shows an empty state
// instead of crashing while the backend lands. Response shapes are read tolerantly: the spec fixes the routes and the
// row types (types.ts), not the envelope, so every reader below accepts the flat row and the `{ order, lines }` form.

import type {
  OrderAttachment, OrderOrigin, OrderParty, OrderSourceType, OrderSpine, OrderStatus, PricingMode,
  SalesOrder, SalesOrderLine, SalesOrderType,
} from "./types";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; missing: boolean; /** 409 "an order already exists for this source": ask, then send again with confirm_another. */ needsConfirmation?: true; /** 503: the Sales Orders database update has not been applied yet. */ needsDatabaseUpdate?: true };

/** A delivery or invoice read from the ERP (SO2 fills these; SO1 shows an empty shell). */
export type ErpDocument = {
  id: string;
  kind: "delivery" | "invoice";
  number: string | null;
  date: string | null;
  amount: number | null;
  /** The ERP's own wording, shown as is. */
  status: string | null;
  delivered?: boolean;
  paid?: boolean;
  /** invoice: open | closed | paid | cancelled. A cancelled invoice never counts toward Invoiced or Paid. */
  spine?: string | null;
  due?: string | null;
  currency?: string | null;
  fetchedAt?: string | null;
  /** An invoice that follows a delivery names it, so the flow can draw the pair. */
  delivery_id?: string | null;
  href?: string | null;
};

export type PartyRef = { id: string; name: string; phone?: string | null; email?: string | null };

export type OrderDetail = {
  order: SalesOrder;
  lines: SalesOrderLine[];
  type: SalesOrderType | null;
  account: PartyRef | null;
  contact: PartyRef | null;
  source: { type: OrderSourceType; id: string | null; ref: string | null } | null;
  /** A connector_links row exists: the ERP accepted the order. */
  erpLinked: boolean;
  /** A connector that can check/send orders exists (SO3): "Check with ERP" shows only then. */
  erpAvailable: boolean;
  erpDocuments: ErpDocument[];
  /** The ERP's order number and when it was last read; null when no ERP holds the order. */
  erpLink: { number: string | null; syncedAt: string | null; checkedAt: string | null } | null;
  /** Shown when the ERP named a customer that has no Account here yet. */
  customerNote: string | null;
  /** The server's own answers about the lock (the same rule the PATCH route applies); null when it sent none. */
  permissions: { editable: boolean; annotatable: boolean; deletable: boolean } | null;
  /** Why the order is locked, in the server's words (so the chip, the greyed controls and a 409 agree). */
  lockReason: string | null;
  /** The quiet pricing line as the server words it, when it sent one. */
  pricingLabel: string | null;
};

export type OrderLineInput = {
  /** An existing line keeps its id, so its history and later ERP links stay attached. */
  id?: string;
  product_id: string | null;
  description: string;
  printed_text: string | null;
  qty: number;
  uom: string | null;
  unit_price: number;
  discount_pct: number;
  tax_pct: number;
  requested_date: string | null;
};

export type CreateOrderBody = {
  type_id?: string | null;
  account_id: string;
  contact_id?: string | null;
  bill_to?: OrderParty | null;
  ship_to?: OrderParty | null;
  customer_po?: string | null;
  requested_date?: string | null;
  currency?: string | null;
  notes?: string | null;
  terms?: string | null;
  lines: OrderLineInput[];
  source?: { type: "standard_quote" | "quotation" | "opportunity"; id: string };
  confirm_another?: boolean;
};

export type PatchOrderBody = Partial<Pick<SalesOrder, "customer_po" | "requested_date" | "notes" | "terms" | "custom_data">> & {
  type_id?: string | null;
  contact_id?: string | null;
  bill_to?: OrderParty | null;
  ship_to?: OrderParty | null;
};

export type NewTypeBody = Partial<Omit<SalesOrderType, "id" | "tenant_id">> & { name: string };

// ── plumbing ──────────────────────────────────────────────────────────────────

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The first array found under any of `keys` (or the value itself when it is an array). */
export function pickArray(json: unknown, keys: string[]): unknown[] {
  if (Array.isArray(json)) return json;
  const r = rec(json);
  if (!r) return [];
  for (const k of keys) if (Array.isArray(r[k])) return r[k] as unknown[];
  return [];
}

async function call<T>(url: string, init: RequestInit | undefined, parse: (json: unknown) => T | null): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, status: 0, error: "Network error", missing: true };
  }
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const r = rec(json);
    const message = r ? str(r.error) ?? str(r.message) : null;
    return {
      ok: false, status: res.status, error: message ?? `Request failed (${res.status})`, missing: json === null || res.status === 404 || res.status === 501,
      ...(res.status === 409 && r?.needs_confirmation === true ? { needsConfirmation: true as const } : {}),
      ...(r?.needsDatabaseUpdate === true ? { needsDatabaseUpdate: true as const } : {}),
    };
  }
  const data = parse(json);
  if (data === null) return { ok: false, status: res.status, error: "The server sent an answer this screen could not read", missing: true };
  return { ok: true, data };
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

// ── readers (exported for tests) ──────────────────────────────────────────────

const STATUSES: OrderStatus[] = ["draft", "confirmed", "cancelled"];
const SPINES: OrderSpine[] = ["open", "in_progress", "completed", "cancelled"];

function readParty(v: unknown): OrderParty | null {
  const r = rec(v);
  if (!r) return null;
  const name = str(r.name);
  if (!name) return null;
  return { name, address: str(r.address), contact: str(r.contact), phone: str(r.phone), email: str(r.email), tax_id: str(r.tax_id) };
}

export function readLine(v: unknown, index: number, orderId: string): SalesOrderLine | null {
  const r = rec(v);
  if (!r) return null;
  const rawSource = r.availability_source ?? r.source;
  const source = rawSource === "erp" || rawSource === "master" ? rawSource : null;
  return {
    id: str(r.id) ?? `line-${index}`,
    order_id: str(r.order_id) ?? orderId,
    line_no: num(r.line_no, index + 1),
    product_id: str(r.product_id),
    description: str(r.description) ?? "",
    printed_text: str(r.printed_text),
    qty: num(r.qty),
    uom: str(r.uom),
    unit_price: num(r.unit_price),
    discount_pct: num(r.discount_pct),
    tax_pct: num(r.tax_pct),
    line_total: num(r.line_total, num(r.qty) * num(r.unit_price) * (1 - num(r.discount_pct) / 100)),
    requested_date: str(r.requested_date),
    confirmed_qty: numOrNull(r.confirmed_qty),
    confirmed_date: str(r.confirmed_date),
    availability_source: source,
    availability_at: str(r.availability_at) ?? str(r.checked_at),
  };
}

export function readOrder(v: unknown): SalesOrder | null {
  const r = rec(v);
  if (!r) return null;
  const id = str(r.id);
  const ref = str(r.ref);
  if (!id || !ref) return null;
  const status = STATUSES.includes(r.status as OrderStatus) ? (r.status as OrderStatus) : "draft";
  const spine = SPINES.includes(r.spine as OrderSpine)
    ? (r.spine as OrderSpine)
    : status === "cancelled" ? "cancelled" : status === "draft" ? "open" : "in_progress";
  const origin: OrderOrigin = r.origin === "erp" ? "erp" : "bpmsquare";
  const pricing: PricingMode = r.pricing_mode === "external" ? "external" : "internal";
  return {
    id,
    tenant_id: str(r.tenant_id) ?? "",
    ref,
    type_id: str(r.type_id),
    origin,
    status,
    status_label: str(r.status_label),
    spine,
    account_id: str(r.account_id),
    erp_customer_name: str(r.erp_customer_name),
    contact_id: str(r.contact_id),
    bill_to: readParty(r.bill_to),
    ship_to: readParty(r.ship_to),
    customer_po: str(r.customer_po),
    source_type: (str(r.source_type) as OrderSourceType | null) ?? "direct",
    source_id: str(r.source_id),
    opportunity_id: str(r.opportunity_id),
    currency: str(r.currency) ?? "",
    pricing_mode: pricing,
    subtotal: num(r.subtotal),
    discount_total: num(r.discount_total),
    tax_total: num(r.tax_total),
    shipping_amount: num(r.shipping_amount),
    total: num(r.total),
    requested_date: str(r.requested_date),
    expected_date: str(r.expected_date),
    notes: str(r.notes),
    terms: str(r.terms),
    owner_user_id: str(r.owner_user_id),
    confirmed_at: str(r.confirmed_at),
    custom_data: rec(r.custom_data),
    created_at: str(r.created_at) ?? "",
    updated_at: str(r.updated_at) ?? "",
  };
}

export function readType(v: unknown): SalesOrderType | null {
  const r = rec(v);
  if (!r) return null;
  const id = str(r.id);
  const name = str(r.name);
  if (!id || !name) return null;
  const tpl = rec(r.template);
  return {
    id,
    tenant_id: str(r.tenant_id) ?? "",
    name,
    prefix: str(r.prefix) ?? "SO",
    pricing_mode: r.pricing_mode === "external" ? "external" : "internal",
    template: {
      blocks: arr(tpl?.blocks),
      accent_color: str(tpl?.accent_color),
      logo_position: tpl?.logo_position === "center" || tpl?.logo_position === "right" ? tpl.logo_position : "left",
    },
    rules: arr(r.rules).flatMap((x) => {
      const q = rec(x);
      const field = q ? str(q.field) : null;
      const equals = q ? str(q.equals) : null;
      return field && equals ? [{ field, equals }] : [];
    }),
    is_default: r.is_default === true,
    active: r.active !== false,
    sort_order: num(r.sort_order),
  };
}

function readParty2(v: unknown): PartyRef | null {
  const r = rec(v);
  if (!r) return null;
  const id = str(r.id);
  const name = str(r.name);
  return id && name ? { id, name, phone: str(r.phone), email: str(r.email) } : null;
}

export function readErpDocument(v: unknown): ErpDocument | null {
  const r = rec(v);
  if (!r) return null;
  const id = str(r.id);
  const kind = r.kind === "delivery" || r.kind === "invoice" ? r.kind : null;
  if (!id || !kind) return null;
  return {
    id, kind, number: str(r.number), date: str(r.date), amount: numOrNull(r.amount), status: str(r.status),
    delivered: r.delivered === true, paid: r.paid === true, delivery_id: str(r.delivery_id), href: str(r.href),
    spine: str(r.spine), due: str(r.due), currency: str(r.currency), fetchedAt: str(r.fetched_at),
  };
}

/** The detail answer: `{ order, lines, type, account, contact, ... }` or the order row with its lines inside. */
export function readDetail(json: unknown): OrderDetail | null {
  const root = rec(json);
  if (!root) return null;
  const orderRaw = rec(root.order) ?? root;
  const order = readOrder(orderRaw);
  if (!order) return null;
  const lines = arr(root.lines ?? orderRaw.lines).flatMap((l, i) => { const x = readLine(l, i, order.id); return x ? [x] : []; });
  const account = readParty2(root.account) ?? (order.account_id && str(orderRaw.account_name) ? { id: order.account_id, name: str(orderRaw.account_name) as string } : null);
  const contact = readParty2(root.contact) ?? (order.contact_id && str(orderRaw.contact_name) ? { id: order.contact_id, name: str(orderRaw.contact_name) as string } : null);
  const src = rec(root.source);
  const source = src
    ? { type: (str(src.type) as OrderSourceType | null) ?? order.source_type, id: str(src.id) ?? order.source_id, ref: str(src.ref) }
    : order.source_type !== "direct" ? { type: order.source_type, id: order.source_id, ref: str(root.source_ref) ?? str(orderRaw.source_ref) } : null;
  const link = root.erp_linked ?? root.erpLinked ?? (root.erp_link ?? root.connector_link ?? null);
  return {
    order,
    lines,
    type: readType(root.type ?? root.order_type),
    account,
    contact,
    source,
    erpLinked: link === true || (link !== null && typeof link === "object"),
    erpAvailable: root.erp_available === true || root.erpAvailable === true,
    erpDocuments: arr(root.erp_documents ?? root.erpDocuments).flatMap((d) => { const x = readErpDocument(d); return x ? [x] : []; }),
    erpLink: (() => {
      const l = rec(root.erp_link);
      return l ? { number: str(l.number), syncedAt: str(l.synced_at), checkedAt: str(l.checked_at) } : null;
    })(),
    customerNote: str(root.customer_note),
    permissions: typeof root.editable === "boolean"
      ? { editable: root.editable, annotatable: root.annotatable === true, deletable: root.deletable === true }
      : null,
    lockReason: str(root.lock_reason),
    pricingLabel: str(root.pricing_label),
  };
}

export function readAttachment(v: unknown, orderId: string): (OrderAttachment & { created_by_name: string | null; href: string | null }) | null {
  const r = rec(v);
  if (!r) return null;
  const id = str(r.id);
  const name = str(r.name) ?? str(r.file_name);
  if (!id || !name) return null;
  const kind = r.kind === "customer_po" || r.kind === "drawing" ? r.kind : "other";
  return {
    id, order_id: str(r.order_id) ?? orderId, kind, type: r.type === "link" ? "link" : "file", name,
    ref: str(r.ref) ?? "", size_bytes: numOrNull(r.size_bytes), created_by: str(r.created_by), created_at: str(r.created_at) ?? "",
    created_by_name: str(r.created_by_name) ?? str(r.created_by_email),
    href: str(r.href),
  };
}

export type Attachment = NonNullable<ReturnType<typeof readAttachment>>;

// ── orders ────────────────────────────────────────────────────────────────────

const base = "/api/sales-orders";

export const getOrder = (id: string) => call(`${base}/${id}`, undefined, readDetail);

export const createOrder = (body: CreateOrderBody) =>
  call(base, jsonInit("POST", body), (j) => {
    const r = rec(j);
    const inner = rec(r?.order);
    const id = str(r?.id) ?? str(inner?.id);
    return id ? { id, ref: str(r?.ref) ?? str(inner?.ref) } : null;
  });

/** "Create sales order" on an accepted quote / won deal: the server copies lines, prices, tax, currency, customer and pricing mode. */
export const createOrderFromSource = (source: { type: "standard_quote" | "quotation" | "opportunity"; id: string }, confirmAnother = false) =>
  call(base, jsonInit("POST", { source, lines: [], ...(confirmAnother ? { confirm_another: true } : {}) }), (j) => {
    const r = rec(j);
    const inner = rec(r?.order);
    const id = str(r?.id) ?? str(inner?.id);
    return id ? { id, ref: str(r?.ref) ?? str(inner?.ref) } : null;
  });

/** Ask the ERP again about this order: its status and its invoices. `throttled` = one was done a moment ago and this one did nothing. */
export const refreshFromErp = (id: string) =>
  call(`${base}/${id}/erp-refresh`, jsonInit("POST", {}), (j) => ({ throttled: rec(j)?.throttled === true, invoices: num(rec(j)?.invoices) }));

export const patchOrder = (id: string, body: PatchOrderBody) => call(`${base}/${id}`, jsonInit("PATCH", body), () => true as const);
export const deleteOrder = (id: string) => call(`${base}/${id}`, { method: "DELETE" }, () => true as const);
export const putLines = (id: string, lines: OrderLineInput[]) => call(`${base}/${id}/lines`, jsonInit("PUT", { lines }), () => true as const);
export const confirmOrder = (id: string) => call(`${base}/${id}/confirm`, jsonInit("POST", {}), () => true as const);
export const cancelOrder = (id: string, reason: string) => call(`${base}/${id}/cancel`, jsonInit("POST", { reason }), () => true as const);
export const reopenOrder = (id: string) => call(`${base}/${id}/reopen`, jsonInit("POST", {}), () => true as const);
/** { ok, sentTo, redirected, intended }: a demo workspace's mail is redirected, never sent to the customer. */
export const emailOrder = (id: string, email?: string) =>
  call(`${base}/${id}/email`, jsonInit("POST", email ? { email } : {}), (j) => {
    const r = rec(j);
    return { sentTo: str(r?.sentTo) ?? str(r?.sent_to), redirected: r?.redirected === true, intended: str(r?.intended) };
  });

export type ShareLinks = {
  pdfUrl: string | null;
  publicPdfUrl: string | null;
  /** A wa.me click-to-chat link with the message ready; null when the customer has no phone number. */
  whatsappUrl: string | null;
  /** What the WhatsApp button does today (the provider is sandbox only), in the server's words. */
  whatsappNote: string | null;
};

/** What the PDF and WhatsApp buttons need, in one call. */
export const getShare = (id: string) =>
  call(`${base}/${id}/share`, undefined, (j): ShareLinks | null => {
    const r = rec(j);
    return r ? { pdfUrl: str(r.pdf_url), publicPdfUrl: str(r.public_pdf_url), whatsappUrl: str(r.whatsapp_url), whatsappNote: str(r.whatsapp_note) } : null;
  });

/** Availability: the server answers with the order's lines (now carrying the confirmed values) or nothing we need. */
export const getAvailability = (id: string) => call(`${base}/${id}/availability`, undefined, (j) => ({ lines: pickArray(j, ["lines"]).flatMap((l, i) => { const x = readLine(l, i, id); return x ? [x] : []; }) }));
export const refreshAvailability = (id: string) => call(`${base}/${id}/availability`, jsonInit("POST", {}), (j) => ({ lines: pickArray(j, ["lines"]).flatMap((l, i) => { const x = readLine(l, i, id); return x ? [x] : []; }) }));

// ── files and links ───────────────────────────────────────────────────────────

export const listAttachments = (id: string) =>
  call(`${base}/${id}/attachments`, undefined, (j) => pickArray(j, ["rows", "attachments", "items"]).flatMap((a) => { const x = readAttachment(a, id); return x ? [x] : []; }));

export const attachmentUrl = (orderId: string, attachmentId: string) => `${base}/${orderId}/attachments/${attachmentId}`;

export function addFile(id: string, file: File, kind: OrderAttachment["kind"], name?: string) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", kind);
  if (name) fd.append("name", name);
  return call(`${base}/${id}/attachments`, { method: "POST", body: fd }, () => true as const);
}

export const addLink = (id: string, link: { url: string; name?: string; kind: OrderAttachment["kind"] }) =>
  call(`${base}/${id}/attachments`, jsonInit("POST", { type: "link", url: link.url, ref: link.url, name: link.name || link.url, kind: link.kind }), () => true as const);

export const removeAttachment = (id: string, attachmentId: string) => call(`${base}/${id}/attachments/${attachmentId}`, { method: "DELETE" }, () => true as const);

// ── order types ───────────────────────────────────────────────────────────────

export type OrderTypeRow = SalesOrderType & { order_count: number };

/** `needsDatabaseUpdate`: the tables are not there yet (the server answers an empty list and says so). */
export const listOrderTypes = () =>
  call("/api/sales-order-types", undefined, (j) => ({
    types: pickArray(j, ["rows", "types"]).flatMap((t): OrderTypeRow[] => { const x = readType(t); return x ? [{ ...x, order_count: num(rec(t)?.order_count) }] : []; }),
    needsDatabaseUpdate: rec(j)?.needsDatabaseUpdate === true,
  }));

export const createOrderType = (body: NewTypeBody) =>
  call("/api/sales-order-types", jsonInit("POST", body), (j) => ({ id: str(rec(j)?.id) ?? str(rec(rec(j)?.type)?.id) }));

export const patchOrderType = (id: string, body: Partial<NewTypeBody>) => call(`/api/sales-order-types/${id}`, jsonInit("PATCH", body), () => true as const);

/** The server deletes a type nobody used and deactivates one with orders; `deactivated` says which happened. */
export const deleteOrderType = (id: string) =>
  call(`/api/sales-order-types/${id}`, { method: "DELETE" }, (j) => ({ deactivated: rec(j)?.deactivated === true || rec(j)?.active === false }));
