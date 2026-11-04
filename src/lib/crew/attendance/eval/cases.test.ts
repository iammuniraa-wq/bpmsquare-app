import { describe, expect, it } from "vitest";
import { ATTENDANCE_FAMILIES, DISTANCE_BUCKETS } from "../facts";
import { ALIAS_TOKEN } from "../alias";
import { dateRange, isDateKey } from "../dates";
import type { Submission } from "../submission";
import { buildCase, loadCases, summaryRowsOf } from "./fixtures";
import { referenceSubmission } from "./reference";
import { aggregate, releaseGate, scoreCase, type CaseScore } from "./score";
import { CASE_TAGS, MIN_CASES, type EvalCase } from "./types";

const cases = loadCases();

describe("fixture set (design 7)", () => {
  it("has at least 40 cases with the required spread", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    for (const tag of CASE_TAGS) {
      expect(cases.filter((c) => c.tags.includes(tag)).length, tag).toBeGreaterThanOrEqual(MIN_CASES[tag]);
    }
  });

  it("has unique ids that match the file order", () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  for (const c of cases) {
    describe(c.id, () => {
      it("is a valid fixture: tags, dates, aliases, codes, buckets", () => {
        expect(c.tags.length).toBeGreaterThan(0);
        for (const t of c.tags) expect(CASE_TAGS as readonly string[]).toContain(t);
        const { run, site, people } = c.input;
        expect(isDateKey(run.from) && isDateKey(run.to)).toBe(true);
        expect(dateRange(run.from, run.to)!.length).toBeGreaterThanOrEqual(14);
        expect(site.alias).toMatch(/^S\d+$/);
        const aliases = people.map((p) => p.alias);
        expect(new Set(aliases).size).toBe(aliases.length);
        for (const a of aliases) expect(a).toMatch(/^P\d+$/);
        for (const p of people) {
          for (const [date, code] of Object.entries(p.days ?? {})) {
            expect(isDateKey(date)).toBe(true);
            expect(code).toMatch(/^(P|M|A|V|X|XM|L\d+|LM\d+)$/);
          }
          for (const f of p.flags ?? []) {
            expect(isDateKey(f.date)).toBe(true);
            if (f.bucket) expect(DISTANCE_BUCKETS as readonly string[]).toContain(f.bucket);
          }
        }
        // building the summary rows must not throw (unknown day code)
        expect(summaryRowsOf(c.input)).toHaveLength(people.length);
      });

      it("expectation is consistent with the case's tags", () => {
        const e = c.expect;
        for (const m of e.must_flag) {
          expect(ATTENDANCE_FAMILIES as readonly string[]).toContain(m.kind);
          expect(m.must_cite.length).toBeGreaterThan(0);
          if (m.level === "person") expect(m.subject).toMatch(/^P\d+$/);
        }
        if (["quiet", "site-level", "trainee", "adversarial"].some((t) => c.tags.includes(t))) expect(e.max_person_findings).toBe(0);
        if (c.tags.includes("quiet")) expect(e.max_findings).toBe(0);
        if (c.tags.includes("person-level")) {
          expect(e.must_flag.some((m) => m.level === "person")).toBe(true);
          expect(e.proposals.forbidden_target_aliases.length).toBeGreaterThan(0);
        }
        // a person-level expectation never targets a proposal at anybody but the flagged person
        for (const m of e.must_flag) if (m.subject) expect(e.proposals.forbidden_target_aliases).not.toContain(m.subject);
      });

      it("the plain detectors produce exactly the expected candidates", async () => {
        const built = await buildCase(c);
        const got = built.candidates.map((x) => ({ family: x.family, level: x.level, ...(x.person ? { subject: x.person } : {}) }));
        expect(got).toEqual(c.expect.expected_candidates);
        // everything the model would see: no names, ids or codes. Only aliases and invented labels.
        const text = JSON.stringify(built.toolResults);
        expect(text).not.toMatch(/emp-\d|site-\d/);
        expect((text.match(ALIAS_TOKEN) ?? []).length).toBeGreaterThan(-1);
        // the case is flaggable only when it has at least one candidate
        if (c.expect.must_flag.length > 0) expect(built.candidates.length).toBeGreaterThan(0);
      });

      it("a careful answer (reference judge) satisfies the case", async () => {
        const built = await buildCase(c);
        const sub = referenceSubmission(built.digest);
        const s = scoreCase(c, JSON.parse(JSON.stringify(sub)), built.toolResults);
        expect(s.parse_errors).toEqual([]);
        expect(s.dropped, JSON.stringify(s)).toBe(0);
        expect(s.missed, JSON.stringify(s)).toEqual([]);
        expect(s.false_positives).toEqual([]);
        expect(s.person_level_violations).toBe(0);
        expect(s.banned_terms).toEqual([]);
        expect(s.forbidden_proposals).toEqual([]);
        expect(s.gaps_missing).toEqual([]);
      });
    });
  }
});

describe("release gate over the whole set", () => {
  const scoreAll = async (make: (c: EvalCase, digest: Awaited<ReturnType<typeof buildCase>>) => Submission): Promise<CaseScore[]> => {
    const out: CaseScore[] = [];
    for (const c of cases) {
      const built = await buildCase(c);
      out.push(scoreCase(c, JSON.parse(JSON.stringify(make(c, built))), built.toolResults));
    }
    return out;
  };

  it("passes for the reference judge with recall 100 percent", async () => {
    const agg = aggregate(await scoreAll((_c, b) => referenceSubmission(b.digest)));
    expect(agg.recall).toBe(1);
    expect(releaseGate(agg)).toEqual({ pass: true, failures: [] });
  });

  it("fails when a model never flags anything (recall below 85 percent)", async () => {
    const agg = aggregate(await scoreAll(() => ({ findings: [], proposals: [], nothing_to_report: "nothing" })));
    expect(agg.recall).toBe(0);
    const gate = releaseGate(agg);
    expect(gate.pass).toBe(false);
    expect(gate.failures.join(" ")).toMatch(/recall/);
  });

  it("fails when a model names a person on a site-level case", async () => {
    const agg = aggregate(
      await scoreAll((c, b) => {
        const sub = referenceSubmission(b.digest);
        const site = sub.findings.find((f) => f.level === "site");
        if (!site) return sub;
        // pretend the model also wrote a person finding about someone in the cluster
        const bad = { ...site, level: "person" as const, subject: { type: "person" as const, alias: "P1" } };
        return { ...sub, findings: [...sub.findings, { ...bad, candidate_id: site.candidate_id }] };
      })
    );
    expect(agg.person_level_violations).toBeGreaterThan(0);
    expect(releaseGate(agg).pass).toBe(false);
  });

  it("fails when a model writes a banned term", async () => {
    const agg = aggregate(
      await scoreAll((_c, b) => {
        const sub = referenceSubmission(b.digest);
        if (sub.findings[0]) sub.findings[0] = { ...sub.findings[0], observed_tmpl: "This looks like fraud." };
        return sub;
      })
    );
    expect(agg.banned_term_hits).toBeGreaterThan(0);
    expect(releaseGate(agg).failures.join(" ")).toMatch(/banned/);
  });
});
