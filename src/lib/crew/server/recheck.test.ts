import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "../types";

// The recheck executor (design 3.5 and 12.2): the supervisor's own door, the scope check the recheck route does not make, the people they left out, and
// the request created by the route's own handler. Everything it touches is mocked: it is the decisions that are tested.

const h = vi.hoisted(() => ({
  ctx: { tenantId: "t1", userId: "u1", role: "member", isSupervisor: true, employee: { id: "self" } } as Record<string, unknown>,
  supervisorError: null as { status: number; message: string } | null,
  scope: { unrestricted: false, employeeIds: ["e1", "e2"], siteIds: ["s1"], selfEmployeeId: "self" } as Record<string, unknown>,
  active: ["e1", "e2", "e3"],
  created: [] as Record<string, unknown>[],
  failFor: new Set<string>(),
}));

vi.mock("@/lib/wfm/server", () => ({ requireWfmSupervisor: async () => { if (h.supervisorError) throw h.supervisorError; return h.ctx; } }));
vi.mock("@/lib/wfm/scope", () => ({ resolveWfmScope: async () => h.scope }));
vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ in: async (_c: string, ids: string[]) => ({ data: ids.filter((i) => h.active.includes(i)).map((id) => ({ id })) }) }) }) }) }),
  }),
}));
vi.mock("@/app/api/wfm/recheck-requests/route", () => ({
  POST: async (req: Request) => {
    const body = (await req.json()) as Record<string, unknown>;
    h.created.push(body);
    return { ok: !h.failFor.has(String(body.employee_id)) };
  },
}));

import { executeRecheck, recheckWordingProblem } from "./recheck";

const proposal = (payload: Record<string, unknown> = {}): Proposal => ({
  id: "p1", finding_id: "f1", run_id: "r1", agent_key: "attendance", action_key: "wfm.recheck", target_type: "site", target_id: "s1",
  payload: { employee_ids: ["e1", "e2", "e3"], target_date: "2026-10-27", message: "draft", ...payload }, edited_payload: null, status: "pending", approver_ids: ["u1"],
  decided_by: null, decided_at: null, decision_note: null, executed_at: null, result: null, fingerprint: "fp", expires_at: "2026-11-11T00:00:00Z", created_at: "2026-11-04T00:00:00Z",
});

beforeEach(() => {
  h.created.length = 0;
  h.failFor.clear();
  h.supervisorError = null;
  h.scope = { unrestricted: false, employeeIds: ["e1", "e2"], siteIds: ["s1"], selfEmployeeId: "self" };
});

describe("executeRecheck", () => {
  it("creates one request per person, for the stored day, with the supervisor's own text", async () => {
    const r = await executeRecheck(proposal(), "Please look at your punches on 27 October.");
    expect(r.ok).toBe(true);
    expect(h.created.map((b) => b.employee_id)).toEqual(["e1", "e2"]);
    expect(h.created.every((b) => b.target_date === "2026-10-27" && b.message === "Please look at your punches on 27 October.")).toBe(true);
  });

  it("skips anyone outside the approver's scope for that day: e3 is never asked, and the result says how many were left", async () => {
    const r = await executeRecheck(proposal(), "Please look.");
    expect(h.created.some((b) => b.employee_id === "e3")).toBe(false);
    expect(r).toEqual({ ok: true, result: { requested: 3, sent: 2, skipped: 1 } });
  });

  it("sends nothing and expires the note when nobody is in scope", async () => {
    h.scope = { unrestricted: false, employeeIds: ["x"], siteIds: [], selfEmployeeId: "self" };
    const r = await executeRecheck(proposal(), "Please look.");
    expect(r).toMatchObject({ ok: false, status: 403, expire: true });
    expect(h.created).toEqual([]);
  });

  it("an admin (unrestricted) reaches the active people, never themselves, never an inactive one", async () => {
    h.scope = { unrestricted: true, employeeIds: null, siteIds: [], selfEmployeeId: "self" };
    h.active = ["e1", "e3"];
    await executeRecheck(proposal({ employee_ids: ["e1", "e2", "e3", "self"] }), "Please look.");
    expect(h.created.map((b) => b.employee_id)).toEqual(["e1", "e3"]);
    h.active = ["e1", "e2", "e3"];
  });

  it("the supervisor may leave people out but never add anyone", async () => {
    await executeRecheck(proposal(), "Please look.", { targets: ["e2", "e-someone-else"] });
    expect(h.created.map((b) => b.employee_id)).toEqual(["e2"]);
    const none = await executeRecheck(proposal(), "Please look.", { targets: ["e-someone-else"] });
    expect(none).toMatchObject({ ok: false, status: 400 });
  });

  it("is refused for someone who is not a supervisor, with the supervisor door's own status", async () => {
    h.supervisorError = { status: 403, message: "Forbidden" };
    expect(await executeRecheck(proposal(), "Please look.")).toEqual({ ok: false, status: 403, error: "Forbidden" });
  });

  it("a note with no date or no people cannot run and expires", async () => {
    expect(await executeRecheck(proposal({ target_date: null }), "x y")).toMatchObject({ ok: false, expire: true });
    expect(await executeRecheck(proposal({ employee_ids: [] }), "x y")).toMatchObject({ ok: false, expire: true });
  });

  it("fails when no request could be created", async () => {
    h.failFor = new Set(["e1", "e2"]);
    expect(await executeRecheck(proposal(), "Please look.")).toMatchObject({ ok: false, status: 502 });
  });
});

describe("the wording of the final text", () => {
  it("passes a plain supervisor message", () => {
    expect(recheckWordingProblem("Your punches on 27 October show a location far from the site. Please check them.")).toBeNull();
  });
  it("refuses any mention of an agent or AI, an alias, or pay and discipline language", () => {
    for (const bad of ["The AI flagged your punches.", "Our assistant noticed a pattern.", "P4, please check your punches.", "This could affect your salary.", "Possible fraud on 27 October."]) {
      expect(recheckWordingProblem(bad), bad).not.toBeNull();
    }
  });
});
