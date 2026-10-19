import { BAND_DAYS } from "./effort";
import { PHASES, type AreaId, type ChangeKind, type EffortBand, type PhaseId, type TaskOwner, type Weekend } from "./types";

// The plan is RULES, not model output (docs/process-design-studio-architecture.md
// section 6.4): phases in a fixed order, a template task list per phase chosen by
// which modules the fit report cited, tasks derived from the changes the client
// kept, and dates computed from a start date and working days. The model may add
// client-specific tasks, never remove a template one. Pure and unit-tested.

export type PlanContext = {
  /** TenantFeatures keys the Standard / Needs setup / Partly rows cite. */
  modules: ReadonlySet<string>;
  areas: ReadonlySet<AreaId>;
  /** The changes the client kept. */
  changes: { id: string; kind: ChangeKind; title: string; effort_band: EffortBand }[];
};

export type PlanTaskDraft = {
  phase: PhaseId;
  name: string;
  owner: TaskOwner;
  duration_days: number;
  milestone: boolean;
  from_template: boolean;
};

type TemplateTask = Omit<PlanTaskDraft, "from_template"> & { when?: (c: PlanContext) => boolean };

const has = (c: PlanContext, ...keys: string[]) => keys.some((k) => c.modules.has(k));

const TEMPLATE: TemplateTask[] = [
  { phase: "foundations", name: "Workspace, users and roles", owner: "bpmsquare", duration_days: 2, milestone: true },
  { phase: "foundations", name: "Company details, currency and tax", owner: "client", duration_days: 1, milestone: false },

  { phase: "master_data", name: "Load customers, contacts and equipment from a spreadsheet", owner: "client", duration_days: 2, milestone: false, when: (c) => has(c, "accounts", "contacts", "assets") },
  { phase: "master_data", name: "Load suppliers", owner: "client", duration_days: 1, milestone: false, when: (c) => has(c, "suppliers", "rfq", "purchasing") },
  { phase: "master_data", name: "Product list, prices and opening stock", owner: "client", duration_days: 3, milestone: false, when: (c) => has(c, "products", "purchasing", "estimator") },
  { phase: "master_data", name: "Check the loaded data together", owner: "client", duration_days: 1, milestone: false, when: (c) => has(c, "accounts", "contacts", "assets", "suppliers", "products") },

  { phase: "sales", name: "Quote statuses, numbering and print templates", owner: "bpmsquare", duration_days: 2, milestone: false, when: (c) => has(c, "quotations", "standard_quotes") },
  { phase: "sales", name: "Pipeline stages", owner: "bpmsquare", duration_days: 1, milestone: false, when: (c) => has(c, "pipeline", "leads") },
  { phase: "sales", name: "Build your estimate templates", owner: "bpmsquare", duration_days: 5, milestone: false, when: (c) => has(c, "estimator") },
  { phase: "sales", name: "Supplier list and request-for-quotation mailbox", owner: "bpmsquare", duration_days: 1, milestone: false, when: (c) => has(c, "rfq") },
  { phase: "sales", name: "Run three real quotes through BPMSquare", owner: "client", duration_days: 3, milestone: true, when: (c) => has(c, "quotations", "standard_quotes", "estimator", "pipeline") },

  { phase: "service_production", name: "Case statuses and the inspection template", owner: "bpmsquare", duration_days: 2, milestone: false, when: (c) => has(c, "cases") },
  { phase: "service_production", name: "Load maintenance contracts and their equipment", owner: "client", duration_days: 2, milestone: false, when: (c) => has(c, "amc") },
  { phase: "service_production", name: "Technicians and dispatch", owner: "bpmsquare", duration_days: 1, milestone: false, when: (c) => has(c, "technicians", "dispatch", "work_orders") },
  { phase: "service_production", name: "Purchase orders and receiving", owner: "bpmsquare", duration_days: 1, milestone: false, when: (c) => has(c, "purchasing") },
  { phase: "service_production", name: "Run five real jobs through BPMSquare", owner: "client", duration_days: 5, milestone: true, when: (c) => has(c, "cases", "work_orders") },

  { phase: "workforce", name: "Sites, shifts and leave types", owner: "client", duration_days: 2, milestone: false, when: (c) => has(c, "wfm") },
  { phase: "workforce", name: "Enrol employees and set up punching", owner: "bpmsquare", duration_days: 3, milestone: false, when: (c) => has(c, "wfm") },
  { phase: "workforce", name: "Parallel run with your current attendance method", owner: "client", duration_days: 10, milestone: true, when: (c) => has(c, "wfm") },

  { phase: "go_live", name: "Train your team", owner: "bpmsquare", duration_days: 2, milestone: false },
  { phase: "go_live", name: "Go live", owner: "client", duration_days: 1, milestone: true },
];

/** Where a kept change lands in the plan: integrations get their own phase, the rest are customisations. */
const phaseOfChange = (k: ChangeKind): PhaseId => (k === "integration" ? "integrations" : "customisations");

export function templateTasks(ctx: PlanContext): PlanTaskDraft[] {
  const out: PlanTaskDraft[] = TEMPLATE
    .filter((t) => !t.when || t.when(ctx))
    .map(({ when: _when, ...t }) => ({ ...t, from_template: true }));
  for (const ch of ctx.changes) {
    out.push({
      phase: phaseOfChange(ch.kind), name: ch.title, owner: "bpmsquare",
      duration_days: BAND_DAYS[ch.effort_band], milestone: false, from_template: true,
    });
  }
  return out;
}

/** Model-suggested extra tasks, made safe: known phase, bounded length and days, no duplicate of a template task. */
export function normaliseExtraTasks(
  raw: unknown,
  existing: readonly Pick<PlanTaskDraft, "name">[],
): { tasks: PlanTaskDraft[]; warnings: string[] } {
  const warnings: string[] = [];
  const seen = new Set(existing.map((t) => t.name.trim().toLowerCase()));
  const tasks: PlanTaskDraft[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const r of list.slice(0, 12)) {
    const t = r as Record<string, unknown>;
    const name = typeof t?.name === "string" ? t.name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    if (!name) continue;
    if (!(PHASES as readonly string[]).includes(String(t.phase))) { warnings.push(`Dropped task "${name}": unknown phase.`); continue; }
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const days = Math.round(Number(t.duration_days));
    tasks.push({
      phase: t.phase as PhaseId,
      name,
      owner: t.owner === "bpmsquare" ? "bpmsquare" : "client",
      duration_days: Number.isFinite(days) ? Math.min(30, Math.max(1, days)) : 1,
      milestone: t.milestone === true,
      from_template: false,
    });
  }
  return { tasks, warnings };
}

// ── Dates ────────────────────────────────────────────────────────────────────

const WEEKEND_DAYS: Record<Weekend, readonly number[]> = { fri_sat: [5, 6], sat_sun: [6, 0], sun: [0] };

const parseDay = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
};
const fmtDay = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

export function isWorkingDay(d: Date, weekend: Weekend): boolean {
  return !WEEKEND_DAYS[weekend].includes(d.getUTCDay());
}

/** The first working day on or after `iso`. */
export function firstWorkingDay(iso: string, weekend: Weekend): string {
  let d = parseDay(iso);
  for (let i = 0; i < 7 && !isWorkingDay(d, weekend); i++) d = addDays(d, 1);
  return fmtDay(d);
}

/**
 * The last day of a block of `days` working days that begins on `startIso`
 * (which must be a working day): one day long ends the day it starts.
 */
export function endOfWorkingDays(startIso: string, days: number, weekend: Weekend): string {
  let d = parseDay(startIso);
  let left = Math.max(1, Math.floor(days)) - 1;
  while (left > 0) {
    d = addDays(d, 1);
    if (isWorkingDay(d, weekend)) left--;
  }
  return fmtDay(d);
}

export type ScheduledPhase = { phase: PhaseId; start: string; end: string; days: number; taskCount: number };

/** Phases one after another, in the fixed order; a phase's days are the sum of its tasks'. Empty phases are dropped. */
export function schedulePhases(
  tasks: readonly { phase: PhaseId; duration_days: number }[],
  startIso: string,
  weekend: Weekend,
): ScheduledPhase[] {
  const out: ScheduledPhase[] = [];
  let cursor = firstWorkingDay(startIso, weekend);
  for (const phase of PHASES) {
    const mine = tasks.filter((t) => t.phase === phase);
    if (mine.length === 0) continue;
    const days = mine.reduce((a, t) => a + Math.max(1, t.duration_days), 0);
    const start = firstWorkingDay(cursor, weekend);
    const end = endOfWorkingDays(start, days, weekend);
    out.push({ phase, start, end, days, taskCount: mine.length });
    cursor = fmtDay(addDays(parseDay(end), 1));
  }
  return out;
}

export function totalWorkingDays(phases: readonly ScheduledPhase[]): number {
  return phases.reduce((a, p) => a + p.days, 0);
}

/** Today in UTC as YYYY-MM-DD, for a default start date. */
export const todayIso = (now: Date = new Date()): string => fmtDay(now);
