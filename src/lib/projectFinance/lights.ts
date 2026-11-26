import type { BehindOnBilling } from "./rules";
import { LIGHT_WORD, OVERDUE_RISK_DAYS, type FinanceSettings, type Light, type LightId, type LightLevel, type Lights, type Num } from "./types";

// The three health lights of a project (design section 6): Margin, Cash, Delivery. Each is a word as well as a colour. Without a forecast a
// light is a grey ring "Not connected"; the one exception is a plan that is itself below the floor or below zero, which is a real finding.

const make = (id: LightId, level: LightLevel, why: string | null): Light => ({ id, level, word: LIGHT_WORD[level], why });
const pt = (n: number) => `${Math.round(n * 10) / 10}`;

export function marginLight(args: { forecastPct: Num; plannedPct: Num; floor: Num; dropPoints: number }): Light {
  const { forecastPct: f, plannedPct: p, floor, dropPoints } = args;
  if (f !== null) {
    const drop = p !== null ? p - f : null;
    if (f < 0) return make("margin", "risk", "The forecast margin is below zero");
    if (drop !== null && drop >= dropPoints) return make("margin", "risk", `The forecast is ${pt(drop)} points below the plan`);
    if (floor !== null && f < floor) return make("margin", "watch", `The forecast margin is below the ${pt(floor)}% floor`);
    if (drop !== null && drop >= dropPoints / 2) return make("margin", "watch", `The forecast is ${pt(drop)} points below the plan`);
    return make("margin", "good", null);
  }
  if (p !== null && p < 0) return make("margin", "plan_risk", "The planned margin is below zero");
  if (p !== null && floor !== null && p < floor) return make("margin", "plan_watch", `The planned margin is below the ${pt(floor)}% floor`);
  return make("margin", "not_connected", null);
}

/** `behind` is null while nothing tells whether milestones were invoiced; `overdueDays` is the oldest unpaid invoice past due (needs the ERP's due dates). */
export function cashLight(args: { behind: BehindOnBilling | null; overdueDays: Num; cashDays: number }): Light {
  const { behind, overdueDays, cashDays } = args;
  if (!behind) return make("cash", "not_connected", null);
  if (behind.count > 0 && behind.oldestDays > cashDays) return make("cash", "risk", `A milestone is ${behind.oldestDays} days behind on billing`);
  if (overdueDays !== null && overdueDays > OVERDUE_RISK_DAYS) return make("cash", "risk", `An invoice is ${overdueDays} days overdue`);
  if (behind.count > 0) return make("cash", "watch", `${behind.count} milestone${behind.count === 1 ? "" : "s"} behind on billing`);
  return make("cash", "good", null);
}

/** `latePct` is late elements as a share of what was planned by today; null until delivery is connected. */
export function deliveryLight(args: { latePct: Num; settings: Pick<FinanceSettings, "latePct"> }): Light {
  const { latePct: l, settings } = args;
  if (l === null) return make("delivery", "not_connected", null);
  if (l >= settings.latePct) return make("delivery", "risk", `${pt(l)}% of what was planned by today is late`);
  if (l >= settings.latePct / 3) return make("delivery", "watch", `${pt(l)}% of what was planned by today is late`);
  return make("delivery", "good", null);
}

export function lightsOf(args: {
  forecastPct: Num; plannedPct: Num; behind: BehindOnBilling | null; overdueDays?: Num; latePct?: Num; settings: FinanceSettings;
}): Lights {
  return {
    margin: marginLight({ forecastPct: args.forecastPct, plannedPct: args.plannedPct, floor: args.settings.marginFloor, dropPoints: args.settings.dropPoints }),
    cash: cashLight({ behind: args.behind, overdueDays: args.overdueDays ?? null, cashDays: args.settings.cashDays }),
    delivery: deliveryLight({ latePct: args.latePct ?? null, settings: args.settings }),
  };
}

/** A light is "hollow" when it states a plan finding rather than a forecast one. */
export const isPlanLight = (l: Light): boolean => l.level === "plan_watch" || l.level === "plan_risk";

/** Count the projects at each level of one light: the portfolio donut. */
export function countLevels(lights: readonly Light[]): Record<LightLevel, number> {
  const out: Record<LightLevel, number> = { good: 0, watch: 0, risk: 0, not_connected: 0, plan_watch: 0, plan_risk: 0 };
  for (const l of lights) out[l.level]++;
  return out;
}
