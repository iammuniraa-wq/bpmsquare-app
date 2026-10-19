import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeHeaderTolerant } from "@/lib/pricing/quoteLineFlags";
import type { ObjectSpec } from "@/lib/import/types";
import {
  isSupplierColumnMissing,
  parseSupplierInput,
  resolveSupplierName,
  rowsCarrySupplier,
  supplierColumnAvailable,
  supplierPickerOptions,
  withoutSupplierFields,
  withSupplierNames,
} from "./supplier";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

describe("parseSupplierInput", () => {
  it("leaves the supplier alone when the key is absent", () => {
    expect(parseSupplierInput({ name: "x" })).toEqual({ present: false });
  });
  it("treats null and empty string as clear", () => {
    expect(parseSupplierInput({ supplier_id: null })).toEqual({ present: true, id: null });
    expect(parseSupplierInput({ supplier_id: "" })).toEqual({ present: true, id: null });
  });
  it("accepts a uuid and rejects anything else", () => {
    expect(parseSupplierInput({ supplier_id: ID_A })).toEqual({ present: true, id: ID_A });
    expect(parseSupplierInput({ supplier_id: "acme" })).toEqual({ present: true, invalid: true });
    expect(parseSupplierInput({ supplier_id: 5 })).toEqual({ present: true, invalid: true });
    expect(parseSupplierInput({ supplier_id: { id: ID_A } })).toEqual({ present: true, invalid: true });
  });
});

describe("resolveSupplierName", () => {
  const suppliers = [
    { id: ID_A, name: "Acme  Components" },
    { id: ID_B, name: "Bolt Co" },
  ];
  it("matches case- and whitespace-insensitively", () => {
    expect(resolveSupplierName("  acme components ", suppliers)).toEqual({ ok: true, id: ID_A });
    expect(resolveSupplierName("BOLT CO", suppliers)).toEqual({ ok: true, id: ID_B });
  });
  it("reports an unknown name", () => {
    expect(resolveSupplierName("Nobody Ltd", suppliers)).toEqual({ ok: false, reason: "unknown" });
  });
  it("refuses to guess between two suppliers with the same name", () => {
    expect(resolveSupplierName("bolt co", [...suppliers, { id: "x", name: "Bolt Co" }])).toEqual({ ok: false, reason: "ambiguous" });
  });
});

describe("withSupplierNames", () => {
  it("shows the supplier by name instead of the uuid and leaves other entries alone", () => {
    const names = new Map([[ID_A, "Acme"], [ID_B, "Bolt Co"]]);
    const out = withSupplierNames(
      [{ field: "name", from: "a", to: "b" }, { field: "supplier_id", from: ID_A, to: ID_B }, { field: "supplier_id", from: null, to: ID_A }],
      names
    );
    expect(out).toEqual([
      { field: "name", from: "a", to: "b" },
      { field: "Supplier", from: "Acme", to: "Bolt Co" },
      { field: "Supplier", from: null, to: "Acme" },
    ]);
  });
  it("falls back to the id when the name is unknown", () => {
    expect(withSupplierNames([{ field: "supplier_id", from: ID_A, to: null }], new Map())).toEqual([{ field: "Supplier", from: ID_A, to: null }]);
  });
});

describe("missing-column handling", () => {
  it("recognises both shapes of the missing supplier_id column", () => {
    expect(isSupplierColumnMissing({ code: "42703", message: 'column "supplier_id" does not exist' })).toBe(true);
    expect(isSupplierColumnMissing({ code: "PGRST204", message: "Could not find the 'supplier_id' column of 'products' in the schema cache" })).toBe(true);
  });
  it("does not mistake another missing column or another error for it", () => {
    expect(isSupplierColumnMissing({ code: "42703", message: 'column "cost_sheet" does not exist' })).toBe(false);
    expect(isSupplierColumnMissing({ code: "23503", message: "violates foreign key constraint" })).toBe(false);
    expect(isSupplierColumnMissing(null)).toBe(false);
  });
  it("reads a row without the key as 'no support yet', not 'no supplier'", () => {
    expect(rowsCarrySupplier([{ id: "1", name: "p" }])).toBe(false);
    expect(rowsCarrySupplier([{ id: "1", supplier_id: null }])).toBe(true);
    expect(rowsCarrySupplier([])).toBe(false);
  });
  it("a write drops supplier_id and retries when the column is missing", async () => {
    const seen: Record<string, unknown>[] = [];
    const res = await writeHeaderTolerant({ name: "p", supplier_id: ID_A }, async (row) => {
      seen.push(row);
      return "supplier_id" in row
        ? { error: { code: "PGRST204", message: "Could not find the 'supplier_id' column of 'products' in the schema cache" } }
        : { error: null };
    });
    expect(res.error).toBeNull();
    expect(res.strippedColumns).toEqual(["supplier_id"]);
    expect(seen).toEqual([{ name: "p", supplier_id: ID_A }, { name: "p" }]);
  });
});

describe("withoutSupplierFields", () => {
  it("removes the supplier name and id columns and nothing else", () => {
    const spec = {
      id: "products", label: "Products", icon: "", description: "", dependsOn: [], sampleRows: [],
      fields: [
        { key: "supplier_name", label: "Supplier", type: "ref", hint: "" },
        { key: "name", label: "Name", type: "text", hint: "" },
        { key: "supplier_id", label: "Supplier ID", type: "text", hint: "", exportOnly: true },
      ],
    } satisfies ObjectSpec;
    expect(withoutSupplierFields(spec).fields.map((f) => f.key)).toEqual(["name"]);
  });
});

// A just-enough fake of the two query shapes the helpers use.
function fakeClient(opts: { productsError?: { code?: string; message: string } | null; suppliers?: { id: string; name: string; status: string }[] }) {
  return {
    from(table: string) {
      if (table === "products") {
        return { select: () => ({ limit: async () => ({ data: [], error: opts.productsError ?? null }) }) };
      }
      return { select: () => ({ eq: () => ({ order: async () => ({ data: opts.suppliers ?? [], error: null }) }) }) };
    },
  } as unknown as SupabaseClient;
}

describe("supplierColumnAvailable / supplierPickerOptions", () => {
  it("is false while 0132 is pending, and the picker is hidden (null)", async () => {
    const db = fakeClient({ productsError: { code: "42703", message: 'column "supplier_id" does not exist' } });
    expect(await supplierColumnAvailable(db)).toBe(false);
    expect(await supplierPickerOptions(db, "t")).toBeNull();
  });
  it("offers active suppliers, keeping the one already on the product", async () => {
    const db = fakeClient({
      suppliers: [
        { id: "a", name: "A", status: "active" },
        { id: "b", name: "B", status: "inactive" },
        { id: "c", name: "C", status: "inactive" },
      ],
    });
    expect(await supplierPickerOptions(db, "t", "c")).toEqual([{ id: "a", name: "A" }, { id: "c", name: "C" }]);
  });
});
