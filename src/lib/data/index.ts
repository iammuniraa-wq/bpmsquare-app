// Data-access layer. The UI calls only these functions, never the store
// directly — so swapping seed fixtures for Supabase queries later touches
// only this file. (isSupabaseConfigured() gate added when the project exists.)

import * as seed from "./seed";
import type { Account, Asset, Contact, Quote, ServiceCase, CaseStatus, WorkOrder, Technician } from "@/lib/types";

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

const byAccount = <T extends { account_id: string | null }>(rows: T[], id: string) =>
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
    cases: byAccount(seed.serviceCases, id),
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
  prospect:     "Prospect",
  oem:          "OEM / Vendor",
  direct:       "Direct customer",
  end_customer: "End-customer (under OEM)",
};

// ── Contacts ──────────────────────────────────────────────────────────────────

export type ContactWithAccount = {
  contact: Contact;
  account: Account;
};

export async function listContacts(): Promise<ContactWithAccount[]> {
  const accountById = new Map(seed.accounts.map((a) => [a.id, a]));
  return seed.contacts.map((contact) => ({
    contact,
    account: accountById.get(contact.account_id)!,
  }));
}

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
  const site = seed.sites.find((s) => s.account_id === quote.account_id) ?? null;
  const lines = seed.quoteLines.filter((l) => l.quote_id === id);
  const revisions = seed.quoteRevisions
    .filter((r) => r.quote_id === id)
    .sort((a, b) => a.rev - b.rev);
  const workOrders = seed.workOrders.filter(
    (wo) => wo.authorized_by.kind === "quote" && wo.authorized_by.id === id
  );

  return { quote, account, contact, site, lines, revisions, workOrders };
}

export const QUOTE_STATUS_LABEL: Record<Quote["status"], string> = {
  draft: "Draft",
  sent: "Sent",
  approved: "Approved",
  rejected: "Rejected",
};

// ── Cases ────────────────────────────────────────────────────────────────────

export type CaseSummary = {
  serviceCase: ServiceCase;
  account: Account;
  technicianName: string | null;
};

export async function listCases(): Promise<CaseSummary[]> {
  const accountById = new Map(seed.accounts.map((a) => [a.id, a]));
  const techById = new Map(seed.technicians.map((t) => [t.id, t]));
  return seed.serviceCases
    .slice()
    .sort((a, b) => +new Date(b.intake_at) - +new Date(a.intake_at))
    .map((sc) => ({
      serviceCase: sc,
      account: accountById.get(sc.account_id)!,
      technicianName: sc.assigned_to ? (techById.get(sc.assigned_to)?.name ?? null) : null,
    }));
}

export async function getCase(id: string) {
  const serviceCase = seed.serviceCases.find((c) => c.id === id);
  if (!serviceCase) return null;

  const account = seed.accounts.find((a) => a.id === serviceCase.account_id) ?? null;
  const contact = seed.contacts.find((c) => c.account_id === serviceCase.account_id) ?? null;
  const asset = serviceCase.asset_id
    ? seed.assets.find((a) => a.id === serviceCase.asset_id) ?? null
    : null;
  const technician = serviceCase.assigned_to
    ? seed.technicians.find((t) => t.id === serviceCase.assigned_to) ?? null
    : null;
  const contract = serviceCase.contract_id
    ? seed.contracts.find((c) => c.id === serviceCase.contract_id) ?? null
    : null;
  const quote = serviceCase.quote_id
    ? seed.quotes.find((q) => q.id === serviceCase.quote_id) ?? null
    : null;
  const photos = seed.casePhotos
    .filter((p) => p.case_id === id)
    .sort((a, b) => +new Date(a.taken_at) - +new Date(b.taken_at));
  const inspectionReport = seed.inspectionReports.find((r) => r.case_id === id) ?? null;

  const loanerAsset = serviceCase.loaner_asset_id
    ? seed.assets.find((a) => a.id === serviceCase.loaner_asset_id) ?? null
    : null;

  const subCases = seed.serviceCases.filter(
    (c) => c.parent_case_id === id
  );

  return { serviceCase, account, contact, asset, technician, contract, quote, photos, inspectionReport, loanerAsset, subCases };
}

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  intake:          "Intake",
  inspection:      "Inspection",
  report_sent:     "Report sent",
  report_approved: "Report approved",
  quote_sent:      "Quote sent",
  quote_approved:  "Quote approved",
  in_repair:       "In repair",
  qa:              "QA",
  ready:           "Ready",
  closed:          "Closed",
  buyback:         "Buyback",
  scrapped:        "Scrapped",
};

export const CASE_TYPE_LABEL: Record<ServiceCase["type"], string> = {
  amc:    "AMC",
  adhoc:  "Adhoc",
  direct: "Direct",
};

// ── Dashboard ─────────────────────────────────────────────────────────────────

const OPEN_CASE_STATUSES: CaseStatus[] = [
  "intake","inspection","report_sent","report_approved",
  "quote_sent","quote_approved","in_repair","qa","ready",
];

export async function getDashboardSummary() {
  const accountById  = new Map(seed.accounts.map((a)    => [a.id, a]));
  const techById     = new Map(seed.technicians.map((t) => [t.id, t]));

  const kpis = {
    openCases:        seed.serviceCases.filter((sc) => OPEN_CASE_STATUSES.includes(sc.status)).length,
    inRepair:         seed.serviceCases.filter((sc) => sc.status === "in_repair").length,
    awaitingApproval: seed.serviceCases.filter((sc) => sc.status === "report_sent" || sc.status === "quote_sent").length,
    activeContracts:  seed.contracts.filter((c) => c.status === "active").length,
    openQuoteValue:   seed.quotes.filter((q) => q.status === "sent" || q.status === "approved").reduce((s, q) => s + q.total, 0),
    activeWorkOrders: seed.workOrders.filter((wo) => wo.status === "in_progress" || wo.status === "scheduled").length,
  };

  const attention = seed.serviceCases
    .filter((sc) => sc.status === "report_sent" || sc.status === "quote_sent")
    .map((sc) => ({ serviceCase: sc, account: accountById.get(sc.account_id) ?? null }));

  const workOrderRows = seed.workOrders
    .filter((wo) => wo.status === "in_progress" || wo.status === "scheduled")
    .map((wo) => ({
      workOrder: wo,
      account:   accountById.get(wo.account_id) ?? null,
      tech:      wo.technician_id ? (techById.get(wo.technician_id) ?? null) : null,
    }));

  const recentActivity = seed.activities
    .slice()
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
    .slice(0, 5)
    .map((act) => ({ activity: act, account: accountById.get(act.account_id) ?? null }));

  return { kpis, attention, workOrderRows, recentActivity };
}

// ── Work Orders ───────────────────────────────────────────────────────────────

export type WorkOrderRow = {
  workOrder: WorkOrder;
  account: Account;
  asset: Asset | null;
  technician: Technician | null;
  authRef: string;
  authKind: "quote" | "contract";
  serviceCase: ServiceCase | null;
};

export async function listWorkOrders(): Promise<WorkOrderRow[]> {
  const accountById    = new Map(seed.accounts.map((a)    => [a.id, a]));
  const assetById      = new Map(seed.assets.map((a)      => [a.id, a]));
  const techById       = new Map(seed.technicians.map((t) => [t.id, t]));
  const quoteById      = new Map(seed.quotes.map((q)      => [q.id, q]));
  const contractById   = new Map(seed.contracts.map((c)   => [c.id, c]));
  const caseById       = new Map(seed.serviceCases.map((c) => [c.id, c]));

  return seed.workOrders
    .slice()
    .sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""))
    .map((wo) => {
      const authRef =
        wo.authorized_by.kind === "quote"
          ? (quoteById.get(wo.authorized_by.id)?.ref ?? wo.authorized_by.id)
          : (contractById.get(wo.authorized_by.id)?.ref ?? wo.authorized_by.id);
      return {
        workOrder: wo,
        account:     accountById.get(wo.account_id)!,
        asset:       wo.asset_id ? (assetById.get(wo.asset_id) ?? null) : null,
        technician:  wo.technician_id ? (techById.get(wo.technician_id) ?? null) : null,
        authRef,
        authKind:    wo.authorized_by.kind,
        serviceCase: wo.case_id ? (caseById.get(wo.case_id) ?? null) : null,
      };
    });
}

export async function getWorkOrder(id: string) {
  const wo = seed.workOrders.find((w) => w.id === id);
  if (!wo) return null;

  const account    = seed.accounts.find((a)     => a.id === wo.account_id) ?? null;
  const asset      = wo.asset_id ? seed.assets.find((a) => a.id === wo.asset_id) ?? null : null;
  const technician = wo.technician_id ? seed.technicians.find((t) => t.id === wo.technician_id) ?? null : null;
  const serviceCase = wo.case_id ? seed.serviceCases.find((c) => c.id === wo.case_id) ?? null : null;

  const quote    = wo.authorized_by.kind === "quote"    ? seed.quotes.find((q)    => q.id === wo.authorized_by.id) ?? null : null;
  const contract = wo.authorized_by.kind === "contract" ? seed.contracts.find((c) => c.id === wo.authorized_by.id) ?? null : null;

  const loanerAsset = serviceCase?.loaner_asset_id
    ? seed.assets.find((a) => a.id === serviceCase.loaner_asset_id) ?? null
    : null;

  return { workOrder: wo, account, asset, technician, serviceCase, quote, contract, loanerAsset };
}

// ── Assets ────────────────────────────────────────────────────────────────────

export type AssetRow = {
  asset: Asset;
  account: Account | null;
  openCaseCount: number;
  loanedToCase: ServiceCase | null;   // set when loaner is on_loan
  loanedToAccount: Account | null;
};

export async function listAssets(): Promise<{ customerAssets: AssetRow[]; loanerStock: AssetRow[] }> {
  const accountById = new Map(seed.accounts.map((a) => [a.id, a]));

  const activeCasesByAsset = new Map<string, number>();
  const loanCaseByAsset    = new Map<string, ServiceCase>();
  seed.serviceCases.forEach((sc) => {
    if (sc.asset_id && !["closed","buyback","scrapped"].includes(sc.status)) {
      activeCasesByAsset.set(sc.asset_id, (activeCasesByAsset.get(sc.asset_id) ?? 0) + 1);
    }
    if (sc.loaner_asset_id) {
      loanCaseByAsset.set(sc.loaner_asset_id, sc);
    }
  });

  const toRow = (asset: Asset): AssetRow => {
    const loanedCase    = asset.is_loaner ? (loanCaseByAsset.get(asset.id) ?? null) : null;
    const loanedAccount = loanedCase ? (accountById.get(loanedCase.account_id) ?? null) : null;
    return {
      asset,
      account:         asset.account_id ? (accountById.get(asset.account_id) ?? null) : null,
      openCaseCount:   activeCasesByAsset.get(asset.id) ?? 0,
      loanedToCase:    loanedCase,
      loanedToAccount: loanedAccount,
    };
  };

  return {
    customerAssets: seed.assets.filter((a) => !a.is_loaner).map(toRow),
    loanerStock:    seed.assets.filter((a) =>  a.is_loaner).map(toRow),
  };
}
