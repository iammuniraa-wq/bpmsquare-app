import { readMarginFloor } from "@/lib/contractProjects/budget";
import { FINANCE_DEFAULTS, FINANCE_LIMITS, FINANCE_VISIBILITIES, FINANCE_VISIBILITY_DEFAULT, type FinanceSettings, type FinanceVisibility } from "./types";

// The workspace settings of this module, held in tenants.config.contract_projects (finance_visibility and finance_lights). Pure, so the
// settings route, the loaders and the tests read one set of rules. Anything missing or out of range reads as its default.

type Cfg = { contract_projects?: { finance_visibility?: unknown; finance_lights?: unknown; margin_floor_pct?: unknown } } | null | undefined;

const within = (n: unknown, [lo, hi]: readonly [number, number], fallback: number): number => {
  const v = typeof n === "number" ? n : typeof n === "string" && n.trim() !== "" ? Number(n) : Number.NaN;
  return Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;
};

export const isFinanceVisibility = (v: unknown): v is FinanceVisibility => typeof v === "string" && (FINANCE_VISIBILITIES as readonly string[]).includes(v);

export function readFinanceSettings(config: Cfg): FinanceSettings {
  const cp = config?.contract_projects;
  const lights = (cp?.finance_lights && typeof cp.finance_lights === "object" ? cp.finance_lights : {}) as Record<string, unknown>;
  return {
    visibility: isFinanceVisibility(cp?.finance_visibility) ? cp.finance_visibility : FINANCE_VISIBILITY_DEFAULT,
    dropPoints: within(lights.drop_points, FINANCE_LIMITS.dropPoints, FINANCE_DEFAULTS.dropPoints),
    cashDays: within(lights.cash_days, FINANCE_LIMITS.cashDays, FINANCE_DEFAULTS.cashDays),
    latePct: within(lights.late_pct, FINANCE_LIMITS.latePct, FINANCE_DEFAULTS.latePct),
    freshnessDays: FINANCE_DEFAULTS.freshnessDays,
    marginFloor: readMarginFloor(config),
  };
}

export type ParsedFinanceSettings = { ok: true; value: { finance_visibility?: FinanceVisibility; finance_lights?: { drop_points: number; cash_days: number; late_pct: number } } } | { ok: false; error: string };

/** The part of a settings request body this module owns: the visibility, and the three light numbers (all three together). */
export function parseFinanceSettings(body: Record<string, unknown>): ParsedFinanceSettings {
  const value: Extract<ParsedFinanceSettings, { ok: true }>["value"] = {};
  if ("finance_visibility" in body) {
    if (!isFinanceVisibility(body.finance_visibility)) return { ok: false, error: "Choose who sees cost and margin: everyone, or only people who are granted it" };
    value.finance_visibility = body.finance_visibility;
  }
  if ("finance_lights" in body) {
    const l = (body.finance_lights && typeof body.finance_lights === "object" ? body.finance_lights : null) as Record<string, unknown> | null;
    if (!l) return { ok: false, error: "The light thresholds must be numbers" };
    const num = (k: string, range: readonly [number, number], label: string): number | string => {
      const n = typeof l[k] === "number" ? (l[k] as number) : typeof l[k] === "string" && (l[k] as string).trim() !== "" ? Number(l[k]) : Number.NaN;
      return Number.isFinite(n) && n >= range[0] && n <= range[1] ? Math.round(n * 10) / 10 : `${label} must be a number from ${range[0]} to ${range[1]}`;
    };
    const drop = num("drop_points", FINANCE_LIMITS.dropPoints, "Margin drop");
    const cash = num("cash_days", FINANCE_LIMITS.cashDays, "Billing days");
    const late = num("late_pct", FINANCE_LIMITS.latePct, "Late share");
    for (const x of [drop, cash, late]) if (typeof x === "string") return { ok: false, error: x };
    value.finance_lights = { drop_points: drop as number, cash_days: Math.round(cash as number), late_pct: late as number };
  }
  return { ok: true, value };
}
