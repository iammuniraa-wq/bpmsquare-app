import "server-only";
import { dayKey } from "@/lib/tender/rules";
import { listLiveTenderIds, loadTenderCrewFacts } from "@/lib/tender/crewFacts";
import { dailySlot, eventDedupeKey, manualDedupeKey } from "../core/schedule";
import { agentEntry } from "../registry";
import { lastDoneRun } from "../server/store";
import type { AgentDefinition, PlanCtx, RunRequest } from "../types";
import { candidateReasons, candidateSummary, snapshotOf, thresholdsFor, TENDER_KINDS, type TenderSnapshot } from "./gate";
import { TENDER_FINDINGS_SCHEMA, TENDER_GOAL, TENDER_LIMITS, TENDER_PROMPT_VERSION } from "./prompt";

// Tender Watch: the definition (docs/design/nova-crew-agents.md section 4). plan() is plain code, the candidate gate: it returns the runs
// worth starting, and a quiet portfolio returns one zero-token "nothing to report" pass. At most MAX_PER_RUN tenders go to one model run.

const entry = agentEntry("tender_watch")!;
const MAX_PER_RUN = 12;

async function plan(ctx: PlanCtx): Promise<RunRequest[]> {
  const sched = ctx.settings.config.schedule ?? entry.defaults.schedule;
  let slot: { key: string; day: string };
  let label: string;
  if (ctx.trigger === "event") {
    if (!ctx.eventDealId) return [];
    slot = { key: eventDedupeKey("tender_watch", ctx.eventDealId, ctx.now, ctx.timezone), day: dayKey(ctx.now, ctx.timezone) };
    label = "A tender changed";
  } else if (ctx.trigger === "manual") {
    slot = { key: manualDedupeKey("tender_watch", ctx.now), day: dayKey(ctx.now, ctx.timezone) };
    label = "Run now";
  } else {
    const d = dailySlot("tender_watch", sched, ctx.now, ctx.timezone);
    if (!d.due) return [];
    slot = d;
    label = "Daily pass";
  }

  const live = await listLiveTenderIds(ctx.admin, ctx.tenantId);
  if (live.pending) return [];
  const ids = ctx.trigger === "event" ? live.ids.filter((id) => id === ctx.eventDealId) : live.ids;
  const { facts } = await loadTenderCrewFacts(ctx.admin, ctx.tenantId, ids, { now: ctx.now, timezone: ctx.timezone });
  const prev = (await lastDoneRun(ctx.admin, ctx.tenantId, "tender_watch"))?.snapshot as { deals?: TenderSnapshot } | null;
  const t = thresholdsFor(ctx.settings.config.sensitivity, ctx.settings.config.watch_window_days);

  const picked = facts
    .map((f) => ({ f, why: candidateReasons(f, prev?.deals ?? null, t) }))
    .filter((x) => x.why.length > 0)
    .sort((a, b) => (a.f.days_to_close ?? 9999) - (b.f.days_to_close ?? 9999))
    .slice(0, MAX_PER_RUN);

  const snapshot = { deals: { ...(prev?.deals ?? {}), ...snapshotOf(facts) } };
  return [{
    agent_key: "tender_watch", trigger: ctx.trigger, trigger_ref: picked.length ? label : `${label}. ${candidateSummary(0, ids.length)}`,
    scope: { deal_ids: picked.map((x) => x.f.deal_id) }, dedupe_key: slot.key, candidate_ids: picked.map((x) => x.f.deal_id), snapshot,
  }];
}

export const tenderWatch: AgentDefinition = {
  key: "tender_watch",
  title: entry.name,
  goal: TENDER_GOAL,
  requires: { features: ["crew", "crew_tender_watch", "gcc_tender", "pipeline"] },
  triggers: { schedule: entry.defaults.schedule, events: ["opportunity.stage_changed", "rfq.replied", "tender.decision_proposed", "tender.details_changed"] },
  plan,
  tools: ["tender_brief", "tender_open_questions", "tender_approvals", "tender_rfq_status", "tender_unpriced_by_cost_code", "tender_next_steps", "tender_people"],
  actions: ["tender.nudge"],
  outputSchema: TENDER_FINDINGS_SCHEMA,
  limits: TENDER_LIMITS,
  tier: "mid",
  defaults: entry.defaults,
  autonomy: "propose",
  evalSet: "src/lib/crew/tender/eval",
  promptVersion: TENDER_PROMPT_VERSION,
};

export const TENDER_FINDING_KINDS = TENDER_KINDS;
