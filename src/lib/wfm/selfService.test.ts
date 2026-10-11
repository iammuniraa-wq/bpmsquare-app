import { describe, it, expect } from "vitest";
import { effectiveSelfService } from "./selfService";

describe("effectiveSelfService", () => {
  it.each([
    [true, null, true],
    [true, true, true],
    [true, false, false],
    [false, null, false],
    [false, true, true],
    [false, false, false],
  ] as const)("workspace %s, override %s -> %s", (workspace, override, expected) => {
    expect(effectiveSelfService(override, workspace)).toBe(expected);
  });

  it("treats a missing column (undefined) as inherit", () => {
    expect(effectiveSelfService(undefined, true)).toBe(true);
    expect(effectiveSelfService(undefined, false)).toBe(false);
  });
});

import { phonePolicy, phoneAllows, hasStandingWfh, normalizeRemoteMode } from "./selfService";
import type { PresenceKind } from "./types";

const ALL_KINDS: PresenceKind[] = [
  "check_in", "check_out", "break_start", "break_end", "ot_in", "ot_out",
  "mobile_work_start", "mobile_work_end", "business_trip_start", "business_trip_end",
];
const allowedOf = (workspace: boolean, override: boolean | null, mode: unknown) =>
  ALL_KINDS.filter((k) => phoneAllows(phonePolicy(override, workspace, mode), k));

// KAN-29 part 2: which kind of remote working a supervisor granted. The cases
// that matter are the ones where a narrow permission could quietly widen, or a
// wide one quietly narrow.
describe("phonePolicy", () => {
  it("kiosk only allows nothing from a phone, whatever mode is stored", () => {
    expect(allowedOf(false, null, null)).toEqual([]);
    expect(allowedOf(true, false, null)).toEqual([]);
    // a stale mode left on a row that was since denied
    expect(allowedOf(true, false, "wfh")).toEqual([]);
  });

  it("work from home offers WFH, breaks and OT -- never a plain check in or out", () => {
    const got = allowedOf(false, true, "wfh");
    expect(got).toEqual(expect.arrayContaining(["mobile_work_start", "mobile_work_end", "break_start", "break_end", "ot_in", "ot_out"]));
    expect(got).not.toContain("check_in");
    expect(got).not.toContain("check_out");
    expect(got).not.toContain("business_trip_start");
  });

  it("site visit offers site punches and not WFH", () => {
    const got = allowedOf(false, true, "site");
    expect(got).toEqual(expect.arrayContaining(["business_trip_start", "business_trip_end", "break_start", "break_end"]));
    expect(got).not.toContain("mobile_work_start");
    expect(got).not.toContain("check_in");
  });

  it("both offers the two remote types together", () => {
    const got = allowedOf(false, true, "both");
    expect(got).toEqual(expect.arrayContaining(["mobile_work_start", "mobile_work_end", "business_trip_start", "business_trip_end"]));
    expect(got).not.toContain("check_in");
    expect(got).not.toContain("check_out");
  });

  it("allowed with NO mode is the 0126 behaviour: every punch", () => {
    expect(allowedOf(false, true, null)).toEqual(ALL_KINDS);
  });

  it("a stored mode does not narrow someone who is only following the workspace", () => {
    // override null -> the mode is a leftover, and must not take check in away
    expect(allowedOf(true, null, "wfh")).toEqual(ALL_KINDS);
  });

  it("a workspace that lets everyone punch is unchanged for people with no override", () => {
    expect(allowedOf(true, null, null)).toEqual(ALL_KINDS);
  });

  it("treats a missing column (undefined) exactly like no mode", () => {
    expect(allowedOf(false, true, undefined)).toEqual(ALL_KINDS);
  });

  it("ignores a value that is not one of the three modes", () => {
    expect(normalizeRemoteMode("everywhere")).toBeNull();
    expect(normalizeRemoteMode("")).toBeNull();
    expect(normalizeRemoteMode(null)).toBeNull();
    expect(allowedOf(false, true, "everywhere")).toEqual(ALL_KINDS);
  });
});

describe("standing work from home", () => {
  it("replaces the per-day request for wfh and both, not for site or nothing", () => {
    expect(hasStandingWfh(phonePolicy(true, false, "wfh"))).toBe(true);
    expect(hasStandingWfh(phonePolicy(true, false, "both"))).toBe(true);
    expect(hasStandingWfh(phonePolicy(true, false, "site"))).toBe(false);
    expect(hasStandingWfh(phonePolicy(true, false, null))).toBe(false);
    // (an allowed person with no mode -- the 0126 behaviour -- is the null case above:
    // they still need the daily request)
    // and a stale mode on someone who is not allowed grants nothing
    expect(hasStandingWfh(phonePolicy(false, false, "wfh"))).toBe(false);
    // following a kiosk-only workspace with a leftover mode: still nothing
    expect(hasStandingWfh(phonePolicy(null, false, "wfh"))).toBe(false);
  });
});

import { blocksLogin, KIOSK_ONLY_LOGIN_MESSAGE } from "./selfService";

// Blocking sign-in is the one change here where a wrong answer locks out the
// workforce, so every branch of who is and is not blocked is pinned.
describe("blocksLogin", () => {
  const kiosk = phonePolicy(null, false, null);                 // workspace kiosk-only, no override
  const kioskByOverride = phonePolicy(false, true, null);       // workspace on, this person pinned to the kiosk
  const phoneEverything = phonePolicy(null, true, null);        // workspace lets everyone punch
  const remote = phonePolicy(true, false, "wfh");               // allowed, work from home
  const legacyAllowed = phonePolicy(true, false, null);         // allowed with no mode (the 0126 behaviour)

  it("blocks a plain WFM-only employee on a kiosk-only workspace", () => {
    expect(blocksLogin({ policy: kiosk, isSupervisor: false, wfmOnly: true })).toBe(true);
  });

  it("blocks someone pinned to the kiosk even when the workspace allows phones", () => {
    expect(blocksLogin({ policy: kioskByOverride, isSupervisor: false, wfmOnly: true })).toBe(true);
  });

  it("never blocks anyone who has phone access, however it was granted", () => {
    for (const policy of [phoneEverything, remote, legacyAllowed]) {
      expect(blocksLogin({ policy, isSupervisor: false, wfmOnly: true })).toBe(false);
    }
    expect(blocksLogin({ policy: phonePolicy(true, false, "site"), isSupervisor: false, wfmOnly: true })).toBe(false);
    expect(blocksLogin({ policy: phonePolicy(true, false, "both"), isSupervisor: false, wfmOnly: true })).toBe(false);
  });

  it("never blocks a supervisor, or nobody could grant anyone access again", () => {
    expect(blocksLogin({ policy: kiosk, isSupervisor: true, wfmOnly: true })).toBe(false);
    expect(blocksLogin({ policy: kioskByOverride, isSupervisor: true, wfmOnly: true })).toBe(false);
  });

  it("fails open for a login that is not WFM-only (it also uses the CRM)", () => {
    expect(blocksLogin({ policy: kiosk, isSupervisor: false, wfmOnly: false })).toBe(false);
  });

  it("carries the exact wording the client asked for", () => {
    expect(KIOSK_ONLY_LOGIN_MESSAGE).toBe(
      "Your attendance is recorded at the office kiosk. Please speak to your supervisor."
    );
  });
});
