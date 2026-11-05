import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sumTokens, monthStartIso, type UsageRow } from "@/lib/ai/usageCap";
import { isSchemaPending } from "@/lib/marketing/pending";
import { AGENTS, agentEntry } from "../registry";
import type {
  AgentConfig, AgentKey, AgentSettings, Finding, FindingStatus, Proposal, RunScope, RunStatus, RunTrigger, SettingsKey,
} from "../types";

// Data access for AI automation (migrations 0245 / 0246). Every query carries `.eq("tenant_id", tenantId)`: these tables have no
// member policy, so the service role is the only reader and the filter is the only isolation (MULTI_TENANT_GUARDRAILS.md). A table
// that is not there yet reads as `pending` (42P01 / PGRST205), never as an error.

export const isPending = isSchemaPending;
const PAGE = 1000;

export const SURFACE: Record<AgentKey, string> = { tender_watch: "crew:tender_watch", attendance: "crew:attendance" };

// ── Settings ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

const SETTINGS_COLS = "agent_key, enabled, paused, config, monthly_token_cap, updated_at";

const blank = (key: SettingsKey): AgentSettings => ({ agent_key: key, enabled: false, paused: false, config: {}, monthly_token_cap: null, updated_at: null });

function asSettings(r: Record<string, unknown>): AgentSettings {
  return {
    agent_key: r.agent_key as SettingsKey, enabled: r.enabled === true, paused: r.paused === true,
    config: (r.config && typeof r.config === "object" ? r.config : {}) as AgentConfig,
    monthly_token_cap: typeof r.monthly_token_cap === "number" ? r.monthly_token_cap : null,
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

export type SettingsMap = { pending: boolean; byKey: Map<SettingsKey, AgentSettings>; get: (k: SettingsKey) => AgentSettings };

export async function loadSettings(admin: SupabaseClient, tenantId: string): Promise<SettingsMap> {
  const { data, error } = await admin.from("crew_agent_settings").select(SETTINGS_COLS).eq("tenant_id", tenantId);
  const byKey = new Map<SettingsKey, AgentSettings>();
  if (error) return { pending: isPending(error), byKey, get: blank };
  for (const r of (data ?? []) as Record<string, unknown>[]) byKey.set(r.agent_key as SettingsKey, asSettings(r));
  return { pending: false, byKey, get: (k) => byKey.get(k) ?? blank(k) };
}

export async function saveSettings(
  admin: SupabaseClient, tenantId: string, key: SettingsKey, userId: string,
  patch: Partial<Pick<AgentSettings, "enabled" | "paused" | "config">> & { monthly_token_cap?: number | null },
): Promise<{ ok: true; before: AgentSettings; after: AgentSettings } | { ok: false; error: string; pending: boolean }> {
  const cur = await loadSettings(admin, tenantId);
  if (cur.pending) return { ok: false, error: "AI automation needs a database update (migration 0245).", pending: true };
  const before = cur.get(key);
  const row = {
    tenant_id: tenantId, agent_key: key,
    enabled: patch.enabled ?? before.enabled, paused: patch.paused ?? before.paused,
    config: patch.config ?? before.config,
    monthly_token_cap: patch.monthly_token_cap === undefined ? before.monthly_token_cap : patch.monthly_token_cap,
    updated_by: userId, updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("crew_agent_settings").upsert(row, { onConflict: "tenant_id,agent_key" });
  if (error) return { ok: false, error: error.message, pending: isPending(error) };
  return { ok: true, before, after: asSettings(row as unknown as Record<string, unknown>) };
}

// ── Usage ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Tokens this workspace's agent has used since the start of the month (ai_usage_log, surface crew:<agent>). A missing table reads as zero. */
export async function agentTokensUsed(admin: SupabaseClient, tenantId: string, agent: AgentKey, now: Date = new Date()): Promise<number> {
  const since = monthStartIso(now);
  let total = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from("ai_usage_log").select("input_tokens, output_tokens")
      .eq("tenant_id", tenantId).eq("surface", SURFACE[agent]).gte("created_at", since).range(from, from + PAGE - 1);
    if (error) return total;
    const rows = (data ?? []) as UsageRow[];
    total += sumTokens(rows);
    if (rows.length < PAGE) break;
  }
  return total;
}

// ── Runs ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RunRow = {
  id: string; tenant_id: string; agent_key: AgentKey; trigger: RunTrigger; trigger_ref: string | null; scope: RunScope; candidates: string[];
  dedupe_key: string; status: RunStatus; attempt: number; model: string | null; prompt_version: string | null;
  input_tokens: number; output_tokens: number; turns: number; tool_calls: number; findings_count: number; proposals_count: number;
  nothing_to_report: string | null; snapshot: Record<string, unknown> | null; error: string | null; requested_by: string | null;
  queued_at: string; started_at: string | null; finished_at: string | null; created_at: string;
};

export const RUN_COLS = "id, tenant_id, agent_key, trigger, trigger_ref, scope, candidates, dedupe_key, status, attempt, model, prompt_version, input_tokens, output_tokens, turns, tool_calls, findings_count, proposals_count, nothing_to_report, snapshot, error, requested_by, queued_at, started_at, finished_at, created_at";

export type NewRun = { agent_key: AgentKey; trigger: RunTrigger; trigger_ref: string; scope: RunScope; candidates: string[]; dedupe_key: string; status?: RunStatus; requested_by?: string | null; purge_after?: string | null; prompt_version?: string | null; snapshot?: Record<string, unknown> | null; nothing_to_report?: string | null };

/** Inserts runs; a repeated dedupe_key records nothing twice. Returns the ids of the rows that were really new. */
export async function enqueueRuns(admin: SupabaseClient, tenantId: string, runs: readonly NewRun[]): Promise<{ ids: string[]; pending: boolean }> {
  if (runs.length === 0) return { ids: [], pending: false };
  const { data, error } = await admin.from("crew_runs")
    .upsert(runs.map((r) => ({
      tenant_id: tenantId, agent_key: r.agent_key, trigger: r.trigger, trigger_ref: r.trigger_ref, scope: r.scope, candidates: r.candidates,
      dedupe_key: r.dedupe_key, status: r.status ?? "queued", requested_by: r.requested_by ?? null, purge_after: r.purge_after ?? null, prompt_version: r.prompt_version ?? null, snapshot: r.snapshot ?? null, nothing_to_report: r.nothing_to_report ?? null,
      ...(r.status && r.status !== "queued" ? { finished_at: new Date().toISOString() } : {}),
    })), { onConflict: "tenant_id,dedupe_key", ignoreDuplicates: true }).select("id");
  if (error) return { ids: [], pending: isPending(error) };
  return { ids: ((data ?? []) as { id: string }[]).map((r) => r.id), pending: false };
}

/** Compare-and-set claim: the run is ours only if one row changed. An expired lease puts a running row back to queued once. */
export async function claimRun(admin: SupabaseClient, run: Pick<RunRow, "id" | "tenant_id" | "attempt">, leaseMs: number, now: Date): Promise<boolean> {
  const { data, error } = await admin.from("crew_runs")
    .update({ status: "running", locked_until: new Date(now.getTime() + leaseMs).toISOString(), attempt: run.attempt + 1, started_at: now.toISOString() })
    .eq("id", run.id).eq("tenant_id", run.tenant_id).eq("status", "queued").select("id");
  return !error && (data ?? []).length > 0;
}

/** Runs whose lease ran out go back to queued once (attempt < 2) or fail. */
export async function requeueExpired(admin: SupabaseClient, now: Date): Promise<void> {
  const iso = now.toISOString();
  await admin.from("crew_runs").update({ status: "queued" }).eq("status", "running").lt("locked_until", iso).lt("attempt", 2);
  await admin.from("crew_runs").update({ status: "failed", error: "The run did not finish (worker stopped).", finished_at: iso }).eq("status", "running").lt("locked_until", iso).gte("attempt", 2);
}

export async function nextQueued(admin: SupabaseClient, limit: number): Promise<RunRow[]> {
  const { data, error } = await admin.from("crew_runs").select(RUN_COLS).eq("status", "queued").order("queued_at", { ascending: true }).limit(limit * 6);
  if (error) return [];
  return (data ?? []) as unknown as RunRow[];
}

export async function finishRun(admin: SupabaseClient, tenantId: string, runId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("crew_runs").update({ ...patch, finished_at: new Date().toISOString(), locked_until: null }).eq("id", runId).eq("tenant_id", tenantId);
  if (error) console.error("[crew] run could not be closed", error.message);
}

export async function loadRun(admin: SupabaseClient, tenantId: string, runId: string): Promise<RunRow | null> {
  const { data } = await admin.from("crew_runs").select(RUN_COLS).eq("tenant_id", tenantId).eq("id", runId).maybeSingle();
  return (data as unknown as RunRow | null) ?? null;
}

export async function listRuns(admin: SupabaseClient, tenantId: string, agent: AgentKey | null, limit = 50): Promise<{ rows: RunRow[]; pending: boolean }> {
  let q = admin.from("crew_runs").select(RUN_COLS).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(limit);
  if (agent) q = q.eq("agent_key", agent);
  const { data, error } = await q;
  if (error) return { rows: [], pending: isPending(error) };
  return { rows: (data ?? []) as unknown as RunRow[], pending: false };
}

/** The most recent finished run of an agent (its snapshot says what was seen last time). */
export async function lastDoneRun(admin: SupabaseClient, tenantId: string, agent: AgentKey): Promise<RunRow | null> {
  const { data } = await admin.from("crew_runs").select(RUN_COLS).eq("tenant_id", tenantId).eq("agent_key", agent).eq("status", "done").order("finished_at", { ascending: false }).limit(1);
  return ((data ?? [])[0] as unknown as RunRow | undefined) ?? null;
}

/** Has a run (any status) been recorded for this agent for the shift-day that closed on `day`'s eve? Keys look like `attendance|site:<id>|day:<yyyy-mm-dd>` (see attendance/plan.ts dedupeKeyFor). */
export async function hasRunForDay(admin: SupabaseClient, tenantId: string, agent: AgentKey, today: string): Promise<boolean> {
  const closed = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const { data } = await admin.from("crew_runs").select("id").eq("tenant_id", tenantId).eq("agent_key", agent).like("dedupe_key", `${agent}|%|day:${closed}`).limit(1);
  return (data ?? []).length > 0;
}

export async function recentRunCount(admin: SupabaseClient, tenantId: string, agent: AgentKey, trigger: RunTrigger, sinceIso: string): Promise<number> {
  const { count } = await admin.from("crew_runs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("agent_key", agent).eq("trigger", trigger).gte("created_at", sinceIso);
  return count ?? 0;
}

export async function loadSteps(admin: SupabaseClient, tenantId: string, runId: string): Promise<Record<string, unknown>[]> {
  const { data } = await admin.from("crew_steps").select("seq, kind, name, input, output, refs, ok, error, tokens_in, tokens_out, ms").eq("tenant_id", tenantId).eq("run_id", runId).order("seq", { ascending: true }).limit(200);
  return (data ?? []) as Record<string, unknown>[];
}

// ── Findings ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const FINDING_COLS = "id, run_id, agent_key, kind, severity, subject_type, subject_id, site_id, title, body, evidence, gaps, fingerprint, recipient_ids, status, status_by, status_at, status_note, suppress_until, created_at";

export async function listFindings(admin: SupabaseClient, tenantId: string, q: { agent?: AgentKey | null; statuses?: FindingStatus[]; subjectId?: string; limit?: number }): Promise<{ rows: Finding[]; pending: boolean }> {
  let query = admin.from("crew_findings").select(FINDING_COLS).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(q.limit ?? 100);
  if (q.agent) query = query.eq("agent_key", q.agent);
  if (q.statuses?.length) query = query.in("status", q.statuses);
  if (q.subjectId) query = query.eq("subject_id", q.subjectId);
  const { data, error } = await query;
  if (error) return { rows: [], pending: isPending(error) };
  return { rows: (data ?? []) as unknown as Finding[], pending: false };
}

export async function findingsOfRun(admin: SupabaseClient, tenantId: string, runId: string): Promise<Finding[]> {
  const { data } = await admin.from("crew_findings").select(FINDING_COLS).eq("tenant_id", tenantId).eq("run_id", runId).order("created_at", { ascending: true }).limit(100);
  return (data ?? []) as unknown as Finding[];
}

export async function loadFinding(admin: SupabaseClient, tenantId: string, id: string): Promise<Finding | null> {
  const { data } = await admin.from("crew_findings").select(FINDING_COLS).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  return (data as unknown as Finding | null) ?? null;
}

export async function openFindingCounts(admin: SupabaseClient, tenantId: string): Promise<Map<AgentKey, number>> {
  const out = new Map<AgentKey, number>();
  for (const a of AGENTS) {
    const { count } = await admin.from("crew_findings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("agent_key", a.key).in("status", ["open", "seen"]);
    out.set(a.key, count ?? 0);
  }
  return out;
}

// ── Proposals ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const PROPOSAL_COLS = "id, finding_id, run_id, agent_key, action_key, target_type, target_id, payload, edited_payload, status, approver_ids, decided_by, decided_at, decision_note, executed_at, result, fingerprint, expires_at, created_at";

export async function listProposals(admin: SupabaseClient, tenantId: string, q: { findingIds?: string[]; status?: string[]; limit?: number }): Promise<Proposal[]> {
  let query = admin.from("crew_proposals").select(PROPOSAL_COLS).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(q.limit ?? 200);
  if (q.findingIds) { if (q.findingIds.length === 0) return []; query = query.in("finding_id", q.findingIds.slice(0, 100)); }
  if (q.status?.length) query = query.in("status", q.status);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as unknown as Proposal[];
}

export async function proposalsOfRun(admin: SupabaseClient, tenantId: string, runId: string): Promise<Proposal[]> {
  const { data } = await admin.from("crew_proposals").select(PROPOSAL_COLS).eq("tenant_id", tenantId).eq("run_id", runId).order("created_at", { ascending: true }).limit(100);
  return (data ?? []) as unknown as Proposal[];
}

export async function loadProposal(admin: SupabaseClient, tenantId: string, id: string): Promise<Proposal | null> {
  const { data } = await admin.from("crew_proposals").select(PROPOSAL_COLS).eq("tenant_id", tenantId).eq("id", id).maybeSingle();
  return (data as unknown as Proposal | null) ?? null;
}

export function entryOf(key: string) { return agentEntry(key); }
