import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Starter templates are read-only; "Copy to customise" (the duplicate route) is the way in.
// The session client is faked and records every write, so we can see what a request would do.

const state = vi.hoisted(() => ({
  template: null as Record<string, unknown> | null,
  writes: [] as { op: string; table: string; payload?: unknown; filters: [string, unknown][] }[],
  tenantId: "tenant-a",
}));

vi.mock("@/lib/changeLog", () => ({ logChange: vi.fn() }));

vi.mock("@/lib/estimator/server", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/estimator/server")>();
  const fake = {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      let op = "select";
      let payload: unknown;
      const q: Record<string, unknown> = {
        insert(p: unknown) { op = "insert"; payload = p; return q; },
        update(p: unknown) { op = "update"; payload = p; return q; },
        select() { return q; },
        eq(k: string, v: unknown) { filters.push([k, v]); return q; },
        single() { state.writes.push({ op, table, payload, filters }); return Promise.resolve({ data: { id: "new-id", ...(payload as object) }, error: null }); },
      };
      return q;
    },
  };
  return {
    ...orig,
    estimatorAccess: vi.fn(async () => ({ supabase: fake, tenantId: state.tenantId, userId: "u1", role: "admin", email: "a@b.c" })),
    loadTemplate: vi.fn(async (_s: unknown, tenantId: string, id: string) => ({
      data: state.template && state.template.id === id && state.template.tenant_id === tenantId ? state.template : null, missing: false,
    })),
    templateUsage: vi.fn(async () => new Map()),
  };
});

import { PATCH } from "./[id]/route";
import { POST as DUPLICATE } from "./[id]/duplicate/route";
import { CHAINLINK_FENCE_STARTER } from "@/lib/estimator/starterTemplates";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const tpl = (extra: Record<string, unknown> = {}) => ({
  id: ID, tenant_id: "tenant-a", name: "Chain-link fence", description: "x", trade: "fencing", version: 1, is_active: true,
  geometry: "chainlink_fence", inputs: CHAINLINK_FENCE_STARTER.inputs, rates: [], rules: CHAINLINK_FENCE_STARTER.rules,
  quote_granularity: "line", keywords: ["fence"], icon: "fence", locked: false, customer_visible: false, ...extra,
});
const req = (body: unknown) => new NextRequest("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => { state.writes = []; state.template = null; state.tenantId = "tenant-a"; });

describe("a locked starter template", () => {
  it("cannot be edited: name, rules and the catalogue fields are refused and nothing is written", async () => {
    state.template = tpl({ locked: true });
    for (const body of [{ name: "Mine" }, { rules: [] }, { description: "new" }, { keywords: ["x"] }, { geometry: null }]) {
      const res = await PATCH(req(body), ctx());
      expect(res.status, JSON.stringify(body)).toBe(409);
      expect((await res.json()).locked).toBe(true);
    }
    expect(state.writes).toEqual([]);
  });

  it("can still be switched off and on", async () => {
    state.template = tpl({ locked: true });
    const res = await PATCH(req({ is_active: false }), ctx());
    expect(res.status).toBe(200);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]).toMatchObject({ op: "update", table: "estimate_templates" });
    expect(state.writes[0].filters).toContainEqual(["tenant_id", "tenant-a"]);
    expect(state.writes[0].filters).toContainEqual(["id", ID]);
  });
});

describe("a template of the workspace's own", () => {
  it("saves its description, keywords, icon and customer visibility without bumping the version", async () => {
    state.template = tpl();
    const res = await PATCH(req({ description: "New line.", keywords: [" Fence ", "GATE"], icon: "fence", customer_visible: true }), ctx());
    expect(res.status).toBe(200);
    const w = state.writes[0].payload as Record<string, unknown>;
    expect(w).toMatchObject({ description: "New line.", keywords: ["fence", "gate"], icon: "fence", customer_visible: true });
    expect("version" in w).toBe(false);
  });

  it("does not let a request set `locked`", async () => {
    state.template = tpl();
    await PATCH(req({ locked: true, description: "d" }), ctx());
    expect("locked" in (state.writes[0].payload as object)).toBe(false);
  });
});

describe("tenant isolation", () => {
  it("another workspace's template id is a 404 and writes nothing", async () => {
    state.template = tpl({ tenant_id: "tenant-b" });
    expect((await PATCH(req({ description: "x" }), ctx())).status).toBe(404);
    expect((await DUPLICATE(req({}), ctx())).status).toBe(404);
    expect(state.writes).toEqual([]);
  });
});

describe("Copy to customise", () => {
  it("makes an editable copy: not locked, not customer-visible, named (custom), same rules and words", async () => {
    state.template = tpl({ locked: true, customer_visible: true });
    const res = await DUPLICATE(req({}), ctx());
    expect(res.status).toBe(201);
    const row = state.writes[0].payload as Record<string, unknown>;
    expect(state.writes[0]).toMatchObject({ op: "insert", table: "estimate_templates" });
    expect(row.tenant_id).toBe("tenant-a");
    expect(row.name).toBe("Chain-link fence (custom)");
    expect("locked" in row).toBe(false);
    expect("customer_visible" in row).toBe(false);
    expect(row.keywords).toEqual(["fence"]);
    expect(row.icon).toBe("fence");
    expect(row.geometry).toBe("chainlink_fence");
    expect((row.rules as unknown[]).length).toBe(CHAINLINK_FENCE_STARTER.rules.length);
    expect(row.version).toBe(1);
  });

  it("an ordinary template copies as (copy)", async () => {
    state.template = tpl();
    await DUPLICATE(req({}), ctx());
    expect((state.writes[0].payload as { name: string }).name).toBe("Chain-link fence (copy)");
  });
});
