// The shapes the Buy-out screens read, written from the API contract in docs/design/contract-buyout.md section 5. Plain types, no I/O.
// Where the contract leaves a field open the type says so (optional) and the screens tolerate its absence.

export const PACKAGE_KINDS = ["supplier", "subcontract"] as const;
export type PackageKind = (typeof PACKAGE_KINDS)[number];
export const KIND_LABEL: Record<PackageKind, string> = { supplier: "Supplier", subcontract: "Subcontract" };

export const PACKAGE_STATUSES = ["draft", "out", "ready", "awarded", "handed_over"] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export type HandoverState = "not_ready" | "ready" | "sent";
export type Handover = { state: HandoverState; sent_at: string | null; sent_by_name?: string | null; erp_ref?: string | null };

/** One row of the package table (GET .../buyout). `against_budget` is positive when the package is under its budget. */
export type PackageRow = {
  id: string;
  ref: string | null;
  name: string;
  kind: PackageKind;
  status: PackageStatus;
  line_count: number;
  budget: number;
  bid_cost: number | null;
  best_quote: number | null;
  committed: number | null;
  against_budget: number | null;
  current_round: number | null;
  rounds: number;
  handover: Handover;
  /** Optional: how many suppliers were asked and answered in the current round, for the "Out, 2 of 3 replied" chip. */
  asked?: number;
  replied?: number;
};

export type BuyoutTiles = { budget: number; committed: number; best_vs_budget: number; needs_decision: number; packages: number };

/** A budget line not yet in any package. */
export type BudgetLineRow = {
  id: string;
  line_no?: number | null;
  wbs?: string | null;
  description: string;
  qty?: number | null;
  unit?: string | null;
  amount?: number | null;
  resource_code?: string | null;
  cost_code?: string | null;
};

export type BuyoutData = {
  group: { id: string; name: string } | null;
  tiles: BuyoutTiles;
  packages: PackageRow[];
  unassigned_lines: BudgetLineRow[];
  /** Optional: the committed amount of each budget line whose package is awarded, keyed by the budget line id or its line key. Read by the Budget tab. */
  committed_by_line?: Record<string, number>;
  /** The database update that adds Buy-out has not been applied. */
  pending?: boolean;
};

export type PackageLine = { item_no: string | null; description: string; qty: number | null; uom: string | null; cost_in_bid: number | null };

export type Quote = {
  supplier_id: string;
  supplier_name: string;
  total: number | null;
  lead_days: number | null;
  valid: boolean;
  lowest_valid: boolean;
  replied_at: string | null;
};

export type Round = {
  rfq_id: string;
  ref: string | null;
  round: number;
  created_at: string | null;
  created_by: string | null;
  status: string | null;
  quotes: Quote[];
};

export type PackageHead = {
  id: string;
  ref: string | null;
  name: string;
  kind: PackageKind;
  status: PackageStatus;
  current_rfq_id: string | null;
  awarded_rfq_id: string | null;
  awarded_supplier_id: string | null;
  awarded_supplier_name?: string | null;
  committed_amount: number | null;
  currency?: string | null;
  award_reason?: string | null;
  awarded_by_name?: string | null;
  awarded_at?: string | null;
  erp_ref?: string | null;
};

export type BudgetBars = { budget: number; best_quote: number | null; committed: number | null };

export type PackageDetail = {
  package: PackageHead;
  lines: PackageLine[];
  rounds: Round[];
  budget_bars?: BudgetBars;
  handover: Handover;
};

export type PickerSupplier = { id: string; name: string; email: string | null; phone?: string | null; type?: string | null; city?: string | null };
export type PickerList = { restricted: boolean; suppliers: PickerSupplier[]; group?: { id?: string; name: string } | null };
