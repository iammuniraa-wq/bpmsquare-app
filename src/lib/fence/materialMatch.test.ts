import { describe, it, expect } from "vitest";
import { matchMaterials, distinctValues, type FenceCatalogRow, type MaterialRequest } from "./materialMatch";

const catalog: FenceCatalogRow[] = [
  { id: "p1", name: "Line post -- SS40 (PVC coated)", list_price: 71, custom_data: { fence_kind: "line_post", pipe_class: "SS40", coating: "PVC coated" } },
  { id: "p2", name: "Line post -- Schedule 40 (PVC coated)", list_price: 55, custom_data: { fence_kind: "line_post", pipe_class: "Schedule 40", coating: "PVC coated" } },
  { id: "p3", name: "Chain-link 50x50 (PVC coated)", list_price: 36, custom_data: { fence_kind: "fabric", mesh_spec: "Chain-link 50x50 . 2.5mm", coating: "PVC coated" } },
  { id: "p4", name: "Tension wire", list_price: 2.7, custom_data: { fence_kind: "tension_wire", coating: "PVC coated" } },
];

const selections = { pipe_class: "SS40", mesh_spec: "Chain-link 50x50 . 2.5mm", coating: "PVC coated" };

describe("matchMaterials", () => {
  it("matches a post by fence_kind + pipe_class + coating", () => {
    const requests: MaterialRequest[] = [{ fence_kind: "line_post", qty: 10, uom: "pcs" }];
    const [resolved] = matchMaterials(requests, catalog, selections);
    expect(resolved.product_id).toBe("p1");
    expect(resolved.list_price).toBe(71);
  });

  it("matches fabric by mesh_spec, ignoring pipe_class", () => {
    const requests: MaterialRequest[] = [{ fence_kind: "fabric", qty: 980, uom: "m2" }];
    const [resolved] = matchMaterials(requests, catalog, selections);
    expect(resolved.product_id).toBe("p3");
  });

  it("matches hardware by fence_kind + coating alone", () => {
    const requests: MaterialRequest[] = [{ fence_kind: "tension_wire", qty: 1500, uom: "m" }];
    const [resolved] = matchMaterials(requests, catalog, selections);
    expect(resolved.product_id).toBe("p4");
  });

  it("leaves a request unresolved (product_id null) when no catalog row matches the selection", () => {
    const requests: MaterialRequest[] = [{ fence_kind: "line_post", qty: 10, uom: "pcs" }];
    const [resolved] = matchMaterials(requests, catalog, { ...selections, pipe_class: "SS20" });
    expect(resolved.product_id).toBeNull();
    expect(resolved.product_name).toBeNull();
  });

  it("switching pipe_class re-resolves to the other post product, not the same one", () => {
    const requests: MaterialRequest[] = [{ fence_kind: "line_post", qty: 10, uom: "pcs" }];
    const [resolved] = matchMaterials(requests, catalog, { ...selections, pipe_class: "Schedule 40" });
    expect(resolved.product_id).toBe("p2");
  });
});

describe("distinctValues", () => {
  it("returns the distinct pipe_class values among post-kind rows, sorted", () => {
    expect(distinctValues(catalog, ["line_post"], "pipe_class")).toEqual(["SS40", "Schedule 40"]);
  });

  it("returns the distinct mesh_spec values among fabric rows only", () => {
    expect(distinctValues(catalog, ["fabric"], "mesh_spec")).toEqual(["Chain-link 50x50 . 2.5mm"]);
  });

  it("returns [] when no catalog row matches the requested fence_kind", () => {
    expect(distinctValues(catalog, ["corner_post"], "pipe_class")).toEqual([]);
  });
});
