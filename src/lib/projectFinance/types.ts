// Project cost-to-complete and profitability (docs/design/pcbs-project-dashboards.md). Plain types and constants, no I/O and no server
// imports, so the loaders, the screens and the tests read the same words. Cost and margin are INTERNAL: nothing in this folder is ever
// printed on a customer document or exposed through the v1 API, MCP, Data Workbench, Talk to data or the change feed.

/** `null` in, `null` out: no function in this folder turns a missing input into 0 (the `coverageOf` habit). */
export type Num = number | null;

export const FINANCE_VISIBILITIES = ["everyone", "granted"] as const;
export type FinanceVisibility = (typeof FINANCE_VISIBILITIES)[number];
export const FINANCE_VISIBILITY_DEFAULT: FinanceVisibility = "everyone";

/** What the ERP read-back lands, one kind per snapshot (migration 0262). Only the first two feed the cost forecast. */
export const ERP_KINDS = ["cost_actual", "cost_committed", "billed", "received", "delivered", "planned_delivery"] as const;
export type ErpKind = (typeof ERP_KINDS)[number];

/** One vocabulary of states on every tile, row and light (design section 5). */
export const CONN_STATES = ["live", "stale", "not_connected", "nothing_posted", "failed"] as const;
export type ConnState = (typeof CONN_STATES)[number];

/** A figure with the state it was read in: `value` is null exactly while there is nothing honest to show. */
export type Reading<T = number> = { state: ConnState; value: T | null; asOf: string | null };

export type FinanceSettings = {
  visibility: FinanceVisibility;
  /** Margin: At risk when the forecast falls this many points below the plan; Watch at half. */
  dropPoints: number;
  /** Cash: At risk when a milestone is more than this many days behind on billing. */
  cashDays: number;
  /** Delivery: At risk when this share of what was planned by today is late; Watch at a third of it. */
  latePct: number;
  /** Facts older than this are stale. */
  freshnessDays: number;
  /** The workspace's margin floor (Settings > Contract projects); null when none is set. */
  marginFloor: number | null;
};

export const FINANCE_DEFAULTS = { dropPoints: 5, cashDays: 30, latePct: 15, freshnessDays: 3 } as const;
/** An invoice more than this many days past its due date puts the cash light at risk (needs the ERP's due dates). */
export const OVERDUE_RISK_DAYS = 60;

export const FINANCE_LIMITS = { dropPoints: [0.5, 50], cashDays: [1, 365], latePct: [1, 100] } as const;

export type LightId = "margin" | "cash" | "delivery";
/** `plan_watch` / `plan_risk`: no forecast yet, but the plan itself is below the floor or below zero (a real finding, drawn hollow). */
export type LightLevel = "good" | "watch" | "risk" | "not_connected" | "plan_watch" | "plan_risk";
export type Light = { id: LightId; level: LightLevel; word: string; why: string | null };

export const LIGHT_LABEL: Record<LightId, string> = { margin: "Margin", cash: "Cash", delivery: "Delivery" };
export const LIGHT_WORD: Record<LightLevel, string> = {
  good: "On track", watch: "Watch", risk: "At risk", not_connected: "Not connected", plan_watch: "Plan below floor", plan_risk: "Plan below floor",
};

/** The three lights of one project. */
export type Lights = Record<LightId, Light>;
