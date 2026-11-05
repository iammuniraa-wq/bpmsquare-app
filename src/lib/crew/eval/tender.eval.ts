import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TENDER_PROMPT_VERSION } from "../tender/prompt";
import { TENDER_CASES } from "../tender/eval/cases";
import { anthropicModel } from "../server/model";
import { passesGate, runTenderCase, summarise, type CaseRun } from "./harness";

// `npm run crew:eval` -- the model-quality check (docs/design/nova-crew-agents.md section 7). NOT part of the normal suite (the file is .eval.ts and
// only vitest.crew-eval.config.ts includes it): it calls the REAL model about 30 times with ANTHROPIC_API_KEY (read from the environment or
// .env.local) and spends a few hundred thousand tokens. It runs the same loop, prompt, tools-as-fixtures and validator as production, scores recall,
// false positives, grounding drops and note recipients, writes docs/crew-eval/<date>-tender_watch.json, and FAILS when the release gate is missed.
// Run it before any change to a prompt, a tool shape, a model or a threshold table, and quote the result in the commit.
//
//   (PowerShell, from the repository root)   npm run crew:eval -- tender
//   CREW_EVAL_ONLY=TW-01,TW-27 npm run crew:eval        only those cases

describe("Tender Watch against the real model", () => {
  it("meets the release gate on the 30 fixed situations", async () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set. Put it in .env.local or the environment, then run npm run crew:eval again.");
    const only = (process.env.CREW_EVAL_ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const cases = only.length ? TENDER_CASES.filter((c) => only.includes(c.id)) : TENDER_CASES;
    const model = anthropicModel("mid");
    const runs: (CaseRun & { id: string; title: string })[] = [];
    for (const c of cases) {
      const r = await runTenderCase(c, model);
      runs.push({ ...r, id: c.id, title: c.title });
      process.stdout.write(`${c.id}  recall ${r.score.recallHits}/${r.score.recallTotal}  false+ ${r.score.falsePositives}  dropped ${r.score.dropped}  tokens ${r.score.tokens}  ${r.status}${r.reason ? ` (${r.reason})` : ""}\n`);
    }
    const summary = summarise(runs);
    const gate = passesGate(summary);
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.resolve(__dirname, "../../../../docs/crew-eval");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${day}-tender_watch.json`), JSON.stringify({ agent: "tender_watch", promptVersion: TENDER_PROMPT_VERSION, date: day, summary, gate, cases: runs.map((r) => ({ id: r.id, title: r.title, score: r.score, status: r.status, reason: r.reason, dropped: r.dropped, findings: r.accepted.map((f) => ({ kind: f.kind, subject: f.subject_id, severity: f.severity, title: f.title })) })) }, null, 2));
    process.stdout.write(`\nrecall ${(summary.recall * 100).toFixed(0)}%  false positives ${summary.falsePositives}  recipient violations ${summary.recipientViolations}  dropped ${(summary.droppedShare * 100).toFixed(0)}%  tokens ${summary.tokens}\n${gate.pass ? "GATE PASSED" : `GATE FAILED: ${gate.failures.join("; ")}`}\n`);
    expect(gate.failures).toEqual([]);
  }, 1_800_000);
});
