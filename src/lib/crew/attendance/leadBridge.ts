// The bridge from the Attendance engine to the shared crew contract (src/lib/crew/types.ts, commits 04b625dc / 03a75142 on the
// lead's branch). The engine itself speaks its own, richer shapes (contract.ts); everything the runner, the registry and the eval
// harness need in the lead's shapes is produced here, in one place, so a change to the shared contract touches one file.
//
// This file needs src/lib/crew/types.ts to exist (type-only imports: nothing from it is loaded at run time). It contains no
// database access: the lead supplies `makeReads`, the three-line wrappers over getSummaryForRange, getPunchFlagsForRange etc.

import type {
  ActionKey,
  AgentDefinition as LeadDefinition,
  AgentSettings,
  DraftFinding,
  EvalCase as LeadEvalCase,
  EvalTag,
  Finding as LeadFinding,
  PlanCtx as LeadPlanCtx,
  Proposal as LeadProposal,
  RunContext,
  RunRequest as LeadRunRequest,
  SubmitFindings,
  ToolAdapter,
  ToolKey,
  ToolResult as LeadToolResult,
} from "../types";
import { ATTENDANCE_AGENT_KEY, ATTENDANCE_TITLE } from "./keys";
import { addDays, shortDate } from "./dates";
import { definitionParts } from "./definition";
import { fingerprintFinding, fingerprintProposal } from "./fingerprint";
import { planAttendanceDetailed, type AttendanceSettings, type PlanOutcome } from "./plan";
import { ATTENDANCE_FAMILIES, type AttendanceReads, type Sensitivity } from "./facts";
import { createToolSession, ATTENDANCE_TOOLS } from "./tools";
import { assignAliases, type AliasMap } from "./alias";
import type { Submission } from "./submission";
import type { RenderedFinding, RenderedProposal, ValidationResult } from "./validate";
import { buildCase, readsFromInput } from "./eval/fixtures";
import type { EvalCase } from "./eval/types";
import type { SiteDigest } from "./digest";

// ── settings and time ───────────────────────────────────────────────────────

/** The workspace-local calendar date of `now`. */
export function workspaceToday(now: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const SENSITIVITIES: readonly Sensitivity[] = ["quiet", "balanced", "thorough"];

/** crew_agent_settings.config -> what the engine tunes. Buddy-punch and holiday-bridging keys are simply ignored. */
export function engineSettings(s: Pick<AgentSettings, "config">): AttendanceSettings {
  const c = s.config ?? {};
  const families: AttendanceSettings["families"] = {};
  for (const f of ATTENDANCE_FAMILIES) if (typeof c.families?.[f] === "boolean") families[f] = c.families[f];
  const siteIds = c.scope?.site_ids;
  return {
    sensitivity: SENSITIVITIES.includes(c.sensitivity as Sensitivity) ? (c.sensitivity as Sensitivity) : "balanced",
    families,
    siteIds: Array.isArray(siteIds) && siteIds.length > 0 ? siteIds : null,
  };
}

// ── plan() ──────────────────────────────────────────────────────────────────

/**
 * One request per site with candidates (candidate_ids = [site id]); when every site is quiet, ONE request with an empty
 * candidate list, which the planner records as a finished zero-token run whose trigger_ref says what was checked.
 */
export function toLeadRunRequests(outcome: PlanOutcome, trigger: LeadRunRequest["trigger"]): LeadRunRequest[] {
  const closed = shortDate(outcome.window.to);
  if (outcome.requests.length > 0) {
    return outcome.requests.map((r) => ({
      agent_key: ATTENDANCE_AGENT_KEY,
      trigger,
      trigger_ref: `Daily pass for ${closed}`,
      scope: r.scope,
      dedupe_key: r.dedupe_key,
      candidate_ids: [r.scope.site_id],
      snapshot: { candidate_count: r.candidate_count },
    }));
  }
  if (outcome.sitesChecked === 0) return [];
  return [{
    agent_key: ATTENDANCE_AGENT_KEY,
    trigger,
    trigger_ref: `Nothing to report. ${outcome.sitesChecked} ${outcome.sitesChecked === 1 ? "site" : "sites"} checked`,
    scope: { from: outcome.window.from, to: outcome.window.to },
    dedupe_key: `${ATTENDANCE_AGENT_KEY}|quiet|day:${outcome.window.to}`,
    candidate_ids: [],
    snapshot: { sites_checked: outcome.sitesChecked, quiet_sites: outcome.quietSites },
  }];
}

export type MakeReads<C> = (ctx: C) => AttendanceReads;

export function leadPlan(makeReads: MakeReads<LeadPlanCtx>): LeadDefinition["plan"] {
  return async (ctx) => {
    const trigger = ctx.trigger === "manual" ? "manual" : "schedule";
    const outcome = await planAttendanceDetailed({
      reads: makeReads(ctx),
      today: workspaceToday(ctx.now, ctx.timezone),
      settings: engineSettings(ctx.settings),
      trigger,
    });
    return toLeadRunRequests(outcome, ctx.trigger);
  };
}

// ── tools ───────────────────────────────────────────────────────────────────

export function leadToolAdapters(makeReads: MakeReads<RunContext>): ToolAdapter[] {
  return ATTENDANCE_TOOLS.map((spec) => ({
    key: spec.key as ToolKey,
    description: spec.description,
    inputSchema: spec.args,
    run: async (ctx: RunContext, args: Record<string, unknown>): Promise<LeadToolResult> => {
      const { site_id, from, to } = ctx.scope;
      if (!site_id || !from || !to) return { ok: false, error: "no_site_scope" };
      // The run's alias map (alias -> employee id) lives in crew_runs.alias_map and in ctx.aliases; the site alias is derived again.
      let aliases: AliasMap = { persons: Object.fromEntries(ctx.aliases ?? []), sites: {} };
      aliases = assignAliases(aliases, "site", [site_id]);
      const session = createToolSession({
        reads: makeReads(ctx),
        run: { siteId: site_id, from, to },
        aliases,
        detect: { sensitivity: engineSettings(ctx.settings).sensitivity, families: engineSettings(ctx.settings).families },
        viewerScope: null,
      });
      const r = await session.call(spec.key, args);
      return r.ok ? { ok: true, data: r.data as Record<string, unknown> } : r;
    },
  }));
}

// ── the definition ──────────────────────────────────────────────────────────

export function buildLeadDefinition(makeReads: MakeReads<LeadPlanCtx>): LeadDefinition {
  const p = definitionParts();
  return {
    key: ATTENDANCE_AGENT_KEY,
    title: ATTENDANCE_TITLE,
    goal: p.goal,
    // crew, crew_attendance and wfm: the first two exist once the lead adds the flags to TenantFeatures.
    requires: { features: ["crew", "crew_attendance", "wfm"] as unknown as LeadDefinition["requires"]["features"] },
    triggers: { schedule: { time: "02:00" } },
    plan: leadPlan(makeReads),
    tools: ATTENDANCE_TOOLS.map((t) => t.key as ToolKey),
    // site_note is not in the shared ActionKey list: it is delivered as the finding itself (see `unmapped` in toPersisted).
    actions: ["wfm.recheck"] as ActionKey[],
    outputSchema: p.outputSchema,
    limits: p.limits,
    tier: p.tier,
    defaults: { schedule: { time: "02:00" }, sensitivity: "balanced", monthlyTokenCap: 500_000, retentionDays: 90 },
    autonomy: "propose",
    evalSet: p.evalSet,
    promptVersion: p.promptVersion,
  };
}

// ── model output -> the shared draft shape (for a runner that validates SubmitFindings generically) ──────────────────

function bodyTemplate(f: Submission["findings"][number]): string {
  return [
    `What was observed: ${f.observed_tmpl}`,
    `What else could explain it: ${f.explanations.map((e) => e.text_tmpl).join(" ")}`,
    `What you could do: ${f.actions.map((a) => a.text_tmpl).join(" ")}`,
  ].join("\n");
}

/**
 * A lossy projection. The attendance-specific rules (person only with a person-level candidate, wording, non-personal
 * explanation, comparison, recheck targets) live in validateSubmission(), which the runner must call for this agent; this
 * projection is for code that wants the generic shape. A multi-target recheck cannot be expressed in DraftProposal (one
 * target): its first target is carried and `recipient_ids` stays empty for the runner to fill from the site's supervisors.
 */
export function toDraftFindings(sub: Submission): SubmitFindings {
  const findings: DraftFinding[] = sub.findings.map((f, i) => {
    const prop = sub.proposals.find((p) => p.finding_index === i && p.action === "wfm.recheck");
    return {
      kind: f.kind,
      severity: f.severity,
      subject: { type: f.level, id: f.subject.alias },
      title_tmpl: f.title_tmpl,
      body_tmpl: bodyTemplate(f),
      evidence: f.evidence.map((e) => ({ step: e.step, path: e.path, label: e.label })),
      gaps: f.gaps,
      ...(prop && prop.action === "wfm.recheck"
        ? { proposal: { action_key: "wfm.recheck" as const, target_type: "employee", target_id: prop.target_aliases[0], recipient_ids: [], message_tmpl: prop.message_tmpl } }
        : {}),
    };
  });
  return { findings, ...(sub.nothing_to_report ? { nothing_to_report: sub.nothing_to_report } : {}) };
}

// ── validated result -> rows the runner persists ────────────────────────────

export type PersistedFindingDraft = Pick<
  LeadFinding,
  "agent_key" | "kind" | "severity" | "subject_type" | "subject_id" | "site_id" | "title" | "body" | "evidence" | "gaps" | "fingerprint" | "recipient_ids"
> & { candidate_id: string };

export type PersistedProposalDraft = Pick<LeadProposal, "agent_key" | "action_key" | "target_type" | "target_id" | "payload" | "fingerprint"> & {
  /** Index into the findings array of the same call (the runner links finding_id after insert). */
  finding_index: number;
};

function renderedBody(f: RenderedFinding): string {
  return [
    `What was observed: ${f.observed}`,
    `What else could explain it: ${f.explanations.map((e) => e.text).join(" ")}`,
    `What you could do: ${f.actions.map((a) => a.text).join(" ")}`,
  ].join("\n");
}

/**
 * Real ids are resolved from the run's alias map HERE and nowhere in the engine's text: titles and bodies keep aliases (the
 * viewer's browser puts names back, renderWithNames), but subject_id, site_id and the fingerprint are real, server-side values.
 * `recipient_ids` is left empty: the runner fills it with the supervisors whose resolveWfmScope covers the site / the person.
 */
export function toPersisted(
  result: ValidationResult,
  digest: SiteDigest,
  aliases: AliasMap
): { findings: PersistedFindingDraft[]; proposals: PersistedProposalDraft[]; unmapped: { kind: "site_note"; finding_index: number; message: string }[] } {
  const siteId = aliases.sites[digest.site.alias] ?? null;
  const findings: PersistedFindingDraft[] = [];
  const indexOf = new Map<number, number>(); // submission index -> position in `findings`
  const fingerprints = new Map<number, string>();

  for (const f of result.findings) {
    const cand = digest.candidates.find((c) => c.id === f.candidate_id);
    if (!cand) continue;
    const fp = fingerprintFinding(f, cand, { aliases });
    if (!fp) continue; // an alias with no real id behind it is dropped, never persisted half-resolved
    const personId = f.level === "person" ? aliases.persons[f.subject.alias] ?? null : null;
    indexOf.set(f.index, findings.length);
    fingerprints.set(f.index, fp);
    findings.push({
      agent_key: ATTENDANCE_AGENT_KEY,
      kind: f.kind,
      severity: f.severity,
      subject_type: f.level === "person" ? "employee" : "site",
      subject_id: (f.level === "person" ? personId : siteId) ?? "",
      site_id: siteId,
      title: f.title,
      body: renderedBody(f),
      evidence: f.evidence.map((e) => ({ step: e.step, path: e.path, label: e.label, href: null })),
      gaps: f.gaps,
      fingerprint: fp,
      recipient_ids: [],
      candidate_id: f.candidate_id,
    });
  }

  const proposals: PersistedProposalDraft[] = [];
  const unmapped: { kind: "site_note"; finding_index: number; message: string }[] = [];
  for (const p of result.proposals) {
    const at = indexOf.get(p.finding_index);
    if (at === undefined) continue;
    if (p.action === "site_note") {
      unmapped.push({ kind: "site_note", finding_index: at, message: p.message });
      continue;
    }
    const recheck = p as Extract<RenderedProposal, { action: "wfm.recheck" }>;
    const ids = recheck.target_aliases.map((a) => aliases.persons[a]).filter((x): x is string => !!x);
    const fp = fingerprintProposal("wfm.recheck", fingerprints.get(p.finding_index) as string, recheck.target_aliases, { aliases });
    if (ids.length !== recheck.target_aliases.length || !fp) continue;
    proposals.push({
      agent_key: ATTENDANCE_AGENT_KEY,
      action_key: "wfm.recheck",
      // one employee: that employee. A list (missing check-out cluster): the site, with the people in the payload.
      target_type: ids.length === 1 ? "employee" : "site",
      target_id: ids.length === 1 ? ids[0] : (siteId ?? ""),
      payload: { employee_ids: ids, message: recheck.message },
      fingerprint: fp,
      finding_index: at,
    });
  }
  return { findings, proposals, unmapped };
}

// ── eval cases in the shared shape ──────────────────────────────────────────

const TAG_MAP: Record<string, EvalTag> = {
  "site-level": "site_level",
  "person-level": "person_level",
  quiet: "quiet",
  trainee: "trainee",
  adversarial: "adversarial",
};

/** Tool results keyed the way the shared harness serves them: tool key -> (args key | "*") -> data. */
export async function toLeadEvalCase(c: EvalCase): Promise<LeadEvalCase> {
  const built = await buildCase(c);
  const siteId = `site-${c.input.site.alias.slice(1).padStart(4, "0")}`;
  const session = createToolSession({
    reads: readsFromInput(c.input),
    run: { siteId, from: c.input.run.from, to: c.input.run.to },
    aliases: built.aliases,
    detect: { sensitivity: c.input.run.sensitivity ?? "balanced" },
  });
  const tool_results: LeadEvalCase["tool_results"] = { attendance_site_digest: { "*": built.digest as unknown as Record<string, unknown> } };
  const flags = await session.call("attendance_punch_flags", {});
  if (flags.ok) tool_results.attendance_punch_flags = { "*": flags.data as Record<string, unknown> };
  const history: Record<string, Record<string, unknown>> = {};
  const aliases = new Set(built.candidates.flatMap((x) => x.members));
  for (const a of aliases) {
    const h = await session.call("attendance_person_history", { alias: a });
    if (h.ok) history[a] = h.data as Record<string, unknown>;
  }
  if (Object.keys(history).length > 0) tool_results.attendance_person_history = history;

  const indexOfCandidate = (kind: string, level: string, subject?: string) =>
    built.candidates.findIndex((x) => x.family === kind && x.level === level && (level === "site" || x.person === subject));

  const tags = new Set<EvalTag>(c.tags.map((t) => TAG_MAP[t]).filter(Boolean));
  if (c.expect.must_flag.length > 0) tags.add("flag_worthy");
  if (/ban|instruction/i.test(c.id)) tags.add("wording");

  return {
    id: c.id,
    tags: [...tags],
    title: c.description,
    today: addDays(c.input.run.to, 1),
    candidates: [c.input.site.alias],
    tool_results,
    expect: {
      must_flag: c.expect.must_flag.map((m) => {
        const i = indexOfCandidate(m.kind, m.level, m.subject);
        return { kind: m.kind, subject: m.level === "site" ? c.input.site.alias : (m.subject as string), must_cite: m.must_cite.map((f) => `s1.candidates[${i}].${f}`) };
      }),
      must_not_flag: c.expect.must_not_flag.map((n) => ({ ...(n.kind ? { kind: n.kind } : {}), ...(n.subject ? { subject: n.subject } : {}), why: n.reason })),
      must_gap: c.expect.must_gap,
      max_findings: c.expect.max_findings,
      proposal_recipients: { forbidden: c.expect.proposals.forbidden_target_aliases },
      nothing_to_report: c.expect.must_flag.length === 0,
    },
  };
}
