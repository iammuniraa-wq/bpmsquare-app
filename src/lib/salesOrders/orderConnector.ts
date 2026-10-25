import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ErpHttp } from "@/lib/middleware/erp";
import type { StoredPayload } from "@/lib/middleware/exchange";
import type { FetchLike } from "@/lib/connectors/sap_s4/odata";
import type { CheckOutcome } from "./erpChecks";
import type { TenantRow } from "./erpContext";
import type { DocumentsResult } from "./erpOrderWrite";
import type { OrderRow } from "./server";
import type { SalesOrderLine } from "./types";

// The seam between the Sales Order and the ERP it talks to (SO4b). Check with ERP, Send to ERP and the refresh of an order's state
// are the same three steps for every ERP; what differs is the system's own words and calls. The shared steps (loading the order with
// the tenant filter, readiness, the confirm rule, the link claim that keeps one BPMSquare order one ERP order, the transfer log, the
// Monitor line, the change log) live in erpSend.ts / erpChecksServer.ts and call an OrderConnector for the rest.
//
// A connector implements:
//   open()      -> a session on the workspace's own connection (read with the tenant filter, never from a request)
//   check()     -> the three results (credit, price, stock) from READ-ONLY calls; nothing is saved in the ERP
//   send()      -> create the order; may be called again after a timeout because it looks the order up by its marker first
//   refresh()   -> read the order's status and its documents (deliveries, invoices) into erp_documents
//   sendBlocker -> reasons the order cannot go to this ERP that are known without calling it (a free-text line, no organisation mapped)
// Adding another ERP is one file that implements this and one line in `connectors` below.

export type ConnectorId = "dynamics365" | "sap_s4";

/** Test hooks: a fake HTTP client for Dynamics, a fake fetch for SAP. */
export type OrderDeps = { http?: ErpHttp; sap?: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void> } };

export type SessionOpen =
  | { ok: true; session: OrderSession; middleware: boolean }
  | { ok: false; kind: "no_connector" | "unsupported" | "unreachable"; message: string };

export type CheckInput = {
  admin: SupabaseClient; tenantId: string; order: OrderRow; lines: SalesOrderLine[];
  /** The ERP's id of the customer (null = not in the ERP) and of each product that has a counterpart there, keyed by the BPMSquare product id. */
  customerId: string | null; erpProducts: Map<string, string>;
};

export type SendInput = {
  admin: SupabaseClient; tenantId: string; order: OrderRow; lines: SalesOrderLine[];
  customerId: string | null; customerName: string; currency: string; erpProducts: Map<string, string>;
};

export type SendOk = { ok: true; orderId: string; orderNumber: string | null; total: number | null; alreadyDone: boolean; steps: string[]; link: string | null; exchange: StoredPayload | null };
export type SendFail = { ok: false; step: string; headline: string; fix: string; raw: string | null; status: number | null; exchange: StoredPayload | null };

export interface OrderSession {
  check(a: CheckInput): Promise<CheckOutcome[]>;
  /** `onCreated` is called the moment the ERP has made the order (or an earlier attempt's order was found again), before anything else is done. */
  send(a: SendInput, hooks: { onCreated: (erpId: string, erpNumber: string | null) => Promise<void> }): Promise<SendOk | SendFail>;
}

export type RefreshOutcome =
  | { kind: "ok"; throttled: boolean; header: string | null; documents: DocumentsResult | null; erpNumber: string | null }
  | { kind: "missing" }
  | { kind: "not_linked" }
  | { kind: "pending" }
  | { kind: "error"; message: string };

export type RefreshArgs = { withHeader: boolean; trigger: "manual" | "webhook" | "schedule"; userId?: string | null; skipThrottle?: boolean; deps?: OrderDeps };

export interface OrderConnector {
  readonly id: ConnectorId;
  /** The system in a sentence: "sent to Dynamics 365 Sales" in the change log. */
  readonly word: string;
  open(a: { admin: SupabaseClient; tenantId: string; tenant: TenantRow; deps?: OrderDeps }): Promise<SessionOpen>;
  customerErpId(admin: SupabaseClient, tenantId: string, accountId: string | null): Promise<string | null>;
  productErpIds(admin: SupabaseClient, tenantId: string, productIds: string[]): Promise<Map<string, string>>;
  /** Why this order cannot be sent to this ERP, known without calling it; null when nothing stops it. */
  sendBlocker(a: { admin: SupabaseClient; tenantId: string; order: OrderRow; lines: SalesOrderLine[] }): Promise<string | null>;
  refresh(admin: SupabaseClient, tenantId: string, orderId: string, args: RefreshArgs): Promise<RefreshOutcome>;
}

// ── Which ERP does this workspace's order go to ─────────────────────────────

/**
 * The connector for an order. An order that already has an ERP link belongs to the connector that holds the link. Otherwise the
 * workspace's connected ERP that can take orders: Dynamics 365 Sales (Dataverse) first, else SAP S/4HANA. When none is connected,
 * Dynamics is returned so the message says "No ERP is connected" in the one way it always has.
 */
export async function pickOrderConnector(admin: SupabaseClient, tenantId: string, orderId?: string): Promise<OrderConnector> {
  const { d365Connector } = await import("@/lib/connectors/d365/orderConnector");
  const { sapConnector } = await import("@/lib/connectors/sap_s4/orderConnector");
  const all: Record<ConnectorId, OrderConnector> = { dynamics365: d365Connector, sap_s4: sapConnector };
  if (orderId) {
    const { data } = await admin.from("connector_links").select("connector_id").eq("tenant_id", tenantId).eq("entity", "sales_orders").eq("object_id", orderId).limit(1);
    const id = (data as { connector_id?: string }[] | null)?.[0]?.connector_id;
    if (id === "dynamics365" || id === "sap_s4") return all[id];
  }
  const { data: rows } = await admin.from("tenant_connectors").select("connector_id, config").eq("tenant_id", tenantId).in("connector_id", ["dynamics365", "sap_s4"]);
  const have = new Map(((rows ?? []) as { connector_id: string; config: { product?: string; auth_mode?: string } | null }[]).map((r) => [r.connector_id, r.config]));
  if (have.get("dynamics365")?.product === "dataverse") return all.dynamics365;
  if (have.get("sap_s4")?.auth_mode) return all.sap_s4;
  return all.dynamics365;
}

/** Refresh one order from the ERP that holds it. The tenant filter is in the connector; a foreign order id is `missing`. */
export async function refreshOrderFromErp(admin: SupabaseClient, tenantId: string, orderId: string, args: RefreshArgs): Promise<RefreshOutcome> {
  const c = await pickOrderConnector(admin, tenantId, orderId);
  return c.refresh(admin, tenantId, orderId, args);
}
