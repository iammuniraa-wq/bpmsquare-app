import type { BudgetLineRow, BuyoutData, PackageDetail, PackageRow, Round } from "./types";

// Sample data for the Buy-out render tests: the shapes of docs/design/contract-buyout.md section 5, with the mock-up's example packages.
// Used by tests only.

export const row = (over: Partial<PackageRow> = {}): PackageRow => ({
  id: "pk1", ref: "PKG-0001", name: "HDPE pipe supply", kind: "supplier", status: "out", line_count: 2, budget: 420000, bid_cost: 400000,
  best_quote: 431000, committed: null, against_budget: -11000, current_round: 2, rounds: 2, handover: { state: "not_ready", sent_at: null }, asked: 3, replied: 2, ...over,
});

export const packages: PackageRow[] = [
  row({ id: "earth", ref: "PKG-0001", name: "Earthworks and backfill", status: "awarded", line_count: 2, budget: 98300, best_quote: 96100, committed: 96100, against_budget: 2200, handover: { state: "sent", sent_at: "2026-10-26T08:00:00Z" } }),
  row({ id: "pipe", ref: "PKG-0002", name: "HDPE pipe supply" }),
  row({ id: "precast", ref: "PKG-0003", name: "Precast manholes and culvert", status: "ready", line_count: 4, budget: 193770, best_quote: 188500, committed: null, against_budget: 5270, asked: 3, replied: 3 }),
  row({ id: "steel", ref: "PKG-0004", name: "Reinforcement and concrete", status: "draft", line_count: 2, budget: 133840, best_quote: null, committed: null, against_budget: null, current_round: null, rounds: 0, asked: undefined, replied: undefined }),
  row({ id: "road", ref: "PKG-0005", name: "Road reinstatement and testing", kind: "subcontract", status: "handed_over", line_count: 2, budget: 78760, best_quote: 71900, committed: 74200, against_budget: 4560, handover: { state: "sent", sent_at: "2026-10-27T08:00:00Z" } }),
];

export const lines: BudgetLineRow[] = [
  { id: "bl1", line_no: 9, wbs: "6.1", description: "Kerb stone", qty: 300, unit: "m", amount: 18000, cost_code: "32 16 13" },
  { id: "bl2", line_no: 10, wbs: "6.2", description: "Paving", qty: 90, unit: "m2", amount: 9000, cost_code: "32 14 00" },
];

export const data = (over: Partial<BuyoutData> = {}): BuyoutData => ({
  group: { id: "g1", name: "Red Sea approved vendors" },
  tiles: { budget: 924670, committed: 170300, best_vs_budget: 1030, needs_decision: 1, packages: 5 },
  packages, unassigned_lines: lines, ...over,
});

export const rounds: Round[] = [
  {
    rfq_id: "rfq12", ref: "RFQ-0012", round: 2, created_at: "2026-10-24T08:00:00Z", created_by: "Sara", status: "partially_replied",
    quotes: [
      { supplier_id: "s1", supplier_name: "SAMPLE Gulf Pipes LLC", total: 431000, lead_days: 28, valid: true, lowest_valid: true, replied_at: "2026-10-25T08:00:00Z" },
      { supplier_id: "s2", supplier_name: "Precast Arabia Pipes", total: 438500, lead_days: 35, valid: true, lowest_valid: false, replied_at: "2026-10-25T09:00:00Z" },
      { supplier_id: "s3", supplier_name: "Waiting Supplier", total: null, lead_days: null, valid: true, lowest_valid: false, replied_at: null },
      { supplier_id: "s4", supplier_name: "Old Quote Co.", total: 429000, lead_days: 20, valid: false, lowest_valid: false, replied_at: "2026-08-01T09:00:00Z" },
    ],
  },
  {
    rfq_id: "rfq9", ref: "RFQ-0009", round: 1, created_at: "2026-10-18T08:00:00Z", created_by: "Sara", status: "replied",
    quotes: [
      { supplier_id: "s1", supplier_name: "SAMPLE Gulf Pipes LLC", total: 452000, lead_days: 30, valid: true, lowest_valid: true, replied_at: "2026-10-19T08:00:00Z" },
      { supplier_id: "s2", supplier_name: "Precast Arabia Pipes", total: 460000, lead_days: 35, valid: true, lowest_valid: false, replied_at: "2026-10-19T09:00:00Z" },
    ],
  },
];

export const detail = (over: Partial<PackageDetail> = {}): PackageDetail => ({
  package: {
    id: "pk1", ref: "PKG-0002", name: "HDPE pipe supply", kind: "supplier", status: "out", current_rfq_id: "rfq12", awarded_rfq_id: null, awarded_supplier_id: null,
    committed_amount: null, currency: "INR",
  },
  lines: [
    { item_no: "2.1", description: "HDPE pipe 600 mm", qty: 420, uom: "m", cost_in_bid: 178500 },
    { item_no: "2.2", description: "HDPE pipe 900 mm", qty: 260, uom: "m", cost_in_bid: 241500 },
  ],
  rounds, budget_bars: { budget: 420000, best_quote: 431000, committed: null }, handover: { state: "not_ready", sent_at: null }, ...over,
});

export const awardedDetail = (): PackageDetail => detail({
  package: {
    id: "pk1", ref: "PKG-0002", name: "HDPE pipe supply", kind: "supplier", status: "awarded", current_rfq_id: "rfq12", awarded_rfq_id: "rfq12", awarded_supplier_id: "s2",
    awarded_supplier_name: "Precast Arabia Pipes", committed_amount: 438500, currency: "INR", award_reason: "Better lead time", awarded_by_name: "Sara", awarded_at: "2026-10-26T08:00:00Z",
  },
  budget_bars: { budget: 420000, best_quote: 431000, committed: 438500 }, handover: { state: "ready", sent_at: null },
});
