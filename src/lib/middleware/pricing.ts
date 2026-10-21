import type { ErpHttp } from "./erp";
import { parseCurrencies } from "./health";

// Price list and currency are decided PER SEND, not kept as settings (spec section 9D).
//  - Price list: the customer's own Dynamics price list, read live from the linked account
//    (`accounts(<id>)?$select=_defaultpricelevelid_value`, always current, no sync needed). Only when the
//    customer has none does the connection's fallback price list apply.
//  - Currency: the BPMSquare quote's currency matched by ISO code to a Dynamics currency, else the Dynamics
//    base currency, else (last resort) the currency an older setup had stored.
// Anything that cannot be decided is left null: the builder then reports it with a plain fix and nothing is sent.

/** Looked up once per run (a Restart of many quotes, one preview): the currency list and the base currency do not change between sends. */
export type RunCache = { currencies?: Promise<Map<string, string>>; baseCurrency?: Promise<string | null> };

export type DataversePricing = {
  priceListId: string | null;
  currencyId: string | null;
  priceListSource: "customer" | "fallback" | null;
  currencySource: "match" | "base" | "stored" | null;
};

/** The customer's own price list, or null when it has none (or is no longer in Dynamics). Other errors are thrown. */
export async function customerPriceList(http: ErpHttp, accountId: string): Promise<string | null> {
  try {
    const row = (await http.get(`accounts(${accountId})`, { $select: "_defaultpricelevelid_value" })) as Record<string, unknown> | null;
    const v = row?._defaultpricelevelid_value;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

async function currencyByCode(http: ErpHttp, cache: RunCache): Promise<Map<string, string>> {
  cache.currencies ??= (async () => {
    const map = new Map<string, string>();
    try {
      const json = await http.get("transactioncurrencies", { $select: "currencyname,isocurrencycode,transactioncurrencyid,statecode", $filter: "statecode eq 0" });
      for (const c of parseCurrencies(json)) if (c.code) map.set(c.code.toUpperCase(), c.id);
    } catch {
      // Unreadable: the base currency is tried next.
    }
    return map;
  })();
  return cache.currencies;
}

async function baseCurrency(http: ErpHttp, cache: RunCache): Promise<string | null> {
  cache.baseCurrency ??= (async () => {
    try {
      const json = (await http.get("organizations", { $select: "_basecurrencyid_value", $top: "1" })) as { value?: Record<string, unknown>[] } | null;
      const v = json?.value?.[0]?._basecurrencyid_value;
      return typeof v === "string" && v ? v : null;
    } catch {
      return null;
    }
  })();
  return cache.baseCurrency;
}

export async function resolveDataversePricing(
  http: ErpHttp,
  a: { accountExternalId: string | null; fallbackPriceListId: string | null; fallbackCurrencyId: string | null; isoCode: string; cache: RunCache },
): Promise<DataversePricing> {
  let priceListId: string | null = null;
  let priceListSource: DataversePricing["priceListSource"] = null;
  if (a.accountExternalId) {
    const own = await customerPriceList(http, a.accountExternalId);
    if (own) { priceListId = own; priceListSource = "customer"; }
  }
  if (!priceListId && a.fallbackPriceListId) { priceListId = a.fallbackPriceListId; priceListSource = "fallback"; }

  let currencyId: string | null = null;
  let currencySource: DataversePricing["currencySource"] = null;
  const byCode = await currencyByCode(http, a.cache);
  const matched = byCode.get(a.isoCode.toUpperCase());
  if (matched) { currencyId = matched; currencySource = "match"; }
  if (!currencyId) {
    const base = await baseCurrency(http, a.cache);
    if (base) { currencyId = base; currencySource = "base"; }
  }
  if (!currencyId && a.fallbackCurrencyId) { currencyId = a.fallbackCurrencyId; currencySource = "stored"; }
  return { priceListId, currencyId, priceListSource, currencySource };
}
