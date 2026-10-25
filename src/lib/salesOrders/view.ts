import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lineIsLate, lineIsShort } from "./availability";
import { orderPermissions, type OrderPermissions } from "./lock";
import { loadLines, type OrderRow } from "./server";
import { erpDeepLink } from "@/lib/middleware/links";
import type { D365Config } from "@/lib/connectors/d365/types";
import { lineBlocker } from "@/lib/connectors/sap_s4/orderMap";
import { ERP_DOCUMENT_COLUMNS, shapeErpDocument, type ErpDocumentRow, type ErpDocumentView } from "./erpDocs";
import { failedChecks, sendReadiness, type ErpCheckView, type ErpTransferView } from "./erpChecks";
import { loadChecks, loadTransfers } from "./erpState";
import type { SalesOrderLine } from "./types";

// The shape GET /api/sales-orders/[id] answers and every action returns, so the detail screen can redraw from
// any response: the order row, its lines, who it is for, what type it is, where it came from and what may be done.

export type OrderView = OrderRow & OrderPermissions & {
  lines: SalesOrderLine[];
  account: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  type: { id: string; name: string; prefix: string; pricing_mode: string } | null;
  /** Ref of the quote / deal / order this one was made from, for "Internal pricing, as quote SQ-…". */
  source_ref: string | null;
  /** The one quiet line under the header: which pricing mode the order uses and why. */
  pricing_label: string;
  attachment_count: number;
  /** A line is late (confirmed after the date asked) or short (confirmed less than asked). Drives the Overview banner. */
  needs_attention: boolean;
  /** Deliveries and invoices an ERP reported for this order (migration 0216); empty while that is pending. */
  erp_documents: ErpDocumentView[];
  /** The ERP's own order number and when it was last read, from the order's connector link; null when no ERP holds it. */
  erp_link: { number: string | null; synced_at: string | null; checked_at: string | null } | null;
  /** Set when the ERP named a customer that has no Account here yet. */
  customer_note: string | null;
  /** An ERP that takes orders is connected (Dynamics 365 Sales or SAP S/4HANA), so Check with ERP and Send to ERP can be offered. */
  erp_available: boolean;
  /** Why Send to ERP is disabled (no customer in the ERP, no lines, already sent...); null when it can be pressed. */
  erp_send_blocker: string | null;
  /** The latest credit, price and stock results (migration 0217), each marked stale when the lines or customer changed after it ran. */
  erp_checks: ErpCheckView[];
  /** Every attempt to send the order to the ERP, newest first. */
  erp_transfers: ErpTransferView[];
  /** The checks/transfers tables are not there yet: the screen says "Needs a database update". */
  erp_checks_pending: boolean;
};

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadErpExtras(db: SupabaseClient, tenantId: string, order: OrderRow): Promise<{ docs: ErpDocumentView[]; link: OrderView["erp_link"] }> {
  const [docsRes, linkRes] = await Promise.all([
    db.from("erp_documents").select(ERP_DOCUMENT_COLUMNS).eq("order_id", order.id).eq("tenant_id", tenantId).order("doc_date", { ascending: true }),
    db.from("connector_links").select("external_key, synced_at").eq("tenant_id", tenantId).eq("object_type", "sales_orders").eq("object_id", order.id).limit(1),
  ]);
  const rows = docsRes.error ? [] : ((docsRes.data ?? []) as unknown as ErpDocumentRow[]);
  const l = linkRes.error ? null : ((linkRes.data ?? []) as { external_key: string | null; synced_at: string | null }[])[0] ?? null;
  let base: Pick<D365Config, "product" | "environment_url"> | null = null;
  if (rows.length > 0 && l) {
    const { data } = await db.from("tenant_connectors").select("config").eq("tenant_id", tenantId).eq("connector_id", "dynamics365").maybeSingle();
    const cfg = (data?.config ?? null) as D365Config | null;
    if (cfg?.product && cfg.environment_url) base = cfg;
  }
  const docs = rows.map((r) => shapeErpDocument(r, base && r.kind === "invoice" && GUID.test(r.raw_ref) ? erpDeepLink(base, "invoice", r.raw_ref) : null));
  const checked = (order as unknown as { erp_docs_checked_at?: string | null }).erp_docs_checked_at ?? null;
  return { docs, link: l ? { number: l.external_key, synced_at: l.synced_at, checked_at: checked } : null };
}

/** Is an ERP that takes orders configured (Dataverse first, else SAP S/4HANA), and does the order's customer have a counterpart there? All tenant-scoped. */
async function loadErpReach(db: SupabaseClient, tenantId: string, order: OrderRow, lines: SalesOrderLine[]): Promise<{ available: boolean; customerLinked: boolean; lineBlocker: string | null }> {
  const { data, error } = await db.from("tenant_connectors").select("config").eq("tenant_id", tenantId).eq("connector_id", "dynamics365").maybeSingle();
  const product = error ? null : ((data?.config ?? null) as { product?: string } | null)?.product;
  let connectorId: "dynamics365" | "sap_s4" | null = product === "dataverse" ? "dynamics365" : null;
  if (!connectorId) {
    const sap = await db.from("tenant_connectors").select("config").eq("tenant_id", tenantId).eq("connector_id", "sap_s4").maybeSingle();
    if (!sap.error && (sap.data?.config as { auth_mode?: string } | null)?.auth_mode) connectorId = "sap_s4";
  }
  const available = connectorId !== null;
  if (!connectorId || !order.account_id) return { available, customerLinked: false, lineBlocker: null };
  const link = await db.from("connector_links").select("id").eq("tenant_id", tenantId).eq("connector_id", connectorId).eq("entity", "customers").eq("object_id", order.account_id).limit(1);
  // SAP takes catalogue products only: a line without one, or one SAP does not know, is named before the button is pressed.
  let blocker: string | null = null;
  if (connectorId === "sap_s4") {
    const productIds = lines.map((l) => l.product_id).filter((x): x is string => !!x);
    const erp = new Map<string, string>();
    if (productIds.length > 0) {
      const { data: pl } = await db.from("connector_links").select("object_id, external_id").eq("tenant_id", tenantId).eq("connector_id", "sap_s4").eq("entity", "products").in("object_id", productIds);
      for (const r of (pl ?? []) as { object_id: string; external_id: string }[]) erp.set(r.object_id, r.external_id);
    }
    blocker = lineBlocker(lines, erp);
  }
  return { available, customerLinked: !link.error && (link.data ?? []).length > 0, lineBlocker: blocker };
}

const SOURCE_TABLE: Record<string, string> = { standard_quote: "standard_quotes", quotation: "quotes", opportunity: "opportunities", order: "sales_orders" };

export function pricingLabel(mode: string, sourceType: string, sourceRef: string | null): string {
  if (mode === "external") return "Prices come from the ERP";
  const kind = { standard_quote: "quote", quotation: "quotation", opportunity: "deal", order: "order" }[sourceType];
  return kind && sourceRef ? `Internal pricing, as ${kind} ${sourceRef}` : "Internal pricing";
}

async function sourceRefOf(db: SupabaseClient, tenantId: string, sourceType: string, sourceId: string | null): Promise<string | null> {
  const table = SOURCE_TABLE[sourceType];
  if (!table || !sourceId) return null;
  const { data, error } = await db.from(table).select("ref").eq("id", sourceId).eq("tenant_id", tenantId).maybeSingle();
  return error ? null : ((data as { ref: string | null } | null)?.ref ?? null);
}

export async function buildOrderView(db: SupabaseClient, tenantId: string, order: OrderRow, erpLinked: boolean): Promise<OrderView> {
  const [lines, accountRes, contactRes, typeRes, sourceRef, attachments, erp] = await Promise.all([
    loadLines(db, tenantId, order.id),
    order.account_id ? db.from("accounts").select("id, name").eq("id", order.account_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    order.contact_id ? db.from("contacts").select("id, name").eq("id", order.contact_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    order.type_id ? db.from("sales_order_types").select("id, name, prefix, pricing_mode").eq("id", order.type_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    sourceRefOf(db, tenantId, order.source_type, order.source_id),
    db.from("sales_order_attachments").select("id").eq("order_id", order.id).eq("tenant_id", tenantId),
    loadErpExtras(db, tenantId, order),
  ]);
  const [checkRes, transferRes, reach] = await Promise.all([loadChecks(db, tenantId, order, lines), loadTransfers(db, tenantId, order.id), loadErpReach(db, tenantId, order, lines)]);
  const blocker = !reach.available ? "No ERP is connected." : sendReadiness({
    origin: order.origin, status: order.status, erpLinked, hasAccount: !!order.account_id, customerLinked: reach.customerLinked,
    lineCount: lines.length, allQuantitiesPositive: lines.every((l) => Number(l.qty) > 0),
  }) ?? reach.lineBlocker;
  return {
    ...order,
    ...orderPermissions(order, erpLinked),
    lines,
    account: (accountRes.data as { id: string; name: string } | null) ?? null,
    contact: (contactRes.data as { id: string; name: string } | null) ?? null,
    type: (typeRes.data as OrderView["type"]) ?? null,
    source_ref: sourceRef,
    pricing_label: pricingLabel(order.pricing_mode, order.source_type, sourceRef),
    attachment_count: attachments.error ? 0 : (attachments.data ?? []).length,
    needs_attention: order.status !== "cancelled" && (lines.some((l) => lineIsLate(l) || lineIsShort(l)) || failedChecks(checkRes.checks).length > 0),
    erp_documents: erp.docs,
    erp_link: erp.link,
    customer_note: !order.account_id && order.erp_customer_name ? "This customer is not in BPMSquare yet. Sync Customers from the ERP and it is linked on the next order refresh." : null,
    erp_available: reach.available,
    erp_send_blocker: blocker,
    erp_checks: checkRes.checks,
    erp_transfers: transferRes.transfers,
    erp_checks_pending: checkRes.pending || transferRes.pending,
  };
}
