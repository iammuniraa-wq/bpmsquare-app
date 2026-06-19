// Data-access layer. The UI calls only these functions, never the store
// directly — so swapping seed fixtures for Supabase queries later touches
// only this file. (isSupabaseConfigured() gate added when the project exists.)

import * as seed from "./seed";
import type { Account, Quote } from "@/lib/types";

export type AccountSummary = {
  account: Account;
  // The OEM that referred this account, resolved for display.
  referredBy: Account | null;
  counts: {
    contacts: number;
    assets: number;
    contracts: number;
    quotes: number;
    workOrders: number;
    invoices: number;
  };
};

const byAccount = <T extends { account_id: string }>(rows: T[], id: string) =>
  rows.filter((r) => r.account_id === id);

export async function listAccounts(): Promise<AccountSummary[]> {
  return seed.accounts.map((account) => summarize(account));
}

export async function getAccountHub(id: string) {
  const account = seed.accounts.find((a) => a.id === id);
  if (!account) return null;

  const technicianById = new Map(seed.technicians.map((t) => [t.id, t]));
  const assetById = new Map(seed.assets.map((a) => [a.id, a]));

  return {
    account,
    referredBy:
      seed.accounts.find((a) => a.id === account.referred_by_account_id) ?? null,
    contacts: byAccount(seed.contacts, id),
    sites: byAccount(seed.sites, id),
    assets: byAccount(seed.assets, id),
    contracts: byAccount(seed.contracts, id),
    leads: byAccount(seed.leads, id),
    quotes: byAccount(seed.quotes, id),
    workOrders: byAccount(seed.workOrders, id).map((wo) => ({
      ...wo,
      asset: wo.asset_id ? assetById.get(wo.asset_id) ?? null : null,
      technician: wo.technician_id
        ? technicianById.get(wo.technician_id) ?? null
        : null,
    })),
    invoices: byAccount(seed.invoices, id),
    activities: byAccount(seed.activities, id).sort(
      (a, b) => +new Date(b.at) - +new Date(a.at)
    ),
  };
}

function summarize(account: Account): AccountSummary {
  const id = account.id;
  return {
    account,
    referredBy:
      seed.accounts.find((a) => a.id === account.referred_by_account_id) ?? null,
    counts: {
      contacts: byAccount(seed.contacts, id).length,
      assets: byAccount(seed.assets, id).length,
      contracts: byAccount(seed.contracts, id).length,
      quotes: byAccount(seed.quotes, id).length,
      workOrders: byAccount(seed.workOrders, id).length,
      invoices: byAccount(seed.invoices, id).length,
    },
  };
}

export const ACCOUNT_TYPE_LABEL: Record<Account["type"], string> = {
  oem: "OEM / Vendor",
  direct: "Direct customer",
  end_customer: "End-customer (under OEM)",
};

export type QuoteSummary = {
  quote: Quote;
  account: Account;
  lineCount: number;
};

export async function listQuotes(): Promise<QuoteSummary[]> {
  const accountById = new Map(seed.accounts.map((a) => [a.id, a]));
  return seed.quotes
    .slice()
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    .map((quote) => ({
      quote,
      account: accountById.get(quote.account_id)!,
      lineCount: seed.quoteLines.filter((l) => l.quote_id === quote.id).length,
    }));
}

export async function getQuote(id: string) {
  const quote = seed.quotes.find((q) => q.id === id);
  if (!quote) return null;

  const account = seed.accounts.find((a) => a.id === quote.account_id) ?? null;
  const contact = seed.contacts.find((c) => c.account_id === quote.account_id) ?? null;
  const lines = seed.quoteLines.filter((l) => l.quote_id === id);
  const workOrders = seed.workOrders.filter(
    (wo) => wo.authorized_by.kind === "quote" && wo.authorized_by.id === id
  );

  return { quote, account, contact, lines, workOrders };
}

export const QUOTE_STATUS_LABEL: Record<Quote["status"], string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
};
