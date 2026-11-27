import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { toBomGroups } from "./bomView";
import type { EstimateLine } from "@/lib/types";

const line = (over: Partial<EstimateLine>): EstimateLine => ({
  id: "l1", tenant_id: "t", estimate_id: "e", sort_order: 0, code: "C1", group_key: "g", description: "Cement", uom: "bag",
  qty: 10, waste_pct: 5, unit_cost: 2, cost_total: 21, component: null, product_id: null, source: "rule", element_ref: null,
  wbs_code: null, custom_data: null, created_at: "", updated_at: "", ...over,
});

describe("Materials tab waste column", () => {
  it("carries each line's waste_pct to the row", () => {
    const groups = toBomGroups([line({}), line({ id: "l2", waste_pct: 0 })], [{ group: "G" }]);
    expect(groups[0].lines.map((l) => l.waste_pct)).toEqual([5, 0]);
  });
  it("draws a Waste % header and cell that collapse into the quantity cell on a phone", () => {
    const tab = readFileSync(path.join(__dirname, "BomTab.tsx"), "utf8");
    const row = readFileSync(path.join(__dirname, "BomRow.tsx"), "utf8");
    expect(tab).toContain("Waste %");
    expect(row).toContain("bom-waste-inline");
    expect(row).toContain('className="bom-waste"');
  });
});
