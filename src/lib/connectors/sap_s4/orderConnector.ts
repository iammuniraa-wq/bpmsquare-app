import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildExchangePayload } from "@/lib/middleware/exchange";
import { parseSalesArea, resolveErpOrg } from "@/lib/middleware/erpOrg";
import { odataString } from "@/lib/connectors/d365/mapping";
import {
  compareCredit, comparePrice, compareStock, type CheckOutcome, type PriceLineInput, type StockLineInput,
} from "@/lib/salesOrders/erpChecks";
import { customerErpId, productErpIds } from "@/lib/salesOrders/erpContext";
import type { OrderConnector, OrderSession, SendFail, SendInput, SendOk, CheckInput } from "@/lib/salesOrders/orderConnector";
import type { OrderRow } from "@/lib/salesOrders/server";
import type { SalesOrderLine } from "@/lib/salesOrders/types";
import { SAP_ORDER_PRESET } from "./catalog";
import {
  MARKER_CARRIERS, buildCreatePayload, lineBlocker, buildSimulationPayload, creditFromSimulation, readSimulation, sapItemNo,
  type SalesAreaParts, type SapOrderLine,
} from "./orderMap";
import { openSapSession, refreshSapOrder, type SapSession } from "./orders";
import { loadSap } from "./server";
import { canWrite, missingProps, refusalFor } from "./serviceMeta";
import { SAP_CONNECTOR_ID, SAP_NAME, SAP_ORDER_SERVICES } from "./types";

// SAP S/4HANA behind the Sales Order seam (salesOrders/orderConnector.ts), SO4b.
//
//   Check with ERP  -> POST A_SalesOrderSimulation (API_SALES_ORDER_SIMULATION_SRV). SAP simulates the order and saves nothing: net price
//                      per item, the quantity ATP confirms per schedule line, and the document's credit status. The three results are
//                      the same Credit / Price / Stock rows Dynamics gives.
//   Send to ERP     -> POST A_SalesOrder (API_SALES_ORDER_SRV) with its items as a deep insert, after fetching SAP's CSRF token. The sales
//                      area comes from the Mapping tab (resolveErpOrg), the customer and every material from this workspace's own links.
//
// Nothing here guesses: a property the connected system does not list makes the step refuse with its name (serviceMeta.ts), a line with no
// material is refused by name, and a customer whose coverage has no sales area mapped gets that sentence on every row that needs it.

export const NO_SALES_AREA = "No sales area is mapped for this customer's coverage.";

type AreaResult = { ok: true; parts: SalesAreaParts } | { ok: false; reason: string };

async function salesAreaOf(admin: SupabaseClient, tenantId: string, order: Pick<OrderRow, "account_id" | "type_id">): Promise<AreaResult> {
  const r = await resolveErpOrg(admin, tenantId, { connectorId: SAP_CONNECTOR_ID, kind: "sales_area", accountId: order.account_id, orderTypeId: order.type_id });
  if (!r.ok) return { ok: false, reason: NO_SALES_AREA };
  const parts = parseSalesArea(r.code);
  if (!parts) return { ok: false, reason: `The mapped sales area "${r.code.slice(0, 40)}" is not a valid code. Use ORG/CHANNEL/DIVISION, for example 1010/10/00.` };
  return { ok: true, parts };
}

const netUnit = (l: SalesOrderLine): number => {
  const qty = Number(l.qty);
  return qty > 0 ? Number(l.line_total) / qty : Number(l.unit_price) * (1 - Number(l.discount_pct) / 100);
};

const sapOrderLines = (lines: SalesOrderLine[], erpProducts: Map<string, string>): { line: SalesOrderLine; item: SapOrderLine }[] =>
  [...lines].sort((a, b) => a.line_no - b.line_no).filter((l) => l.product_id && erpProducts.has(l.product_id) && Number(l.qty) > 0)
    .map((l, i) => ({ line: l, item: { item: sapItemNo(i), material: erpProducts.get(l.product_id as string) as string, qty: Number(l.qty) } }));

// ── Check ───────────────────────────────────────────────────────────────────

async function check(session: SapSession, a: CheckInput): Promise<CheckOutcome[]> {
  const { admin, tenantId, order, lines, customerId, erpProducts } = a;
  const currency = order.currency || "USD";
  const all = (status: CheckOutcome["status"], message: string): CheckOutcome[] => (["credit", "price", "stock"] as const).map((kind) => ({ kind, status, message, detail: null }));

  if (customerId === null) {
    const credit = compareCredit({ customerLinked: false, read: null, orderTotal: Number(order.total), currency });
    const msg = "This customer is not in the ERP yet, so SAP could not simulate the order.";
    return [credit, { kind: "price", status: "warning", message: msg, detail: null }, { kind: "stock", status: "warning", message: msg, detail: null }];
  }
  const area = await salesAreaOf(admin, tenantId, order);
  if (!area.ok) return all("warning", area.reason);

  const sim = sapOrderLines(lines, erpProducts);
  const priceLines = (erp: (i: number) => PriceLineInput["erp"]): PriceLineInput[] => lines.map((l) => {
    const idx = sim.findIndex((s) => s.line.id === l.id);
    return { lineId: l.id, lineNo: l.line_no, description: l.description, unitPrice: netUnit(l), hasProduct: !!l.product_id, productLinked: !!l.product_id && erpProducts.has(l.product_id), erp: idx >= 0 ? erp(idx) : null };
  });
  const stockLines = (erp: (i: number) => StockLineInput["erp"]): StockLineInput[] => lines.map((l) => {
    const idx = sim.findIndex((s) => s.line.id === l.id);
    return { lineId: l.id, lineNo: l.line_no, description: l.description, qty: Number(l.qty), uom: l.uom, hasProduct: !!l.product_id, productLinked: !!l.product_id && erpProducts.has(l.product_id), erp: idx >= 0 ? erp(idx) : null };
  });

  if (sim.length === 0) {
    return [
      creditFromSimulation(null),
      comparePrice({ lines: priceLines(() => null), currency }),
      compareStock({ lines: stockLines(() => null), figure: "confirmed" }),
    ];
  }

  const service = SAP_ORDER_SERVICES.simulation;
  const meta = await session.meta(service);
  const missing = missingProps(meta, service, [{ set: "A_SalesOrderSimulation", props: ["SalesOrderType", "SalesOrganization", "DistributionChannel", "OrganizationDivision", "SoldToParty"], navs: ["to_Item"] }]);
  if (missing.length) return all("not_run", refusalFor(missing, "Nothing was simulated."));

  let result: ReturnType<typeof readSimulation>;
  try {
    const client = await session.client(service);
    const payload = buildSimulationPayload({ area: area.parts, soldTo: customerId, currency: order.currency, requestedDate: order.requested_date, lines: sim.map((s) => s.item) });
    result = readSimulation(await client.create("A_SalesOrderSimulation", payload));
  } catch (e) {
    return all("not_run", `SAP could not simulate this order: ${(e as Error).message ?? "no answer"}`.slice(0, 400));
  }

  const byItem = new Map(result.items.map((i) => [i.item, i]));
  const itemOf = (idx: number) => byItem.get(sim[idx].item.item) ?? result.items[idx] ?? null;
  const price = comparePrice({
    currency,
    lines: priceLines((idx) => {
      const it = itemOf(idx);
      if (!it) return { ok: false, reason: "SAP returned no item for this line" };
      const per = it.net !== null && it.asked !== null && it.asked > 0 ? it.net / it.asked : null;
      return { ok: true, value: { price: per, source: "price_list" } };
    }),
  });
  const stock = compareStock({
    figure: "confirmed",
    lines: stockLines((idx) => {
      const it = itemOf(idx);
      if (!it) return { ok: false, reason: "SAP returned no item for this line" };
      return { ok: true, value: { onHand: it.confirmedQty } };
    }),
  });

  // What SAP can confirm per line is the Availability tab's ERP row; written to this tenant's own lines only.
  const at = new Date().toISOString();
  for (let idx = 0; idx < sim.length; idx++) {
    const it = itemOf(idx);
    if (!it || it.confirmedQty === null) continue;
    await admin.from("sales_order_lines").update({ confirmed_qty: it.confirmedQty, confirmed_date: it.confirmedDate, availability_source: "erp", availability_at: at })
      .eq("id", sim[idx].line.id).eq("order_id", order.id).eq("tenant_id", tenantId);
  }
  return [creditFromSimulation(result.creditStatus), price, stock];
}

// ── Send ────────────────────────────────────────────────────────────────────

function plainSapFailure(e: unknown): { headline: string; fix: string; status: number; raw: string } {
  const x = e as { status?: number; message?: string };
  const status = x.status ?? 0;
  const raw = (x.message ?? "SAP did not answer").slice(0, 600);
  if (status === 401) return { headline: "SAP refused the login.", fix: "Open Connections, check the Communication user and press Test.", status, raw };
  if (status === 403) return { headline: "The Communication user may not create sales orders.", fix: `Add the user to the Communication Arrangement that offers ${SAP_ORDER_SERVICES.orders}, then retry.`, status, raw };
  if (status === 400 || status === 422) return { headline: "SAP did not accept the order.", fix: "Open Details, fix what SAP names, then retry.", status, raw };
  return { headline: "SAP did not answer properly.", fix: "Retry in a few minutes. SAP is asked for the order first, so a retry never makes a twin.", status, raw };
}

/** Find the order this BPMSquare order already is in SAP, by the marker (our order ref in the writable header property, or the PO). */
async function findOrder(session: SapSession, a: { soldTo: string; ref: string; carrier: string | null; po: string; since: string }): Promise<{ number: string; total: number | null } | "ambiguous" | null> {
  const client = await session.client(SAP_ORDER_SERVICES.orders);
  const marker = a.carrier ? `${a.carrier} eq ${odataString(a.ref.slice(0, 16))}` : `PurchaseOrderByCustomer eq ${odataString(a.po)}`;
  const filter = `SoldToParty eq ${odataString(a.soldTo)} and CreationDate ge datetime'${a.since}T00:00:00' and ${marker}`;
  const rows: Record<string, unknown>[] = [];
  for await (const r of client.list(SAP_ORDER_PRESET.entity_set, { filter, pageSize: 5, maxRows: 5 })) rows.push(r);
  if (rows.length === 0) return null;
  if (rows.length > 1) return "ambiguous";
  const n = rows[0].SalesOrder;
  const t = Number(rows[0].TotalNetAmount);
  return typeof n === "string" && n ? { number: n, total: Number.isFinite(t) ? t : null } : null;
}

const dayBefore = (): string => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

async function send(session: SapSession, a: SendInput, hooks: { onCreated: (erpId: string, erpNumber: string | null) => Promise<void> }): Promise<SendOk | SendFail> {
  const { admin, tenantId, order, lines, customerId, erpProducts } = a;
  const t0 = Date.now();
  let exchange: SendOk["exchange"] = null;
  const fail = (step: string, headline: string, fix: string, raw: string | null, status: number | null): SendFail => ({ ok: false, step, headline, fix, raw, status, exchange });

  if (!customerId) return fail("prepare", "This customer is not in SAP yet.", "Sync customers from SAP first.", null, null);
  const why = lineBlocker(lines, erpProducts);
  if (why) return fail("prepare", why, "Fix the line, then send again.", null, null);
  const area = await salesAreaOf(admin, tenantId, order);
  if (!area.ok) return fail("prepare", area.reason, "Add the sales area for this coverage on the Mapping tab, then send.", null, null);

  const service = SAP_ORDER_SERVICES.orders;
  const meta = await session.meta(service);
  const missing = missingProps(meta, service, [
    { set: "A_SalesOrderType", props: ["SalesOrderType", "SalesOrganization", "DistributionChannel", "OrganizationDivision", "SoldToParty", "PurchaseOrderByCustomer"], navs: ["to_Item"] },
    { set: "A_SalesOrderItemType", props: ["SalesOrderItem", "Material", "RequestedQuantity"] },
  ]);
  if (missing.length) return fail("prepare", refusalFor(missing), "Ask the SAP administrator which release this is, then retry.", null, null);
  const carrier = MARKER_CARRIERS.find((p) => canWrite(meta, "A_SalesOrderType", p)) ?? null;
  const po = (order.customer_po?.trim() || order.ref).slice(0, 35);
  const precise = carrier !== null || !order.customer_po?.trim();
  const sapLines = sapOrderLines(lines, erpProducts).map((s) => s.item);
  const body = buildCreatePayload({ area: area.parts, soldTo: customerId, currency: order.currency, requestedDate: order.requested_date, lines: sapLines, customerPo: order.customer_po, orderRef: order.ref, carrier });
  const since = dayBefore();
  const found = (n: { number: string; total: number | null }, how: string): SendOk => ({ ok: true, orderId: n.number, orderNumber: n.number, total: n.total, alreadyDone: true, steps: [how], link: null, exchange });

  // An earlier attempt may have made the order (a lost link, a timeout): look for it by its marker before creating another.
  try {
    if (precise) {
      const earlier = await findOrder(session, { soldTo: customerId, ref: order.ref, carrier, po, since });
      if (earlier === "ambiguous") return fail("find", "More than one SAP order matches this one.", "Open SAP and check for a duplicate before sending again.", null, null);
      if (earlier) { await hooks.onCreated(earlier.number, earlier.number); return found(earlier, "Found the order already in SAP."); }
    }
  } catch (e) {
    const f = plainSapFailure(e);
    return fail("find", f.headline, f.fix, f.raw, f.status);
  }

  let row: Record<string, unknown>;
  const request = { method: "POST", path: `/${SAP_ORDER_PRESET.entity_set}`, requestBody: body };
  try {
    const client = await session.client(service);
    row = await client.create(SAP_ORDER_PRESET.entity_set, body);
    exchange = buildExchangePayload({ ...request, status: 201, responseBody: row, durationMs: Date.now() - t0, failed: false });
  } catch (e) {
    const f = plainSapFailure(e);
    exchange = buildExchangePayload({ ...request, status: f.status || null, responseBody: { error: f.raw }, durationMs: Date.now() - t0, failed: true });
    // A create that timed out may still have been made: look for the order by its marker before calling it a failure.
    if (f.status === 0) {
      try {
        const late = await findOrder(session, { soldTo: customerId, ref: order.ref, carrier, po, since });
        if (late && late !== "ambiguous") { await hooks.onCreated(late.number, late.number); return { ...found(late, "Created the order with its items (SAP answered slowly)."), alreadyDone: false }; }
      } catch { /* fall through to the original failure */ }
    }
    return fail("create", f.headline, f.fix, f.raw, f.status);
  }

  const number = typeof row.SalesOrder === "string" && row.SalesOrder.trim() ? row.SalesOrder.trim() : null;
  if (!number) return fail("create", "SAP did not return the new order's number.", "Open SAP and check whether the order was made before sending again.", null, null);
  await hooks.onCreated(number, number);
  const total = Number(row.TotalNetAmount);
  return { ok: true, orderId: number, orderNumber: number, total: Number.isFinite(total) ? total : null, alreadyDone: false, steps: [`Created the order with ${sapLines.length} item${sapLines.length === 1 ? "" : "s"}.`], link: null, exchange };
}

// ── The connector ───────────────────────────────────────────────────────────

export const sapConnector: OrderConnector = {
  id: "sap_s4",
  word: SAP_NAME,

  async open({ admin, tenantId, tenant, deps }) {
    const loaded = await loadSap(admin, tenantId);
    if (!loaded) return { ok: false, kind: "no_connector", message: "No ERP is connected. Connect one under Settings > Integration middleware." };
    const session = openSapSession(loaded, deps?.sap);
    const s: OrderSession = { check: (a) => check(session, a), send: (a, hooks) => send(session, a, hooks) };
    return { ok: true, session: s, middleware: tenant.features?.integration_middleware === true };
  },

  customerErpId: (admin, tenantId, accountId) => customerErpId(admin, tenantId, accountId, SAP_CONNECTOR_ID),
  productErpIds: (admin, tenantId, ids) => productErpIds(admin, tenantId, ids, SAP_CONNECTOR_ID),

  async sendBlocker({ admin, tenantId, order, lines }) {
    const erp = await productErpIds(admin, tenantId, lines.map((l) => l.product_id).filter((x): x is string => !!x), SAP_CONNECTOR_ID);
    const why = lineBlocker(lines, erp);
    if (why) return why;
    const area = await salesAreaOf(admin, tenantId, order);
    return area.ok ? null : area.reason;
  },

  refresh: (admin, tenantId, orderId, args) => refreshSapOrder(admin, tenantId, orderId, {
    withHeader: args.withHeader, trigger: args.trigger, userId: args.userId, skipThrottle: args.skipThrottle, ...(args.deps?.sap ?? {}),
  }),
};
