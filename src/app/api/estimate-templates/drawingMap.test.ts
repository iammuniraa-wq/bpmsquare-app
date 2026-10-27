import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The drawing layer map (0215) rides on the template routes: saved with the template, never part of its version, left out
// (not failing the save) while the column is missing, and copied by "Copy to customise".

const state = vi.hoisted(() => ({
  template: null as Record<string, unknown> | null,
  writes: [] as { op: string; payload: Record<string, unknown> }[],
  /** Column names the fake database "does not have" yet: an insert or update naming one fails with 42703. */
  missingColumns: [] as string[],
}));

vi.mock("@/lib/changeLog", () => ({ logChange: vi.fn() }));

vi.mock("@/lib/estimator/server", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/estimator/server")>();
  const fake = {
    from: () => {
      let op = "select";
      let payload: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        insert(p: Record<string, unknown>) { op = "insert"; payload = p; return q; },
        update(p: Record<string, unknown>) { op = "update"; payload = p; return q; },
        select() { return q; },
        eq() { return q; },
        single() {
          const bad = state.missingColumns.find((c) => c in payload);
          if (bad) return Promise.resolve({ data: null, error: { code: "42703", message: `column "${bad}" does not exist` } });
          state.writes.push({ op, payload });
          return Promise.resolve({ data: { id: "new-id", ...payload }, error: null });
        },
      };
      return q;
    },
  };
  return {
    ...orig,
    estimatorAccess: vi.fn(async () => ({ supabase: fake, tenantId: "tenant-a", userId: "u1", role: "admin", email: "a@b.c" })),
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
const MAP = [{ input: "total_length_m", measure: "length_m", layers: ["FENCE"] }];
const tpl = (extra: Record<string, unknown> = {}) => ({
  id: ID, tenant_id: "tenant-a", name: "My fence", description: "x", trade: "fencing", version: 3, is_active: true,
  geometry: "chainlink_fence", inputs: CHAINLINK_FENCE_STARTER.inputs, rates: [], rules: CHAINLINK_FENCE_STARTER.rules,
  quote_granularity: "line", keywords: ["fence"], icon: "fence", locked: false, customer_visible: false, drawing_map: null, ...extra,
});
const req = (body: unknown) => new NextRequest("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => { state.writes = []; state.template = tpl(); state.missingColumns = []; });

describe("saving the layer map", () => {
  it("writes it with the template and does not bump the version", async () => {
    const res = await PATCH(req({ drawing_map: MAP }), ctx());
    expect(res.status).toBe(200);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].payload.drawing_map).toEqual(MAP);
    expect("version" in state.writes[0].payload).toBe(false);
    expect((await res.json()).drawing_map_pending).toBeUndefined();
  });

  it("an edit to the map alongside unchanged inputs and rules still leaves the version alone, a rule edit bumps it", async () => {
    await PATCH(req({ inputs: CHAINLINK_FENCE_STARTER.inputs, rules: CHAINLINK_FENCE_STARTER.rules, drawing_map: MAP }), ctx());
    expect("version" in state.writes[0].payload).toBe(false);
    const rules = CHAINLINK_FENCE_STARTER.rules.map((r, i) => (i === 0 ? { ...r, description: "Line posts (changed)" } : r));
    await PATCH(req({ rules, drawing_map: MAP }), ctx());
    expect(state.writes[1].payload.version).toBe(4);
  });

  it("clearing every row stores null", async () => {
    state.template = tpl({ drawing_map: MAP });
    await PATCH(req({ drawing_map: [] }), ctx());
    expect(state.writes[0].payload.drawing_map).toBeNull();
  });

  it("refuses a map that points at an input the template does not have, naming the row", async () => {
    const res = await PATCH(req({ drawing_map: [{ input: "nope", measure: "length_m", layers: ["A"] }] }), ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).issues[0].path).toBe("drawing_map[0].input");
    expect(state.writes).toEqual([]);
  });

  it("refuses a change to a locked starter's map", async () => {
    state.template = tpl({ locked: true });
    expect((await PATCH(req({ drawing_map: MAP }), ctx())).status).toBe(409);
    expect(state.writes).toEqual([]);
  });

  it("while the column is missing, the rest of the save goes through and the answer says the map was not saved", async () => {
    state.template = (() => { const { drawing_map: _gone, ...rest } = tpl(); return rest; })();
    const res = await PATCH(req({ name: "Renamed", drawing_map: MAP }), ctx());
    expect(res.status).toBe(200);
    expect(state.writes[0].payload.name).toBe("Renamed");
    expect("drawing_map" in state.writes[0].payload).toBe(false);
    expect((await res.json()).drawing_map_pending).toBe(true);
  });
});

describe("copy to customise", () => {
  it("carries the map onto the editable copy", async () => {
    state.template = tpl({ locked: true, drawing_map: MAP });
    const res = await DUPLICATE(req({}), ctx());
    expect(res.status).toBe(201);
    expect(state.writes[0]).toMatchObject({ op: "insert" });
    expect(state.writes[0].payload.drawing_map).toEqual(MAP);
    expect(state.writes[0].payload.locked).toBeUndefined();
  });

  it("still makes the copy, without the map, while the column is missing", async () => {
    state.template = tpl({ locked: true, drawing_map: MAP });
    state.missingColumns = ["drawing_map"];
    const res = await DUPLICATE(req({}), ctx());
    expect(res.status).toBe(201);
    expect(state.writes).toHaveLength(1);
    expect("drawing_map" in state.writes[0].payload).toBe(false);
    expect(state.writes[0].payload.keywords).toEqual(["fence"]);
  });

  it("falls back all the way when neither the catalogue columns nor the map exist", async () => {
    state.template = tpl({ locked: true, drawing_map: MAP });
    state.missingColumns = ["drawing_map", "keywords", "icon"];
    const res = await DUPLICATE(req({}), ctx());
    expect(res.status).toBe(201);
    expect(Object.keys(state.writes[0].payload)).not.toContain("drawing_map");
    expect(Object.keys(state.writes[0].payload)).not.toContain("keywords");
  });
});
