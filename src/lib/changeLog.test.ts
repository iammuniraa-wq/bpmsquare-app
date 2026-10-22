import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const adminRows: Record<string, unknown>[] = [];
const sessionRows: Record<string, unknown>[] = [];
const insertTo = (sink: Record<string, unknown>[]) => (rows: unknown) => {
  sink.push(...(Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[]);
  return Promise.resolve({ error: null });
};
const client = (sink: Record<string, unknown>[]) => ({ from: () => ({ insert: insertTo(sink) }) });

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => client(adminRows) }));

import { logChange, logChangeBatch } from "./changeLog";
import { runVia } from "./actions/via";

beforeEach(() => { adminRows.length = 0; sessionRows.length = 0; });

describe("change_log is written by the server only (audit 2026-10-22 M1)", () => {
  it("logChange writes through the service-role client, never the session client handed in", async () => {
    await logChange(client(sessionRows) as never, { tenantId: "t1", objectType: "accounts", objectId: "a1", action: "create", actorId: "u1", actorEmail: "u@x.test" });
    expect(sessionRows).toHaveLength(0);
    expect(adminRows).toEqual([expect.objectContaining({ tenant_id: "t1", object_type: "accounts", actor_id: "u1" })]);
  });

  it("logChangeBatch does the same", async () => {
    await logChangeBatch(client(sessionRows) as never, [{ tenantId: "t1", objectType: "contacts", objectId: "c1", action: "create", actorId: "u1" }]);
    expect(sessionRows).toHaveLength(0);
    expect(adminRows).toHaveLength(1);
  });

  it("the assistant mark comes only from the server-side context", async () => {
    await logChange(client(sessionRows) as never, { tenantId: "t1", objectType: "accounts", objectId: "a1", action: "create" });
    await runVia("assistant", () => logChange(client(sessionRows) as never, { tenantId: "t1", objectType: "accounts", objectId: "a2", action: "create" }));
    expect(adminRows[0].via).toBeUndefined();
    expect(adminRows[1].via).toBe("assistant");
  });
});
