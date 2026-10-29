import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The picture settings (0235) ride on the template routes like the drawing map: saved with the template, never part of its version,
// validated against its inputs, left out (not failing the save) while the column is missing, and copied by "Copy to customise".

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
import { POST as CREATE } from "./route";
import { POST as DUPLICATE } from "./[id]/duplicate/route";


const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const inputs = [{ key: "length_m", label: "Length", type: "number", default: 10, unit: "m" }, { key: "valves_n", label: "Valves", type: "number", default: 2, unit: "nr" }];
const rates = [{ key: "r", label: "Rate", unit: "per m", value: 5 }];
const rules = [{ code: "pipe", group: "Pipes", description: "Pipe", uom: "m", qty: "length_m + valves_n", component: "materials", cost: { kind: "rate", rate: "r" } }];
const VISUAL = { run: "length_m", count: "valves_n" };
const tpl = (extra: Record<string, unknown> = {}) => ({
  id: ID, tenant_id: "tenant-a", name: "Drain", description: "x", trade: "civil", version: 3, is_active: true,
  geometry: null, inputs, rates, rules, quote_granularity: "line", keywords: [], icon: null, locked: false, customer_visible: false, visual: null, ...extra,
});
const req = (body: unknown) => new NextRequest("http://x/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => { state.writes = []; state.template = tpl(); state.missingColumns = []; });

describe("saving the picture settings", () => {
  it("writes them with the template and does not bump the version", async () => {
    const res = await PATCH(req({ visual: VISUAL }), ctx());
    expect(res.status).toBe(200);
    expect(state.writes[0].payload.visual).toEqual(VISUAL);
    expect("version" in state.writes[0].payload).toBe(false);
    expect((await res.json()).visual_pending).toBeUndefined();
  });

  it("switches the picture off, and clears it with null", async () => {
    await PATCH(req({ visual: { picture: "none" } }), ctx());
    expect(state.writes[0].payload.visual).toEqual({ picture: "none" });
    state.template = tpl({ visual: VISUAL });
    await PATCH(req({ visual: null }), ctx());
    expect(state.writes[1].payload.visual).toBeNull();
  });

  it("refuses a role that points at an input the template does not have, naming it", async () => {
    const res = await PATCH(req({ visual: { run: "nope" } }), ctx());
    expect(res.status).toBe(422);
    expect((await res.json()).issues[0].path).toBe("visual.run");
    expect(state.writes).toEqual([]);
  });

  it("refuses a change to a locked starter", async () => {
    state.template = tpl({ locked: true });
    expect((await PATCH(req({ visual: VISUAL }), ctx())).status).toBe(409);
  });

  it("while the column is missing, the rest of the save goes through and the answer says it was not saved", async () => {
    state.template = (() => { const { visual: _gone, ...rest } = tpl(); return rest; })();
    const res = await PATCH(req({ name: "Renamed", visual: VISUAL }), ctx());
    expect(res.status).toBe(200);
    expect(state.writes[0].payload.name).toBe("Renamed");
    expect("visual" in state.writes[0].payload).toBe(false);
    expect((await res.json()).visual_pending).toBe(true);
  });

  it("an edit to a rule with the settings unchanged bumps the version once", async () => {
    await PATCH(req({ rules: rules.map((r) => ({ ...r, description: "Pipe, changed" })), visual: VISUAL }), ctx());
    expect(state.writes[0].payload.version).toBe(4);
  });
});

describe("creating and copying a template with picture settings", () => {
  it("a new template stores them", async () => {
    const res = await CREATE(req({ name: "New drain", inputs, rates, rules, visual: VISUAL }));
    expect(res.status).toBe(201);
    expect(state.writes[0].payload.visual).toEqual(VISUAL);
  });

  it("is still created, without them, while the column is missing", async () => {
    state.missingColumns = ["visual"];
    const res = await CREATE(req({ name: "New drain", inputs, rates, rules, visual: VISUAL }));
    expect(res.status).toBe(201);
    expect(state.writes).toHaveLength(1);
    expect("visual" in state.writes[0].payload).toBe(false);
  });

  it("copy to customise carries them, and still copies without them while the column is missing", async () => {
    state.template = tpl({ locked: true, visual: VISUAL });
    expect((await DUPLICATE(req({}), ctx())).status).toBe(201);
    expect(state.writes[0].payload.visual).toEqual(VISUAL);
    state.missingColumns = ["visual"];
    expect((await DUPLICATE(req({}), ctx())).status).toBe(201);
    expect("visual" in state.writes[1].payload).toBe(false);
  });
});
