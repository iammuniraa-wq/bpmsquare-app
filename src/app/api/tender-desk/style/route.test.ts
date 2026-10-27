import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ signedIn: true, flag: true, calls: [] as string[] }));

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => {
    state.calls.push("requireTenantUser");
    if (!state.signedIn) throw Object.assign(new Error("Unauthorized"), { status: 401 });
    return { supabase: {}, tenantId: "t1", userId: "u1", role: "member" };
  },
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, tenantId: string, key: string) => {
    state.calls.push(`feature:${tenantId}:${key}`);
    return state.flag;
  },
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const post = (body: unknown) => POST(new NextRequest(new URL("http://internal.invalid/api/tender-desk/style"), {
  method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body),
}));

beforeEach(() => { state.signedIn = true; state.flag = true; state.calls = []; });

describe("POST /api/tender-desk/style", () => {
  it("checks the session first and answers 401 without one", async () => {
    state.signedIn = false;
    const res = await post({ style: "bold" });
    expect(res.status).toBe(401);
    expect(state.calls).toEqual(["requireTenantUser"]);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a workspace without the tender edition (403) and sets nothing", async () => {
    state.flag = false;
    const res = await post({ style: "bold" });
    expect(res.status).toBe(403);
    expect(state.calls).toEqual(["requireTenantUser", "feature:t1:gcc_tender"]);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("allow-lists the value: only bold and control are accepted", async () => {
    for (const style of ["classic", "Bold", "", "<script>", null, 1, undefined]) {
      const res = await post({ style });
      expect(res.status, String(style)).toBe(400);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect((await post("not json")).status).toBe(400);
    expect((await post("null")).status).toBe(400);
  });

  it.each(["bold", "control"])("remembers %s for a year in a lax, http-only cookie on the whole site", async (style) => {
    const res = await post({ style });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`bpm_tender_desk=${style}`);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/Max-Age=31536000/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("marks the cookie secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const res = await post({ style: "control" });
      expect(res.headers.get("set-cookie") ?? "").toMatch(/Secure/i);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
