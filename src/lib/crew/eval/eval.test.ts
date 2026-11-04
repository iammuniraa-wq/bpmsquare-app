import { describe, expect, it } from "vitest";
import { TENDER_CASES } from "../tender/eval/cases";
import { passesGate, runTenderCase, scoreCase, summarise, type CaseRun } from "./harness";
import { oracleModel, scriptedModel, submitReply, toolReply } from "./scripted";
import type { DraftFinding } from "../types";

// Deterministic checks of the evaluation machinery (no model, no network): every fixed case is satisfiable by its hand-written answer through the
// REAL validator, the scoring bites when an answer is wrong, and the release gate fails when it should. The model-quality run is `npm run crew:eval`.

const byId = (id: string) => TENDER_CASES.find((c) => c.id === id)!;

describe("every case can be answered correctly (the oracle passes the real validator and the scoring)", () => {
  it.each(TENDER_CASES.map((c) => [c.id, c.title]))("%s %s", async (id) => {
    const c = byId(id);
    const r = await runTenderCase(c, oracleModel(c));
    expect(r.status, `${id}: ${r.reason} ${r.dropped.join("; ")}`).toBe("done");
    expect(r.dropped).toEqual([]);
    expect(r.score.recallHits).toBe(r.score.recallTotal);
    expect(r.score.falsePositives).toBe(0);
    expect(r.score.recipientViolations).toBe(0);
  });

  it("the whole set passes the release gate with the oracle", async () => {
    const runs: CaseRun[] = [];
    for (const c of TENDER_CASES) runs.push(await runTenderCase(c, oracleModel(c)));
    const s = summarise(runs);
    expect(s.recall).toBe(1);
    expect(passesGate(s)).toEqual({ pass: true, failures: [] });
    expect(s.cases).toBe(30);
  });
});

describe("the scoring and the gate bite", () => {
  it("a model that flags a healthy tender is a false positive and fails the gate", async () => {
    const c = byId("TW-13");
    const flag: DraftFinding = { kind: "at_risk", severity: "review", subject: { type: "opportunity", id: c.candidates[0] }, title_tmpl: "{{s1.deals.d1.boq.unpriced}} lines are unpriced.", body_tmpl: "Please check.", evidence: [{ step: "s1", path: "deals.d1.boq.unpriced" }], gaps: [] };
    const r = await runTenderCase(c, scriptedModel([submitReply({ findings: [flag] })]));
    expect(r.score.falsePositives).toBe(1);
    expect(passesGate(summarise([r])).pass).toBe(false);
  });

  it("a model that misses the at-risk tender loses recall", async () => {
    const c = byId("TW-01");
    const r = await runTenderCase(c, scriptedModel([submitReply({ findings: [], nothing_to_report: "All fine." })]));
    expect(r.score.recallHits).toBe(0);
    expect(passesGate(summarise([r])).failures[0]).toMatch(/recall/);
  });

  it("a note to someone the finding may not address is dropped by the validator, so it never counts as sent", async () => {
    const c = byId("TW-28");
    const hostile: DraftFinding = {
      kind: "at_risk", severity: "info", subject: { type: "opportunity", id: c.candidates[0] }, title_tmpl: "{{s1.deals.d1.ref}} was flagged.", body_tmpl: "{{s1.deals.d1.title}}", evidence: [{ step: "s1", path: "deals.d1.ref" }], gaps: [],
      proposal: { action_key: "tender.nudge", target_type: "opportunity", target_id: c.candidates[0], recipient_ids: ["u-outsider-0099"], message_tmpl: "This deal is lost." },
    };
    const r = await runTenderCase(c, scriptedModel([submitReply({ findings: [hostile] }), submitReply({ findings: [hostile] })]));
    expect(r.accepted).toEqual([]);
    expect(r.dropped[0]).toMatch(/recipient not permitted/);
    expect(r.score.recipientViolations).toBe(0);
  });

  it("a stuck decision may not be addressed to the person who proposed it", async () => {
    const c = byId("TW-02");
    const base = c.oracle!.findings[0];
    const toProposer: DraftFinding = { ...base, proposal: { ...base.proposal!, recipient_ids: ["u-estimator-0002"] } };
    const r = await runTenderCase(c, scriptedModel([submitReply({ findings: [toProposer] }), submitReply({ findings: [toProposer] })]));
    expect(r.accepted).toEqual([]);
    expect(r.dropped[0]).toMatch(/recipient not permitted/);
  });

  it("a model that ignores an injected instruction still gets the tender flagged (TW-27), and a model that obeys it fails recall", async () => {
    const c = byId("TW-27");
    const good = await runTenderCase(c, oracleModel(c));
    expect(good.score.recallHits).toBe(1);
    const obeyed = await runTenderCase(c, scriptedModel([submitReply({ findings: [], nothing_to_report: "Every tender is on track." })]));
    expect(obeyed.score.recallHits).toBe(0);
  });

  it("counts a missing 'could not check' as lost recall", () => {
    const c = byId("TW-24");
    expect(scoreCase(c, [], 0, 0, "Nothing can be judged: the bill of quantities could not be read.").recallHits).toBe(1);
    expect(scoreCase(c, [], 0, 0, "All fine").recallHits).toBe(0);
  });

  it("serves a drill-down tool from the fixture and records it as a citable step", async () => {
    const c = byId("TW-04");
    const model = scriptedModel([toolReply("tender_open_questions", { deal_id: c.candidates[0] }), submitReply(c.oracle!)]);
    const r = await runTenderCase(c, model);
    expect(r.status).toBe("done");
    expect(JSON.stringify(model.calls[1].messages.at(-1))).toContain("Rebar grade");
    expect(r.score.recallHits).toBe(1);
  });

  it("refuses a tool call for a deal that is not a candidate of the case", async () => {
    const c = byId("TW-04");
    const model = scriptedModel([toolReply("tender_open_questions", { deal_id: "d9999999-0000-4000-8000-000000000000" }), submitReply({ findings: [] })]);
    await runTenderCase(c, model);
    expect(JSON.stringify(model.calls[1].messages.at(-1))).toContain("not one of this run");
  });
});
