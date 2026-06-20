import "server-only";
import { createServerSupabase } from "@/lib/supabase-server";
import type { Invoice, Lead } from "@/lib/types";

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
    asset: (Array.isArray(wo.assets) ? wo.assets[0] : wo.assets) ?? null,
    technician: (Array.isArray(wo.technicians) ? wo.technicians[0] : wo.technicians) ?? null,
    authorized_by: wo.authorized_by ?? { kind: "quote" },
  }));

  return {
    account,
    referredBy: referredByRow ?? null,
    contacts: contacts ?? [],
    sites: [],
    assets: assets ?? [],
    contracts: contracts ?? [],
    cases: cases ?? [],
    leads: [],
    quotes: quotes ?? [],
    workOrders: mappedWOs,
    invoices: invoices ?? [],
    activities: [],
  };
}

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
