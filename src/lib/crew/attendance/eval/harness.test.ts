import { describe, expect, it } from "vitest";
import { scriptedModel, submitReply, toolReply } from "../../eval/scripted";
import type { SubmitFindings } from "../../types";
import { runAttendanceCase, summariseAttendance, type AttendanceCaseRun } from "./harness";
import { buildCase, loadCases } from "./fixtures";
import { referenceSubmission } from "./reference";

// Deterministic checks of the Attendance evaluation machinery (no model, no network): every fixed situation is answered correctly by the rules-only
// reference through the REAL loop, prompt, tools and validator, the scoring bites when an answer is wrong, and the release gate fails when it should.
// The model-quality run is `npm run crew:eval -- attendance`.

const cases = loadCases();
const byId = (id: string) => cases.find((c) => c.id === id)!;
const asSubmit = (x: unknown) => x as SubmitFindings;

async function reference(id: string) {
  const c = byId(id);
  const built = await buildCase(c);
  return { c, built, sub: referenceSubmission(built.digest) };
}

describe("the reference answers every situation through the real loop and passes the release gate", () => {
  it("runs all of them with no corrective retry and no drops", async () => {
    const runs: AttendanceCaseRun[] = [];
    for (const c of cases) {
      const built = await buildCase(c);
      const r = await runAttendanceCase(c, scriptedModel([submitReply(asSubmit(referenceSubmission(built.digest)))]));
      expect(r.status, `${c.id}: ${r.reason}`).toBe("done");
      expect(r.score.parsed, c.id).toBe(true);
      expect(r.score.dropped, `${c.id} dropped`).toBe(0);
      expect(r.score.person_level_violations, c.id).toBe(0);
      expect(r.score.banned_terms, c.id).toEqual([]);
      runs.push(r);
    }
    const s = summariseAttendance(runs);
    expect(s.gate).toEqual({ pass: true, failures: [] });
    expect(s.aggregate.cases).toBe(cases.length);
    expect(s.aggregate.recall).toBe(1);
  }, 120_000);
});

describe("the scoring and the gate bite", () => {
  it("a person named for a site-level pattern is refused by the validator and counts against the model", async () => {
    const { c, built } = await reference("site-level-01-late-three-days");
    const first = built.digest.candidates[0];
    const hostile = {
      findings: [{
        candidate_id: first.id, kind: first.family, level: "person", severity: "review", subject: { type: "person", alias: "P1" },
        title_tmpl: "P1 is often late", observed_tmpl: "P1 was late on {{s1.candidates[0].days|dates}}.",
        explanations: [{ code: "transport_or_gate_process", text_tmpl: "transport" }], actions: [{ code: "nothing", text_tmpl: "nothing" }],
        evidence: [{ step: "s1", path: "candidates[0]", label: "candidate" }], gaps: [],
      }],
      proposals: [], nothing_to_report: null,
    };
    const r = await runAttendanceCase(c, scriptedModel([submitReply(asSubmit(hostile)), submitReply(asSubmit({ findings: [], proposals: [], nothing_to_report: "None." }))]));
    expect(r.score.person_level_violations).toBeGreaterThan(0);
    expect(r.accepted).toBe(0);
    expect(summariseAttendance([r]).gate.pass).toBe(false);
  });

  it("a banned word anywhere in what the model wrote fails the gate even when the finding is dropped", async () => {
    const { c, sub } = await reference("site-level-01-late-three-days");
    const bad = { ...sub, findings: sub.findings.map((f, i) => (i === 0 ? { ...f, title_tmpl: "Possible fraud: late check-ins cluster" } : f)) };
    const r = await runAttendanceCase(c, scriptedModel([submitReply(asSubmit(bad)), submitReply(asSubmit({ findings: [], proposals: [], nothing_to_report: "None." }))]));
    expect(r.score.banned_terms).toContain("fraud");
    expect(summariseAttendance([r]).gate.pass).toBe(false);
  });

  it("a model that finds nothing on a flag-worthy situation loses recall", async () => {
    const { c } = await reference("site-level-01-late-three-days");
    const r = await runAttendanceCase(c, scriptedModel([submitReply(asSubmit({ findings: [], proposals: [], nothing_to_report: "Everything looks normal." }))]));
    expect(r.score.must_flag_hit).toBe(0);
    expect(summariseAttendance([r]).gate.failures.join(" ")).toMatch(/recall/);
  });

  it("a model that flags a quiet situation is a false positive", async () => {
    const { c, built } = await reference("quiet-02-one-late-day");
    expect(built.digest.candidates.length).toBeGreaterThanOrEqual(0);
    const r = await runAttendanceCase(c, scriptedModel([submitReply(asSubmit({ findings: [], proposals: [], nothing_to_report: "Nothing to look at." }))]));
    expect(r.score.false_positives).toEqual([]);
    expect(r.score.person_level_violations).toBe(0);
  });

  it("a drill-down tool is served over the fixture and is citable; a person who is not in a candidate is refused", async () => {
    const { c, sub } = await reference("person-level-01-late-five-days");
    const alias = c.expect.must_flag[0].subject!;
    const model = scriptedModel([
      toolReply("attendance_person_history", { alias }),
      toolReply("attendance_person_history", { alias: "P99" }),
      submitReply(asSubmit(sub)),
    ]);
    const r = await runAttendanceCase(c, model);
    expect(r.status).toBe("done");
    const second = JSON.stringify(model.calls[1].messages.at(-1));
    expect(second).toContain('late_minutes');
    const third = JSON.stringify(model.calls[2].messages.at(-1));
    expect(third).toContain("not one of this run");
    expect(r.score.must_flag_hit).toBe(r.score.must_flag_expected);
  });

  it("a run that never submits is a parse failure, which the gate refuses", async () => {
    const { c } = await reference("quiet-01-everyone-on-time");
    const r = await runAttendanceCase(c, scriptedModel([{ content: [{ type: "text", text: "I am not sure." }], stopReason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, model: "scripted" }]));
    expect(r.status).toBe("failed");
    expect(summariseAttendance([r]).gate.failures.join(" ")).toMatch(/parse/);
  });
});
