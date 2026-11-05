import { describe, expect, it } from "vitest";
import { buildCase, loadCases } from "./eval/fixtures";
import { referenceSubmission } from "./eval/reference";
import { validateAttendanceSubmission, type SubmitCtx } from "./submit";

// The step between the model's raw submission and what the shared runner persists: real ids come from the run's alias map, the text keeps aliases,
// the recipients exclude the person a finding is about, a recheck keeps its people and its day, a site note becomes part of the finding.

const ALIAS = /\b[PS]\d+\b/;
const cases = loadCases();
const byId = (id: string) => cases.find((c) => c.id === id)!;

async function run(id: string, recipientsFor?: SubmitCtx["recipientsFor"]) {
  const c = byId(id);
  const built = await buildCase(c);
  const marked: Record<string, string[]> = {};
  const asked: [string, string][] = [];
  const out = validateAttendanceSubmission(referenceSubmission(built.digest), new Map(Object.entries(built.toolResults)), {
    digest: built.digest, aliases: built.aliases, marked,
    recipientsFor: recipientsFor ?? ((type, subject) => { asked.push([type, subject]); return ["u-lead", "u-site-supervisor"]; }),
  });
  return { c, built, out, marked, asked };
}

describe("a person-level finding with a recheck", () => {
  it("is stored against the real employee and site, with aliases only in the text", async () => {
    const { out, built } = await run("person-level-06-far-three-times");
    const f = out.accepted.find((x) => x.subject_type === "employee")!;
    expect(f).toBeTruthy();
    expect(f.subject_id).toMatch(/^emp-\d{4}$/);
    expect(f.site_id).toBe(Object.values(built.aliases.sites)[0]);
    expect(f.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(f.title + f.body).not.toMatch(/emp-\d|site-\d/);
    expect(f.title + f.body).toMatch(ALIAS);
  });

  it("asks the recheck of that person only, for the latest day of the pattern, addressed to the same supervisors as the finding", async () => {
    const { out, built } = await run("person-level-06-far-three-times");
    const f = out.accepted.find((x) => x.proposal)!;
    const p = f.proposal!;
    expect(p.action_key).toBe("wfm.recheck");
    expect(p.payload).toMatchObject({ employee_ids: [f.subject_id] });
    const cand = built.digest.candidates.find((c) => c.person && built.aliases.persons[c.person] === f.subject_id)!;
    expect((p.payload as { target_date: string }).target_date).toBe([...cand.days].sort().at(-1));
    expect(p.recipient_ids).toEqual(f.recipient_ids);
    expect(p.message).not.toMatch(ALIAS);
    expect(p.message).not.toMatch(/\bAI\b|agent|assistant/i);
    expect(p.fingerprint).toMatch(/^[0-9a-f]{32}$/);
  });

  it("hands the real subject to the recipient rule, so the person a finding is about can be left out", async () => {
    const { out, asked } = await run("person-level-06-far-three-times");
    const person = out.accepted.find((x) => x.subject_type === "employee")!;
    expect(asked).toContainEqual(["employee", person.subject_id]);
    expect(asked.every(([, id]) => !ALIAS.test(id))).toBe(true);
  });

  it("remembers which days the pattern is made of, for the card's strip", async () => {
    const { out, marked } = await run("person-level-06-far-three-times");
    const f = out.accepted[0];
    expect(marked[f.fingerprint!].length).toBeGreaterThan(0);
  });
});

describe("a site-level finding", () => {
  it("is about the site, names no one, and keeps a site note as part of the finding (nothing is sent)", async () => {
    const { out } = await run("site-level-01-late-three-days");
    const f = out.accepted[0];
    expect(f.subject_type).toBe("site");
    expect(f.subject_id).toMatch(/^site-\d{4}$/);
    expect(f.body).toContain("Note for the site team:");
    expect(f.proposal).toBeNull();
    expect(f.title + f.body).not.toMatch(/\bP\d+\b/);
  });

  it("a missing-check-out cluster proposes ONE recheck for the people behind it, in the payload", async () => {
    const { out } = await run("site-level-06-nine-did-not-check-out");
    const f = out.accepted.find((x) => x.proposal)!;
    expect(f.subject_type).toBe("site");
    const ids = (f.proposal!.payload as { employee_ids: string[] }).employee_ids;
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^emp-\d{4}$/);
    expect(f.proposal!.target_type).toBe("site");
  });
});

describe("what is refused", () => {
  it("a malformed submission is rejected as a whole, with the reason, and nothing is accepted", async () => {
    const { built } = await run("quiet-01-everyone-on-time");
    const out = validateAttendanceSubmission({ findings: "no" }, new Map(Object.entries(built.toolResults)), { digest: built.digest, aliases: built.aliases, recipientsFor: () => [] });
    expect(out.accepted).toEqual([]);
    expect(out.rejected[0].reason).toMatch(/^malformed/);
    expect(out.result).toBeNull();
  });

  it("an empty list with a reason is a normal, successful answer", async () => {
    const { built } = await run("quiet-01-everyone-on-time");
    const out = validateAttendanceSubmission({ findings: [], proposals: [], nothing_to_report: "Nothing to look at." }, new Map(Object.entries(built.toolResults)), { digest: built.digest, aliases: built.aliases, recipientsFor: () => [] });
    expect(out.accepted).toEqual([]);
    expect(out.rejected).toEqual([]);
    expect(out.result?.nothing_to_report).toBe("Nothing to look at.");
  });

  it("a finding whose alias has no real id behind it is not persisted half-resolved, and is reported as rejected", async () => {
    const c = byId("person-level-06-far-three-times");
    const built = await buildCase(c);
    const stripped = { persons: {}, sites: built.aliases.sites };
    const out = validateAttendanceSubmission(referenceSubmission(built.digest), new Map(Object.entries(built.toolResults)), { digest: built.digest, aliases: stripped, recipientsFor: () => ["u"] });
    expect(out.accepted).toEqual([]);
    expect(out.rejected.length).toBeGreaterThan(0);
  });
});
