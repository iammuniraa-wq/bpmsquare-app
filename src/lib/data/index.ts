// Data-access layer. The UI calls only these functions, never the store
// directly — so swapping seed fixtures for Supabase queries later touches
// only this file. (isSupabaseConfigured() gate added when the project exists.)

import * as seed from "./seed";
import type { Account, Asset, Contact, Quote, QuoteLine, ServiceCase, CaseStatus, WorkOrder, Technician, TechnicianLeave, VisitLog, VisitStatus, PricingItem, TextFragment } from "@/lib/types";

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
  lines: QuoteLine[];
};

export async function listQuotes(): Promise<QuoteSummary[]> {
  const accountById  = new Map(seed.accounts.map((a) => [a.id, a]));
  const linesByQuote = new Map<string, QuoteLine[]>();
  seed.quoteLines.forEach((l) => {
    const arr = linesByQuote.get(l.quote_id) ?? [];
    arr.push(l);
    linesByQuote.set(l.quote_id, arr);
  });
  return seed.quotes
    .slice()
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
    .map((quote) => ({
      quote,
      account:   accountById.get(quote.account_id)!,
      lines:     linesByQuote.get(quote.id) ?? [],
      lineCount: (linesByQuote.get(quote.id) ?? []).length,
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

  const visitLogs = seed.visitLogs.filter((v) => v.work_order_id === id);

  return { workOrder: wo, account, asset, technician, serviceCase, quote, contract, loanerAsset, visitLogs };
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

// ── Technicians ───────────────────────────────────────────────────────────────

export const TECH_STATUS_LABEL: Record<Technician["status"], string> = {
  active:   "Active",
  on_leave: "On Leave",
  inactive: "Inactive",
};

export const LEAVE_REASON_LABEL: Record<TechnicianLeave["reason"], string> = {
  vacation: "Vacation",
  sick:     "Sick leave",
  training: "Training",
  other:    "Other",
};

export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  planned:     "Planned",
  in_progress: "In Progress",
  completed:   "Completed",
  cancelled:   "Cancelled",
};

export type TechnicianCard = {
  technician: Technician;
  todayWorkOrders: typeof seed.workOrders;
  currentLeave: TechnicianLeave | null;
  monthStats: { visits: number; kmTravelled: number; visitedAccounts: number };
};

function isOnLeaveOn(tech_id: string, date: string): TechnicianLeave | null {
  return seed.technicianLeaves.find(
    (l) => l.technician_id === tech_id && l.from_date <= date && l.to_date >= date
  ) ?? null;
}

export async function listTechnicians(): Promise<TechnicianCard[]> {
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7); // "YYYY-MM"

  return seed.technicians.map((tech) => {
    const todayWorkOrders = seed.workOrders.filter(
      (wo) => wo.technician_id === tech.id && wo.scheduled_for === today
    );
    const currentLeave = isOnLeaveOn(tech.id, today);
    const monthLogs = seed.visitLogs.filter(
      (v) => v.technician_id === tech.id && v.visit_date.startsWith(thisMonth) && v.status === "completed"
    );
    return {
      technician: tech,
      todayWorkOrders,
      currentLeave,
      monthStats: {
        visits:          monthLogs.length,
        kmTravelled:     monthLogs.reduce((s, v) => s + (v.travel_distance_km ?? 0) * 2, 0),
        visitedAccounts: new Set(monthLogs.map((v) => v.account_id)).size,
      },
    };
  });
}

export type CalendarDay = {
  date: string;        // YYYY-MM-DD
  isLeave: boolean;
  leaveReason: LeaveReason | null;
  workOrders: typeof seed.workOrders;
  visitLogs: VisitLog[];
  slotsFree: number;
  slotsTotal: number;
};

import type { LeaveReason } from "@/lib/types";

export async function getTechnicianDetail(techId: string, yearMonth: string) {
  const tech = seed.technicians.find((t) => t.id === techId);
  if (!tech) return null;

  const [year, month] = yearMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();

  const leaves = seed.technicianLeaves.filter((l) => l.technician_id === techId);
  const allWOs = seed.workOrders.filter((wo) => wo.technician_id === techId);
  const allVisits = seed.visitLogs.filter((v) => v.technician_id === techId);

  const calendarDays: CalendarDay[] = Array.from({ length: daysInMonth }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    const date = `${yearMonth}-${day}`;
    const leave = leaves.find((l) => l.from_date <= date && l.to_date >= date) ?? null;
    const dayWOs = allWOs.filter((wo) => wo.scheduled_for === date);
    const dayVisits = allVisits.filter((v) => v.visit_date === date);
    const scheduledCount = dayWOs.length + dayVisits.filter((v) => !dayWOs.some((w) => w.id === v.work_order_id)).length;
    return {
      date,
      isLeave: leave !== null,
      leaveReason: leave?.reason ?? null,
      workOrders: dayWOs,
      visitLogs: dayVisits,
      slotsFree: Math.max(0, tech.max_visits_per_day - scheduledCount),
      slotsTotal: tech.max_visits_per_day,
    };
  });

  const accountById = new Map(seed.accounts.map((a) => [a.id, a]));
  const woById      = new Map(seed.workOrders.map((w) => [w.id, w]));

  const recentVisits = allVisits
    .slice()
    .sort((a, b) => b.visit_date.localeCompare(a.visit_date))
    .slice(0, 10)
    .map((v) => ({
      visitLog: v,
      account:   accountById.get(v.account_id) ?? null,
      workOrder: woById.get(v.work_order_id) ?? null,
    }));

  const upcomingWOs = allWOs
    .filter((wo) => {
      const sf = wo.scheduled_for ?? "";
      return sf >= yearMonth + "-01" && (wo.status === "scheduled" || wo.status === "in_progress");
    })
    .map((wo) => ({ workOrder: wo, account: accountById.get(wo.account_id) ?? null }));

  const monthStats = (() => {
    const monthVisits = allVisits.filter((v) => v.visit_date.startsWith(yearMonth));
    const completed   = monthVisits.filter((v) => v.status === "completed");
    return {
      totalVisits:   monthVisits.length,
      completed:     completed.length,
      kmTravelled:   monthVisits.reduce((s, v) => s + (v.travel_distance_km ?? 0) * 2, 0),
      avgWorkMinutes: completed.length === 0 ? 0 : Math.round(
        completed.reduce((s, v) => {
          if (!v.work_start_time || !v.work_end_time) return s;
          const [sh, sm] = v.work_start_time.split(":").map(Number);
          const [eh, em] = v.work_end_time.split(":").map(Number);
          const bk = (v.break_start_time && v.break_end_time)
            ? (() => {
                const [bsh, bsm] = v.break_start_time!.split(":").map(Number);
                const [beh, bem] = v.break_end_time!.split(":").map(Number);
                return (beh * 60 + bem) - (bsh * 60 + bsm);
              })()
            : 0;
          return s + ((eh * 60 + em) - (sh * 60 + sm) - bk);
        }, 0) / completed.length
      ),
    };
  })();

  return { technician: tech, calendarDays, leaves, recentVisits, upcomingWOs, monthStats };
}

// ── Pricing & Fragments ───────────────────────────────────────────────────────

export const PRICING_CATEGORY_LABEL: Record<PricingItem["category"], string> = {
  labour:    "Labour",
  material:  "Materials",
  testing:   "Testing & Certification",
  transport: "Transport & Logistics",
};

export async function listPricingItems(): Promise<PricingItem[]> {
  return seed.pricingItems;
}

export async function listTextFragments(): Promise<TextFragment[]> {
  return seed.textFragments;
}

export async function getQuoteFormData() {
  return {
    accounts:      seed.accounts,
    contacts:      seed.contacts,
    assets:        seed.assets.filter((a) => a.account_id !== null), // customer-owned only
    pricingItems:  seed.pricingItems,
    textFragments: seed.textFragments,
  };
}
