import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runAttendanceCase, summariseAttendance, type AttendanceCaseRun } from "../attendance/eval/harness";
import { loadCases } from "../attendance/eval/fixtures";
import { ATTENDANCE_PROMPT_VERSION } from "../attendance/prompt";
import { anthropicModel } from "../server/model";

// `npm run crew:eval -- attendance` -- the model-quality check of Attendance Anomalies (docs/design/nova-crew-agents.md section 7). NOT part of the normal
// suite (the file is .eval.ts and only vitest.crew-eval.config.ts includes it): it calls the REAL model once per fixed situation (40) with
// ANTHROPIC_API_KEY (environment or .env.local), runs the same loop, prompt, tools and validator as production over the fixtures, scores recall, person-level
// findings where none is allowed, banned words, explanations and proposals, writes docs/crew-eval/<date>-attendance.json, and FAILS when the release gate
// is missed. Run it before any change to a prompt, a tool shape, a model or a threshold table, and quote the result in the commit. Nothing is sent to a
// person and no database is touched.
//
//   (PowerShell, from the repository root)   npm run crew:eval -- attendance
//   CREW_EVAL_ONLY=site-level-01-late-three-days npm run crew:eval -- attendance        only those cases (ids, comma separated)

describe("Attendance Anomalies against the real model", () => {
  it("meets the release gate on the fixed situations", async () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set. Put it in .env.local or the environment, then run npm run crew:eval -- attendance again.");
    const only = (process.env.CREW_EVAL_ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const all = loadCases();
    const cases = only.length ? all.filter((c) => only.includes(c.id)) : all;
    const model = anthropicModel("small");
    const runs: (AttendanceCaseRun & { id: string })[] = [];
    for (const c of cases) {
      const r = await runAttendanceCase(c, model);
      runs.push({ ...r, id: c.id });
      const sc = r.score;
      process.stdout.write(`${c.id}  flagged ${sc.must_flag_hit}/${sc.must_flag_expected}  false+ ${sc.false_positives.length}  person-level ${sc.person_level_violations}  dropped ${sc.dropped}  tokens ${r.tokens}  ${r.status}${r.reason ? ` (${r.reason})` : ""}\n`);
    }
    const sum = summariseAttendance(runs);
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.resolve(__dirname, "../../../../docs/crew-eval");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${day}-attendance.json`), JSON.stringify({ agent: "attendance", promptVersion: ATTENDANCE_PROMPT_VERSION, date: day, summary: sum.aggregate, gate: sum.gate, tokens: sum.tokens, cases: runs.map((r) => ({ id: r.id, status: r.status, reason: r.reason, tokens: r.tokens, score: r.score })) }, null, 2));
    process.stdout.write(`\nrecall ${(sum.aggregate.recall * 100).toFixed(0)}%  person-level violations ${sum.aggregate.person_level_violations}  banned ${sum.aggregate.banned_term_hits}  false positives ${sum.aggregate.false_positives}  dropped ${(sum.aggregate.dropped_share * 100).toFixed(0)}%  tokens ${sum.tokens}\n${sum.gate.pass ? "GATE PASSED" : `GATE FAILED: ${sum.gate.failures.join("; ")}`}\n`);
    expect(sum.gate.failures).toEqual([]);
  }, 3_600_000);
});
