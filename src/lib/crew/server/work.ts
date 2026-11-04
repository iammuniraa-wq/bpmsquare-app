import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysIso } from "../core/fingerprint";
import { executeRun, type RunnerDeps } from "./runner";
import { claimRun, nextQueued, requeueExpired } from "./store";

// The work cron's brain (docs/design/nova-crew-agents.md section 3.3): claims queued runs, a few per tick, one workspace at a time in
// rotation (so a busy workspace cannot starve another), runs them under a time budget, and expires proposals nobody answered.

export const LEASE_MS = 5 * 60_000;
const MAX_RUNS_PER_TICK = 4;
const TIME_BUDGET_MS = 150_000;

/** Interleave queued runs so each workspace gets a turn before any gets a second. */
export function rotate<T extends { tenant_id: string }>(rows: readonly T[]): T[] {
  const by = new Map<string, T[]>();
  for (const r of rows) (by.get(r.tenant_id) ?? by.set(r.tenant_id, []).get(r.tenant_id)!).push(r);
  const out: T[] = [];
  for (let i = 0; out.length < rows.length; i++) {
    let any = false;
    for (const list of by.values()) if (list[i]) { out.push(list[i]); any = true; }
    if (!any) break;
  }
  return out;
}

export type WorkSummary = { claimed: number; done: number; failed: number; skipped: number; expired: number };

export async function workTick(admin: SupabaseClient, deps: RunnerDeps & { budgetMs?: number } = {}): Promise<WorkSummary> {
  const sum: WorkSummary = { claimed: 0, done: 0, failed: 0, skipped: 0, expired: 0 };
  const now = deps.now ? deps.now() : new Date();
  const started = Date.now();
  await requeueExpired(admin, now);
  sum.expired = await expireProposals(admin, now);

  for (const run of rotate(await nextQueued(admin, MAX_RUNS_PER_TICK))) {
    if (sum.claimed >= MAX_RUNS_PER_TICK || Date.now() - started > (deps.budgetMs ?? TIME_BUDGET_MS)) break;
    if (!(await claimRun(admin, run, LEASE_MS, now))) continue;
    sum.claimed++;
    const r = await executeRun(admin, { ...run, attempt: run.attempt + 1 }, deps);
    if (r.status === "done") sum.done++;
    else if (r.status === "failed") sum.failed++;
    else sum.skipped++;
  }
  return sum;
}

/** A pending proposal past its expiry becomes expired (it can no longer be approved). */
export async function expireProposals(admin: SupabaseClient, now: Date): Promise<number> {
  const { data, error } = await admin.from("crew_proposals").update({ status: "expired", decision_note: "Not answered in time" }).eq("status", "pending").lt("expires_at", now.toISOString()).select("id");
  return error ? 0 : (data ?? []).length;
}

/** Retention (design 3.13): runs and steps and findings past purge_after go; a silenced finding keeps only its fingerprint and status. */
export async function retentionTick(admin: SupabaseClient, now: Date = new Date()): Promise<{ runs: number; findings: number; blanked: number; proposals: number }> {
  const today = now.toISOString().slice(0, 10);
  const out = { runs: 0, findings: 0, blanked: 0, proposals: 0 };
  const del = await admin.from("crew_findings").delete().lt("purge_after", today).or(`suppress_until.is.null,suppress_until.lt.${today}`).select("id");
  out.findings = del.error ? 0 : (del.data ?? []).length;
  const blank = await admin.from("crew_findings").update({ title: "", body: "", evidence: [], gaps: [] }).lt("purge_after", today).gte("suppress_until", today).neq("title", "").select("id");
  out.blanked = blank.error ? 0 : (blank.data ?? []).length;
  const runs = await admin.from("crew_runs").delete().lt("purge_after", today).select("id");
  out.runs = runs.error ? 0 : (runs.data ?? []).length;
  const props = await admin.from("crew_proposals").delete().neq("status", "pending").lt("created_at", `${addDaysIso(today, -180)}T00:00:00Z`).select("id");
  out.proposals = props.error ? 0 : (props.data ?? []).length;
  return out;
}
