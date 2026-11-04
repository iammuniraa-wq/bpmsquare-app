// The evaluation harness (docs/design/nova-crew-agents.md section 7): serves a fixed situation as the tools' answers (no database), runs the SAME
// loop, prompt, validator and bounds as production against a model, and scores what comes back. Pure and free of server-only imports so it runs
// under vitest with a scripted model (deterministic) and under `npm run crew:eval` with the real one. Tender Watch only for now; the attendance
// engine registers its own cases through the same `runCase` shape.

import { TENDER_TOOL_SPECS } from "../adapters/tenderSpecs";
import { validateDraft, type ValidatedFinding, type ValidateEnv } from "../core/grounding";
import { runLoop, StepLog, submitToolSpec, type CrewModel } from "../core/loop";
import { foreignIds } from "../core/tools";
import { candidateReasons, permittedRecipients, TENDER_BANNED, TENDER_KINDS, thresholdsFor } from "../tender/gate";
import { TENDER_FINDINGS_SCHEMA, TENDER_LIMITS, tenderSystemPrompt, tenderUserPrompt } from "../tender/prompt";
import type { EvalCase, EvalScore, SubmitFindings, ToolKey, ToolResult } from "../types";
import type { TenderCrewFacts } from "@/lib/tender/crewFacts";

export type EvalCaseFile = EvalCase & {
  /** A hand-written correct submission. Used ONLY by the deterministic tests (a scripted "oracle" model) to prove the case is satisfiable. */
  oracle?: SubmitFindings;
  /** Overrides the plan step's "why this tender" lines (a case about "an addendum since last time" needs a previous run the harness does not have). */
  reasons?: Record<string, string[]>;
  /** Sources the workspace could not read (a migration pending): passed to the prompt exactly as production does. */
  unavailable?: string[];
};

export type CaseRun = { score: EvalScore; accepted: ValidatedFinding[]; dropped: string[]; status: string; reason: string | null; submittedFindings: number };

const TOOL_KEYS = Object.keys(TENDER_TOOL_SPECS) as ToolKey[];

export async function runTenderCase(c: EvalCaseFile, model: CrewModel): Promise<CaseRun> {
  const brief = (c.tool_results.tender_brief?.["*"] ?? { deals: {} }) as { deals: Record<string, TenderCrewFacts> };
  const facts = Object.values(brief.deals).map((f) => ({ ...f, people: { admin_ids: [] } }) as TenderCrewFacts);
  const byId = new Map(facts.map((f) => [f.deal_id, f]));
  const steps = new StepLog();
  const candidates = new Set(c.candidates);
  const t = thresholdsFor("balanced");

  const reasons: Record<string, string[]> = {};
  c.candidates.forEach((id, i) => { const f = byId.get(id); reasons[`d${i + 1}`] = c.reasons?.[`d${i + 1}`] ?? (f ? candidateReasons(f, null, t) : []); });
  await steps.add({ kind: "prefetch", name: "tender brief", output: { today: c.today, ...brief } });

  const runTool = async (name: string, input: unknown): Promise<ToolResult> => {
    if (!TOOL_KEYS.includes(name as ToolKey)) { await steps.add({ kind: "tool", name, input, ok: false, error: "That tool is not available." }); return { ok: false, error: "That tool is not available." }; }
    if (foreignIds(input, candidates).length > 0) { await steps.add({ kind: "tool", name, input, ok: false, error: "That id is not one of this run's candidates." }); return { ok: false, error: "That id is not one of this run's candidates." }; }
    const table = c.tool_results[name as ToolKey] ?? {};
    const dealId = (input as { deal_id?: string } | null)?.deal_id;
    const data = (dealId && table[dealId]) || table["*"];
    if (!data) { await steps.add({ kind: "tool", name, input, ok: false, error: "No data." }); return { ok: false, error: "That source could not be read." }; }
    const rec = await steps.add({ kind: "tool", name, input, output: data });
    return { ok: true, data: { _step: rec.id, ...data } };
  };

  const env: ValidateEnv = {
    steps: steps.outputs, candidateIds: candidates, kinds: TENDER_KINDS, banned: TENDER_BANNED, actions: ["tender.nudge"],
    permittedRecipients: (d) => permittedRecipients(d, byId.get(d.subject?.id)), refsOf: () => [], hrefFor: () => null,
  };

  let tokens = 0;
  const loop = await runLoop({
    model, system: tenderSystemPrompt(),
    user: tenderUserPrompt({ todayIso: c.today, briefStep: "s1", brief: { today: c.today, ...brief }, unavailable: c.unavailable ?? [], thresholds: t, reasons }),
    tools: [...TOOL_KEYS.map((k) => ({ name: k, description: TENDER_TOOL_SPECS[k]!.description, input_schema: TENDER_TOOL_SPECS[k]!.inputSchema })), submitToolSpec(TENDER_FINDINGS_SCHEMA)],
    limits: TENDER_LIMITS, steps, runTool,
    gate: async () => ({ ok: true }),
    meter: (u) => { tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0); },
    validate: (submit) => {
      const accepted: ValidatedFinding[] = [];
      const rejected: { index: number; reason: string }[] = [];
      submit.findings.forEach((d, index) => { const v = validateDraft(d, env); if (v.ok) accepted.push(v.finding); else rejected.push({ index, reason: v.reason }); });
      return { accepted, rejected };
    },
  });

  return { score: scoreCase(c, loop.accepted, loop.dropped.length, tokens, loop.nothingToReport), accepted: loop.accepted, dropped: loop.dropped.map((d) => d.reason), status: loop.status, reason: loop.reason, submittedFindings: loop.accepted.length + loop.dropped.length };
}

/** Scores one run against the case's expectations (design section 7). */
export function scoreCase(c: EvalCase, accepted: readonly ValidatedFinding[], dropped: number, tokens: number, nothingToReport: string | null = null): EvalScore {
  let hits = 0;
  for (const m of c.expect.must_flag) {
    const f = accepted.find((x) => x.kind === m.kind && x.subject_id === m.subject);
    if (f && (m.must_cite ?? []).every((p) => f.evidence.some((e) => e.path === p || e.path.startsWith(`${p}.`)))) hits++;
  }
  // A "must say it could not check X" counts like a must-flag: the word has to appear in a finding's gaps or in the nothing-to-report line.
  const said = [...accepted.flatMap((f) => f.gaps), nothingToReport ?? ""].join(" ").toLowerCase();
  const gapsExpected = c.expect.must_gap ?? [];
  hits += gapsExpected.filter((g) => said.includes(g.toLowerCase())).length;
  // A finding is a false positive when it matches a must-not-flag entry, or when the case expects nothing at all; findings beyond max_findings count too.
  const flaggedWrongly = accepted.filter((f) => c.expect.nothing_to_report === true || c.expect.must_not_flag.some((n) => (n.kind === undefined || n.kind === f.kind) && (n.subject === undefined || n.subject === f.subject_id))).length;
  const overflow = c.expect.max_findings !== undefined ? Math.max(0, accepted.length - flaggedWrongly - c.expect.max_findings) : 0;
  const fp = flaggedWrongly + overflow;
  const rec = c.expect.proposal_recipients;
  let violations = 0;
  for (const f of accepted) for (const id of f.proposal?.recipient_ids ?? []) {
    if (rec?.forbidden?.includes(id) || (rec?.allowed && !rec.allowed.includes(id))) violations++;
  }
  return { caseId: c.id, recallHits: hits, recallTotal: c.expect.must_flag.length + gapsExpected.length, falsePositives: fp, dropped, bannedHits: 0, recipientViolations: violations, tokens };
}

export type Summary = { cases: number; recall: number; recallHits: number; recallTotal: number; falsePositives: number; recipientViolations: number; dropped: number; submitted: number; droppedShare: number; tokens: number };

export function summarise(runs: readonly CaseRun[]): Summary {
  const sum = (f: (r: CaseRun) => number) => runs.reduce((a, r) => a + f(r), 0);
  const hits = sum((r) => r.score.recallHits);
  const total = sum((r) => r.score.recallTotal);
  const dropped = sum((r) => r.score.dropped);
  const submitted = sum((r) => r.submittedFindings);
  return {
    cases: runs.length, recall: total === 0 ? 1 : hits / total, recallHits: hits, recallTotal: total, falsePositives: sum((r) => r.score.falsePositives),
    recipientViolations: sum((r) => r.score.recipientViolations), dropped, submitted, droppedShare: submitted === 0 ? 0 : dropped / submitted, tokens: sum((r) => r.score.tokens),
  };
}

/** The release gate (design section 7; thresholds proposed, the owner may change them): recall >= 90%, no must-not-flag hit, every note to a permitted person, <= 5% dropped. */
export const TENDER_GATE = { minRecall: 0.9, maxFalsePositives: 0, maxRecipientViolations: 0, maxDroppedShare: 0.05 } as const;

export function passesGate(s: Summary): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  if (s.recall < TENDER_GATE.minRecall) failures.push(`recall ${(s.recall * 100).toFixed(0)}% is under ${TENDER_GATE.minRecall * 100}%`);
  if (s.falsePositives > TENDER_GATE.maxFalsePositives) failures.push(`${s.falsePositives} must-not-flag hit(s)`);
  if (s.recipientViolations > TENDER_GATE.maxRecipientViolations) failures.push(`${s.recipientViolations} note(s) to someone not permitted`);
  if (s.droppedShare > TENDER_GATE.maxDroppedShare) failures.push(`${(s.droppedShare * 100).toFixed(0)}% of findings were dropped by the validator (limit ${TENDER_GATE.maxDroppedShare * 100}%)`);
  return { pass: failures.length === 0, failures };
}
