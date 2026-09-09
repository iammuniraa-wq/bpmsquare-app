import { describe, it, expect } from "vitest";
import { openBreakMinutes, breakAlertBody } from "./breakAlert";
import type { PresenceKind } from "./types";

const ev = (kind: PresenceKind, ts: string) => ({ kind, ts });
const NOW = new Date("2026-09-10T12:00:00Z");

describe("openBreakMinutes", () => {
  it("is null when the employee never went on break", () => {
    expect(openBreakMinutes([ev("check_in", "2026-09-10T09:00:00Z")], NOW)).toBeNull();
  });

  it("is null when the break was closed", () => {
    expect(
      openBreakMinutes(
        [
          ev("check_in", "2026-09-10T09:00:00Z"),
          ev("break_start", "2026-09-10T11:00:00Z"),
          ev("break_end", "2026-09-10T11:20:00Z"),
        ],
        NOW
      )
    ).toBeNull();
  });

  it("counts from break_start while the break is still open", () => {
    expect(
      openBreakMinutes(
        [ev("check_in", "2026-09-10T09:00:00Z"), ev("break_start", "2026-09-10T11:25:00Z")],
        NOW
      )
    ).toBe(35);
  });

  it("a second break_start while one is open doesn't restart the clock", () => {
    expect(
      openBreakMinutes(
        [
          ev("break_start", "2026-09-10T11:00:00Z"),
          ev("break_start", "2026-09-10T11:40:00Z"),
        ],
        NOW
      )
    ).toBe(60);
  });

  it("measures the LATEST break, not the first, once an earlier one closed", () => {
    expect(
      openBreakMinutes(
        [
          ev("break_start", "2026-09-10T10:00:00Z"),
          ev("break_end", "2026-09-10T10:15:00Z"),
          ev("break_start", "2026-09-10T11:30:00Z"),
        ],
        NOW
      )
    ).toBe(30);
  });

  it("checking out closes an open break — nobody to nudge", () => {
    expect(
      openBreakMinutes(
        [ev("break_start", "2026-09-10T11:00:00Z"), ev("check_out", "2026-09-10T11:30:00Z")],
        NOW
      )
    ).toBeNull();
  });

  it("moving onto OT closes an open break", () => {
    expect(
      openBreakMinutes(
        [ev("break_start", "2026-09-10T11:00:00Z"), ev("ot_in", "2026-09-10T11:30:00Z")],
        NOW
      )
    ).toBeNull();
  });

  it("does not depend on the input already being sorted", () => {
    expect(
      openBreakMinutes(
        [ev("break_start", "2026-09-10T11:30:00Z"), ev("check_in", "2026-09-10T09:00:00Z")],
        NOW
      )
    ).toBe(30);
  });

  it("a work-from-home session end also closes an open break", () => {
    expect(
      openBreakMinutes(
        [ev("break_start", "2026-09-10T11:00:00Z"), ev("mobile_work_end", "2026-09-10T11:10:00Z")],
        NOW
      )
    ).toBeNull();
  });
});

describe("breakAlertBody", () => {
  it("uses the standard sentence when the tenant set no custom message", () => {
    expect(breakAlertBody(35, "")).toBe("You've been on break for 35m. Punch back in when you're ready.");
  });

  it("formats past an hour", () => {
    expect(breakAlertBody(95, "   ")).toBe("You've been on break for 1h 35m. Punch back in when you're ready.");
  });

  it("a tenant's own wording wins", () => {
    expect(breakAlertBody(35, "Chai break over — back to the floor please")).toBe(
      "Chai break over — back to the floor please"
    );
  });
});
