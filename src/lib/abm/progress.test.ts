import { describe, it, expect } from "vitest";
import { deriveProgress, validateManualProgress, describeProgressSource, type ProgressInput } from "./progress";
import { missingRoles, roleGaps, groupSummary, sanitizeRequiredRoles, pickPrimary } from "./roles";
import { computeResults, goalSentence } from "./results";
import { parseTargetPatch, parseProgram, parseMember, parseAddAccounts, cfOnly } from "./requests";

const DM = { contact_id: "c-dm", role: "decision_maker" as const, name: "Khalid" };
const INF = { contact_id: "c-inf", role: "influencer" as const, name: "Noura" };

const base = (over: Partial<ProgressInput> = {}): ProgressInput => ({
  current: "planned", currentSource: "rule", addedAt: "2026-09-01T00:00:00Z",
  members: [DM, INF], requiredRoles: ["decision_maker", "influencer"], engagedNeedsRequiredRoles: true, events: [], deal: null,
  ...over,
});

describe("progress rules", () => {
  it("stays Planned when nothing happened", () => {
    const v = deriveProgress(base());
    expect(v.changed).toBe(false);
    expect(v.progress).toBe("planned");
  });

  it("moves to Reached on a delivery to a buying-group member, and says who and when", () => {
    const v = deriveProgress(base({ events: [{ name: "email.delivered", occurred_at: "2026-10-04T08:00:00Z", contact_id: "c-dm" }] }));
    expect(v).toMatchObject({ progress: "reached", changed: true, rule: "reached" });
    expect(v.reason).toBe("Khalid was sent an email, 4 Oct 2026");
    expect(v.evidence).toHaveLength(1);
  });

  it("ignores events from people who are not in the buying group, and events before the company was added", () => {
    const v = deriveProgress(base({ events: [
      { name: "email.clicked", occurred_at: "2026-10-04T08:00:00Z", contact_id: "stranger" },
      { name: "email.clicked", occurred_at: "2026-08-01T08:00:00Z", contact_id: "c-dm" },
    ] }));
    expect(v.changed).toBe(false);
  });

  it("moves to Engaged on a click once the required roles are filled", () => {
    const v = deriveProgress(base({ current: "reached", events: [{ name: "email.clicked", occurred_at: "2026-10-08T08:00:00Z", contact_id: "c-inf" }] }));
    expect(v).toMatchObject({ progress: "engaged", changed: true, rule: "engaged", held: null });
    expect(v.reason).toContain("Noura clicked a link in an email, 8 Oct 2026");
  });

  it("holds at Reached when a required role is missing, and says why", () => {
    const v = deriveProgress(base({ current: "reached", members: [INF], events: [{ name: "email.clicked", occurred_at: "2026-10-08T08:00:00Z", contact_id: "c-inf" }] }));
    expect(v.changed).toBe(false);
    expect(v.progress).toBe("reached");
    expect(v.held).toBe("Would be Engaged, but no decision maker is named in the buying group");
  });

  it("from Planned, an engagement with a gap still counts as Reached (we obviously reached them)", () => {
    const v = deriveProgress(base({ members: [INF], events: [{ name: "email.clicked", occurred_at: "2026-10-08T08:00:00Z", contact_id: "c-inf" }] }));
    expect(v).toMatchObject({ progress: "reached", changed: true });
    expect(v.held).not.toBeNull();
  });

  it("the lenient setting engages on the first click regardless of the gap", () => {
    const v = deriveProgress(base({ current: "reached", members: [INF], engagedNeedsRequiredRoles: false, events: [{ name: "quote.opened", occurred_at: "2026-10-08T08:00:00Z", contact_id: "c-inf" }] }));
    expect(v).toMatchObject({ progress: "engaged", changed: true });
  });

  it("never moves backwards by rule, and leaves a person's In talks alone", () => {
    const v = deriveProgress(base({ current: "in_talks", currentSource: "manual", events: [{ name: "email.delivered", occurred_at: "2026-10-04T08:00:00Z", contact_id: "c-dm" }] }));
    expect(v.changed).toBe(false);
    expect(v.progress).toBe("in_talks");
  });

  it("a linked open deal moves to Deal open (and an In talks target forward), a closed one to Won or Lost", () => {
    expect(deriveProgress(base({ current: "in_talks", deal: { id: "d", ref: "OPP-0042", outcome: "open", amount: 1, closed_at: null } }))).toMatchObject({ progress: "deal_open", rule: "deal_open", reason: "OPP-0042 is open for this company" });
    const won = deriveProgress(base({ current: "deal_open", deal: { id: "d", ref: "OPP-0042", outcome: "won", amount: 1800000, closed_at: "2026-10-14T00:00:00Z" } }));
    expect(won).toMatchObject({ progress: "won", rule: "deal_closed" });
    expect(won.reason).toBe("OPP-0042 was won (1,800,000), 14 Oct 2026");
    expect(deriveProgress(base({ current: "deal_open", deal: { id: "d", ref: null, outcome: "lost", amount: null, closed_at: null } })).progress).toBe("lost");
    expect(deriveProgress(base({ current: "deal_open", deal: { id: "d", ref: null, outcome: "dropped", amount: null, closed_at: null } })).progress).toBe("lost");
  });

  it("a Dropped, Won or Lost target is never touched by a rule", () => {
    for (const current of ["dropped", "won", "lost"] as const) {
      const v = deriveProgress(base({ current, events: [{ name: "email.clicked", occurred_at: "2026-10-08T08:00:00Z", contact_id: "c-dm" }], deal: { id: "d", ref: "OPP-1", outcome: "open", amount: 1, closed_at: null } }));
      expect(v.changed).toBe(false);
      expect(v.progress).toBe(current);
    }
  });
});

describe("a manual progress change needs a reason", () => {
  it("refuses an empty or missing reason, and an unknown status", () => {
    expect(validateManualProgress("engaged", "").ok).toBe(false);
    expect(validateManualProgress("engaged", "   ").ok).toBe(false);
    expect(validateManualProgress("engaged", undefined).ok).toBe(false);
    expect(validateManualProgress("hot", "because").ok).toBe(false);
    const r = validateManualProgress("in_talks", " Site meeting 3 Nov ");
    expect(r).toEqual({ ok: true, progress: "in_talks", reason: "Site meeting 3 Nov" });
  });

  it("the route parser carries that rule: a progress with no reason is a 422-style error", () => {
    const noReason = parseTargetPatch({ progress: "dropped" });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.error).toMatch(/reason/i);
    const ok = parseTargetPatch({ progress: "dropped", progress_reason: "Awarded to a competitor" });
    expect(ok).toMatchObject({ ok: true, value: { progress: { to: "dropped", reason: "Awarded to a competitor" } } });
  });

  it("explains a manual override with who, when and why", () => {
    const s = describeProgressSource({ progress_source: "manual", progress_reason: "Site meeting held", progress_changed_at: "2026-11-03T10:00:00Z", actorName: "Faisal" });
    expect(s).toBe("Set by Faisal, 3 Nov 2026: Site meeting held");
    expect(describeProgressSource({ progress_source: "rule", progress_reason: "Khalid clicked a link in an email, 8 Oct 2026", progress_changed_at: "2026-10-08T00:00:00Z" })).toBe("Set by rule: Khalid clicked a link in an email, 8 Oct 2026");
  });
});

describe("request allowlists", () => {
  it("a target PATCH ignores everything it does not list (tenant, program, account, ids)", () => {
    const r = parseTargetPatch({ tenant_id: "x", program_id: "y", account_id: "z", id: "w", tier: "one_to_one", next_step: "Call", progress_source: "rule" });
    expect(r).toEqual({ ok: true, value: { tier: "one_to_one", next_step: "Call" } });
  });

  it("only cf_ custom fields get through, as plain values", () => {
    expect(cfOnly({ cf_region: "Central", tenant_id: "x", cf_n: 4, cf_o: { a: 1 }, "cf_bad key": "x" })).toEqual({ cf_region: "Central", cf_n: 4 });
  });

  it("validates program fields and dates", () => {
    expect(parseProgram({ name: "" }, true).ok).toBe(false);
    expect(parseProgram({ name: "X", starts_on: "2027-02-01", ends_on: "2027-01-01" }, true).ok).toBe(false);
    expect(parseProgram({ name: "X", kind: "party" }, true).ok).toBe(false);
    const p = parseProgram({ name: "X", required_roles: ["blocker", "decision_maker", "decision_maker"], status: "active" }, true);
    expect(p).toMatchObject({ ok: true, value: { required_roles: ["decision_maker"], status: "active" } });
  });

  it("a member needs a contact on create and a known role", () => {
    expect(parseMember({ role: "user" }, true).ok).toBe(false);
    expect(parseMember({ contact_id: "c", role: "boss" }, true).ok).toBe(false);
    expect(parseMember({ role: "blocker" }, false)).toEqual({ ok: true, value: { role: "blocker" } });
  });

  it("adding accounts takes exactly one way of choosing", () => {
    expect(parseAddAccounts({ account_ids: ["a"], segment_id: "s" }).ok).toBe(false);
    expect(parseAddAccounts({}).ok).toBe(false);
    expect(parseAddAccounts({ segment_id: "s", tier: "one_to_few" })).toEqual({ ok: true, value: { segment_id: "s", tier: "one_to_few" } });
  });
});

describe("buying group gaps", () => {
  it("lists each required role nobody holds", () => {
    expect(missingRoles(["decision_maker", "influencer"], [{ role: "influencer" }])).toEqual(["decision_maker"]);
    expect(roleGaps(["decision_maker", "influencer"], [])).toEqual([
      { role: "decision_maker", text: "No decision maker yet" }, { role: "influencer", text: "No influencer yet" },
    ]);
    expect(roleGaps(["decision_maker"], [{ role: "decision_maker" }])).toEqual([]);
  });

  it("the required roles are per program, so a different program asks for different roles", () => {
    const members = [{ role: "user" as const }];
    expect(missingRoles(["decision_maker"], members)).toEqual(["decision_maker"]);
    expect(missingRoles(["user"], members)).toEqual([]);
  });

  it("summarises for a list row", () => {
    expect(groupSummary(["decision_maker"], [{ role: "influencer" }, { role: "user" }])).toEqual({ text: "2 people · no decision maker", hasGap: true });
    expect(groupSummary(["decision_maker"], [{ role: "decision_maker" }])).toEqual({ text: "1 person", hasGap: false });
    expect(groupSummary(["decision_maker"], []).text).toBe("No one named yet · no decision maker");
  });

  it("only requirable roles survive, falling back to the default", () => {
    expect(sanitizeRequiredRoles(["blocker", "unknown"], ["decision_maker"])).toEqual(["decision_maker"]);
    expect(sanitizeRequiredRoles("nope", ["influencer"])).toEqual(["influencer"]);
  });

  it("calls the primary first, else the decision maker", () => {
    expect(pickPrimary([{ id: "a", role: "user", is_primary: false }, { id: "b", role: "decision_maker", is_primary: false }])?.id).toBe("b");
    expect(pickPrimary([{ id: "a", role: "user", is_primary: true }, { id: "b", role: "decision_maker", is_primary: false }])?.id).toBe("a");
    expect(pickPrimary([])).toBeNull();
  });
});

describe("results by account", () => {
  const t = (id: string, tier: "one_to_one" | "one_to_few" | "one_to_many", progress: Parameters<typeof computeResults>[0][number]["progress"], opportunity_id: string | null = null) => ({ id, account_id: id, tier, progress, opportunity_id });

  it("counts the funnel by company: reached, engaged, in talks, in a deal, won", () => {
    const targets = [
      t("1", "one_to_one", "won", "d1"), t("2", "one_to_one", "deal_open", "d2"), t("3", "one_to_one", "deal_open", "d3"),
      t("4", "one_to_few", "in_talks"), t("5", "one_to_few", "engaged"), t("6", "one_to_few", "engaged"), t("7", "one_to_few", "engaged"),
      t("8", "one_to_many", "reached"), t("9", "one_to_many", "reached"), t("10", "one_to_many", "reached"), t("11", "one_to_many", "reached"),
      t("12", "one_to_many", "planned"), t("13", "one_to_many", "dropped"),
    ];
    const deals = [{ id: "d1", outcome: "won" as const, amount: 1800000 }, { id: "d2", outcome: "open" as const, amount: 1200000 }, { id: "d3", outcome: "open" as const, amount: 3000000 }, { id: "orphan", outcome: "won" as const, amount: 99 }];
    const r = computeResults(targets, deals, { metric: "deals_won", target: 3 });
    expect(r.funnel).toMatchObject({ targets: 13, reached: 11, engaged: 7, inTalks: 4, deals: 3, won: 1, dropped: 1 });
    expect(r.byTier.find((x) => x.tier === "one_to_one")).toMatchObject({ targets: 3, engaged: 3, deals: 3, won: 1 });
    expect(r.money).toEqual({ openValue: 4200000, wonValue: 1800000, openDeals: 2, wonDeals: 1 });
    expect(goalSentence(r)).toBe("1 of 3 won");
    expect(r.smallSample).toBe(true);
  });

  it("money counts a deal once and only when a target links it", () => {
    const r = computeResults([t("1", "one_to_one", "won", "d1"), t("2", "one_to_one", "won", "d1")], [{ id: "d1", outcome: "won", amount: 100 }], { metric: "revenue", target: null });
    expect(r.money.wonValue).toBe(100);
    expect(goalSentence(r)).toBe("100 revenue won so far");
  });
});
