import { describe, expect, it } from "vitest";
import { runLoop, StepLog, submitToolSpec, SUBMIT_TOOL, type LoopOptions } from "./loop";
import { validateDraft, type ValidateEnv, type ValidatedFinding } from "./grounding";
import { makeToolRunner } from "./tools";
import { scriptedModel, submitReply, textReply, toolReply } from "../eval/scripted";
import type { DraftFinding, RunContext, ToolAdapter } from "../types";

const steps0 = () => {
  const steps = new StepLog();
  return steps;
};

function setup(replies: Parameters<typeof scriptedModel>[0], over: Partial<LoopOptions> = {}) {
  const steps = steps0();
  const env = (): ValidateEnv => ({
    steps: steps.outputs, candidateIds: new Set(["deal-1"]), kinds: ["at_risk"], banned: [], actions: ["tender.nudge"],
    permittedRecipients: () => null, refsOf: () => [], hrefFor: () => null,
  });
  const model = scriptedModel(replies);
  const adapter: ToolAdapter = { key: "tender_next_steps", description: "d", inputSchema: {}, run: async () => ({ ok: true, data: { open: 2 } }) };
  const ctx = { candidateIds: new Set(["deal-1"]) } as unknown as RunContext;
  const opts: LoopOptions = {
    model, system: "s", user: "u", tools: [submitToolSpec({})], limits: { maxTurns: 4, maxToolCalls: 2, maxTokensPerRun: 10_000, deadlineMs: 1000 }, steps,
    runTool: makeToolRunner([adapter], ["tender_next_steps"], ctx, steps),
    gate: async () => ({ ok: true }), meter: () => {},
    validate: (submit) => {
      const accepted: ValidatedFinding[] = [];
      const rejected: { index: number; reason: string }[] = [];
      submit.findings.forEach((d, index) => { const v = validateDraft(d, env()); if (v.ok) accepted.push(v.finding); else rejected.push({ index, reason: v.reason }); });
      return { accepted, rejected };
    },
    ...over,
  };
  return { opts, model, steps };
}

const finding = (over: Partial<DraftFinding> = {}): DraftFinding => ({
  kind: "at_risk", severity: "review", subject: { type: "opportunity", id: "deal-1" }, title_tmpl: "{{s1.n}} things need a look.", body_tmpl: "Please check.",
  evidence: [{ step: "s1", path: "n", label: "N" }], gaps: [], ...over,
});

describe("runLoop", () => {
  it("a straight submission is validated and finishes the run", async () => {
    const { opts, steps } = setup([submitReply({ findings: [finding()] })]);
    await steps.add({ kind: "prefetch", name: "brief", output: { n: 7 } });
    const r = await runLoop(opts);
    expect(r.status).toBe("done");
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].title).toBe("7 things need a look.");
    expect(r.inputTokens).toBeGreaterThan(0);
    expect(r.turns).toBe(1);
  });

  it("an empty list with a reason is a normal, successful run", async () => {
    const { opts } = setup([submitReply({ findings: [], nothing_to_report: "All quiet." })]);
    const r = await runLoop(opts);
    expect(r).toMatchObject({ status: "done", accepted: [], nothingToReport: "All quiet." });
  });

  it("a tool call is recorded as a citable step and its id is handed back to the model", async () => {
    const { opts, model, steps } = setup([toolReply("tender_next_steps", { deal_id: "deal-1" }), submitReply({ findings: [] })]);
    await steps.add({ kind: "prefetch", name: "brief", output: {} });
    const r = await runLoop(opts);
    expect(r.status).toBe("done");
    expect(r.toolCalls).toBe(1);
    const second = model.calls[1].messages.at(-1)!;
    expect(JSON.stringify(second)).toContain("_step");
    expect(JSON.stringify(second)).toContain("s2");
    expect(steps.outputs.get("s2")).toEqual({ open: 2 });
  });

  it("a foreign id is a tool error, not data", async () => {
    const { opts, model } = setup([toolReply("tender_next_steps", { deal_id: "someone-elses-deal" }), submitReply({ findings: [] })]);
    const r = await runLoop(opts);
    expect(r.status).toBe("done");
    expect(JSON.stringify(model.calls[1].messages.at(-1))).toContain("not one of this run");
  });

  it("an unlisted tool is refused", async () => {
    const { opts, model } = setup([toolReply("delete_everything", {}), submitReply({ findings: [] })]);
    await runLoop(opts);
    expect(JSON.stringify(model.calls[1].messages.at(-1))).toContain("not available");
  });

  it("stops handing out tools at maxToolCalls and tells the model to wrap up", async () => {
    const t = (id: string) => toolReply("tender_next_steps", { deal_id: id });
    const { opts, model } = setup([t("deal-1"), t("deal-1"), t("deal-1"), submitReply({ findings: [] })], { limits: { maxTurns: 6, maxToolCalls: 2, maxTokensPerRun: 10_000, deadlineMs: 1000 } });
    const r = await runLoop(opts);
    expect(r.toolCalls).toBe(2);
    expect(JSON.stringify(model.calls[3].messages.at(-1))).toContain("tool limit reached");
  });

  it("one corrective retry: a digit outside a placeholder is sent back with the reason, the corrected finding is kept", async () => {
    const bad = finding({ title_tmpl: "5 things need a look." });
    const { opts, model, steps } = setup([submitReply({ findings: [bad] }), submitReply({ findings: [finding()] })]);
    await steps.add({ kind: "prefetch", name: "brief", output: { n: 7 } });
    const r = await runLoop(opts);
    expect(r.status).toBe("done");
    expect(r.accepted).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
    expect(JSON.stringify(model.calls[1].messages.at(-1))).toContain("digit outside a placeholder");
  });

  it("after the retry, what is still wrong is dropped and listed, and the rest of the run still lands", async () => {
    const bad = finding({ title_tmpl: "5 things need a look." });
    const good = finding({ subject: { type: "opportunity", id: "deal-1" } });
    const { opts, steps } = setup([submitReply({ findings: [good, bad] }), submitReply({ findings: [bad] })]);
    await steps.add({ kind: "prefetch", name: "brief", output: { n: 7 } });
    const r = await runLoop(opts);
    expect(r.status).toBe("done");
    expect(r.accepted).toHaveLength(1);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0].reason).toMatch(/ungrounded/);
  });

  it("free text without a submission is nudged once, then the run fails rather than guessing", async () => {
    const { opts, model } = setup([textReply("Everything looks fine"), textReply("Really fine")]);
    const r = await runLoop(opts);
    expect(r.status).toBe("failed");
    expect(r.accepted).toEqual([]);
    expect(JSON.stringify(model.calls[1].messages.at(-1))).toContain(SUBMIT_TOOL);
  });

  it("a refusal or a cut-off answer is a failure, never partial findings", async () => {
    const { opts } = setup([{ ...submitReply({ findings: [finding()] }), stopReason: "max_tokens" }]);
    const r = await runLoop(opts);
    expect(r.status).toBe("failed");
    expect(r.accepted).toEqual([]);
  });

  it("the gate is asked before every model call: a spent budget ends the run as skipped_budget with nothing sent", async () => {
    const { opts, model } = setup([submitReply({ findings: [] })], { gate: async () => ({ ok: false, status: "skipped_budget", reason: "Paused: monthly allowance reached" }) });
    const r = await runLoop(opts);
    expect(r).toMatchObject({ status: "skipped_budget", reason: "Paused: monthly allowance reached", turns: 0 });
    expect(model.calls).toHaveLength(0);
  });

  it("pausing takes effect between steps: the run is cancelled and the steps so far are kept", async () => {
    let calls = 0;
    const { opts, steps } = setup([toolReply("tender_next_steps", { deal_id: "deal-1" }), submitReply({ findings: [] })], {
      gate: async () => (++calls >= 3 ? { ok: false, status: "cancelled", reason: "Paused" } : { ok: true }),
    });
    const r = await runLoop(opts);
    expect(r.status).toBe("cancelled");
    expect(steps.records.some((x) => x.kind === "model")).toBe(true);
  });

  it("a model that throws fails the run with its message", async () => {
    const { opts } = setup([submitReply({ findings: [] })], { model: { create: async () => { throw new Error("The AI service is busy."); } } });
    const r = await runLoop(opts);
    expect(r).toMatchObject({ status: "failed", reason: "The AI service is busy." });
  });

  it("runs out of turns without an answer: failed", async () => {
    const t = toolReply("tender_next_steps", { deal_id: "deal-1" });
    const { opts } = setup([t, t, t, t, t], { limits: { maxTurns: 2, maxToolCalls: 9, maxTokensPerRun: 10_000, deadlineMs: 1000 } });
    const r = await runLoop(opts);
    expect(r.status).toBe("failed");
  });
});
