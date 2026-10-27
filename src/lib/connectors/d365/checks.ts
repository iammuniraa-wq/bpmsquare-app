import type { ErpHttp } from "@/lib/middleware/erp";
import { customerPriceList } from "@/lib/middleware/pricing";
import type { CreditFacts, ErpRead, PriceFacts } from "@/lib/salesOrders/erpChecks";

// Check with ERP, the Dataverse reads (SO3, docs/design/sales-order.md). READ-ONLY: every call here is a GET; nothing is
// written to the ERP and nothing is created as a side effect. Each function returns the figures the pure comparisons in
// src/lib/salesOrders/erpChecks.ts need, or the reason they could not be read -- it never throws for an ERP answer.
//
// The standard Dataverse (Dynamics 365 Sales) names used, none of which has been run against a live organisation yet:
//   accounts(id)            creditonhold (boolean), creditlimit (money)
//   salesorders             _customerid_value, statecode (0 Active, 1 Submitted), totalamount -- the customer's open orders
//   productpricelevels      _pricelevelid_value, _productid_value, amount -- a product's price in a price list
//   products(id)            price (the product's list price), quantityonhand
// A field an organisation does not expose comes back missing, and the comparison says so instead of failing.

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The open-orders read is one page this long; a customer with more is reported as "at least". */
export const OPEN_ORDERS_CAP = 200;

const asNumber = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** A short, plain reason for a failed read. A 404 is "no longer in the ERP"; anything else carries the ERP's own words, trimmed. */
export function readFailure(e: unknown): string {
  const x = e as { status?: number; message?: string };
  if (x.status === 404) return "it no longer exists in the ERP";
  if (x.status === 401 || x.status === 403) return "the ERP refused the connection (check the app user's access)";
  const msg = (x.message ?? "the ERP did not answer").replace(/\s+/g, " ").trim();
  return msg.length > 160 ? `${msg.slice(0, 157)}...` : msg;
}

/** The customer's credit position: on hold, the limit, and what they already have on open orders. */
export async function readCreditFacts(http: ErpHttp, accountId: string): Promise<ErpRead<CreditFacts>> {
  if (!GUID.test(accountId)) return { ok: false, reason: "the customer's ERP id is not a record id" };
  let row: Record<string, unknown> | null;
  try {
    row = (await http.get(`accounts(${accountId})`, { $select: "creditonhold,creditlimit" })) as Record<string, unknown> | null;
  } catch (e) {
    return { ok: false, reason: readFailure(e) };
  }
  const hold = row && "creditonhold" in row ? (typeof row.creditonhold === "boolean" ? row.creditonhold : null) : undefined;
  const limit = row && "creditlimit" in row ? asNumber(row.creditlimit) : undefined;

  let open = 0;
  let capped = false;
  // Only a customer with a limit has an exposure worth adding up; saves a call for everyone else.
  if (typeof limit === "number" && limit > 0) {
    try {
      const page = (await http.get("salesorders", {
        $select: "totalamount", $filter: `_customerid_value eq ${accountId} and (statecode eq 0 or statecode eq 1)`, $top: String(OPEN_ORDERS_CAP),
      })) as { value?: Record<string, unknown>[] } | null;
      const rows = page?.value ?? [];
      for (const r of rows) open += asNumber(r.totalamount) ?? 0;
      capped = rows.length >= OPEN_ORDERS_CAP;
    } catch (e) {
      return { ok: false, reason: `the customer's open orders could not be read (${readFailure(e)})` };
    }
  }
  return { ok: true, value: { creditOnHold: hold, creditLimit: limit, openOrdersTotal: open, openOrdersCapped: capped } };
}

/** The price list a customer's prices come from: their own, else the connection's fallback. */
export async function readPriceListId(http: ErpHttp, accountId: string | null, fallback: string | null): Promise<string | null> {
  if (accountId && GUID.test(accountId)) {
    try {
      const own = await customerPriceList(http, accountId);
      if (own) return own;
    } catch {
      // The customer's list could not be read: the fallback is used, and the price check reads each product's own price anyway.
    }
  }
  return fallback && GUID.test(fallback) ? fallback : null;
}

export type ProductFacts = {
  /** The product's price in the price list, when the list holds one. */
  listAmount: number | null;
  /** The product's own list price. */
  price: number | null;
  /** Quantity on hand; null when the ERP holds none. */
  onHand: number | null;
};

/** One product's price and stock. Two small GETs; the price-list item is skipped when there is no price list. */
export async function readProductFacts(http: ErpHttp, productId: string, priceListId: string | null): Promise<ErpRead<ProductFacts>> {
  if (!GUID.test(productId)) return { ok: false, reason: "the product's ERP id is not a record id" };
  let row: Record<string, unknown> | null;
  try {
    row = (await http.get(`products(${productId})`, { $select: "price,quantityonhand" })) as Record<string, unknown> | null;
  } catch (e) {
    return { ok: false, reason: readFailure(e) };
  }
  let listAmount: number | null = null;
  if (priceListId) {
    try {
      const page = (await http.get("productpricelevels", {
        $select: "amount", $filter: `_pricelevelid_value eq ${priceListId} and _productid_value eq ${productId}`, $top: "1",
      })) as { value?: Record<string, unknown>[] } | null;
      listAmount = asNumber(page?.value?.[0]?.amount);
    } catch {
      // The list item is optional: the product's own price still answers the check.
    }
  }
  return { ok: true, value: { listAmount, price: asNumber(row?.price), onHand: asNumber(row?.quantityonhand) } };
}

/** What the price check compares with: the customer's price list entry, else the product's own price. */
export function priceFacts(f: ProductFacts): PriceFacts {
  return f.listAmount !== null ? { price: f.listAmount, source: "price_list" } : { price: f.price, source: "product" };
}
