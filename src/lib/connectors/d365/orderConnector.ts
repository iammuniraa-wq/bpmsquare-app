import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildExchangePayload, pickExchange, recordingHttp } from "@/lib/middleware/exchange";
import { sendDataverseSalesOrder, type DataverseOrderState } from "@/lib/middleware/erpOrder";
import { erpDeepLink } from "@/lib/middleware/links";
import { buildDataverseQuote, plainFailure, type QuoteForErp } from "@/lib/middleware/payload";
import { resolveDataversePricing } from "@/lib/middleware/pricing";
import { compareCredit, comparePrice, compareStock, type CheckOutcome, type ErpRead, type PriceLineInput, type StockLineInput } from "@/lib/salesOrders/erpChecks";
import { customerErpId, openErp, productErpIds } from "@/lib/salesOrders/erpContext";
import { orderNote, outLines } from "@/lib/salesOrders/erpPayload";
import type { OrderConnector, OrderSession, SendFail, SendInput, SendOk } from "@/lib/salesOrders/orderConnector";
import { outboundConfig } from "./catalog";
import { priceFacts, readCreditFacts, readPriceListId, readProductFacts, type ProductFacts } from "./checks";
import { refreshOrderDocuments } from "./orders";
import { CONNECTOR_ID } from "./server";
import type { D365Config } from "./types";
import type { ErpHttp } from "@/lib/middleware/erp";

// Dynamics 365 Sales (Dataverse) behind the Sales Order seam (salesOrders/orderConnector.ts). The logic is the one SO3 shipped, moved here
// unchanged so another ERP can sit next to it: the checks are GET only, the send is `sendDataverseSalesOrder` (idempotent through the
// BPMSquare marker in the order's description), and a failure is turned into the plain sentence the person reads.

function checkSession(http: ErpHttp, cfg: D365Config): Pick<OrderSession, "check"> {
  return {
    async check(a) {
      const { order, lines, customerId, erpProducts } = a;
      const currency = order.currency || "USD";
      const productIds = lines.map((l) => l.product_id).filter((x): x is string => !!x);

      const credit = compareCredit({
        customerLinked: customerId !== null,
        read: customerId ? await readCreditFacts(http, customerId) : null,
        orderTotal: Number(order.total), currency,
      });

      // Price and stock share one read per product.
      const priceListId = await readPriceListId(http, customerId, cfg.price_list_id ?? null);
      const facts = new Map<string, ErpRead<ProductFacts>>();
      let down: string | null = null;
      for (const pid of new Set(productIds)) {
        const ext = erpProducts.get(pid);
        if (!ext) continue;
        if (down) { facts.set(pid, { ok: false, reason: down }); continue; }
        const r = await readProductFacts(http, ext, priceListId);
        if (!r.ok && !/no longer exists/.test(r.reason)) down = r.reason;
        facts.set(pid, r);
      }
      const factsOf = (pid: string | null): ErpRead<ProductFacts> | null => (pid ? facts.get(pid) ?? null : null);

      const priceLines: PriceLineInput[] = lines.map((l) => {
        const f = factsOf(l.product_id);
        return {
          lineId: l.id, lineNo: l.line_no, description: l.description, unitPrice: Number(l.unit_price),
          hasProduct: !!l.product_id, productLinked: !!l.product_id && erpProducts.has(l.product_id),
          erp: f ? (f.ok ? { ok: true, value: priceFacts(f.value) } : f) : null,
        };
      });
      const stockLines: StockLineInput[] = lines.map((l) => {
        const f = factsOf(l.product_id);
        return {
          lineId: l.id, lineNo: l.line_no, description: l.description, qty: Number(l.qty), uom: l.uom,
          hasProduct: !!l.product_id, productLinked: !!l.product_id && erpProducts.has(l.product_id),
          erp: f ? (f.ok ? { ok: true, value: { onHand: f.value.onHand } } : f) : null,
        };
      });
      const out: CheckOutcome[] = [credit, comparePrice({ lines: priceLines, currency }), compareStock({ lines: stockLines })];
      return out;
    },
  };
}

function sendSession(http: ErpHttp, cfg: D365Config): Pick<OrderSession, "send"> {
  return {
    async send(a: SendInput, hooks): Promise<SendOk | SendFail> {
      const { order, lines, customerId, customerName, currency } = a;
      const rec = recordingHttp(http);
      const h = rec.http;
      const exchange = () => buildExchangePayload(pickExchange(rec.calls));
      const fail = (step: string, headline: string, fix: string, raw: string | null, status: number | null): SendFail => ({ ok: false, step, headline, fix, raw, status, exchange: exchange() });

      // Build the document. Price list and currency are decided per send, exactly as for a quote.
      let body: Record<string, unknown>;
      try {
        const pricing = await resolveDataversePricing(h, {
          accountExternalId: customerId, fallbackPriceListId: cfg.price_list_id ?? null, fallbackCurrencyId: cfg.currency_id ?? null, isoCode: currency, cache: {},
        });
        const out = outboundConfig(cfg);
        const qfe: QuoteForErp = {
          ref: order.ref, doc_id: order.id, title: customerName || order.ref, customer_name: customerName || order.ref, account_external_id: customerId,
          description: orderNote(order), lines: outLines(lines), subtotal: Number(order.subtotal), total: Number(order.total), valid_until: null, outcome: "awarded", currency,
        };
        const built = buildDataverseQuote(
          qfe, { price_list_id: pricing.priceListId, currency_id: pricing.currencyId },
          { quote: out.sales_order.field_map, quote_line: out.sales_order_line.field_map }, "sales_order",
        );
        if (built.problems.length > 0) {
          const p = built.problems[0];
          return fail("prepare", p.message, p.fix, null, null);
        }
        body = built.body;
      } catch (e) {
        const x = e as { status?: number; message?: string };
        const f = plainFailure(x, undefined, "order");
        return fail("prepare", f.headline, f.fix, x.message ?? null, x.status ?? null);
      }

      let result: Awaited<ReturnType<typeof sendDataverseSalesOrder>>;
      try {
        result = await sendDataverseSalesOrder(h, {
          ref: order.ref, docId: order.id, existingId: null, create: body,
          onCreated: async (s: DataverseOrderState) => { await hooks.onCreated(s.orderId, s.orderNumber); },
        });
      } catch (e) {
        const x = e as { status?: number; message?: string; step?: string };
        const f = plainFailure(x, x.step, "order");
        return fail(x.step ?? "create", f.headline, f.fix, x.message ?? null, x.status ?? null);
      }
      return {
        ok: true, orderId: result.orderId, orderNumber: result.orderNumber, total: result.total, alreadyDone: result.alreadyDone, steps: result.steps,
        link: erpDeepLink(cfg, "salesorder", result.orderId), exchange: exchange(),
      };
    },
  };
}

export const d365Connector: OrderConnector = {
  id: "dynamics365",
  word: "Dynamics 365 Sales",

  async open({ admin, tenantId, tenant, deps }) {
    const erp = await openErp(admin, tenantId, tenant, deps?.http);
    if (!erp.ok) return erp;
    return { ok: true, middleware: erp.middleware, session: { ...checkSession(erp.http, erp.cfg), ...sendSession(erp.http, erp.cfg) } };
  },

  customerErpId: (admin: SupabaseClient, tenantId, accountId) => customerErpId(admin, tenantId, accountId, CONNECTOR_ID),
  productErpIds: (admin: SupabaseClient, tenantId, ids) => productErpIds(admin, tenantId, ids, CONNECTOR_ID),

  // Free-text lines go as write-in lines and the organisation is the app user's own: nothing is known to stop the order before the call.
  async sendBlocker() { return null; },

  refresh: (admin, tenantId, orderId, args) => refreshOrderDocuments(admin, tenantId, orderId, {
    withHeader: args.withHeader, trigger: args.trigger, userId: args.userId, skipThrottle: args.skipThrottle,
  }),
};
