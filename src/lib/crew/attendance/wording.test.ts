import { describe, expect, it } from "vitest";
import { AGENT_MENTIONS, BANNED_TERMS, EXTRA_BANNED, SEVERITY_LABEL, agentMentionsIn, bannedTermsIn, checkEmployeeFacingWording, checkWording } from "./wording";

describe("banned terms", () => {
  it("the design's list is the constant, exactly", () => {
    expect([...BANNED_TERMS]).toEqual([
      "fraud", "cheat", "proxy", "buddy", "lying", "theft", "steal", "suspicious", "deduct", "penalty", "penalise",
      "discipline", "terminate", "warning letter", "salary",
    ]);
  });

  it("every term, in any case and with common endings, is caught", () => {
    const samples = [
      "This looks like FRAUD", "possible cheating", "a proxy punch", "buddy punching", "he is lying", "time theft", "stealing minutes",
      "Suspicious pattern", "a deduction", "a penalty", "penalised", "disciplinary step", "terminated", "a warning letter", "affects salary",
    ];
    for (const s of samples) expect(bannedTermsIn(s).length, s).toBeGreaterThan(0);
  });

  it("every extra term is caught on its own", () => {
    for (const t of EXTRA_BANNED) expect(bannedTermsIn(`prefix ${t} suffix`), t).toContain(t);
  });

  it("character, intent, pay and blame language is caught", () => {
    for (const s of ["lazy approach", "dishonest start times", "P3 is unreliable", "on purpose", "deliberately late", "affects payroll", "a pay cut", "worst offender", "a violation", "his attitude", "to blame"]) {
      expect(bannedTermsIn(s).length, s).toBeGreaterThan(0);
    }
  });

  it("plain, neutral wording passes", () => {
    for (const s of [
      "Late check-ins cluster on three days at this site.",
      "The shift start or grace setting may explain it.",
      "A location problem on the phone is possible.",
      "Worth a look. You could review the site boundary in Settings.",
      "Nothing needs doing.",
    ]) expect(bannedTermsIn(s), s).toEqual([]);
  });

  it("matches word starts, not the middle of unrelated words", () => {
    expect(bannedTermsIn("a subproxy")).toEqual([]);
    expect(bannedTermsIn("steal")).toContain("steal");
  });

  it("severity words are never 'violation'", () => {
    expect(Object.values(SEVERITY_LABEL)).toEqual(["For information", "Worth a look", "Review soon"]);
    for (const v of Object.values(SEVERITY_LABEL)) expect(bannedTermsIn(v)).toEqual([]);
  });
});

describe("checkWording", () => {
  it("names nobody in a site-level finding", () => {
    expect(checkWording(["P3 is late"], { level: "site" })).toEqual([{ code: "names_person_for_site_pattern", detail: "P3" }]);
    expect(checkWording(["Several people are late at S2"], { level: "site" })).toEqual([]);
  });

  it("one person per person-level finding: two aliases is a comparison", () => {
    expect(checkWording(["P3 and P5 are both late"], { level: "person" }).map((p) => p.code)).toContain("compares_people");
    expect(checkWording(["P3 is late"], { level: "person" })).toEqual([]);
  });

  it("comparing a person with the others is caught", () => {
    expect(checkWording(["P3 is later than the others"], { level: "person" }).map((p) => p.code)).toContain("compares_people");
    expect(checkWording(["Unlike everyone else, P3 punches late"], { level: "person" }).map((p) => p.code)).toContain("compares_people");
  });

  it("reports banned terms with the term", () => {
    expect(checkWording(["Suspicious"], { level: "site" })).toEqual([{ code: "banned_term", detail: "suspicious" }]);
  });
});

describe("employee-facing text (a recheck message sent by a supervisor)", () => {
  it("must not reveal an agent or AI, carry an alias or a banned term", () => {
    expect(checkEmployeeFacingWording("Please check your punches on 27 Oct and send a correction request if needed.")).toEqual([]);
    expect(checkEmployeeFacingWording("Our AI assistant flagged your punches").map((p) => p.code)).toContain("mentions_agent");
    expect(checkEmployeeFacingWording("P4, please check").map((p) => p.code)).toContain("alias_in_message");
    expect(checkEmployeeFacingWording("This looks like fraud").map((p) => p.code)).toContain("banned_term");
  });

  it("agent mentions are whole words: 'said' and 'rail' are fine", () => {
    expect(agentMentionsIn("He said the rail was shut")).toEqual([]);
    expect(agentMentionsIn("an automated check")).toContain("automated");
    expect([...AGENT_MENTIONS]).toContain("ai");
  });
});
