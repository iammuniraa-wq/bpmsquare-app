// The strip above the contract projects list: what is running, what it is worth and where the margin is thin. Pure, so the list page
// and its test share it. Totals cover active projects only; they are not summed across currencies.

export type SummaryInput = {
  status: string;
  contract_value: number;
  currency: string | null;
  budget_total: number | null;
  margin_pct: number | null;
};

export type ProjectsSummary = {
  active: number;
  /** The one currency the active projects share, "" when they differ (a total would mean nothing), null when there are none. */
  currency: string | "" | null;
  contractValue: number;
  budget: number;
  /** Active projects with a planned margin below the floor, and how many of those are below zero. */
  lowMargin: number;
  negativeMargin: number;
};

export function summariseProjects(rows: SummaryInput[], marginFloor = 10): ProjectsSummary {
  const active = rows.filter((r) => r.status === "active");
  const currencies = new Set(active.map((r) => r.currency ?? ""));
  const withMargin = active.filter((r) => r.margin_pct !== null);
  return {
    active: active.length,
    currency: active.length === 0 ? null : currencies.size === 1 ? [...currencies][0] : "",
    contractValue: active.reduce((s, r) => s + r.contract_value, 0),
    budget: active.reduce((s, r) => s + (r.budget_total ?? 0), 0),
    lowMargin: withMargin.filter((r) => (r.margin_pct as number) < marginFloor).length,
    negativeMargin: withMargin.filter((r) => (r.margin_pct as number) < 0).length,
  };
}
