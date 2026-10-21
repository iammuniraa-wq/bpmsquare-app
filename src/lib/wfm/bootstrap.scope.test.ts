import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => ({}) }));

const { wfmLeaveRecordsPayload, wfmLeaveRequestsPayload } = await import("./bootstrap");

type Call = { method: string; args: unknown[] };

/** Records the filter chain a payload builder applies, resolving to no rows. */
function recordingClient() {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (v: { data: never[]; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };
  for (const method of ["select", "eq", "in", "order"]) {
    builder[method] = (...args: unknown[]) => { calls.push({ method, args }); return builder; };
  }
  return { client: { from: () => builder } as never, calls };
}

const scoped = { unrestricted: false, employeeIds: ["e1", "e2"], siteIds: [], selfEmployeeId: "me" };
const open = { unrestricted: true, employeeIds: null, siteIds: [], selfEmployeeId: null };

describe("leave payloads honour the caller's scope", () => {
  it("records: restricts to the scope's employees and keeps the tenant filter", async () => {
    const { client, calls } = recordingClient();
    await wfmLeaveRecordsPayload(client, "t1", null, scoped);
    expect(calls).toContainEqual({ method: "eq", args: ["tenant_id", "t1"] });
    expect(calls).toContainEqual({ method: "in", args: ["employee_id", ["e1", "e2"]] });
  });

  it("requests: restricts to the scope's employees and keeps the tenant filter", async () => {
    const { client, calls } = recordingClient();
    await wfmLeaveRequestsPayload(client, "t1", { status: "pending", scope: scoped });
    expect(calls).toContainEqual({ method: "eq", args: ["tenant_id", "t1"] });
    expect(calls).toContainEqual({ method: "in", args: ["employee_id", ["e1", "e2"]] });
  });

  it("an empty reach filters to nothing rather than to everyone", async () => {
    const { client, calls } = recordingClient();
    await wfmLeaveRecordsPayload(client, "t1", null, { ...scoped, employeeIds: [] });
    expect(calls).toContainEqual({ method: "in", args: ["employee_id", []] });
  });

  it("an unrestricted scope adds no employee filter", async () => {
    const { client, calls } = recordingClient();
    await wfmLeaveRecordsPayload(client, "t1", null, open);
    await wfmLeaveRequestsPayload(client, "t1", { scope: open });
    expect(calls.some((c) => c.method === "in")).toBe(false);
  });
});
