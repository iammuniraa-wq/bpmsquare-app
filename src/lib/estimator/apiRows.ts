import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";

// The customer-safe view of an estimate for the v1 API, /api/v1/ask and the
// report builder: ref, name, status, who it is for, which template, the price
// quoted and the dates.
//
// DELIBERATELY NOT SELECTED, anywhere on these surfaces: unit_cost, cost_total,
// margin_pct, the totals' cost breakdown (cost_total, margin_amount, by_group,
// by_component), `params`, `model` and the lines themselves. Those are the
// estimator's internal cost data. The price comes from two json paths
// (totals->price, totals->price_incl_vat), so the rest of `totals` never leaves
// the database for this query. Keep it that way: add a column here only after
// asking whether a customer could see it.

const SELECT =
  "id, ref, name, status, currency, custom_data, created_at, updated_at, " +
  "quoted_total:totals->price, quoted_total_incl_vat:totals->price_incl_vat, " +
  "accounts(id, ref, name), contacts(id, ref, name), estimate_templates(name)";

type Related = { id?: string; ref?: string | null; name?: string | null } | null;
const one = (v: unknown): Related => (Array.isArray(v) ? ((v[0] as Related) ?? null) : ((v as Related) ?? null));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** One PostgREST row -> the public shape. Pure, so the field list is testable. */
export function shapeEstimateRow(raw: Record<string, unknown>): Record<string, unknown> {
  const acc = one(raw.accounts);
  const con = one(raw.contacts);
  const tpl = one(raw.estimate_templates);
  return {
    id: raw.id,
    ref: raw.ref ?? null,
    name: raw.name,
    status: raw.status,
    currency: raw.currency ?? null,
    quoted_total: num(raw.quoted_total),
    quoted_total_incl_vat: num(raw.quoted_total_incl_vat),
    account: acc ? { id: acc.id ?? null, ref: acc.ref ?? null, name: acc.name ?? null } : null,
    contact: con ? { id: con.id ?? null, ref: con.ref ?? null, name: con.name ?? null } : null,
    template: tpl ? { name: tpl.name ?? null } : null,
    custom_data: raw.custom_data ?? null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    _links: { self: `/api/v1/estimates/${String(raw.id)}` },
  };
}

/** Every estimate of a tenant, public shape. A missing table (0131 pending) reads as none. */
export async function loadEstimatesForApi(tenantId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await createAdminSupabase()
    .from("estimates")
    .select(SELECT)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(shapeEstimateRow);
}

export async function loadEstimateForApi(tenantId: string, id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await createAdminSupabase()
    .from("estimates")
    .select(SELECT)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return shapeEstimateRow(data as unknown as Record<string, unknown>);
}

/** The select string, exported so a test can prove no cost column is in it. */
export const ESTIMATE_API_SELECT = SELECT;
