import { describe, it, expect, vi, beforeEach } from "vitest";

let allowed = true;
let featureOn = true;
vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: {}, tenantId: "t-1", userId: "u1", role: "member" }),
  createAdminSupabase: () => ({ admin: true }),
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async () => featureOn, getTenant: async () => ({}) }));
vi.mock("@/lib/permissions", () => ({ resolvePermissions: async () => ({}), canEditWorkcenter: () => allowed }));
const send = vi.fn();
const check = vi.fn();
vi.mock("@/lib/salesOrders/erpSend", () => ({ sendOrderToErp: (...a: unknown[]) => send(...a) }));
vi.mock("@/lib/salesOrders/erpChecksServer", () => ({ runOrderChecks: (...a: unknown[]) => check(...a) }));

import { POST as sendRoute } from "./route";
import { POST as checkRoute } from "../erp-check/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body?: unknown) => new Request("http://acme.example.com/api/sales-orders/so-1/erp-send", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }) as never;

beforeEach(() => { allowed = true; featureOn = true; send.mockReset(); check.mockReset(); });

describe("POST /api/sales-orders/[id]/erp-send", () => {
  it("passes the session's tenant and user, never an id from the body, and answers the ERP number", async () => {
    send.mockResolvedValue({ state: "sent", erpNumber: "ORD-1", link: "https://org/x" });
    const res = await sendRoute(post({ confirm: true, tenant_id: "t-2" }), ctx("so-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, erp_number: "ORD-1" });
    expect(send).toHaveBeenCalledWith({ admin: true }, "t-1", "so-1", { userId: "u1", confirm: true });
  });

  it("only an explicit boolean true confirms", async () => {
    send.mockResolvedValue({ state: "needs_confirmation", items: ["Credit: failed"] });
    const res = await sendRoute(post({ confirm: "yes" }), ctx("so-1"));
    expect(send.mock.calls[0][3]).toMatchObject({ confirm: false });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ needs_confirmation: true, items: ["Credit: failed"] });
  });

  it("a second press is a 409 with the ERP number", async () => {
    send.mockResolvedValue({ state: "already_sent", erpNumber: "ORD-1" });
    const res = await sendRoute(post({}), ctx("so-1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ already_sent: true, erp_number: "ORD-1" });
  });

  it("maps the other outcomes to clear statuses", async () => {
    const cases: [object, number][] = [
      [{ state: "missing" }, 404], [{ state: "pending", bundle: "scripts/run-bundle-28-sales-order-checks-2026-10-24.sql" }, 503], [{ state: "not_ready", message: "x" }, 422],
      [{ state: "no_connector", message: "x" }, 422], [{ state: "in_progress" }, 409], [{ state: "failed", step: "create", headline: "h", fix: "f" }, 502], [{ state: "unreachable", message: "x" }, 502],
    ];
    for (const [r, status] of cases) {
      send.mockResolvedValue(r);
      expect((await sendRoute(post({}), ctx("so-1"))).status, JSON.stringify(r)).toBe(status);
    }
    send.mockResolvedValue({ state: "pending", bundle: "b" });
    expect(await (await sendRoute(post({}), ctx("so-1"))).json()).toMatchObject({ needsDatabaseUpdate: true, bundle: "b" });
    send.mockResolvedValue({ state: "failed", step: "create", headline: "h", fix: "f" });
    expect(await (await sendRoute(post({}), ctx("so-1"))).json()).toMatchObject({ step: "create", error: "h", fix: "f" });
  });

  it("needs the Sales Orders edit permission and the module", async () => {
    allowed = false;
    expect((await sendRoute(post({}), ctx("so-1"))).status).toBe(403);
    expect((await checkRoute(post({}), ctx("so-1"))).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
    allowed = true; featureOn = false;
    expect((await sendRoute(post({}), ctx("so-1"))).status).toBe(403);
  });
});

describe("POST /api/sales-orders/[id]/erp-check", () => {
  it("answers the three results, and maps the failures", async () => {
    check.mockResolvedValue({ kind: "ok", checks: [{ kind: "credit", status: "passed" }] });
    const res = await checkRoute(post(), ctx("so-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, checks: [{ kind: "credit" }] });
    expect(check).toHaveBeenCalledWith({ admin: true }, "t-1", "so-1", { userId: "u1" });
    const cases: [object, number][] = [
      [{ kind: "missing" }, 404], [{ kind: "pending", bundle: "b" }, 503], [{ kind: "not_ready", message: "x" }, 409],
      [{ kind: "no_connector", message: "x" }, 422], [{ kind: "unreachable", message: "x" }, 502], [{ kind: "error", message: "x" }, 500],
    ];
    for (const [r, status] of cases) {
      check.mockResolvedValue(r);
      expect((await checkRoute(post(), ctx("so-1"))).status, JSON.stringify(r)).toBe(status);
    }
  });
});
