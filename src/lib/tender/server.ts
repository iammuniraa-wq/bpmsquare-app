import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TENDER_STAGES, type TenantFeatures } from "@/lib/constants";
import { parseSent, type TenderDecision, type TenderFields } from "./rules";
import { parseBondStatus, type BondStatus } from "./bond";
import { readAllPages } from "@/lib/pagedRead";

// Server-side helpers for tender deals (migration 0220). Every query is tenant-scoped on the admin client
// (MULTI_TENANT_GUARDRAILS.md) and every one tolerates the migration being pending: a missing table or column reads as
// "no tender", never as a crash. Nothing here runs for a workspace without the platform-admin flag `gcc_tender`: the
// callers ask `tenderEnabled(features)` first, so a standard workspace costs no extra query anywhere.

export type TenderRow = TenderFields & {
  opportunity_id: string;
  tenant_id: string;
  deal_type_id: string | null;
  decision: TenderDecision | null;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  source_email_id: string | null;
  custom_data: Record<string, unknown> | null;
  reminders_sent: number[];
  /** 0221: held until released. Reads "held" while that migration is pending. */
  bond_status: BondStatus;
  bond_released_at: string | null;
  bond_released_by: string | null;
  /** 0225: the outcome facts of a closed tender. Null while that migration is pending or nothing was recorded. */
  award_value: number | null;
  winning_bidder: string | null;
  award_date: string | null;
  outcome_note: string | null;
  created_at: string;
  updated_at: string;
};

// The columns slice 1 (0220) created, and the three the bond adds (0221). Reads ask for both and fall back to the first
// when the second migration is still pending, so a half-applied database never makes a tender disappear.
export const TENDER_COLUMNS_BASE =
  "opportunity_id, tenant_id, deal_type_id, tender_no, issuer_name, issuer_account_id, portal, closing_at, bid_bond_amount, bid_bond_currency, bid_bond_expiry, addenda_count, decision, decision_reason, decided_by, decided_at, source_email_id, custom_data, reminders_sent, created_at, updated_at";
export const BOND_COLUMNS = "bond_status, bond_released_at, bond_released_by";
export const OUTCOME_COLUMNS = "award_value, winning_bidder, award_date, outcome_note";
export const TENDER_COLUMNS_WITH_BOND = `${TENDER_COLUMNS_BASE}, ${BOND_COLUMNS}`;
export const TENDER_COLUMNS = `${TENDER_COLUMNS_WITH_BOND}, ${OUTCOME_COLUMNS}`;

/** Run a tender read with the full column list, then without the 0225 columns, then without the 0221 ones, if they are not there yet. */
async function withBondFallback<T>(run: (columns: string) => PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>): Promise<{ data: T | null; error: { code?: string; message?: string } | null }> {
  const first = await run(TENDER_COLUMNS);
  if (!(first.error && isMissingSchema(first.error))) return first;
  const second = await run(TENDER_COLUMNS_WITH_BOND);
  if (!(second.error && isMissingSchema(second.error))) return second;
  return run(TENDER_COLUMNS_BASE);
}

/** The flag, read from a features object. Missing key = off. */
export const tenderEnabled = (features: Partial<TenantFeatures> | null | undefined): boolean =>
  features?.gcc_tender === true && features?.pipeline === true;

/** 42P01 / PGRST205: the table is not there yet. 42703 / PGRST204: a column is not there yet. */
export function isMissingSchema(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && (err.code === "42P01" || err.code === "42703" || err.code === "PGRST205" || err.code === "PGRST204");
}

function normalise(r: Record<string, unknown>): TenderRow {
  return {
    ...(r as unknown as TenderRow),
    addenda_count: Number(r.addenda_count ?? 0),
    // PostgREST answers timestamptz as "2026-10-30T12:00:00+00:00"; rules.ts stores "...000Z". One spelling, so an unchanged value never reads as a change.
    closing_at: typeof r.closing_at === "string" && !Number.isNaN(Date.parse(r.closing_at)) ? new Date(r.closing_at).toISOString() : null,
    bid_bond_amount: r.bid_bond_amount == null ? null : Number(r.bid_bond_amount),
    reminders_sent: parseSent(r.reminders_sent),
    bond_status: parseBondStatus(r.bond_status),
    bond_released_at: typeof r.bond_released_at === "string" ? r.bond_released_at : null,
    bond_released_by: typeof r.bond_released_by === "string" ? r.bond_released_by : null,
    award_value: r.award_value == null ? null : Number(r.award_value),
    winning_bidder: typeof r.winning_bidder === "string" ? r.winning_bidder : null,
    award_date: typeof r.award_date === "string" ? r.award_date : null,
    outcome_note: typeof r.outcome_note === "string" ? r.outcome_note : null,
  };
}

/** One deal's tender row, or null (no row, no table, no column). */
export async function loadTender(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<TenderRow | null> {
  const { data, error } = await withBondFallback((cols) => admin.from("opportunity_tenders").select(cols).eq("opportunity_id", opportunityId).eq("tenant_id", tenantId).maybeSingle());
  if (error || !data) return null;
  return normalise(data as Record<string, unknown>);
}

/**
 * The tender row of a deal for a path that must behave exactly as before when tenders are off: with the flag off this
 * returns null WITHOUT asking the database anything.
 */
export async function tenderForDeal(admin: SupabaseClient, tenantId: string, features: Partial<TenantFeatures> | null | undefined, opportunityId: string): Promise<TenderRow | null> {
  if (!tenderEnabled(features)) return null;
  return loadTender(admin, tenantId, opportunityId);
}

/** Every tender row of a workspace; `pending` is true when migration 0220 has not been applied. */
export async function listTenders(admin: SupabaseClient, tenantId: string): Promise<{ rows: TenderRow[]; pending: boolean }> {
  const { data, error } = await withBondFallback((cols) => readAllPages((from, to) => admin.from("opportunity_tenders").select(cols).eq("tenant_id", tenantId).order("opportunity_id", { ascending: true }).range(from, to)));
  if (error) return { rows: [], pending: isMissingSchema(error) };
  return { rows: ((data ?? []) as unknown as Record<string, unknown>[]).map(normalise), pending: false };
}

/** Is the table there? A cheap probe used before a create so a pending migration answers 503 instead of leaving a half-made deal. */
export async function tenderTableReady(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const { error } = await admin.from("opportunity_tenders").select("opportunity_id").eq("tenant_id", tenantId).limit(1);
  return !error;
}

/** The workspace's `tender` deal type (deal_types), made on first use. Null when the table is not there yet. */
export async function ensureTenderDealType(admin: SupabaseClient, tenantId: string): Promise<string | null> {
  const found = await admin.from("deal_types").select("id").eq("tenant_id", tenantId).eq("code", "tender").maybeSingle();
  if (found.error) return null;
  if (found.data?.id) return found.data.id as string;
  // Slice 1 reads the stage list from code; the snapshot is stored so the row already has its shape for the day a workspace edits it.
  const made = await admin.from("deal_types").upsert(
    { tenant_id: tenantId, code: "tender", name: "Tender", stages: DEFAULT_TENDER_STAGES, active: true, sort: 10 },
    { onConflict: "tenant_id,code", ignoreDuplicates: true },
  ).select("id").maybeSingle();
  if (made.data?.id) return made.data.id as string;
  const again = await admin.from("deal_types").select("id").eq("tenant_id", tenantId).eq("code", "tender").maybeSingle();
  return (again.data?.id as string | undefined) ?? null;
}

/** An account id belongs to this workspace? (foreign ids from a body are never trusted: guardrails) */
export async function accountInTenant(admin: SupabaseClient, tenantId: string, accountId: string): Promise<boolean> {
  const { data } = await admin.from("accounts").select("id").eq("id", accountId).eq("tenant_id", tenantId).maybeSingle();
  return !!data;
}

/** A shared-Inbox message belongs to this workspace? */
export async function emailInTenant(admin: SupabaseClient, tenantId: string, emailId: string): Promise<boolean> {
  const { data } = await admin.from("inbound_emails").select("id").eq("id", emailId).eq("tenant_id", tenantId).maybeSingle();
  return !!data;
}
