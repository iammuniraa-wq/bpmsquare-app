import type { CompareResponse } from "@/lib/rfq/comparison";
import type { CompareInput, InLine, InSupplier, Reference } from "./compute";

// One RFQ, eight lines, three suppliers, built to carry every case the comparison must handle and small enough to check by hand:
//   - supplier C did not quote line 6 (a partial quote),
//   - supplier C's price on line 7 is 40 percent above our own price,
//   - the only reference for line 4 is a year old (stale), and supplier A is 25 percent above it,
//   - supplier A's price on line 8 is past its validity date.
// Used by the tests only. Names are invented.

export const T0 = "2026-11-26";
export const money = (n: number): string => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const lid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const LINE_ID = lid;
export const RS = { A: "20000000-0000-4000-8000-00000000000a", B: "20000000-0000-4000-8000-00000000000b", C: "20000000-0000-4000-8000-00000000000c" } as const;

export const LINES: InLine[] = [
  { id: lid(1), slNo: 1, description: "HDPE geomembrane 1.5 mm", uom: "m2", qty: 100 },
  { id: lid(2), slNo: 2, description: "Geotextile 300 gsm", uom: "m2", qty: 200 },
  { id: lid(3), slNo: 3, description: "Waterproofing membrane", uom: "m2", qty: 50 },
  { id: lid(4), slNo: 4, description: "Precast pipe 600 mm", uom: "m", qty: 20 },
  { id: lid(5), slNo: 5, description: "Precast pipe 900 mm", uom: "m", qty: 10 },
  { id: lid(6), slNo: 6, description: "Ready mix C40", uom: "m3", qty: 30 },
  { id: lid(7), slNo: 7, description: "Rebar T16", uom: "ton", qty: 5 },
  { id: lid(8), slNo: 8, description: "Rebar T20", uom: "ton", qty: 4 },
];

export const SUPPLIERS: InSupplier[] = [
  { id: RS.A, supplierId: "30000000-0000-4000-8000-00000000000a", name: "Alpha Supply", status: "replied" },
  { id: RS.B, supplierId: "30000000-0000-4000-8000-00000000000b", name: "Beta Trading", status: "replied" },
  { id: RS.C, supplierId: "30000000-0000-4000-8000-00000000000c", name: "Gamma Industrial", status: "replied" },
];

// unit price by line number; null = not quoted
const PRICES: Record<"A" | "B" | "C", (number | null)[]> = {
  A: [10, 5, 20, 100, 200, 50, 3000, 3200],
  B: [12, 4.5, 25, 90, 210, 55, 3100, 3000],
  C: [11, 6, 22, 95, 190, null, 4200, 3300],
};
const LEAD: Record<"A" | "B" | "C", number[]> = { A: [14, 14, 14, 14, 14, 14, 14, 14], B: [21, 21, 21, 21, 21, 21, 21, 28], C: [10, 10, 10, 10, 10, 10, 10, 10] };

export const rid = (who: "A" | "B" | "C", n: number) => `40000000-0000-4000-${{ A: "a", B: "b", C: "c" }[who]}000-${String(n).padStart(12, "0")}`;

export function responses(): CompareResponse[] {
  const out: CompareResponse[] = [];
  (["A", "B", "C"] as const).forEach((who) => {
    PRICES[who].forEach((price, i) => {
      if (price === null) return;
      out.push({
        id: rid(who, i + 1), rfq_supplier_id: RS[who], rfq_line_id: lid(i + 1), status: "quoted", unit_price: price, fx_rate: null, currency: "SAR",
        lead_time_days: LEAD[who][i], moq: null, valid_until: who === "A" && i === 7 ? "2026-11-01" : "2027-01-31", note: null, submitted_at: "2026-11-10T09:00:00Z",
      });
    });
  });
  return out;
}

export const REFERENCES = new Map<string, Reference[]>([
  [lid(4), [{ label: "Product cost price", price: 80, asOf: "2025-12-01" }]],
  [lid(7), [{ label: "RFQ-0009 · Beta Trading", price: 3000, asOf: "2026-10-01" }, { label: "Estimate EST-0003", price: 2000, asOf: "2026-01-01" }]],
]);

export function fixtureInput(over: Partial<CompareInput> = {}): CompareInput {
  return {
    rfq: { id: "50000000-0000-4000-8000-000000000001", ref: "RFQ-0014", title: "Civil package", status: "replied" },
    lines: LINES, suppliers: SUPPLIERS, responses: responses(), today: T0, staleDays: 180, referenceDays: 180, tenantCurrency: "SAR",
    references: REFERENCES, money, ...over,
  };
}
