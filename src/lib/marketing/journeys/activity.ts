import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import { describeStep } from "./definition";
import { REASON_GROUPS, SKIP_GROUPS, reasonGroup, reasonLabel, type ReasonGroup } from "./reasons";
import { isOverdueByTicks } from "./safety";
import type { JourneyDefinition, RunRow, StepRow } from "./types";

// What is happening in a journey right now, built only from rows the runner
// already writes (journey_runs, journey_run_steps, journey_tasks). No new
// engine and nothing stored twice: counts, the groups of people who were
// skipped and why, and the run log.

export type Person = { run_id: string; contact_name: string; account_name: string; reason: string; reason_label: string; at: string; held: boolean };

export type SkipGroup = { group: ReasonGroup; label: string; count: number; people: Person[] };

export type RunLogItem = {
  run_id: string;
  contact_name: string;
  account_name: string;
  status: "waiting" | "stuck" | "done" | "exited" | "active";
  where: string;
  entered_at: string;
  next_due_at: string | null;
  note: string;
  steps: { title: string; status: string; label: string; at: string; sent: boolean }[];
};

export type Activity = {
  missing: boolean;
  entered: number;
  waiting: number;
  stuck: number;
  finished: number;
  sent: number;
  tasks: number;
  skipped: SkipGroup[];
  skippedTotal: number;
  log: RunLogItem[];
};

const RUN_LIMIT = 1000;
const STEP_LIMIT = 4000;
const PEOPLE_PER_GROUP = 50;
const LOG_ITEMS = 100;

const chunk = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function names(admin: SupabaseClient, tenantId: string, table: "contacts" | "accounts", ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunk([...new Set(ids)], 150)) {
    const { data } = await admin.from(table).select("id, name").eq("tenant_id", tenantId).in("id", part);
    for (const r of (data ?? []) as { id: string; name: string | null }[]) out.set(r.id, r.name ?? "");
  }
  return out;
}

export function classifyRun(run: Pick<RunRow, "status" | "next_due_at">, now: Date): RunLogItem["status"] {
  if (run.status === "done") return "done";
  if (run.status === "exited") return "exited";
  if (run.status === "stalled") return "stuck";
  // A run the runner should have moved a couple of ticks ago has not been picked up, or keeps failing.
  if (isOverdueByTicks(run.next_due_at, now, 2)) return "stuck";
  return "waiting";
}

export async function journeyActivity(admin: SupabaseClient, tenantId: string, journeyId: string, def: JourneyDefinition, now: Date): Promise<Activity> {
  const empty: Activity = { missing: false, entered: 0, waiting: 0, stuck: 0, finished: 0, sent: 0, tasks: 0, skipped: [], skippedTotal: 0, log: [] };
  const runsRes = await admin.from("journey_runs").select("*").eq("tenant_id", tenantId).eq("journey_id", journeyId).order("entered_at", { ascending: false }).limit(RUN_LIMIT);
  if (runsRes.error) {
    if (isSchemaPending(runsRes.error)) return { ...empty, missing: true };
    throw runsRes.error;
  }
  const runs = (runsRes.data ?? []) as RunRow[];
  const stepsRes = await admin.from("journey_run_steps").select("*").eq("tenant_id", tenantId).eq("journey_id", journeyId).order("at", { ascending: true }).limit(STEP_LIMIT);
  const steps = stepsRes.error ? [] : ((stepsRes.data ?? []) as StepRow[]);
  const tasksRes = await admin.from("journey_tasks").select("id").eq("tenant_id", tenantId).eq("journey_id", journeyId);
  const tasks = tasksRes.error ? 0 : (tasksRes.data ?? []).length;

  const [contactNames, accountNames] = await Promise.all([
    names(admin, tenantId, "contacts", runs.map((r) => r.contact_id).filter((x): x is string => !!x)),
    names(admin, tenantId, "accounts", runs.map((r) => r.account_id).filter((x): x is string => !!x)),
  ]);
  const who = (r: RunRow) => ({ contact_name: (r.contact_id && contactNames.get(r.contact_id)) || "Unknown person", account_name: (r.account_id && accountNames.get(r.account_id)) || "" });

  const stepsByRun = new Map<string, StepRow[]>();
  for (const s of steps) stepsByRun.set(s.run_id, [...(stepsByRun.get(s.run_id) ?? []), s]);
  const stepTitle = (id: string) => { const s = def.steps.find((x) => x.id === id); return s ? describeStep(s) : "A step that was removed"; };

  const groups = new Map<ReasonGroup, Person[]>();
  const add = (g: ReasonGroup, p: Person) => groups.set(g, [...(groups.get(g) ?? []), p]);
  const runById = new Map(runs.map((r) => [r.id, r]));
  for (const s of steps) {
    if (s.status !== "skipped" || !s.reason) continue;
    const run = runById.get(s.run_id);
    if (!run) continue;
    add(reasonGroup(s.reason), { run_id: run.id, ...who(run), reason: s.reason, reason_label: reasonLabel(s.reason), at: s.at, held: false });
  }
  let waiting = 0, stuck = 0, finished = 0;
  const log: RunLogItem[] = [];
  for (const r of runs) {
    const cls = classifyRun(r, now);
    if (cls === "waiting") waiting++; else if (cls === "stuck") stuck++; else finished++;
    // A person held by a rule right now is "skipped for the moment" under the same reason group.
    if (r.status === "active" && r.note_reason && ["quiet_hours", "weekly_off", "daily_cap", "account_in_trouble"].includes(r.note_reason)) {
      add(reasonGroup(r.note_reason), { run_id: r.id, ...who(r), reason: r.note_reason, reason_label: reasonLabel(r.note_reason), at: r.entered_at, held: true });
    }
    if (r.status === "exited" && r.exit_reason && !["finished", "journey_archived"].includes(r.exit_reason)) {
      add(reasonGroup(r.exit_reason), { run_id: r.id, ...who(r), reason: r.exit_reason, reason_label: reasonLabel(r.exit_reason), at: r.finished_at ?? r.entered_at, held: false });
    }
    if (log.length < LOG_ITEMS) {
      log.push({
        run_id: r.id, ...who(r), status: cls,
        where: r.current_step_id ? stepTitle(r.current_step_id) : r.status === "done" ? "Finished" : reasonLabel(r.exit_reason),
        entered_at: r.entered_at, next_due_at: r.next_due_at, note: r.last_note ?? "",
        steps: (stepsByRun.get(r.id) ?? []).map((s) => ({ title: stepTitle(s.step_id), status: s.status, label: reasonLabel(s.reason), at: s.at, sent: s.sent })),
      });
    }
  }

  const skipped: SkipGroup[] = SKIP_GROUPS.filter((g) => groups.has(g)).map((g) => {
    const people = groups.get(g) as Person[];
    return { group: g, label: REASON_GROUPS[g], count: people.length, people: people.slice(0, PEOPLE_PER_GROUP) };
  });
  return {
    missing: false, entered: runs.length, waiting, stuck, finished, sent: steps.filter((s) => s.sent).length, tasks,
    skipped, skippedTotal: skipped.reduce((n, g) => n + g.count, 0), log,
  };
}
