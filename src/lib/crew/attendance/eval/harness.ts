// The Attendance evaluation harness (docs/design/nova-crew-agents.md section 7): one fixed situation in, the SAME loop, prompt, tools and validator as
// production, a model (the real one under `npm run crew:eval -- attendance`, a scripted one in the normal suite), and the engine's own scoring out.
//
// What is real: the system prompt, the first message, the tool descriptions and schemas, the tools themselves (served over the fixture's reads, so a
// drill-down returns exactly what production would), the loop bounds, the retry rule, and validateAttendanceSubmission. What is a fixture: the facts.
// Scoring is on the model's FIRST submission: a model that needs the corrective retry is judged on what it got wrong first, which is the stricter reading.

import { foreignIds } from "../../core/tools";
import { runLoop, StepLog, submitToolSpec, type CrewModel } from "../../core/loop";
import { definitionParts } from "../definition";
import { attendanceSystemPrompt, attendanceUserPrompt } from "../prompt";
import { SUBMISSION_SCHEMA } from "../submission";
import { validateAttendanceSubmission } from "../submit";
import { ATTENDANCE_TOOLS, createToolSession } from "../tools";
import { buildCase, readsFromInput } from "./fixtures";
import { aggregate, releaseGate, scoreCase, type Aggregate, type CaseScore } from "./score";
import type { EvalCase } from "./types";

export type AttendanceCaseRun = { score: CaseScore; status: string; reason: string | null; tokens: number; accepted: number };

const TOOL_KEYS = ATTENDANCE_TOOLS.map((t) => t.key);

export async function runAttendanceCase(c: EvalCase, model: CrewModel): Promise<AttendanceCaseRun> {
  const built = await buildCase(c);
  const siteId = Object.values(built.aliases.sites)[0];
  const steps = new StepLog();
  await steps.add({ kind: "prefetch", name: "attendance digest", output: built.digest });

  const session = createToolSession({
    reads: readsFromInput(c.input), run: { siteId, from: c.input.run.from, to: c.input.run.to },
    aliases: built.aliases, detect: { sensitivity: c.input.run.sensitivity ?? "balanced" }, viewerScope: null,
  });
  // The ids a tool call may name: the site and the people in the candidates (the runner adds the same set in production).
  const allowed = new Set<string>([siteId, built.digest.site.alias, ...built.digest.candidates.flatMap((x) => x.members)]);

  const runTool = async (name: string, input: unknown) => {
    const fail = async (error: string) => { await steps.add({ kind: "tool", name, input, ok: false, error }); return { ok: false as const, error }; };
    if (!TOOL_KEYS.includes(name)) return fail("That tool is not available.");
    if (foreignIds(input, allowed).length > 0) return fail("That id is not one of this run's candidates.");
    const r = await session.call(name, (input ?? {}) as Record<string, unknown>);
    if (!r.ok) return fail(r.error);
    const rec = await steps.add({ kind: "tool", name, input, output: r.data });
    return { ok: true as const, data: { _step: rec.id, ...(r.data as Record<string, unknown>) } };
  };

  const raws: unknown[] = [];
  let tokens = 0;
  const loop = await runLoop({
    model, system: attendanceSystemPrompt(), user: attendanceUserPrompt({ digest: built.digest, digestStep: "s1" }),
    tools: [...ATTENDANCE_TOOLS.map((t) => ({ name: t.key, description: t.description, input_schema: t.args })), submitToolSpec(SUBMISSION_SCHEMA)],
    limits: definitionParts().limits, steps, runTool,
    gate: async () => ({ ok: true }),
    meter: (u) => { tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0); },
    validate: (_submit, raw) => {
      raws.push(raw);
      const out = validateAttendanceSubmission(raw, steps.outputs, { digest: built.digest, aliases: built.aliases, recipientsFor: () => ["u-supervisor"] });
      return { accepted: out.accepted, rejected: out.rejected };
    },
  });

  // A run that never submitted anything is a parse failure, which the gate refuses.
  const score = scoreCase(c, raws[0] ?? "no submission", Object.fromEntries(steps.outputs));
  return { score, status: loop.status, reason: loop.reason, tokens, accepted: loop.accepted.length };
}

export function summariseAttendance(runs: readonly AttendanceCaseRun[]): { aggregate: Aggregate; gate: { pass: boolean; failures: string[] }; tokens: number } {
  const a = aggregate(runs.map((r) => r.score));
  return { aggregate: a, gate: releaseGate(a), tokens: runs.reduce((n, r) => n + r.tokens, 0) };
}
