import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";
import { createAdminSupabase } from "@/lib/supabase-server";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { TroubleFacts } from "./safety";

// Reads the runner, the preview and the simulation share. Every query is on the
// service-role client, so every query names the tenant (MULTI_TENANT_GUARDRAILS.md).
// A foreign id is only ever used after it was loaded with its own tenant filter.

export type PersonRow = { id: string; account_id: string; name: string; email: string | null };

/** The contact, only if it belongs to this tenant. The address is decrypted here and goes no further than the send. */
export async function loadContact(admin: SupabaseClient, tenantId: string, contactId: string): Promise<PersonRow | null> {
  const { data, error } = await admin.from("contacts").select("id, account_id, name, email").eq("id", contactId).eq("tenant_id", tenantId).maybeSingle();
  if (error || !data) return null;
  const r = data as { id: string; account_id: string; name: string | null; email: string | null };
  return { id: r.id, account_id: r.account_id, name: r.name ?? "", email: r.email ? decrypt(r.email) || null : null };
}

/** The oldest-created contact of an account: the person a company-level event is about. */
export async function mainContactOf(admin: SupabaseClient, tenantId: string, accountId: string): Promise<PersonRow | null> {
  const { data, error } = await admin.from("contacts").select("id, account_id, name, email, created_at").eq("tenant_id", tenantId).eq("account_id", accountId).order("created_at", { ascending: true }).limit(1);
  if (error || !data || (data as unknown[]).length === 0) return null;
  const r = (data as { id: string; account_id: string; name: string | null; email: string | null }[])[0];
  return { id: r.id, account_id: r.account_id, name: r.name ?? "", email: r.email ? decrypt(r.email) || null : null };
}

export async function loadAccount(admin: SupabaseClient, tenantId: string, accountId: string): Promise<{ id: string; name: string; owner_user_id: string | null; marketing_opt_out: boolean } | null> {
  const { data, error } = await admin.from("accounts").select("id, name, owner_user_id, marketing_opt_out").eq("id", accountId).eq("tenant_id", tenantId).maybeSingle();
  if (error || !data) return null;
  return data as { id: string; name: string; owner_user_id: string | null; marketing_opt_out: boolean };
}

const CLOSED_CASE = new Set(["closed", "buyback", "scrapped"]);

/** Is this company in trouble: an open case the clock has been running on, or an unpaid invoice past its due date. */
export async function troubleFactsOf(admin: SupabaseClient, tenantId: string, accountId: string, today: string): Promise<TroubleFacts> {
  const [cases, invoices] = await Promise.all([
    admin.from("service_cases").select("status, intake_at").eq("tenant_id", tenantId).eq("account_id", accountId),
    admin.from("invoices").select("status, due_date, total, paid_amount").eq("tenant_id", tenantId).eq("account_id", accountId),
  ]);
  let oldest: Date | null = null;
  for (const c of (cases.data ?? []) as { status: string; intake_at: string | null }[]) {
    if (CLOSED_CASE.has(c.status) || !c.intake_at) continue;
    const d = new Date(c.intake_at);
    if (!oldest || d < oldest) oldest = d;
  }
  const overdue = ((invoices.data ?? []) as { status: string; due_date: string | null; total: number | null; paid_amount: number | null }[])
    .some((i) => ["sent", "partial", "overdue"].includes(i.status) && !!i.due_date && i.due_date < today && (i.total ?? 0) - (i.paid_amount ?? 0) > 0);
  return { oldestOpenCaseAt: oldest, hasOverdueInvoice: overdue };
}

/** When this person last got a journey email, within the last 24 hours. */
export async function recentSendTimes(admin: SupabaseClient, tenantId: string, contactId: string, now: Date): Promise<Date[]> {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const { data, error } = await admin.from("journey_run_steps").select("at").eq("tenant_id", tenantId).eq("contact_id", contactId).eq("sent", true).gte("at", since);
  if (error) return [];
  return ((data ?? []) as { at: string }[]).map((r) => new Date(r.at));
}

export type OwnerLookup = (tenantId: string, accountId: string) => Promise<string | null>;

/**
 * Who owns this company: the winning Coverage team's lead, else the owner cached on the account.
 * Coverage is imported lazily so a test or a workspace without it never loads its engine.
 */
export const defaultOwnerLookup: OwnerLookup = async (tenantId, accountId) => {
  const admin = createAdminSupabase();
  const { data: account } = await admin.from("accounts").select("*").eq("id", accountId).eq("tenant_id", tenantId).maybeSingle();
  if (!account) return null;
  try {
    const { resolveCoverageForAccount } = await import("@/lib/coverage/resolve");
    const resolved = await resolveCoverageForAccount(tenantId, account as never);
    const lead = resolved.owner?.team.lead_user_id ?? null;
    if (lead) return lead;
  } catch (e) {
    if (!isSchemaPending(e as { message?: string })) console.error("[journeys] coverage lookup failed", e);
  }
  return (account as { owner_user_id: string | null }).owner_user_id ?? null;
};

/** The sign-in address of a member of THIS tenant, for an @mention. Null if the user is not a member. */
export async function memberEmail(admin: SupabaseClient, tenantId: string, userId: string): Promise<string | null> {
  const { data: m } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  if (!m) return null;
  const { data } = await admin.auth.admin.getUserById(userId);
  return data?.user?.email?.toLowerCase() ?? null;
}
