import { describe, expect, it } from "vitest";
import { summariseVerdicts } from "./plainAudiencePlan";

const cand = (name: string, email: string | null, accountId: string | null = "a1") => ({
  account_id: accountId, account_name: name, email, marketing_opt_out: false, manual_email: accountId ? null : email,
});

describe("summariseVerdicts", () => {
  it("counts only people the gate lets through as receiving", () => {
    const plan = summariseVerdicts([
      { candidate: cand("A", "a@x.com"), verdict: { ok: true } },
      { candidate: cand("B", null), verdict: { ok: false, status: "skipped_no_email", reason: "no_email", contact: null } },
      { candidate: cand("c@x.com", "c@x.com", null), verdict: { ok: false, status: "skipped_no_contact", reason: "no_contact", contact: null } },
      { candidate: cand("D", "d@x.com", "a4"), verdict: { ok: false, status: "skipped_no_consent", reason: "no_consent", contact: { id: "k4" } } },
    ]);
    expect(plan.total).toBe(4);
    expect(plan.willReceive).toBe(1);
    expect(plan.leftOut.map((l) => l.code)).toEqual(["no_email", "no_contact", "no_consent"]);
    expect(plan.leftOut[1].fix?.href).toBe("/contacts/new?email=c%40x.com");
    expect(plan.leftOut[2].fix?.href).toBe("/contacts/k4");
  });

  it("groups reasons, biggest first, and caps the listed people", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ candidate: cand(`P${i}`, null), verdict: { ok: false as const, status: "skipped_no_email", reason: "no_email", contact: null } }));
    const plan = summariseVerdicts(rows, 3);
    expect(plan.byCode).toEqual([{ code: "no_email", label: "No email address", count: 5 }]);
    expect(plan.leftOut).toHaveLength(3);
  });
});
