import { describe, expect, it } from "vitest";
import { inventoryItemForProduct, loadInventoryCandidates, loadProductSkus, type InventoryCandidate } from "./inventoryForProduct";

const T1 = "tenant-1";
const T2 = "tenant-2";
const items: InventoryCandidate[] = [
  { id: "i-1", tenant_id: T1, sku: "BRG-6205" },
  { id: "i-2", tenant_id: T1, sku: "SEAL-10" },
  { id: "i-3", tenant_id: T2, sku: "ONLY-T2" },
  { id: "i-4", tenant_id: T1, sku: null },
];

describe("inventoryItemForProduct", () => {
  it("matches the exact SKU", () => {
    expect(inventoryItemForProduct(T1, { sku: "BRG-6205" }, items)).toBe("i-1");
  });

  it("ignores case and surrounding spaces on both sides", () => {
    expect(inventoryItemForProduct(T1, { sku: "  brg-6205 " }, items)).toBe("i-1");
    expect(inventoryItemForProduct(T1, { sku: "seal-10" }, [{ id: "x", tenant_id: T1, sku: " SEAL-10  " }])).toBe("x");
  });

  it("returns null when nothing matches", () => {
    expect(inventoryItemForProduct(T1, { sku: "NOPE" }, items)).toBeNull();
  });

  it("returns null when the product has no SKU, even though an item has none either", () => {
    expect(inventoryItemForProduct(T1, { sku: null }, items)).toBeNull();
    expect(inventoryItemForProduct(T1, { sku: "   " }, items)).toBeNull();
    expect(inventoryItemForProduct(T1, { sku: undefined }, items)).toBeNull();
  });

  it("returns null when more than one item carries the SKU", () => {
    const dup: InventoryCandidate[] = [...items, { id: "i-9", tenant_id: T1, sku: "brg-6205" }];
    expect(inventoryItemForProduct(T1, { sku: "BRG-6205" }, dup)).toBeNull();
  });

  it("never matches an item of another tenant", () => {
    expect(inventoryItemForProduct(T1, { sku: "ONLY-T2" }, items)).toBeNull();
    expect(inventoryItemForProduct(T2, { sku: "BRG-6205" }, items)).toBeNull();
  });

  it("does not let another tenant's identical SKU make a match ambiguous", () => {
    const shared: InventoryCandidate[] = [...items, { id: "i-8", tenant_id: T2, sku: "BRG-6205" }];
    expect(inventoryItemForProduct(T1, { sku: "BRG-6205" }, shared)).toBe("i-1");
  });

  it("returns null for a product that belongs to another tenant", () => {
    expect(inventoryItemForProduct(T1, { sku: "BRG-6205", tenant_id: T2 }, items)).toBeNull();
    expect(inventoryItemForProduct(T1, { sku: "BRG-6205", tenant_id: T1 }, items)).toBe("i-1");
  });
});

type Filter = { col: string; val: unknown };
function fakeSupabase(rows: Record<string, Record<string, unknown>[]>, failTable?: string) {
  const seen: { table: string; filters: Filter[] }[] = [];
  return {
    seen,
    client: {
      from(table: string) {
        const filters: Filter[] = [];
        let range: [number, number] | null = null;
        const b: Record<string, unknown> = {};
        Object.assign(b, {
          select: () => b,
          eq: (col: string, val: unknown) => { filters.push({ col, val }); return b; },
          in: (col: string, val: unknown) => { filters.push({ col, val }); return b; },
          not: () => b,
          range: (a: number, z: number) => { range = [a, z]; return b; },
          then: (resolve: (r: unknown) => void) => {
            seen.push({ table, filters });
            if (table === failTable) return resolve({ data: null, error: { message: "boom" } });
            let out = rows[table] ?? [];
            for (const f of filters) {
              out = out.filter((r) => (Array.isArray(f.val) ? (f.val as unknown[]).includes(r[f.col]) : r[f.col] === f.val));
            }
            if (range) out = out.slice(range[0], range[1] + 1);
            return resolve({ data: out, error: null });
          },
        });
        return b;
      },
    } as never,
  };
}

describe("loaders", () => {
  it("loadInventoryCandidates asks for this tenant's items only", async () => {
    const { client, seen } = fakeSupabase({ inventory_items: items as never });
    const got = await loadInventoryCandidates(client, T1);
    expect(got.map((i) => i.id).sort()).toEqual(["i-1", "i-2", "i-4"]);
    expect(seen[0].filters).toContainEqual({ col: "tenant_id", val: T1 });
  });

  it("loadProductSkus never returns a product that is not this tenant's", async () => {
    const { client } = fakeSupabase({
      products: [
        { id: "p-1", tenant_id: T1, sku: "BRG-6205" },
        { id: "p-2", tenant_id: T2, sku: "ONLY-T2" },
      ],
    });
    const got = await loadProductSkus(client, T1, ["p-1", "p-2", null, undefined]);
    expect([...got.keys()]).toEqual(["p-1"]);
    expect(got.get("p-1")).toEqual({ sku: "BRG-6205", tenant_id: T1 });
  });

  it("a failed read yields no links instead of an error", async () => {
    const { client } = fakeSupabase({}, "inventory_items");
    expect(await loadInventoryCandidates(client, T1)).toEqual([]);
    const p = fakeSupabase({}, "products");
    expect((await loadProductSkus(p.client, T1, ["p-1"])).size).toBe(0);
  });

  it("loadProductSkus with no product ids does not query", async () => {
    const { client, seen } = fakeSupabase({});
    expect((await loadProductSkus(client, T1, [null])).size).toBe(0);
    expect(seen).toHaveLength(0);
  });
});
