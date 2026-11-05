import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { monthlyTokensUsed, logUsage } from "@/lib/ai/structured";
import { dayKey } from "@/lib/tender/rules";
import { billedTokensOf } from "./usage";
import { checkBudget, effectiveAgentCap, pausedReason } from "../core/budget";
import { purgeAfter } from "../core/fingerprint";
import { validateDraft, type ValidateEnv, type ValidatedFinding } from "../core/grounding";
import { runLoop, StepLog, submitToolSpec, type CrewModel, type GateVerdict, type ModelUsage, type StepRecord } from "../core/loop";
import { makeToolRunner, toolSpecs } from "../core/tools";
import { agentModule } from "../definitions";
import { agentEntry } from "../registry";
import type { AgentSettings, RunContext } from "../types";
import { anthropicModel, aiConfigured, crewDisabled } from "./model";
import { sendDigests } from "./digest";
import { persistFindings } from "./persist";
import { agentTokensUsed, finishRun, loadSettings, SURFACE, type RunRow } from "./store";
import { loadCrewTenant } from "./tenant";

// One run, end to end (docs/design/nova-crew-agents.md section 2): settings and flags -> budget -> prefetch -> model loop -> validate ->
// persist. The loop itself is core/loop.ts (no database); this file is the database-backed wrapper that the eval harness does not use.
// Every query is scoped by the run's tenant_id; the run row came from the queue, never from a request.

const SETTINGS_TTL_MS = 15_000;
const STEP_JSON_CAP = 60_000;

export type RunnerDeps = { model?: CrewModel; now?: () => Date };

const capped = (v: unknown): unknown => {
  try { return JSON.stringify(v ?? null).length > STEP_JSON_CAP ? { truncated: true } : v ?? null; } catch { return { truncated: true }; }
};

export async function executeRun(admin: SupabaseClient, run: RunRow, deps: RunnerDeps = {}): Promise<{ status: string }> {
  const tenantId = run.tenant_id;
  const now = deps.now ? deps.now() : new Date();
  const close = async (status: string, patch: Record<string, unknown> = {}) => { await finishRun(admin, tenantId, run.id, { status, ...patch }); return { status }; };

  try {
    const entry = agentEntry(run.agent_key);
    const mod = agentModule(run.agent_key);
    const tenant = await loadCrewTenant(admin, tenantId);
    if (!entry || !tenant) return close("failed", { error: "The workspace could not be read." });
    if (tenant.features.crew !== true || tenant.features[entry.flag] !== true) return close("cancelled", { error: "AI automation is switched off for this workspace." });
    if (!mod) return close("failed", { error: "This agent has no engine yet." });
    if (crewDisabled()) return close("skipped_paused", { error: "Agents are stopped for the whole platform." });
    if (!aiConfigured() && !deps.model) return close("failed", { error: "AI is not set up for this workspace." });

    let settings = await loadSettings(admin, tenantId);
    let settingsAt = Date.now();
    const agentSettings = (): AgentSettings => settings.get(run.agent_key);
    const stopped = (): boolean => !agentSettings().enabled || agentSettings().paused || settings.get("_workspace").paused;
    if (stopped()) return close("skipped_paused", { error: "Agents are paused for this workspace." });

    const { def, runtime } = mod;
    const agentCap = effectiveAgentCap(agentSettings().monthly_token_cap, def.defaults.monthlyTokenCap);
    const agentUsedBase = await agentTokensUsed(admin, tenantId, run.agent_key, now);
    const pooledUsedBase = await monthlyTokensUsed(tenantId, now);
    let runUsed = 0;
    const budget = () => checkBudget({ runUsed, runCap: def.limits.maxTokensPerRun, agentUsed: agentUsedBase + runUsed, agentCap, pooledUsed: pooledUsedBase + runUsed, pooledBudget: tenant.pooledBudget });
    const first = budget();
    if (!first.allowed) return close("skipped_budget", { error: pausedReason(first.limitedBy) });

    const ctx: RunContext = {
      admin, tenantId, runId: run.id, agentKey: run.agent_key, scope: run.scope ?? {}, now, timezone: tenant.timezone,
      candidateIds: new Set(run.candidates ?? []), aliases: null, settings: agentSettings(),
    };

    const steps = new StepLog(async (r: StepRecord) => {
      await admin.from("crew_steps").insert({
        tenant_id: tenantId, run_id: run.id, seq: r.seq, kind: r.kind, name: r.name, input: capped(r.input), output: capped(r.output),
        refs: r.refs, ok: r.ok, error: r.error, tokens_in: r.tokens_in, tokens_out: r.tokens_out, ms: r.ms,
      });
    });
    await steps.add({ kind: "plan", name: "plan", output: { trigger: run.trigger, because: run.trigger_ref, candidates: ctx.candidateIds.size } });

    const prepared = await runtime.prepare(ctx, run);
    // Attendance: the tools see the run's alias map, and the aliases of the people in the candidates are ids the model may name.
    const toolCtx: RunContext = prepared.aliasMap
      ? { ...ctx, aliases: new Map(Object.entries(prepared.aliasMap.persons)), candidateIds: new Set([...ctx.candidateIds, ...(prepared.toolIds ?? [])]) }
      : ctx;
    await steps.add({ kind: "prefetch", name: prepared.prefetch.name, output: prepared.prefetch.output, refs: prepared.prefetch.refs });
    if (prepared.unavailable.length) await steps.add({ kind: "prefetch", name: "unavailable", output: { unavailable: prepared.unavailable }, ok: true });

    const model = deps.model ?? anthropicModel(def.tier);
    const started = Date.now();
    const gate = async (): Promise<GateVerdict> => {
      if (Date.now() - settingsAt > SETTINGS_TTL_MS) { settings = await loadSettings(admin, tenantId); settingsAt = Date.now(); }
      if (crewDisabled() || stopped()) return { ok: false, status: "cancelled", reason: "Paused" };
      if (Date.now() - started > def.limits.deadlineMs) return { ok: false, status: "cancelled", reason: "The run reached its time limit." };
      const b = budget();
      return b.allowed ? { ok: true } : { ok: false, status: "skipped_budget", reason: pausedReason(b.limitedBy) };
    };
    const meter = async (usage: ModelUsage, modelName: string) => {
      const t = billedTokensOf(usage);
      runUsed += t.input + t.output;
      await logUsage({ tenantId, userId: null, surface: SURFACE[run.agent_key], studyId: run.id, inputTokens: t.input, outputTokens: t.output, model: modelName });
    };

    const env: ValidateEnv = {
      steps: steps.outputs, candidateIds: ctx.candidateIds, kinds: runtime.kinds, banned: runtime.banned, actions: def.actions,
      permittedRecipients: prepared.permittedRecipients, refsOf: (id) => steps.refsByStep.get(id) ?? [], hrefFor: prepared.hrefFor,
    };
    const result = await runLoop({
      model, system: runtime.system(), user: prepared.user,
      tools: [...toolSpecs(runtime.adapters.filter((a) => def.tools.includes(a.key))), submitToolSpec(runtime.findingsSchema)],
      limits: def.limits, steps, gate, meter,
      runTool: makeToolRunner(runtime.adapters, def.tools, toolCtx, steps),
      validate: (submit, raw) => {
        if (runtime.submission) return runtime.submission.validate(raw, steps.outputs, prepared);
        const accepted: ValidatedFinding[] = [];
        const rejected: { index: number; reason: string }[] = [];
        submit.findings.forEach((d, index) => { const v = validateDraft(d, env); if (v.ok) accepted.push(v.finding); else rejected.push({ index, reason: v.reason }); });
        return { accepted, rejected };
      },
    });

    const patchBase = { model: result.model, prompt_version: def.promptVersion, input_tokens: result.inputTokens, output_tokens: result.outputTokens, turns: result.turns, tool_calls: result.toolCalls, snapshot: prepared.snapshot, ...(prepared.aliasMap ? { alias_map: prepared.aliasMap } : {}) };
    if (result.status !== "done") {
      const status = result.status === "failed" ? "failed" : result.status;
      return close(status, { ...patchBase, error: result.reason ?? "The run did not finish." });
    }

    const today = dayKey(now, tenant.timezone);
    const saved = await persistFindings(admin, {
      tenantId, run, now, today, retentionDays: def.defaults.retentionDays, bucketOf: prepared.bucketOf, seenBy: prepared.seenBy, members: prepared.members,
      closesAt: prepared.closesAt, labelOf: prepared.labelOf,
    }, result.accepted);
    await steps.add({ kind: "gate", name: "saved", output: { created: saved.created, refreshed: saved.refreshed, suppressed: saved.suppressed, proposals: saved.proposals, dropped: [...result.dropped, ...saved.skipped].map((d) => d.reason) } });
    if (run.trigger === "schedule") {
      try { await sendDigests(admin, tenant, run.agent_key, agentSettings().config.digest_optin ?? [], undefined, agentSettings().config.visibility); } catch (e) { console.error("[crew] digest failed", (e as Error).message); }
    }
    return close("done", {
      ...patchBase, findings_count: saved.created, proposals_count: saved.proposals,
      nothing_to_report: result.accepted.length === 0 ? (result.nothingToReport ?? "Nothing needs attention.") : null,
      purge_after: purgeAfter(today, def.defaults.retentionDays),
    });
  } catch (e) {
    console.error("[crew] run failed", run.id, (e as Error).message);
    return close("failed", { error: (e as Error).message.slice(0, 300) || "The run failed." });
  }
}
