import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { loadEmployeeImpact, describeImpact } = await import("./employeeImpact");

type Call = { table: string; filters: [string, unknown][]; head: boolean; ascending?: boolean };

/** A client whose count queries answer from `counts` and whose punch-edge queries answer with fixed timestamps. */
export function fakeAdmin(counts: Record<string, number>, opts: { missing?: string[]; fail?: string } = {}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, filters: [], head: false };
    calls.push(call);
    const result = () => {
      if (opts.fail === table) return { count: null, data: null, error: { message: "boom" } };
      if (opts.missing?.includes(table)) return { count: null, data: null, error: { code: "42P01", message: "no such table" } };
      if (call.head) return { count: counts[table] ?? 0, data: null, error: null };
      return { data: [{ ts: call.ascending ? "2026-03-02T05:00:00Z" : "2026-10-22T17:00:00Z" }], error: null };
    };
    const b: Record<string, unknown> = {
      select: (_c: string, o?: { head?: boolean }) => { call.head = !!o?.head; return b; },
      eq: (k: string, v: unknown) => { call.filters.push([k, v]); return b; },
      order: (_c: string, o?: { ascending?: boolean }) => { call.ascending = o?.ascending; return b; },
      limit: () => b,
      then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
    };
    return b;
  };
  return { client: { from } as never, calls };
}

describe("loadEmployeeImpact", () => {
  it("counts every work table and the first and last punch", async () => {
    const { client } = fakeAdmin({
      wfm_presence_events: 42, wfm_leave_records: 3, wfm_correction_requests: 2, wfm_ot_sessions: 1,
    });
    const impact = await loadEmployeeImpact(client, "t1", "e1");
    expect(impact).toMatchObject({
      punches: 42, leave_records: 3, corrections: 2, overtime_sessions: 1, leave_requests: 0, total: 48,
      first_punch: "2026-03-02T05:00:00Z", last_punch: "2026-10-22T17:00:00Z",
    });
  });

  it("an employee with nothing recorded totals zero and skips the punch-edge reads", async () => {
    const { client, calls } = fakeAdmin({});
    const impact = await loadEmployeeImpact(client, "t1", "e1");
    expect(impact.total).toBe(0);
    expect(impact.first_punch).toBeNull();
    expect(calls.every((c) => c.head)).toBe(true);
  });

  it("scopes every query to the tenant and the employee", async () => {
    const { client, calls } = fakeAdmin({ wfm_presence_events: 1 });
    await loadEmployeeImpact(client, "tenant-A", "emp-9");
    expect(calls.length).toBeGreaterThan(9);
    for (const c of calls) {
      expect(c.filters).toContainEqual(["tenant_id", "tenant-A"]);
      expect(c.filters).toContainEqual(["employee_id", "emp-9"]);
    }
  });

  it("reads a table that was never migrated as zero", async () => {
    const { client } = fakeAdmin({ wfm_leave_records: 2 }, { missing: ["wfm_advance_requests", "wfm_clarification_threads"] });
    const impact = await loadEmployeeImpact(client, "t1", "e1");
    expect(impact.total).toBe(2);
  });

  it("fails closed on any other database error", async () => {
    const { client } = fakeAdmin({}, { fail: "wfm_ot_sessions" });
    await expect(loadEmployeeImpact(client, "t1", "e1")).rejects.toThrow(/wfm_ot_sessions/);
  });
});

describe("describeImpact", () => {
  it("lists nonzero lines in plain words with the right plural", () => {
    const lines = describeImpact({
      punches: 1, first_punch: null, last_punch: null, leave_records: 4, leave_requests: 0, corrections: 0,
      overtime_sessions: 2, recheck_requests: 0, advance_requests: 0, clarifications: 0, roster_entries: 0, total: 7,
    });
    expect(lines).toEqual(["1 recorded punch", "4 leave records", "2 overtime sessions"]);
  });
});
