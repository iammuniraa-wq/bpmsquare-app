import "server-only";
import { unstable_cache } from "next/cache";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase-server";
import { decryptAccount, decryptContact } from "@/lib/encryption";
import type {
  Invoice, Lead, Account, Contact, Asset, ServiceCase, Quote, WorkOrder,
  Contract, Activity, QuoteLine, QuoteRevision, Technician, TechnicianLeave,
  VisitLog, PricingItem, TextFragment, CaseStatus, CasePhoto, InspectionReport,
} from "@/lib/types";

// ── Invoices ──────────────────────────────────────────────────────────────────

export type InvoiceRow = Invoice & { account_name: string };

export async function listInvoices(): Promise<InvoiceRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("invoices")
    .select("*, accounts(name)")
    .order("issued_at", { ascending: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    ...(r as Invoice),
    account_name: (Array.isArray(r.accounts) ? r.accounts[0]?.name : r.accounts?.name) ?? "—",
  }));
}

// ── Leads ─────────────────────────────────────────────────────────────────────

export type LeadRow = Lead & { account_name: string };

export async function listLeadsLive(): Promise<LeadRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("leads")
    .select("*, accounts(name)")
    .order("created_at", { ascending: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    ...(r as Lead),
    account_name: (Array.isArray(r.accounts) ? r.accounts[0]?.name : r.accounts?.name) ?? "—",
  }));
}

// ── Contracts / AMC ───────────────────────────────────────────────────────────

export type ContractRow = {
  id: string;
  ref: string;
  status: "active" | "expired" | "draft";
  start_date: string | null;
  end_date: string | null;
  value: number | null;
  account_name: string;
};

export async function listContracts(): Promise<ContractRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("contracts")
    .select("id, ref, status, start_date, end_date, value, accounts(name)")
    .order("end_date", { ascending: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: r.id as string,
    ref: r.ref as string,
    status: r.status as ContractRow["status"],
    start_date: r.start_date as string | null,
    end_date: r.end_date as string | null,
    value: r.value as number | null,
    account_name: (Array.isArray(r.accounts) ? r.accounts[0]?.name : r.accounts?.name) ?? "—",
  }));
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

export type DispatchRow = {
  id: string;
  ref: string;
  status: string;
  scheduled_for: string | null;
  description: string | null;
  account_name: string;
  technician_name: string | null;
  case_ref: string | null;
};

export async function listDispatch(): Promise<DispatchRow[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("work_orders")
    .select("id, ref, status, scheduled_for, description, accounts(name), technicians(name), service_cases(ref)")
    .in("status", ["scheduled", "in_progress"])
    .order("scheduled_for", { ascending: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: r.id as string,
    ref: r.ref as string,
    status: r.status as string,
    scheduled_for: r.scheduled_for as string | null,
    description: r.description as string | null,
    account_name: (Array.isArray(r.accounts) ? r.accounts[0]?.name : r.accounts?.name) ?? "—",
    technician_name: (Array.isArray(r.technicians) ? r.technicians[0]?.name : r.technicians?.name) ?? null,
    case_ref: (Array.isArray(r.service_cases) ? r.service_cases[0]?.ref : r.service_cases?.ref) ?? null,
  }));
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export type AccountSummary = {
  account: Account;
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

async function _listAccountsImpl(tenantId: string): Promise<AccountSummary[]> {
  const supabase = createAdminSupabase();

  const { data: accounts } = await supabase
    .from("accounts")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  if (!accounts || accounts.length === 0) return [];

  const ids = accounts.map((a: Account) => a.id);
  const referredByIds = accounts
    .map((a: Account) => a.referred_by_account_id)
    .filter((id: string | null): id is string => Boolean(id));

  const [
    { data: contacts },
    { data: assets },
    { data: contracts },
    { data: quotes },
    { data: workOrders },
    { data: invoices },
    { data: referredByAccounts },
  ] = await Promise.all([
    supabase.from("contacts").select("id, account_id").in("account_id", ids),
    supabase.from("assets").select("id, account_id").in("account_id", ids),
    supabase.from("contracts").select("id, account_id").in("account_id", ids),
    supabase.from("quotes").select("id, account_id").in("account_id", ids),
    supabase.from("work_orders").select("id, account_id").in("account_id", ids),
    supabase.from("invoices").select("id, account_id").in("account_id", ids),
    referredByIds.length > 0
      ? supabase.from("accounts").select("id, name").in("id", referredByIds)
      : Promise.resolve({ data: [] }),
  ]);

  const refMap = new Map((referredByAccounts ?? []).map((a) => [a.id, a as Account]));

  const count = (rows: { account_id: string }[] | null, id: string) =>
    (rows ?? []).filter((r) => r.account_id === id).length;

  return (accounts as Account[]).map((account) => ({
    account,
    referredBy: account.referred_by_account_id
      ? (refMap.get(account.referred_by_account_id) ?? null) as Account | null
      : null,
    counts: {
      contacts:   count(contacts   as { account_id: string }[], account.id),
      assets:     count(assets     as { account_id: string }[], account.id),
      contracts:  count(contracts  as { account_id: string }[], account.id),
      quotes:     count(quotes     as { account_id: string }[], account.id),
      workOrders: count(workOrders as { account_id: string }[], account.id),
      invoices:   count(invoices   as { account_id: string }[], account.id),
    },
  }));
}

const _listAccountsCached = unstable_cache(
  _listAccountsImpl,
  ["list-accounts"],
  { revalidate: 30, tags: ["accounts"] }
);

export async function listAccountsLive(): Promise<AccountSummary[]> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: tu } = await createAdminSupabase().from("tenant_users").select("tenant_id").eq("user_id", user.id).maybeSingle();
  if (!tu?.tenant_id) return [];
  const rows = await _listAccountsCached(tu.tenant_id as string);
  return rows.map((s) => ({ ...s, account: decryptAccount(s.account) }));
}

export async function getAccountHubLive(id: string) {
  const supabase = await createServerSupabase();

  const { data: account } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!account) return null;

  const [
    { data: contacts },
    { data: assets },
    { data: contracts },
    { data: cases },
    { data: quotes },
    { data: workOrders },
    { data: invoices },
    { data: referredByRow },
  ] = await Promise.all([
    supabase.from("contacts").select("*").eq("account_id", id),
    supabase.from("assets").select("*").eq("account_id", id),
    supabase.from("contracts").select("*").eq("account_id", id),
    supabase.from("service_cases").select("*").eq("account_id", id),
    supabase.from("quotes").select("*").eq("account_id", id),
    supabase
      .from("work_orders")
      .select("*, assets(name, kind, rating, serial), technicians(name)")
      .eq("account_id", id),
    supabase.from("invoices").select("*").eq("account_id", id),
    account.referred_by_account_id
      ? supabase.from("accounts").select("id, name").eq("id", account.referred_by_account_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mappedWOs = (workOrders ?? []).map((wo: any) => ({
    ...wo,
    authorized_by: { kind: wo.auth_kind ?? "quote", id: wo.auth_id ?? "" },
    asset: (Array.isArray(wo.assets) ? wo.assets[0] : wo.assets) ?? null,
    technician: (Array.isArray(wo.technicians) ? wo.technicians[0] : wo.technicians) ?? null,
  }));

  return {
    account: decryptAccount(account as Account),
    referredBy: (referredByRow ?? null) as Pick<Account, "id" | "name"> | null,
    contacts: ((contacts ?? []) as Contact[]).map(decryptContact),
    sites: [],
    assets: (assets ?? []) as Asset[],
    contracts: (contracts ?? []) as Contract[],
    cases: (cases ?? []) as ServiceCase[],
    leads: [],
    quotes: (quotes ?? []) as Quote[],
    workOrders: mappedWOs as (WorkOrder & { asset: Asset | null; technician: { name: string } | null })[],
    invoices: (invoices ?? []) as Invoice[],
    activities: [] as Activity[],
  };
}

// ── Assets ────────────────────────────────────────────────────────────────────

export type AssetRow = {
  asset: Asset;
  account: Account | null;
  openCaseCount: number;
  loanedToCase: ServiceCase | null;
  loanedToAccount: Account | null;
};

export async function listAssetsLive(): Promise<{ customerAssets: AssetRow[]; loanerStock: AssetRow[] }> {
  const supabase = await createServerSupabase();

  const [{ data: assets }, { data: cases }] = await Promise.all([
    supabase.from("assets").select("*").order("name", { ascending: true }),
    supabase.from("service_cases").select("id, ref, asset_id, loaner_asset_id, account_id, status"),
  ]);

  const allAssets = (assets ?? []) as Asset[];
  const allCases = (cases ?? []) as ServiceCase[];

  const accountIds = [...new Set(allAssets.map((a) => a.account_id).filter(Boolean) as string[])];
  const { data: accounts } = accountIds.length
    ? await supabase.from("accounts").select("*").in("id", accountIds)
    : { data: [] };

  const accountById = new Map((accounts ?? []).map((a) => [a.id, a as Account]));

  const activeCasesByAsset = new Map<string, number>();
  const loanCaseByAsset = new Map<string, ServiceCase>();
  allCases.forEach((sc) => {
    if (sc.asset_id && !["closed", "buyback", "scrapped"].includes(sc.status)) {
      activeCasesByAsset.set(sc.asset_id, (activeCasesByAsset.get(sc.asset_id) ?? 0) + 1);
    }
    if (sc.loaner_asset_id) loanCaseByAsset.set(sc.loaner_asset_id, sc);
  });

  const toRow = (asset: Asset): AssetRow => {
    const loanedCase = asset.is_loaner ? (loanCaseByAsset.get(asset.id) ?? null) : null;
    const loanedAccount = loanedCase ? (accountById.get(loanedCase.account_id ?? "") ?? null) : null;
    return {
      asset,
      account: asset.account_id ? (accountById.get(asset.account_id) ?? null) : null,
      openCaseCount: activeCasesByAsset.get(asset.id) ?? 0,
      loanedToCase: loanedCase,
      loanedToAccount: loanedAccount,
    };
  };

  return {
    customerAssets: allAssets.filter((a) => !a.is_loaner).map(toRow),
    loanerStock:    allAssets.filter((a) =>  a.is_loaner).map(toRow),
  };
}

// ── Contacts ──────────────────────────────────────────────────────────────────

export type ContactWithAccount = {
  contact: Contact;
  account: Account;
};

export async function listContactsLive(): Promise<ContactWithAccount[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("contacts")
    .select("*, accounts(*)")
    .order("name");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    contact: decryptContact(r as Contact),
    account: decryptAccount((Array.isArray(r.accounts) ? r.accounts[0] : r.accounts) as Account),
  }));
}

// ── Contact detail ───────────────────────────────────────────────────────────

export async function getContactLive(id: string) {
  const supabase = await createServerSupabase();
  const { data: contact } = await supabase
    .from("contacts")
    .select("*, accounts(*)")
    .eq("id", id)
    .maybeSingle();
  if (!contact) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acct = (contact as any).accounts;
  const account = (Array.isArray(acct) ? acct[0] : acct) as Account | null;

  const { data: cases } = await supabase
    .from("service_cases")
    .select("id, ref, status, type, complaint, equipment_label, intake_at")
    .eq("account_id", contact.account_id)
    .order("intake_at", { ascending: false });

  return {
    contact: decryptContact(contact as Contact),
    account: account ? decryptAccount(account) : null,
    cases: (cases ?? []) as Pick<ServiceCase, "id" | "ref" | "status" | "type" | "complaint" | "equipment_label" | "intake_at">[],
  };
}

// ── Asset detail ──────────────────────────────────────────────────────────────

export async function getAssetLive(id: string) {
  const supabase = await createServerSupabase();
  const { data: asset } = await supabase
    .from("assets")
    .select("*, accounts(*)")
    .eq("id", id)
    .maybeSingle();
  if (!asset) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acct = (asset as any).accounts;
  const account = (Array.isArray(acct) ? acct[0] : acct) as Account | null;

  const { data: cases } = await supabase
    .from("service_cases")
    .select("id, ref, status, type, complaint, equipment_label, intake_at, closed_at")
    .eq("asset_id", id)
    .order("intake_at", { ascending: false });

  return {
    asset: asset as Asset,
    account,
    cases: (cases ?? []) as Pick<ServiceCase, "id" | "ref" | "status" | "type" | "complaint" | "equipment_label" | "intake_at" | "closed_at">[],
  };
}

// ── Quotes ────────────────────────────────────────────────────────────────────

export type QuoteSummary = {
  quote: Quote;
  account: Account;
  lineCount: number;
  lines: QuoteLine[];
};

const _listQuotesCached = unstable_cache(
  async (tenantId: string): Promise<QuoteSummary[]> => {
    const supabase = createAdminSupabase();
    // Fetch quotes first so we have IDs to filter quote_lines
    const { data: quotes } = await supabase
      .from("quotes")
      .select("*, accounts(*)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (!quotes || quotes.length === 0) return [];

    const quoteIds = quotes.map((q: { id: string }) => q.id);
    const { data: lines } = await supabase
      .from("quote_lines")
      .select("*")
      .in("quote_id", quoteIds);

    const linesByQuote = new Map<string, QuoteLine[]>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (lines ?? []).forEach((l: any) => {
      const arr = linesByQuote.get(l.quote_id) ?? [];
      arr.push(l as QuoteLine);
      linesByQuote.set(l.quote_id, arr);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return quotes.map((r: any) => ({
      quote: r as Quote,
      account: (Array.isArray(r.accounts) ? r.accounts[0] : r.accounts) as Account,
      lines: linesByQuote.get(r.id) ?? [],
      lineCount: linesByQuote.get(r.id)?.length ?? 0,
    }));
  },
  ["list-quotes"],
  { revalidate: 30, tags: ["quotes"] }
);

export async function listQuotesLive(): Promise<QuoteSummary[]> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: tu } = await createAdminSupabase().from("tenant_users").select("tenant_id").eq("user_id", user.id).maybeSingle();
  if (!tu?.tenant_id) return [];
  return _listQuotesCached(tu.tenant_id as string);
}

export async function getQuoteLive(id: string) {
  const supabase = await createServerSupabase();
  const [
    { data: quote },
    { data: lines },
    { data: revisions },
    { data: workOrders },
  ] = await Promise.all([
    supabase.from("quotes").select("*, accounts(*)").eq("id", id).maybeSingle(),
    supabase.from("quote_lines").select("*").eq("quote_id", id).order("sl_no"),
    supabase.from("quote_revisions").select("*").eq("quote_id", id).order("rev"),
    supabase.from("work_orders").select("*").eq("auth_kind", "quote").eq("auth_id", id),
  ]);

  if (!quote) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accRaw = (Array.isArray((quote as any).accounts) ? (quote as any).accounts[0] : (quote as any).accounts) as Account | null;
  const acc = accRaw ? decryptAccount(accRaw) : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storedContactId = (quote as any).contact_id as string | null | undefined;
  const { data: cd } = storedContactId
    ? await supabase.from("contacts").select("*").eq("id", storedContactId).maybeSingle()
    : acc
      ? await supabase.from("contacts").select("*").eq("account_id", acc.id).limit(1).maybeSingle()
      : { data: null };
  const contact = cd ? decryptContact(cd as Contact) : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mappedWOs = (workOrders ?? []).map((wo: any) => ({
    ...wo,
    authorized_by: { kind: wo.auth_kind as "quote" | "contract", id: wo.auth_id as string },
  })) as WorkOrder[];

  // Fetch linked assets if the quote has asset_ids
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assetIds: string[] = (quote as any).asset_ids ?? [];
  let assets: Asset[] = [];
  if (assetIds.length > 0) {
    const { data: assetRows } = await supabase.from("assets").select("*").in("id", assetIds);
    assets = (assetRows ?? []) as Asset[];
  }

  return {
    quote: quote as Quote,
    account: acc,
    contact,
    site: null,
    lines: (lines ?? []) as QuoteLine[],
    revisions: (revisions ?? []) as QuoteRevision[],
    workOrders: mappedWOs,
    assets,
  };
}

// ── Cases ─────────────────────────────────────────────────────────────────────

export type CaseSummary = {
  serviceCase: ServiceCase;
  account: Account;
  technicianName: string | null;
};

// Cached per-tenant — admin client with explicit tenant filter (bypasses RLS safely)
const _listCasesCached = unstable_cache(
  async (tenantId: string): Promise<CaseSummary[]> => {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from("service_cases")
      .select("*, accounts(*), technicians(name)")
      .eq("tenant_id", tenantId)
      .order("intake_at", { ascending: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((r: any) => ({
      serviceCase: r as ServiceCase,
      account: (Array.isArray(r.accounts) ? r.accounts[0] : r.accounts) as Account,
      technicianName: (Array.isArray(r.technicians) ? r.technicians[0]?.name : r.technicians?.name) ?? null,
    }));
  },
  ["list-cases"],
  { revalidate: 30, tags: ["cases"] }
);

export async function listCasesLive(): Promise<CaseSummary[]> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: tu } = await createAdminSupabase().from("tenant_users").select("tenant_id").eq("user_id", user.id).maybeSingle();
  if (!tu?.tenant_id) return [];
  return _listCasesCached(tu.tenant_id as string);
}

export async function getCaseLive(id: string) {
  const supabase = await createServerSupabase();

  // Note: service_cases has two FKs to assets (asset_id + loaner_asset_id).
  // Use explicit alias "asset:asset_id(*)" to avoid PostgREST ambiguity error.
  const [
    { data: serviceCase },
    { data: photos },
    { data: inspectionReport },
    { data: subCases },
  ] = await Promise.all([
    supabase.from("service_cases").select("*, accounts(*), technicians(*), asset:asset_id(*), contracts(*), quotes(*)").eq("id", id).maybeSingle(),
    supabase.from("case_photos").select("*").eq("case_id", id).order("taken_at"),
    supabase.from("inspection_reports").select("*").eq("case_id", id).maybeSingle(),
    supabase.from("service_cases").select("*").eq("parent_case_id", id),
  ]);

  if (!serviceCase) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = serviceCase as any;
  const account    = (Array.isArray(r.accounts)    ? r.accounts[0]    : r.accounts)    as Account | null;
  const technician = (Array.isArray(r.technicians) ? r.technicians[0] : r.technicians) as Technician | null;
  const asset      = (Array.isArray(r.asset)       ? r.asset[0]       : r.asset)       as Asset | null;
  const contract   = (Array.isArray(r.contracts)   ? r.contracts[0]   : r.contracts)   as Contract | null;
  const quote      = (Array.isArray(r.quotes)      ? r.quotes[0]      : r.quotes)      as Quote | null;
  const sc         = serviceCase as ServiceCase;

  // Fetch contact + loaner asset in parallel (second round-trip, but concurrent)
  const [{ data: cd }, { data: la }] = await Promise.all([
    account
      ? supabase.from("contacts").select("*").eq("account_id", account.id).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    sc.loaner_asset_id
      ? supabase.from("assets").select("*").eq("id", sc.loaner_asset_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const contact     = cd ? decryptContact(cd as Contact) : null;
  const loanerAsset = la as Asset | null;

  return {
    serviceCase: serviceCase as ServiceCase,
    account: account ? decryptAccount(account) : null,
    contact,
    asset,
    technician,
    contract,
    quote,
    photos: (photos ?? []) as CasePhoto[],
    inspectionReport: (inspectionReport ?? null) as InspectionReport | null,
    loanerAsset,
    subCases: (subCases ?? []) as ServiceCase[],
  };
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

export async function listWorkOrdersLive(): Promise<WorkOrderRow[]> {
  const supabase = await createServerSupabase();

  const [{ data: wos }, { data: quotes }, { data: contracts }] = await Promise.all([
    supabase
      .from("work_orders")
      .select("*, accounts(*), assets(id, name, kind, rating, serial), technicians(*), service_cases(id, ref, status)")
      .order("scheduled_for", { ascending: true }),
    supabase.from("quotes").select("id, ref"),
    supabase.from("contracts").select("id, ref"),
  ]);

  const quoteRefById    = new Map((quotes    ?? []).map((q) => [q.id, q.ref as string]));
  const contractRefById = new Map((contracts ?? []).map((c) => [c.id, c.ref as string]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (wos ?? []).map((r: any) => {
    const authKind = (r.auth_kind ?? "quote") as "quote" | "contract";
    const authRef = authKind === "quote"
      ? (quoteRefById.get(r.auth_id) ?? r.auth_id ?? "")
      : (contractRefById.get(r.auth_id) ?? r.auth_id ?? "");
    return {
      workOrder: { ...r, authorized_by: { kind: authKind, id: r.auth_id ?? "" } } as WorkOrder,
      account:     (Array.isArray(r.accounts)      ? r.accounts[0]     : r.accounts)     as Account,
      asset:       (Array.isArray(r.assets)        ? r.assets[0]       : r.assets)       as Asset | null ?? null,
      technician:  (Array.isArray(r.technicians)   ? r.technicians[0]  : r.technicians)  as Technician | null ?? null,
      serviceCase: (Array.isArray(r.service_cases) ? r.service_cases[0]: r.service_cases)as ServiceCase | null ?? null,
      authRef,
      authKind,
    };
  });
}

export async function getWorkOrderLive(id: string) {
  const supabase = await createServerSupabase();

  const [{ data: wo }, { data: visitLogs }] = await Promise.all([
    supabase
      .from("work_orders")
      .select("*, accounts(*), assets(*), technicians(*), service_cases(*)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("visit_logs").select("*").eq("work_order_id", id).order("visit_date"),
  ]);

  if (!wo) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = wo as any;
  const authKind = (r.auth_kind ?? "quote") as "quote" | "contract";
  const account     = (Array.isArray(r.accounts)      ? r.accounts[0]     : r.accounts)     as Account | null;
  const asset       = (Array.isArray(r.assets)        ? r.assets[0]       : r.assets)       as Asset | null;
  const technician  = (Array.isArray(r.technicians)   ? r.technicians[0]  : r.technicians)  as Technician | null;
  const serviceCase = (Array.isArray(r.service_cases) ? r.service_cases[0]: r.service_cases)as ServiceCase | null;

  // Fetch auth reference
  let quote: Quote | null = null;
  let contract: Contract | null = null;
  if (authKind === "quote" && r.auth_id) {
    const { data: q } = await supabase.from("quotes").select("*").eq("id", r.auth_id).maybeSingle();
    quote = q as Quote | null;
  } else if (authKind === "contract" && r.auth_id) {
    const { data: c } = await supabase.from("contracts").select("*").eq("id", r.auth_id).maybeSingle();
    contract = c as Contract | null;
  }

  let loanerAsset: Asset | null = null;
  if (serviceCase?.loaner_asset_id) {
    const { data: la } = await supabase.from("assets").select("*").eq("id", serviceCase.loaner_asset_id).maybeSingle();
    loanerAsset = la as Asset | null;
  }

  return {
    workOrder: { ...r, authorized_by: { kind: authKind, id: r.auth_id ?? "" } } as WorkOrder,
    account,
    asset,
    technician,
    serviceCase,
    quote,
    contract,
    loanerAsset,
    visitLogs: (visitLogs ?? []) as VisitLog[],
  };
}

// ── Technicians ───────────────────────────────────────────────────────────────

export type TechnicianCard = {
  technician: Technician;
  todayWorkOrders: WorkOrder[];
  currentLeave: TechnicianLeave | null;
  monthStats: { visits: number; kmTravelled: number; visitedAccounts: number };
};

export async function listTechniciansLive(): Promise<TechnicianCard[]> {
  const supabase = await createServerSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);

  const [
    { data: technicians },
    { data: workOrders },
    { data: leaves },
    { data: visits },
  ] = await Promise.all([
    supabase.from("technicians").select("*").order("name"),
    supabase.from("work_orders").select("*").gte("scheduled_for", today).lte("scheduled_for", today),
    supabase.from("technician_leaves").select("*").lte("from_date", today).gte("to_date", today),
    supabase.from("visit_logs").select("*").gte("visit_date", thisMonth + "-01"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (technicians ?? []).map((tech: any) => {
    const t = tech as Technician & { certifications?: unknown; cert_expiry?: unknown };
    const resolved: Technician = {
      ...t,
      certifications: Array.isArray(t.certifications) ? t.certifications as string[] : [],
      cert_expiry: (t.cert_expiry && typeof t.cert_expiry === "object" && !Array.isArray(t.cert_expiry)) ? t.cert_expiry as Record<string, string> : {},
    };
    const todayWOs = (workOrders ?? []).filter((wo: WorkOrder) => wo.technician_id === tech.id);
    const leave = (leaves ?? []).find((l: TechnicianLeave) => l.technician_id === tech.id) ?? null;
    const monthVisits = (visits ?? []).filter((v: VisitLog) => v.technician_id === tech.id && v.status === "completed");
    return {
      technician: resolved,
      todayWorkOrders: todayWOs.map((wo: WorkOrder & { auth_kind?: string; auth_id?: string }) => ({
        ...wo,
        authorized_by: { kind: (wo.auth_kind ?? "quote") as "quote" | "contract", id: wo.auth_id ?? "" },
      })) as WorkOrder[],
      currentLeave: leave as TechnicianLeave | null,
      monthStats: {
        visits:          monthVisits.length,
        kmTravelled:     monthVisits.reduce((s: number, v: VisitLog) => s + ((v.travel_distance_km ?? 0) * 2), 0),
        visitedAccounts: new Set(monthVisits.map((v: VisitLog) => v.account_id)).size,
      },
    };
  });
}

export type CalendarDay = {
  date: string;
  isLeave: boolean;
  leaveReason: string | null;
  workOrders: WorkOrder[];
  visitLogs: VisitLog[];
  slotsFree: number;
  slotsTotal: number;
};

export async function getTechnicianDetailLive(techId: string, yearMonth: string) {
  const supabase = await createServerSupabase();

  const [year, month] = yearMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStart = `${yearMonth}-01`;
  const monthEnd   = `${yearMonth}-${String(daysInMonth).padStart(2, "0")}`;

  const [
    { data: tech },
    { data: leaves },
    { data: allWOs },
    { data: allVisits },
  ] = await Promise.all([
    supabase.from("technicians").select("*").eq("id", techId).maybeSingle(),
    supabase.from("technician_leaves").select("*").eq("technician_id", techId),
    supabase.from("work_orders").select("*, accounts(name)").eq("technician_id", techId),
    supabase.from("visit_logs").select("*, accounts(name)").eq("technician_id", techId),
  ]);

  if (!tech) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tech as any;
  const technician: Technician = {
    ...t,
    certifications: Array.isArray(t.certifications) ? t.certifications : [],
    cert_expiry: (t.cert_expiry && typeof t.cert_expiry === "object") ? t.cert_expiry : {},
  };

  const typedLeaves = (leaves ?? []) as TechnicianLeave[];
  const typedWOs = (allWOs ?? []).map((wo: WorkOrder & { auth_kind?: string; auth_id?: string }) => ({
    ...wo,
    authorized_by: { kind: (wo.auth_kind ?? "quote") as "quote" | "contract", id: wo.auth_id ?? "" },
  })) as WorkOrder[];
  const typedVisits = (allVisits ?? []) as VisitLog[];

  const calendarDays: CalendarDay[] = Array.from({ length: daysInMonth }, (_, i) => {
    const day = String(i + 1).padStart(2, "0");
    const date = `${yearMonth}-${day}`;
    const leave = typedLeaves.find((l) => l.from_date <= date && l.to_date >= date) ?? null;
    const dayWOs = typedWOs.filter((wo) => wo.scheduled_for === date);
    const dayVisits = typedVisits.filter((v) => v.visit_date === date);
    const scheduledCount = dayWOs.length + dayVisits.filter((v) => !dayWOs.some((w) => w.id === v.work_order_id)).length;
    return {
      date,
      isLeave: leave !== null,
      leaveReason: leave?.reason ?? null,
      workOrders: dayWOs,
      visitLogs: dayVisits,
      slotsFree: Math.max(0, technician.max_visits_per_day - scheduledCount),
      slotsTotal: technician.max_visits_per_day,
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountById = new Map((allWOs ?? []).map((w: any) => [w.id, (Array.isArray(w.accounts) ? w.accounts[0] : w.accounts) as Account | null]));

  const recentVisits = typedVisits
    .filter((v) => v.visit_date >= monthStart && v.visit_date <= monthEnd)
    .sort((a, b) => b.visit_date.localeCompare(a.visit_date))
    .slice(0, 10)
    .map((v) => ({
      visitLog: v,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      account: ((allVisits as any[])?.find((r: any) => r.id === v.id) as any)?.accounts ?? null,
      workOrder: typedWOs.find((w) => w.id === v.work_order_id) ?? null,
    }));

  const upcomingWOs = typedWOs
    .filter((wo) => {
      const sf = wo.scheduled_for ?? "";
      return sf >= monthStart && (wo.status === "scheduled" || wo.status === "in_progress");
    })
    .map((wo) => ({ workOrder: wo, account: accountById.get(wo.id) ?? null }));

  const monthVisits = typedVisits.filter((v) => v.visit_date >= monthStart && v.visit_date <= monthEnd);
  const completed = monthVisits.filter((v) => v.status === "completed");
  const monthStats = {
    totalVisits:    monthVisits.length,
    completed:      completed.length,
    kmTravelled:    monthVisits.reduce((s, v) => s + ((v.travel_distance_km ?? 0) * 2), 0),
    avgWorkMinutes: completed.length === 0 ? 0 : Math.round(
      completed.reduce((s, v) => {
        if (!v.work_start_time || !v.work_end_time) return s;
        const [sh, sm] = v.work_start_time.split(":").map(Number);
        const [eh, em] = v.work_end_time.split(":").map(Number);
        const bk = (v.break_start_time && v.break_end_time)
          ? (() => { const [bsh, bsm] = v.break_start_time!.split(":").map(Number); const [beh, bem] = v.break_end_time!.split(":").map(Number); return (beh * 60 + bem) - (bsh * 60 + bsm); })()
          : 0;
        return s + ((eh * 60 + em) - (sh * 60 + sm) - bk);
      }, 0) / completed.length
    ),
  };

  return { technician, calendarDays, leaves: typedLeaves, recentVisits, upcomingWOs, monthStats };
}

// ── Pricing & Text Fragments ──────────────────────────────────────────────────

export async function listPricingItemsLive(): Promise<PricingItem[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("pricing_items").select("*").order("category").order("description");
  return (data ?? []) as PricingItem[];
}

export async function listTextFragmentsLive(): Promise<TextFragment[]> {
  const supabase = await createServerSupabase();
  const { data } = await supabase.from("text_fragments").select("*").order("category").order("label");
  return (data ?? []) as TextFragment[];
}

export async function getQuoteFormDataLive() {
  const supabase = await createServerSupabase();
  const admin = createAdminSupabase();

  // Resolve tenant_id from current user's JWT
  const { data: { user } } = await supabase.auth.getUser();
  const tenantId = user?.app_metadata?.tenant_id as string | undefined;

  const [
    { data: accounts },
    { data: contacts },
    { data: assets },
    { data: pricingItems },
    { data: textFragments },
    { data: tenantRow },
  ] = await Promise.all([
    supabase.from("accounts").select("*").order("name"),
    supabase.from("contacts").select("*").order("name"),
    supabase.from("assets").select("*").not("account_id", "is", null).order("name"),
    supabase.from("pricing_items").select("*").order("category").order("description"),
    supabase.from("text_fragments").select("*").order("category").order("label"),
    tenantId
      ? admin.from("tenants").select("config").eq("id", tenantId).single()
      : Promise.resolve({ data: null }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = (tenantRow as any)?.config ?? {};

  return {
    accounts:      ((accounts  ?? []) as Account[]).map(decryptAccount),
    contacts:      ((contacts  ?? []) as Contact[]).map(decryptContact),
    assets:        (assets        ?? []) as Asset[],
    pricingItems:  (pricingItems  ?? []) as PricingItem[],
    textFragments: (textFragments ?? []) as TextFragment[],
    tenantEntities: (config.entities ?? []) as import("@/lib/constants").TenantEntity[],
    tenantTax:      config.tax ?? { label: "GST", rate: 18, inclusive: false },
  };
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

const OPEN_CASE_STATUSES: CaseStatus[] = [
  "intake","inspection","report_sent","report_approved",
  "quote_sent","quote_approved","in_repair","qa","ready",
];

export async function getDashboardSummaryLive() {
  const supabase = await createServerSupabase();

  const [
    { data: cases },
    { data: contracts },
    { data: quotes },
    { data: workOrders },
    { data: activities },
  ] = await Promise.all([
    supabase.from("service_cases").select("id, status, account_id, ref, intake_at, equipment_label").order("intake_at", { ascending: true }),
    supabase.from("contracts").select("id, status"),
    supabase.from("quotes").select("id, status, total"),
    supabase.from("work_orders").select("*, accounts(name), technicians(name)").in("status", ["in_progress", "scheduled"]).order("scheduled_for"),
    supabase.from("activities").select("*, accounts(name)").order("at", { ascending: false }).limit(5),
  ]);

  const allCases = (cases ?? []) as ServiceCase[];
  const allContracts = (contracts ?? []) as Contract[];
  const allQuotes = (quotes ?? []) as Quote[];

  const kpis = {
    openCases:        allCases.filter((sc) => OPEN_CASE_STATUSES.includes(sc.status)).length,
    inRepair:         allCases.filter((sc) => sc.status === "in_repair").length,
    awaitingApproval: allCases.filter((sc) => sc.status === "report_sent" || sc.status === "quote_sent").length,
    activeContracts:  allContracts.filter((c) => c.status === "active").length,
    openQuoteValue:   allQuotes.filter((q) => q.status === "sent" || q.status === "approved").reduce((s, q) => s + q.total, 0),
    activeWorkOrders: (workOrders ?? []).length,
  };

  // Fetch account names for all priority cases (awaiting response + qa/ready)
  const PRIORITY_STATUSES: CaseStatus[] = ["report_sent", "quote_sent", "qa", "ready"];
  const priorityAccountIds = [...new Set(
    allCases.filter((sc) => PRIORITY_STATUSES.includes(sc.status)).map((sc) => sc.account_id)
  )];
  const { data: priorityAccounts } = priorityAccountIds.length
    ? await supabase.from("accounts").select("id, name").in("id", priorityAccountIds)
    : { data: [] };
  const acctMap = new Map((priorityAccounts ?? []).map((a) => [a.id, a as Account]));

  const attention = allCases
    .filter((sc) => sc.status === "report_sent" || sc.status === "quote_sent")
    .map((sc) => ({ serviceCase: sc, account: acctMap.get(sc.account_id) ?? null }));

  const readyCases = allCases
    .filter((sc) => sc.status === "qa" || sc.status === "ready")
    .map((sc) => ({ serviceCase: sc, account: acctMap.get(sc.account_id) ?? null }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workOrderRows = (workOrders ?? []).map((wo: any) => ({
    workOrder: { ...wo, authorized_by: { kind: (wo.auth_kind ?? "quote") as "quote" | "contract", id: wo.auth_id ?? "" } } as WorkOrder,
    account: (Array.isArray(wo.accounts) ? wo.accounts[0] : wo.accounts) as Account | null,
    tech: (Array.isArray(wo.technicians) ? wo.technicians[0] : wo.technicians) as { name: string } | null,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentActivity = (activities ?? []).map((act: any) => ({
    activity: act as Activity,
    account: (Array.isArray(act.accounts) ? act.accounts[0] : act.accounts) as Account | null,
  }));

  return { kpis, attention, readyCases, workOrderRows, recentActivity };
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export type AnalyticsData = {
  totals: {
    accounts: number; contacts: number; customerAssets: number; openCases: number;
    workOrders: number; activeContracts: number; leads: number; technicians: number;
  };
  accountsByType: Array<{ type: string; label: string; count: number }>;
  leadFunnel: Array<{ stage: string; count: number }>;
  assetsByKind: Array<{ kind: string; label: string; count: number; loanerCount: number }>;
  loanerStock: { available: number; onLoan: number; total: number };
  quotesByStatus: Array<{ status: string; label: string; count: number; value: number }>;
  quoteTrend: Array<{ dateLabel: string; value: number; cumulative: number }>;
  casesByStatus: Array<{ status: string; label: string; count: number }>;
  workOrdersByStatus: Array<{ status: string; label: string; count: number }>;
  techniciansByStatus: Array<{ status: string; label: string; count: number }>;
  invoicesByStatus: Array<{ status: string; label: string; count: number; value: number }>;
  contractStats: { activeCount: number; totalValue: number };
  recentActivity: Array<{ text: string; at: string; pillar: Activity["pillar"]; accountName: string }>;
};

const CASE_STATUS_LABEL_MAP: Record<string, string> = {
  intake: "Intake", inspection: "Inspection", report_sent: "Report sent",
  report_approved: "Report approved", quote_sent: "Quote sent", quote_approved: "Quote approved",
  in_repair: "In repair", qa: "QA", ready: "Ready", closed: "Closed", buyback: "Buyback", scrapped: "Scrapped",
};

export async function getAnalyticsDataLive(): Promise<AnalyticsData> {
  const supabase = await createServerSupabase();

  const [
    { data: accounts }, { data: contacts }, { data: assets },
    { data: cases }, { data: workOrders }, { data: contracts },
    { data: leads }, { data: technicians }, { data: quotes },
    { data: invoices }, { data: activities },
  ] = await Promise.all([
    supabase.from("accounts").select("id, type"),
    supabase.from("contacts").select("id"),
    supabase.from("assets").select("id, kind, is_loaner, loaner_status"),
    supabase.from("service_cases").select("id, status"),
    supabase.from("work_orders").select("id, status"),
    supabase.from("contracts").select("id, status, value"),
    supabase.from("leads").select("id, status"),
    supabase.from("technicians").select("id, status"),
    supabase.from("quotes").select("id, status, total, created_at").order("created_at"),
    supabase.from("invoices").select("id, status, total"),
    supabase.from("activities").select("*, accounts(name)").order("at", { ascending: false }).limit(6),
  ]);

  const allAccounts    = (accounts    ?? []) as Array<{ id: string; type: string }>;
  const allAssets      = (assets      ?? []) as Array<{ id: string; kind: string; is_loaner: boolean; loaner_status: string | null }>;
  const allCases       = (cases       ?? []) as Array<{ id: string; status: string }>;
  const allWorkOrders  = (workOrders  ?? []) as Array<{ id: string; status: string }>;
  const allContracts   = (contracts   ?? []) as Array<{ id: string; status: string; value: number | null }>;
  const allLeads       = (leads       ?? []) as Array<{ id: string; status: string }>;
  const allTechnicians = (technicians ?? []) as Array<{ id: string; status: string }>;
  const allQuotes      = (quotes      ?? []) as Array<{ id: string; status: string; total: number; created_at: string }>;
  const allInvoices    = (invoices    ?? []) as Array<{ id: string; status: string; total: number }>;

  const totals = {
    accounts:        allAccounts.length,
    contacts:        (contacts ?? []).length,
    customerAssets:  allAssets.filter((a) => !a.is_loaner).length,
    openCases:       allCases.filter((c) => OPEN_CASE_STATUSES.includes(c.status as CaseStatus)).length,
    workOrders:      allWorkOrders.length,
    activeContracts: allContracts.filter((c) => c.status === "active").length,
    leads:           allLeads.length,
    technicians:     allTechnicians.length,
  };

  const accountTypeCounts = new Map<string, number>();
  allAccounts.forEach((a) => accountTypeCounts.set(a.type, (accountTypeCounts.get(a.type) ?? 0) + 1));
  const accountsByType = [
    { type: "oem",          label: "OEM / Vendor",    count: accountTypeCounts.get("oem")          ?? 0 },
    { type: "direct",       label: "Direct customer", count: accountTypeCounts.get("direct")       ?? 0 },
    { type: "end_customer", label: "End-customer",    count: accountTypeCounts.get("end_customer") ?? 0 },
    { type: "prospect",     label: "Prospect",        count: accountTypeCounts.get("prospect")     ?? 0 },
  ].filter((x) => x.count > 0);

  const leadCounts = new Map<string, number>();
  allLeads.forEach((l) => leadCounts.set(l.status, (leadCounts.get(l.status) ?? 0) + 1));
  const leadFunnel = [
    { stage: "All leads", count: allLeads.length },
    { stage: "Engaged",   count: allLeads.filter((l) => l.status !== "new" && l.status !== "lost").length },
    { stage: "Quoted",    count: allLeads.filter((l) => l.status === "quoted" || l.status === "won").length },
    { stage: "Won",       count: leadCounts.get("won") ?? 0 },
  ];

  const assetKinds: Array<[string, string]> = [["motor","Motor"],["transformer","Transformer"],["pump","Pump"],["generator","Generator"],["panel","Panel"]];
  const assetsByKind = assetKinds
    .map(([kind, label]) => ({
      kind, label,
      count:       allAssets.filter((a) => a.kind === kind && !a.is_loaner).length,
      loanerCount: allAssets.filter((a) => a.kind === kind && a.is_loaner).length,
    }))
    .filter((x) => x.count + x.loanerCount > 0);

  const loaners = allAssets.filter((a) => a.is_loaner);
  const loanerStock = {
    total:     loaners.length,
    available: loaners.filter((a) => a.loaner_status === "available").length,
    onLoan:    loaners.filter((a) => a.loaner_status === "on_loan").length,
  };

  const qStatusCounts = new Map<string, { count: number; value: number }>();
  allQuotes.forEach((q) => {
    const s = qStatusCounts.get(q.status) ?? { count: 0, value: 0 };
    qStatusCounts.set(q.status, { count: s.count + 1, value: s.value + q.total });
  });
  const quotesByStatus = ["draft","sent","approved","rejected"]
    .map((status) => ({ status, label: status.charAt(0).toUpperCase() + status.slice(1), ...(qStatusCounts.get(status) ?? { count: 0, value: 0 }) }))
    .filter((x) => x.count > 0);

  let cumulative = 0;
  const quoteTrend = allQuotes.map((q) => {
    cumulative += q.total;
    const d = new Date(q.created_at);
    return { dateLabel: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }), value: q.total, cumulative };
  });

  const caseStatusCounts = new Map<string, number>();
  allCases.forEach((c) => caseStatusCounts.set(c.status, (caseStatusCounts.get(c.status) ?? 0) + 1));
  const casesByStatus = Array.from(caseStatusCounts.entries())
    .map(([status, count]) => ({ status, label: CASE_STATUS_LABEL_MAP[status] ?? status, count }))
    .sort((a, b) => b.count - a.count);

  const woStatusCounts = new Map<string, number>();
  allWorkOrders.forEach((wo) => woStatusCounts.set(wo.status, (woStatusCounts.get(wo.status) ?? 0) + 1));
  const workOrdersByStatus = ["scheduled","in_progress","completed"]
    .map((status) => ({ status, label: status === "in_progress" ? "In Progress" : status.charAt(0).toUpperCase() + status.slice(1), count: woStatusCounts.get(status) ?? 0 }))
    .filter((x) => x.count > 0);

  const techStatusCounts = new Map<string, number>();
  allTechnicians.forEach((t) => techStatusCounts.set(t.status, (techStatusCounts.get(t.status) ?? 0) + 1));
  const techniciansByStatus = [
    { status: "active",   label: "Active",   count: techStatusCounts.get("active")   ?? 0 },
    { status: "on_leave", label: "On Leave", count: techStatusCounts.get("on_leave") ?? 0 },
    { status: "inactive", label: "Inactive", count: techStatusCounts.get("inactive") ?? 0 },
  ].filter((x) => x.count > 0);

  const invStatusCounts = new Map<string, { count: number; value: number }>();
  allInvoices.forEach((inv) => {
    const s = invStatusCounts.get(inv.status) ?? { count: 0, value: 0 };
    invStatusCounts.set(inv.status, { count: s.count + 1, value: s.value + inv.total });
  });
  const invoicesByStatus = ["draft","sent","paid"]
    .map((status) => ({ status, label: status.charAt(0).toUpperCase() + status.slice(1), ...(invStatusCounts.get(status) ?? { count: 0, value: 0 }) }))
    .filter((x) => x.count > 0);

  const activeContracts = allContracts.filter((c) => c.status === "active");
  const contractStats = {
    activeCount: activeContracts.length,
    totalValue:  activeContracts.reduce((s, c) => s + (c.value ?? 0), 0),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentActivity = (activities ?? []).map((act: any) => ({
    text:        act.text as string,
    at:          act.at as string,
    pillar:      act.pillar as Activity["pillar"],
    accountName: (Array.isArray(act.accounts) ? act.accounts[0]?.name : act.accounts?.name) ?? act.account_id,
  }));

  return {
    totals, accountsByType, leadFunnel, assetsByKind, loanerStock,
    quotesByStatus, quoteTrend, casesByStatus, workOrdersByStatus,
    techniciansByStatus, invoicesByStatus, contractStats, recentActivity,
  };
}
