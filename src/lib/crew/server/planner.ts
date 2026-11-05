import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eventsAfter, type EventCursor } from "@/lib/events/consume";
import { MAX_EVENT_DEPTH } from "@/lib/events/catalog";
import { dayKey } from "@/lib/tender/rules";
import { dailySlot } from "../core/schedule";
import { purgeAfter } from "../core/fingerprint";
import { agentModule } from "../definitions";
import { AGENTS, type AgentEntry } from "../registry";
import type { AgentSettings, PlanCtx, RunRequest, RunTrigger } from "../types";
import { crewDisabled } from "./model";
import { enqueueRuns, isPending, loadSettings, recentRunCount, type NewRun } from "./store";
import { loadCrewTenant, type CrewTenant } from "./tenant";

// The plan cron's brain (docs/design/nova-crew-agents.md section 3.3): per workspace with an enabled agent, (1) the schedule slot and
// (2) domain_event wake-ups. Both only INSERT runs; the work cron executes them. A double tick, a retried request or two overlapping
// crons enqueue nothing twice because (tenant_id, dedupe_key) is unique.

const EVENT_DAILY_CAP = 40;
const LEASE_MS = 4 * 60_000;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

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
    if (!tenant.hasTimezone) { out.notes.push(`${tenant.slug}: set the workspace time zone first`); continue; }

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

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function takeCursor(admin: SupabaseClient, tenantId: string, now: Date): Promise<{ cursor: EventCursor; fresh: boolean } | "busy" | "pending"> {
  const seed = await admin.from("crew_cursors").upsert({ tenant_id: tenantId }, { onConflict: "tenant_id", ignoreDuplicates: true });
  if (seed.error) return isPending(seed.error) ? "pending" : "busy";
  const { data, error } = await admin.from("crew_cursors")
    .update({ locked_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq("tenant_id", tenantId).or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`).select("last_created_at, last_event_id");
  if (error) return isPending(error) ? "pending" : "busy";
  const row = (data ?? [])[0] as { last_created_at: string | null; last_event_id: string | null } | undefined;
  if (!row) return "busy";
  // A workspace whose bookmark does not exist yet starts from now: history is never replayed into model runs.
  return row.last_created_at ? { cursor: { created_at: row.last_created_at, id: row.last_event_id ?? "" }, fresh: false } : { cursor: { created_at: now.toISOString(), id: "" }, fresh: true };
}

async function saveCursor(admin: SupabaseClient, tenantId: string, c: EventCursor, now: Date) {
  await admin.from("crew_cursors").update({ last_created_at: c.created_at, last_event_id: c.id || null, locked_until: null, updated_at: now.toISOString() }).eq("tenant_id", tenantId);
}

/** Deal ids that woke the agent since the cursor. rfq.replied is about an RFQ, so its tender deal is looked up (tenant-scoped). */
async function dealsFromEvents(admin: SupabaseClient, tenantId: string, events: { name: string; object_type: string; object_id: string | null; source: string; depth: number }[]): Promise<string[]> {
  const deals = new Set<string>();
  const rfqIds: string[] = [];
  for (const e of events) {
    if (e.source === "runner" || e.depth >= 1 || e.depth > MAX_EVENT_DEPTH || !e.object_id) continue;
    if (e.object_type === "opportunity") deals.add(e.object_id);
    else if (e.object_type === "rfq") rfqIds.push(e.object_id);
  }
  if (rfqIds.length) {
    const { data } = await admin.from("rfqs").select("origin_id").eq("tenant_id", tenantId).eq("origin_type", "opportunity").in("id", rfqIds.slice(0, 100));
    for (const r of (data ?? []) as { origin_id: string | null }[]) if (r.origin_id) deals.add(r.origin_id);
  }
  return [...deals];
}

export async function planEvents(admin: SupabaseClient, tenant: CrewTenant, now: Date): Promise<{ woken: number; notes: string[] }> {
  const out = { woken: 0, notes: [] as string[] };
  const entry = AGENTS.find((a) => a.key === "tender_watch")!;
  if (tenant.features.crew !== true || tenant.features.crew_tender_watch !== true || crewDisabled() || !agentModule("tender_watch") || entry.engine !== "ready") return out;
  const settings = await loadSettings(admin, tenant.id);
  if (settings.pending || !settings.get("tender_watch").enabled || !tenant.hasTimezone) return out;
  const taken = await takeCursor(admin, tenant.id, now);
  if (taken === "busy" || taken === "pending") return out;
  const { cursor, fresh } = taken;
  if (fresh) { await saveCursor(admin, tenant.id, cursor, now); return out; }

  const names = agentModule("tender_watch")!.def.triggers.events ?? [];
  const events = await eventsAfter(admin, tenant.id, cursor, names);
  if (events.length === 0) { await saveCursor(admin, tenant.id, cursor, now); return out; }
  const last = events[events.length - 1];

  const today = new Date(now.getTime() - 86_400_000).toISOString();
  const used = await recentRunCount(admin, tenant.id, "tender_watch", "event", today);
  const deals = (await dealsFromEvents(admin, tenant.id, events)).slice(0, Math.max(0, Math.min(20, EVENT_DAILY_CAP - used)));
  for (const dealId of deals) {
    const r = await planTenant(admin, tenant, now, "event", dealId, "tender_watch");
    out.woken += r.enqueued;
    out.notes.push(...r.notes);
  }
  await saveCursor(admin, tenant.id, { created_at: last.created_at, id: last.id }, now);
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
      const ev = await planEvents(admin, tenant, now);
      sum.enqueued += ev.woken; sum.skipped.push(...ev.notes);
    } catch (e) {
      sum.skipped.push(`${t.id}: ${(e as Error).message}`);
    }
  }
  return sum;
}

export { ZERO_UUID };
