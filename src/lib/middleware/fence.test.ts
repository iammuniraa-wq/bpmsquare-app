import { describe, it, expect } from "vitest";
import { shapeForErp, fenceSummaryText, type FenceInfo, type OutLine } from "./fence";
import { parseRules } from "./rules";

const fence: FenceInfo = {
  name: "North boundary", layout: "closed_perimeter", total_length_m: 500, fabric_height_m: 2.4, mesh_spec: "50x50", coating: "galvanised",
  security_profile: "High", gates: [{ gate_type: "single_swing", width_m: 1.2 }, { gate_type: "sliding", width_m: 6 }, { gate_type: "single_swing", width_m: 1.2 }],
  drawing_url: "https://acme.example.com/fence-projects/f-1",
};
const lines: OutLine[] = [
  { sl_no: "1", description: "Post", uom: "pcs", qty: 100, rate: 5, discount_pct: 0, amount: 500 },
  { sl_no: "2", description: "Fabric", uom: "m", qty: 500, rate: 2, discount_pct: 0, amount: 1000 },
];
const sel = (over: Record<string, boolean> = {}) => ({ ...parseRules({}).fence, ...over });
const args = (over = {}) => ({ lines, base: ["Total in BPMSquare: 1725.00"], fence, selection: sel(), notes: "Phase 1 first", terms: "Net 30", subtotal: 1500, ...over });

describe("fence selection", () => {
  it("default: summary in the description and the quantity lines", () => {
    const r = shapeForErp(args());
    expect(r.fence).toBe(true);
    expect(r.lines).toEqual(lines);
    expect(r.description.join("\n")).toContain("North boundary: Closed perimeter, 500 m");
    expect(r.description.join("\n")).not.toMatch(/Security profile|Drawing|Notes|Terms/);
  });

  it("describes gates by type", () => {
    expect(fenceSummaryText(fence)).toContain("2 single swing gates + 1 sliding gate");
  });

  it("each ticked part appears", () => {
    const text = shapeForErp(args({ selection: sel({ security_profile: true, drawing_link: true, notes_terms: true }) })).description.join("\n");
    expect(text).toContain("Security profile: High");
    expect(text).toContain("Drawing: https://acme.example.com/fence-projects/f-1");
    expect(text).toContain("Notes: Phase 1 first");
    expect(text).toContain("Terms: Net 30");
  });

  it("without quantity lines, one lump line carries the same money", () => {
    const r = shapeForErp(args({ selection: sel({ quantity_lines: false }) }));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].amount).toBe(1500);
    expect(r.lines[0].qty * r.lines[0].rate).toBe(1500);
  });

  it("a quote that did not come from a fence project is untouched", () => {
    const r = shapeForErp(args({ fence: null, selection: sel({ summary: false, quantity_lines: false }) }));
    expect(r).toEqual({ lines, description: ["Total in BPMSquare: 1725.00"], fence: false });
  });
});
