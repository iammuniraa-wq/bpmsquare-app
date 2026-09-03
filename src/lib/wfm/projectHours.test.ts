import { describe, it, expect } from "vitest";
import { rollUpProjectHours, projectHeadcount, UNASSIGNED, type SessionsForEmployee } from "./projectHours";
import { workSessions } from "./hours";
import type { WorkSession } from "./hours";

const session = (over: Partial<WorkSession> = {}): WorkSession => ({
  in: "2026-09-03T09:00:00Z",
  out: "2026-09-03T17:00:00Z",
  gross_minutes: 480,
  break_minutes: 30,
  net_minutes: 450,
  breaks: [],
  project_id: null,
  ...over,
});

describe("rollUpProjectHours", () => {
  it("sums sessions into their own project", () => {
    const input: SessionsForEmployee[] = [
      { employee_id: "e1", sessions: [session({ project_id: "p1" }), session({ project_id: "p1" })] },
    ];
    const [row] = rollUpProjectHours(input, true);
    expect(row.key).toBe("p1");
    expect(row.net_minutes).toBe(900);
    expect(row.sessions).toBe(2);
  });

  it("splits ONE day across two projects when the employee transferred mid-shift", () => {
    const input: SessionsForEmployee[] = [
      {
        employee_id: "e1",
        sessions: [
          session({ project_id: "p1", gross_minutes: 240, break_minutes: 0, net_minutes: 240 }),
          session({ project_id: "p2", gross_minutes: 180, break_minutes: 0, net_minutes: 180 }),
        ],
      },
    ];
    const rows = rollUpProjectHours(input, true);
    expect(rows.map((r) => [r.key, r.net_minutes])).toEqual([["p1", 240], ["p2", 180]]);
  });

  it("buckets an unattributed session as unassigned rather than dropping it", () => {
    const rows = rollUpProjectHours([{ employee_id: "e1", sessions: [session()] }], true);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(UNASSIGNED);
    expect(rows[0].net_minutes).toBe(450);
  });

  it("honours deductBreaks=false by billing gross", () => {
    const input: SessionsForEmployee[] = [{ employee_id: "e1", sessions: [session({ project_id: "p1" })] }];
    expect(rollUpProjectHours(input, false)[0].net_minutes).toBe(480);
    expect(rollUpProjectHours(input, true)[0].net_minutes).toBe(450);
  });

  it("orders biggest first", () => {
    const input: SessionsForEmployee[] = [
      { employee_id: "e1", sessions: [session({ project_id: "small", net_minutes: 60 })] },
      { employee_id: "e2", sessions: [session({ project_id: "big", net_minutes: 600 })] },
    ];
    expect(rollUpProjectHours(input, true).map((r) => r.key)).toEqual(["big", "small"]);
  });

  it("returns nothing for no sessions", () => {
    expect(rollUpProjectHours([], true)).toEqual([]);
  });
});

describe("projectHeadcount", () => {
  it("counts each employee once per project however many sessions they booked", () => {
    const input: SessionsForEmployee[] = [
      { employee_id: "e1", sessions: [session({ project_id: "p1" }), session({ project_id: "p1" })] },
      { employee_id: "e2", sessions: [session({ project_id: "p1" })] },
    ];
    expect(projectHeadcount(input).get("p1")).toBe(2);
  });
});

// The rollup is only correct if sessions actually carry the project of their
// OWN check_in -- this is the seam between the two files, so it's tested
// against real events rather than hand-built sessions.
describe("workSessions carries project attribution", () => {
  it("gives each session the project of the check_in that opened it", () => {
    const events = [
      { kind: "check_in" as const, ts: "2026-09-03T09:00:00Z", project_id: "p1" },
      { kind: "check_out" as const, ts: "2026-09-03T12:00:00Z", project_id: "p1" },
      { kind: "check_in" as const, ts: "2026-09-03T13:00:00Z", project_id: "p2" },
      { kind: "check_out" as const, ts: "2026-09-03T17:00:00Z", project_id: "p2" },
    ];
    const sessions = workSessions(events, new Date("2026-09-03T17:00:00Z"));
    expect(sessions.map((s) => s.project_id)).toEqual(["p1", "p2"]);
    expect(sessions.map((s) => s.gross_minutes)).toEqual([180, 240]);
  });

  it("leaves the project null when events don't carry one", () => {
    const events = [
      { kind: "check_in" as const, ts: "2026-09-03T09:00:00Z" },
      { kind: "check_out" as const, ts: "2026-09-03T17:00:00Z" },
    ];
    expect(workSessions(events, new Date("2026-09-03T17:00:00Z"))[0].project_id).toBeNull();
  });

  // The check_out's own stamp is irrelevant: the session belongs to whatever
  // it was opened against. Otherwise a punch-out corrected later could
  // silently move hours between projects.
  it("ignores a differing project on the closing punch", () => {
    const events = [
      { kind: "check_in" as const, ts: "2026-09-03T09:00:00Z", project_id: "opened-on" },
      { kind: "check_out" as const, ts: "2026-09-03T17:00:00Z", project_id: "something-else" },
    ];
    expect(workSessions(events, new Date("2026-09-03T17:00:00Z"))[0].project_id).toBe("opened-on");
  });
});
