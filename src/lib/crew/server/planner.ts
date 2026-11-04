import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dayKey } from "@/lib/tender/rules";
import { dailySlot } from "../core/schedule";
import { purgeAfter } from "../core/fingerprint";
import { agentModule } from "../definitions";
import { AGENTS, type AgentEntry } from "../registry";
import type { AgentSettings, PlanCtx, RunRequest, RunTrigger } from "../types";
import { crewDisabled } from "./model";
import { enqueueRuns, loadSettings, type NewRun } from "./store";
import { loadCrewTenant, type CrewTenant } from "./tenant";

// The plan cron's brain (docs/design/nova-crew-agents.md section 3.3): per workspace with an enabled agent, (1) the schedule slot and
// (2) domain_event wake-ups. Both only INSERT runs; the work cron executes them. A double tick, a retried request or two overlapping
// crons enqueue nothing twice because (tenant_id, dedupe_key) is unique.


export type PlanSummary = { tenants: number; enqueued: number; quiet: number; paused: number; skipped: string[]; pending: boolean };

function toNewRun(r: RunRequest, entry: AgentEntry, today: string, status?: NewRun["status"], promptVersion?: string | null): NewRun {
  const quiet = r.candidate_ids.length === 0;
  return {
    agent_key: r.agent_key, trigger: r.trigger, trigger_ref: r.trigger_ref, scope: r.scope, candidates: r.candidate_ids, dedupe_key: r.dedupe_key,
    status: status ?? (quiet ? "done" : "queued"), snapshot: r.snapshot ?? null, nothing_to_report: quiet && !status ? r.trigger_ref : null,
    purge_after: purgeAfter(today, entry.defaults.retentionDays), prompt_version: promptVersion ?? null,
  };
}

function stoppedFor(ws: AgentSettings, agent: AgentSettings): boolean {
  return agent.paused || ws.paused;
}

export async function planTenant(admin: SupabaseClient, tenant: CrewTenant, now: Date, trigger: RunTrigger = "schedule", eventDealId: string | null = null, only?: AgentEntry["key"]): Promise<{ enqueued: number; quiet: number; paused: number; notes: string[]; pending: boolean }> {
  const out = { enqueued: 0, quiet: 0, paused: 0, notes: [] as string[], pending: false };
  if (tenant.features.crew !== true || crewDisabled()) return out;
  const settings = await loadSettings(admin, tenant.id);
  if (settings.pending) { out.pending = true; return out; }
  const ws = settings.get("_workspace");
  const today = dayKey(now, tenant.timezone);

  for (const entry of AGENTS) {
    if (only && entry.key !== only) continue;
    if (tenant.features[entry.flag] !== true || !entry.requires.every((k) => tenant.features[k] === true)) continue;
    const mod = agentModule(entry.key);
    if (entry.engine !== "ready" || !mod) continue;
    const s = settings.get(entry.key);
    if (!s.enabled) continue;
    if (entry.key === "tender_watch" && !tenant.hasTimezone) { out.notes.push(`${tenant.slug}: set the workspace time zone first`); continue; }

    if (stoppedFor(ws, s)) {
      // A pause is visible, not silent: the slot is recorded as skipped_paused.
      if (trigger === "schedule") {
        const slot = dailySlot(entry.key, s.config.schedule ?? entry.defaults.schedule, now, tenant.timezone);
        if (slot.due) {
          const r = await enqueueRuns(admin, tenant.id, [toNewRun({ agent_key: entry.key, trigger, trigger_ref: "Daily pass", scope: {}, dedupe_key: slot.key, candidate_ids: [] }, entry, today, "skipped_paused")]);
          out.paused += r.ids.length;
        }
      }
      continue;
    }

    const ctx: PlanCtx = { admin, tenantId: tenant.id, now, timezone: tenant.timezone, settings: s, features: tenant.features, eventDealId, trigger };
    let requests: RunRequest[] = [];
    try { requests = await mod.def.plan(ctx); } catch (e) { out.notes.push(`${tenant.slug}/${entry.key}: ${(e as Error).message}`); continue; }
    const rows = requests
      .filter((r) => trigger !== "event" || r.candidate_ids.length > 0)
      .map((r) => toNewRun(r, entry, today, undefined, mod.def.promptVersion));
    const made = await enqueueRuns(admin, tenant.id, rows);
    if (made.pending) { out.pending = true; continue; }
    // Count what was really new: a quiet pass is recorded as done and costs nothing.
    const quietKeys = new Set(rows.filter((r) => r.status === "done").map((r) => r.dedupe_key));
    const newQuiet = rows.filter((r) => quietKeys.has(r.dedupe_key)).length;
    out.enqueued += Math.max(0, made.ids.length - (made.ids.length > 0 ? Math.min(newQuiet, made.ids.length) : 0));
    out.quiet += made.ids.length > 0 ? Math.min(newQuiet, made.ids.length) : 0;
  }
  return out;
}

// ── Everything ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function planAll(admin: SupabaseClient, now: Date = new Date()): Promise<PlanSummary> {
  const sum: PlanSummary = { tenants: 0, enqueued: 0, quiet: 0, paused: 0, skipped: [], pending: false };
  if (crewDisabled()) return sum;
  const { data, error } = await admin.from("tenants").select("id").contains("features", { crew: true }).limit(500);
  if (error) { sum.skipped.push(error.message); return sum; }
  for (const t of (data ?? []) as { id: string }[]) {
    try {
      const tenant = await loadCrewTenant(admin, t.id);
      if (!tenant) continue;
      sum.tenants++;
      const r = await planTenant(admin, tenant, now);
      sum.enqueued += r.enqueued; sum.quiet += r.quiet; sum.paused += r.paused; sum.skipped.push(...r.notes);
      if (r.pending) sum.pending = true;
    } catch (e) {
      sum.skipped.push(`${t.id}: ${(e as Error).message}`);
    }
  }
  return sum;
}

