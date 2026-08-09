import { describe, it, expect } from "vitest";
import { applyPunch, deriveState, allowedKinds } from "./types";

describe("punch state machine (out → in → [break ↔ in]* → out)", () => {
  it("allows the happy path", () => {
    expect(applyPunch("out", "check_in")).toBe("in");
    expect(applyPunch("in", "break_start")).toBe("break");
    expect(applyPunch("break", "break_end")).toBe("in");
    expect(applyPunch("in", "check_out")).toBe("out");
  });

  it("allows checking out directly from a break (closes the open break)", () => {
    expect(applyPunch("break", "check_out")).toBe("out");
  });

  it("rejects impossible transitions", () => {
    expect(applyPunch("out", "check_out")).toBeNull();
    expect(applyPunch("out", "break_start")).toBeNull();
    expect(applyPunch("out", "break_end")).toBeNull();
    expect(applyPunch("in", "check_in")).toBeNull();
    expect(applyPunch("in", "break_end")).toBeNull();
    expect(applyPunch("break", "check_in")).toBeNull();
    expect(applyPunch("break", "break_start")).toBeNull();
  });

  it("allowedKinds matches applyPunch for every state", () => {
    for (const state of ["out", "in", "break"] as const) {
      for (const kind of ["check_in", "check_out", "break_start", "break_end"] as const) {
        const allowed = allowedKinds(state).includes(kind);
        const applies = applyPunch(state, kind) !== null;
        expect(allowed).toBe(applies);
      }
    }
  });

  it("deriveState folds a day's events into the current state", () => {
    expect(deriveState([])).toBe("out");
    expect(deriveState([{ kind: "check_in" }])).toBe("in");
    expect(deriveState([{ kind: "check_in" }, { kind: "break_start" }])).toBe("break");
    expect(deriveState([{ kind: "check_in" }, { kind: "break_start" }, { kind: "break_end" }])).toBe("in");
    expect(deriveState([{ kind: "check_in" }, { kind: "check_out" }])).toBe("out");
    // a full day incl. re-check-in
    expect(deriveState([
      { kind: "check_in" }, { kind: "break_start" }, { kind: "break_end" },
      { kind: "check_out" }, { kind: "check_in" },
    ])).toBe("in");
  });

  it("deriveState ignores an illegal event instead of crashing (state stays put)", () => {
    // a check_in while already "in" is illegal -- applyPunch returns null,
    // so deriveState must hold the prior state, not throw or silently jump.
    expect(deriveState([{ kind: "check_in" }, { kind: "check_in" }])).toBe("in");
  });
});
