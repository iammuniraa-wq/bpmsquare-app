import type { MarketingConfig, TenantConfig } from "@/lib/constants";
import { marketingConfigOf } from "../config";
import { DEFAULT_SLA_BUSINESS_DAYS, DEFAULT_WEEKLY_OFF } from "./timing";

// The hand-over settings (Settings, Marketing, Leads, Hand-over): what happens to a lead between "someone is
// interested" and "a salesperson has it". They live in config.marketing.lifecycle, which
// slaDueFrom() and the assignment already read. Pure, so the settings route, the screen and the
// tests share one reading of them.

export type Lifecycle = NonNullable<MarketingConfig["lifecycle"]>;

export type HandoverSettings = {
  sla_business_days: number;
  weekly_off: number[];
  auto_create_leads: boolean;
  fallback_user_ids: string[];
  overdue_notify: { owner: boolean; team_lead: boolean };
};

export const MAX_SLA_DAYS = 30;
export const MAX_FALLBACK_PEOPLE = 20;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The settings with every default filled in, from whatever the workspace has stored. */
export function handoverOf(config: Partial<TenantConfig> | null | undefined): HandoverSettings {
  const l = marketingConfigOf(config).lifecycle ?? {};
  const days = typeof l.sla_business_days === "number" && Number.isFinite(l.sla_business_days) && l.sla_business_days >= 0
    ? Math.min(MAX_SLA_DAYS, Math.floor(l.sla_business_days)) : DEFAULT_SLA_BUSINESS_DAYS;
  const off = Array.isArray(l.weekly_off) ? [...new Set(l.weekly_off.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [...DEFAULT_WEEKLY_OFF];
  return {
    sla_business_days: days,
    weekly_off: off,
    auto_create_leads: l.auto_create_leads === true,
    fallback_user_ids: Array.isArray(l.fallback_user_ids) ? l.fallback_user_ids.filter((x): x is string => typeof x === "string" && UUID.test(x)).slice(0, MAX_FALLBACK_PEOPLE) : [],
    overdue_notify: { owner: l.overdue_notify?.owner === true, team_lead: l.overdue_notify?.team_lead === true },
  };
}

export type HandoverSave = { ok: true; value: HandoverSettings } | { ok: false; error: string };

/**
 * Validates what the screen sends. `memberIds` is the set of user ids that belong to THIS workspace (read by
 * the route from tenant_users): a fallback person who is not in it is refused, never stored, so an id from a
 * request body cannot put another workspace's person on this workspace's rota.
 */
export function sanitizeHandover(input: unknown, memberIds: ReadonlySet<string>): HandoverSave {
  if (!input || typeof input !== "object") return { ok: false, error: "Nothing to save" };
  const b = input as Record<string, unknown>;

  const rawDays = typeof b.sla_business_days === "number" ? b.sla_business_days : Number(b.sla_business_days);
  if (!Number.isFinite(rawDays) || rawDays < 0 || rawDays > MAX_SLA_DAYS) return { ok: false, error: `Response time is between 0 and ${MAX_SLA_DAYS} working days` };

  const off = Array.isArray(b.weekly_off) ? [...new Set((b.weekly_off as unknown[]).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort() : null;
  if (!off) return { ok: false, error: "Choose the days off" };
  if (off.length >= 7) return { ok: false, error: "At least one day of the week has to be a working day" };

  const ids = Array.isArray(b.fallback_user_ids) ? (b.fallback_user_ids as unknown[]) : [];
  const fallback: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "That person could not be found" };
    if (!memberIds.has(id)) return { ok: false, error: "That person is not a member of this workspace" };
    if (!fallback.includes(id)) fallback.push(id);
  }
  if (fallback.length > MAX_FALLBACK_PEOPLE) return { ok: false, error: `Choose at most ${MAX_FALLBACK_PEOPLE} people` };

  const n = (b.overdue_notify && typeof b.overdue_notify === "object" ? b.overdue_notify : {}) as Record<string, unknown>;
  return {
    ok: true,
    value: {
      sla_business_days: Math.floor(rawDays),
      weekly_off: off,
      auto_create_leads: b.auto_create_leads === true,
      fallback_user_ids: fallback,
      overdue_notify: { owner: n.owner === true, team_lead: n.team_lead === true },
    },
  };
}

/** The lifecycle block to store: the new settings over whatever else the block already held. */
export function mergeLifecycle(existing: Lifecycle | undefined, next: HandoverSettings): Lifecycle {
  return { ...(existing ?? {}), ...next };
}
