import { beforeEach, describe, expect, it, vi } from "vitest";

// Adding a starter's catalogue items to a workspace: only the SKUs it lacks, with the next references, marked illustrative, scoped to
// the tenant, never over an item that exists (edited, repriced or renamed).

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ products: [] as Record<string, unknown>[], calls: [] as { op: string; filters: [string, unknown][] }[], logs: [] as Record<string, unknown>[], seq: 1, missing: false }));

vi.mock("@/lib/changeLog", () => ({ logChangeBatch: vi.fn(async (_s: unknown, rows: Record<string, unknown>[]) => { state.logs.push(...rows); }) }));
vi.mock("@/lib/masterRef", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/masterRef")>();
  return { ...orig, nextMasterRefSeq: vi.fn(async () => state.seq) };
});

import { installStarterCatalogue } from "./starterCatalogueServer";
import { PIPES_FITTINGS_STARTER } from "./starterTemplatesPipes";
import { CONCRETE_WORKS_STARTER } from "./starterTemplatesCivil";
import { PRECAST_ELEMENTS_STARTER } from "./starterTemplatesPrecast";

const client = () => ({
  from: () => {
    const filters: [string, unknown][] = [];
    let op = "select";
    let payload: unknown;
    const q: Record<string, unknown> = {
      select() { return q; },
      insert(p: unknown) { op = "insert"; payload = p; return q; },
      eq(k: string, v: unknown) { filters.push([k, v]); return q; },
      in(k: string, v: unknown[]) { filters.push([k, v]); return q; },
      then(resolve: (v: unknown) => unknown) {
        state.calls.push({ op, filters: [...filters] });
        if (state.missing) return Promise.resolve({ data: null, error: { code: "42P01", message: 'relation "products" does not exist' } }).then(resolve);
        if (op === "insert") {
          const added = (payload as Row[]).map((p, i) => ({ id: `p-${state.products.length + i}`, ...p }));
          state.products.push(...added);
          return Promise.resolve({ data: added, error: null }).then(resolve);
        }
        const hit = (r: Row) => filters.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v));
        return Promise.resolve({ data: state.products.filter(hit), error: null }).then(resolve);
      },
    };
    return q;
  },
}) as never;

const actor = { id: "u1", email: "a@b.c" };
beforeEach(() => { state.products = []; state.calls = []; state.logs = []; state.seq = 1; state.missing = false; });

describe("installing a starter's catalogue", () => {
  it("adds every item marked illustrative, with sequential references, for this tenant only", async () => {
    const items = PIPES_FITTINGS_STARTER.catalogue!;
    const r = await installStarterCatalogue(client(), "tenant-a", actor, items);
    expect(r).toEqual({ added: items.length, kept: 0, skipped: false });
    expect(state.products).toHaveLength(items.length);
    expect(state.products.every((p) => p.tenant_id === "tenant-a")).toBe(true);
    expect(state.products[0]).toMatchObject({ ref: "PRD-0001", status: "active" });
    expect(state.products[1].ref).toBe("PRD-0002");
    for (const p of state.products) {
      expect(p.name).toMatch(/ \(illustrative\)$/);
      expect((p.custom_data as Record<string, unknown>).illustrative).toBe(true);
      expect(p.cost_price).toBeGreaterThan(0);
      expect(p).not.toHaveProperty("cost_price_as_of");
    }
    for (const c of state.calls.filter((x) => x.op === "select")) expect(c.filters).toContainEqual(["tenant_id", "tenant-a"]);
    expect(state.logs).toHaveLength(items.length);
    expect(state.logs[0]).toMatchObject({ tenantId: "tenant-a", objectType: "products", action: "create", actorId: "u1" });
  });

  it("running it again adds nothing, and an item that was changed is kept as it is", async () => {
    const items = CONCRETE_WORKS_STARTER.catalogue!;
    await installStarterCatalogue(client(), "tenant-a", actor, items);
    const rebar = state.products.find((p) => p.sku === "EST-REBAR")!;
    Object.assign(rebar, { name: "Rebar B500", cost_price: 2.9, custom_data: { cost_source: "Quote 9" } });
    const before = JSON.stringify(state.products);
    const r = await installStarterCatalogue(client(), "tenant-a", actor, items);
    expect(r).toEqual({ added: 0, kept: items.length, skipped: false });
    expect(JSON.stringify(state.products)).toBe(before);
  });

  it("an item another workspace has does not count as this workspace's", async () => {
    state.products.push({ id: "other", tenant_id: "tenant-b", sku: "EST-REBAR", name: "Theirs", cost_price: 9 });
    const r = await installStarterCatalogue(client(), "tenant-a", actor, PRECAST_ELEMENTS_STARTER.catalogue!);
    expect(r.added).toBe(PRECAST_ELEMENTS_STARTER.catalogue!.length);
    expect(state.products.find((p) => p.id === "other")).toMatchObject({ name: "Theirs", cost_price: 9 });
    expect(state.products.filter((p) => p.sku === "EST-REBAR")).toHaveLength(2);
  });

  it("a shared item (reinforcement steel) is added once when a second starter needs it", async () => {
    await installStarterCatalogue(client(), "tenant-a", actor, PRECAST_ELEMENTS_STARTER.catalogue!);
    const r = await installStarterCatalogue(client(), "tenant-a", actor, CONCRETE_WORKS_STARTER.catalogue!);
    expect(state.products.filter((p) => p.sku === "EST-REBAR")).toHaveLength(1);
    expect(r.kept).toBe(1);
  });

  it("a database without the products table installs nothing and says so, instead of failing", async () => {
    state.missing = true;
    expect(await installStarterCatalogue(client(), "tenant-a", actor, PIPES_FITTINGS_STARTER.catalogue!)).toEqual({ added: 0, kept: 0, skipped: true });
  });
});
