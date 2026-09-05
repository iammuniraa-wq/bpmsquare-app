// Project billing arithmetic: which rate an hour gets, and how a period's
// sessions fold into invoice lines. Pure and dependency-free so it is
// unit-testable -- same convention as hours.ts and projectTree.ts. The
// database-facing half is billingServer.ts.
//
// Owner decisions (WFM_PROJECT_COSTING.md §11): actual minutes, never
// rounded to a block; the rate ladder is project override > employment type
// > workspace default; line granularity is chosen per invoice.

export type RateSource = "project" | "parent" | "employment_type" | "default";

export type CostingRates = {
  default_bill_rate: number;
  default_cost_rate: number;
  rates_by_employment_type: Record<string, { bill?: number; cost?: number }>;
};

/**
 * The bill rate for an hour on a project.
 *
 * `chain` is the project's own bill_rate first, then each ancestor's, root
 * last -- the nearest set rate wins, so a rate on the main project covers
 * every sub-project that doesn't set its own. Then the person's employment
 * type, then the workspace default. A rate of 0 is "unset", never "free".
 */
export function resolveBillRate(
  chain: (number | null | undefined)[],
  employmentType: string | null,
  costing: CostingRates
): { rate: number; source: RateSource } {
  for (let i = 0; i < chain.length; i++) {
    const r = chain[i];
    if (typeof r === "number" && r > 0) return { rate: r, source: i === 0 ? "project" : "parent" };
  }
  const byType = employmentType ? costing.rates_by_employment_type[employmentType]?.bill : undefined;
  if (typeof byType === "number" && byType > 0) return { rate: byType, source: "employment_type" };
  return { rate: costing.default_bill_rate > 0 ? costing.default_bill_rate : 0, source: "default" };
}

/** Cost has no project rung: what a person costs does not change with the
 *  job they are on. Employment type, then the workspace default. */
export function resolveCostRate(employmentType: string | null, costing: CostingRates): number {
  const byType = employmentType ? costing.rates_by_employment_type[employmentType]?.cost : undefined;
  if (typeof byType === "number" && byType > 0) return byType;
  return costing.default_cost_rate > 0 ? costing.default_cost_rate : 0;
}

export type BillableSession = {
  project_id: string;
  employee_id: string;
  employment_type: string | null;
  /** Worked minutes, already net of breaks per the tenant's own setting. */
  minutes: number;
};

export type BillingLine = {
  /** The project (or Level-1 sub-project) this line is for. */
  group_id: string;
  group_label: string;
  /** Full line text: the group, plus the employment type when a group
   *  splits by rate. */
  description: string;
  rate: number;
  source: RateSource;
  employment_type: string | null;
  minutes: number;
  /** minutes / 60 to two decimals -- what goes in the invoice's qty. */
  hours: number;
  /** hours × rate, to two decimals, so the printed line is arithmetically
   *  consistent with itself. */
  amount: number;
  /** Internal. Stripped before anything customer- or API-facing. */
  cost: number;
  people: number;
};

export type BuildLinesInput = {
  sessions: BillableSession[];
  /** Which line a project's hours belong on. Under "project" granularity
   *  every project maps to the root; under "sub_project" each maps to its
   *  Level-1 ancestor (or the root for the root's own hours). */
  groupOf: (projectId: string) => { id: string; label: string };
  /** The project's bill_rate, then its ancestors' -- see resolveBillRate. */
  chainFor: (projectId: string) => (number | null | undefined)[];
  costing: CostingRates;
  typeLabel: (code: string) => string;
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fold a period's sessions into invoice lines.
 *
 * One line per group per rate: when two people on the same sub-project are
 * billed at different rates (say a contractor and a full-timer, with no
 * project override), the line splits by employment type so the customer
 * can see why the rates differ, rather than being shown one blended figure.
 */
export function buildBillingLines(input: BuildLinesInput): BillingLine[] {
  type Acc = BillingLine & { _people: Set<string>; _order: number };
  const acc = new Map<string, Acc>();
  // Groups keep the order their hours were first seen (the caller passes
  // sessions in tree order), and lines within a group sit together.
  const groupOrder = new Map<string, number>();

  for (const s of input.sessions) {
    if (s.minutes <= 0) continue;
    const group = input.groupOf(s.project_id);
    const { rate, source } = resolveBillRate(input.chainFor(s.project_id), s.employment_type, input.costing);
    const costRate = resolveCostRate(s.employment_type, input.costing);
    const splitsByType = source === "employment_type";
    const key = `${group.id}|${rate}|${splitsByType ? s.employment_type ?? "" : ""}`;

    if (!groupOrder.has(group.id)) groupOrder.set(group.id, groupOrder.size);
    let row = acc.get(key);
    if (!row) {
      row = {
        group_id: group.id, group_label: group.label, description: group.label,
        rate, source, employment_type: splitsByType ? s.employment_type : null,
        minutes: 0, hours: 0, amount: 0, cost: 0, people: 0,
        _people: new Set(), _order: groupOrder.get(group.id)!,
      };
      acc.set(key, row);
    }
    row.minutes += s.minutes;
    row.cost += (s.minutes / 60) * costRate;
    row._people.add(s.employee_id);
  }

  const lines = [...acc.values()].sort((a, b) => a._order - b._order || a.rate - b.rate);
  const perGroup = new Map<string, number>();
  for (const l of lines) perGroup.set(l.group_id, (perGroup.get(l.group_id) ?? 0) + 1);

  return lines.map((l) => {
    const hours = round2(l.minutes / 60);
    // Only a split group needs its lines told apart. The default-rate line
    // may hold several employment types, so it is named by the rate, not by
    // a type it cannot claim.
    const split = (perGroup.get(l.group_id) ?? 0) > 1;
    const typeSuffix = !split ? "" : l.employment_type ? ` — ${input.typeLabel(l.employment_type)}` : " — standard rate";
    const { _people, _order, ...rest } = l;
    void _order;
    return {
      ...rest,
      description: `${l.group_label}${typeSuffix}`,
      hours,
      amount: round2(hours * l.rate),
      cost: round2(l.cost),
      people: _people.size,
    };
  });
}

/** Inclusive date ranges (YYYY-MM-DD strings compare correctly as text). */
export function periodsOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

/** The previous calendar month for a YYYY-MM-DD "today", as an inclusive
 *  range -- what the month-end auto-draft bills. */
export function previousMonth(today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const first = new Date(Date.UTC(y, m - 2, 1));
  const last = new Date(Date.UTC(y, m - 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}
