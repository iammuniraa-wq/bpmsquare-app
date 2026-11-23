import { SITE_LIMITS } from "./types";
import type { Cleaned } from "./expenseRules";

// Settings > Site entry, pure: the limits and the category rows an admin may save. The ids a category or the alert list carries are verified by
// the route against THIS workspace; here only their shape and size are checked.

const MAX_LIMIT = SITE_LIMITS.maxAmount;

const limit = (v: unknown, name: string): Cleaned<number | null> => {
  if (v === null || v === undefined || v === "") return { ok: true, value: null };
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_LIMIT) return { ok: false, error: `${name} must be a positive amount, or empty for no limit` };
  return { ok: true, value: Math.round(n * 100) / 100 };
};

export type SiteSettingsInput = { pm_limit: number | null; monthly_cap: number | null; notify_receipts: string[] };

export function cleanSiteSettings(body: Record<string, unknown>): Cleaned<SiteSettingsInput> {
  const pm = limit(body.pm_limit, "The manager's limit");
  if (!pm.ok) return pm;
  const cap = limit(body.monthly_cap, "The monthly cap");
  if (!cap.ok) return cap;
  const notify = Array.isArray(body.notify_receipts) ? [...new Set(body.notify_receipts.filter((x): x is string => typeof x === "string" && x.length > 0))] : [];
  if (notify.length > 20) return { ok: false, error: "Tell at most 20 people" };
  return { ok: true, value: { pm_limit: pm.value, monthly_cap: cap.value, notify_receipts: notify } };
}

export type CategoryInput = { name: string; resource_code: string | null; cost_code: string | null; erp_category: string | null; limit_amount: number | null; active: boolean; sort_order: number };

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** A category as typed; `partial` leaves a field that was not sent out of the result (a PATCH). */
export function cleanCategory(body: Record<string, unknown>, partial: boolean): Cleaned<Partial<CategoryInput>> {
  const out: Partial<CategoryInput> = {};
  if (!partial || "name" in body) {
    const name = text(body.name, 80);
    if (!name) return { ok: false, error: "Give the category a name" };
    out.name = name;
  }
  if (!partial || "resource_code" in body) out.resource_code = text(body.resource_code, 20);
  if (!partial || "cost_code" in body) out.cost_code = text(body.cost_code, 40);
  if (!partial || "erp_category" in body) out.erp_category = text(body.erp_category, 60);
  if (!partial || "limit_amount" in body) {
    const l = limit(body.limit_amount, "The limit");
    if (!l.ok) return l;
    out.limit_amount = l.value;
  }
  if (!partial || "active" in body) out.active = body.active !== false;
  if (!partial || "sort_order" in body) {
    const n = Number(body.sort_order ?? 0);
    out.sort_order = Number.isInteger(n) && n >= 0 && n <= 1000 ? n : 0;
  }
  return { ok: true, value: out };
}
