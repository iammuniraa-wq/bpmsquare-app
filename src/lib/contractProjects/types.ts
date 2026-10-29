// Contract projects (docs/design/gcc-tender-deals.md section 15, slice 5a). Plain types and constants, no I/O and no server imports,
// so the routes, the screens and the tests read the same words. Tables: migration 0226.

export const PROJECT_STATUSES = ["draft", "baseline_pending", "active", "closed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Draft", baseline_pending: "Baseline waiting", active: "Active", closed: "Closed",
};

export const REVISION_STATUSES = ["draft", "pending", "approved", "superseded"] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];
export const REVISION_STATUS_LABEL: Record<RevisionStatus, string> = {
  draft: "Draft", pending: "Waiting for approval", approved: "Approved", superseded: "Superseded",
};

export const MASTER_KINDS = ["resource", "cost_code", "justification", "reserve_type", "division", "job_location"] as const;
export type MasterKind = (typeof MASTER_KINDS)[number];
export const MASTER_KIND_LABEL: Record<MasterKind, string> = {
  resource: "Resource levels", cost_code: "Cost codes", justification: "Justification reasons",
  reserve_type: "Reserve types", division: "Divisions", job_location: "Job locations",
};
export const isMasterKind = (v: unknown): v is MasterKind => typeof v === "string" && (MASTER_KINDS as readonly string[]).includes(v);

export const MASTER_SOURCES = ["manual", "file", "epromis", "default"] as const;
export type MasterSource = (typeof MASTER_SOURCES)[number];

/** `link_to_inventory` and `budget_validation` are read from ePROMIS later; `revenue_side` marks a level that is income, not a cost type. */
export type MasterFlags = { link_to_inventory?: boolean; budget_validation?: boolean; revenue_side?: boolean };

export type MasterRow = {
  id: string;
  kind: MasterKind;
  code: string;
  name: string;
  parent_code: string | null;
  flags: MasterFlags;
  source: MasterSource;
  active: boolean;
};

/** The ePROMIS resource levels the owner showed (design section 9). 91 and 92 are the income side of a project, not cost types. */
export const RESOURCE_SEEDS: readonly { code: string; name: string; flags: MasterFlags }[] = [
  { code: "11", name: "Material", flags: {} },
  { code: "21", name: "Asset", flags: {} },
  { code: "31", name: "Man Power", flags: {} },
  { code: "32", name: "Hiring Man Power", flags: {} },
  { code: "41", name: "Sub Contractor", flags: {} },
  { code: "51", name: "Other Direct Cost", flags: {} },
  { code: "91", name: "Revenue", flags: { revenue_side: true } },
  { code: "92", name: "On Account - Other Billed", flags: { revenue_side: true } },
];

/**
 * The CSI MasterFormat divisions (the level a cost code hangs under) and the same division numbers as material sub-groups under
 * resource 11 (code "11" + division number, as in ePROMIS: 1105 Metals). Starter lists: the owner did not have the client's own, so a
 * workspace begins with these and replaces or extends them by file import (matched on kind + code) or the later ePROMIS refresh.
 */
export const MASTERFORMAT_DIVISIONS: readonly { code: string; name: string }[] = [
  { code: "00", name: "Procurement and Contracting Requirements" },
  { code: "01", name: "General Requirements" },
  { code: "02", name: "Existing Conditions" },
  { code: "03", name: "Concrete" },
  { code: "04", name: "Masonry" },
  { code: "05", name: "Metals" },
  { code: "06", name: "Wood, Plastics and Composites" },
  { code: "07", name: "Thermal and Moisture Protection" },
  { code: "08", name: "Openings" },
  { code: "09", name: "Finishes" },
  { code: "10", name: "Specialties" },
  { code: "11", name: "Equipment" },
  { code: "12", name: "Furnishings" },
  { code: "13", name: "Special Construction" },
  { code: "14", name: "Conveying Equipment" },
  { code: "21", name: "Fire Suppression" },
  { code: "22", name: "Plumbing" },
  { code: "23", name: "Heating, Ventilating and Air Conditioning" },
  { code: "25", name: "Integrated Automation" },
  { code: "26", name: "Electrical" },
  { code: "27", name: "Communications" },
  { code: "28", name: "Electronic Safety and Security" },
  { code: "31", name: "Earthwork" },
  { code: "32", name: "Exterior Improvements" },
  { code: "33", name: "Utilities" },
  { code: "34", name: "Transportation" },
  { code: "35", name: "Waterway and Marine" },
  { code: "40", name: "Process Integration" },
  { code: "41", name: "Material Processing and Handling Equipment" },
  { code: "42", name: "Process Heating, Cooling and Drying Equipment" },
  { code: "43", name: "Process Gas and Liquid Handling" },
  { code: "44", name: "Pollution and Waste Control Equipment" },
  { code: "45", name: "Industry-Specific Manufacturing Equipment" },
  { code: "46", name: "Water and Wastewater Equipment" },
  { code: "48", name: "Electrical Power Generation" },
];

/** A few sections the demo BOQ uses, under their division. */
export const MASTERFORMAT_SECTIONS: readonly { code: string; name: string; parent: string }[] = [
  { code: "01 50 00", name: "Temporary Facilities and Controls", parent: "01" },
  { code: "01 71 23", name: "Field Engineering", parent: "01" },
  { code: "03 30 00", name: "Cast-in-Place Concrete", parent: "03" },
  { code: "31 23 16", name: "Excavation", parent: "31" },
  { code: "32 31 13", name: "Chain Link Fences and Gates", parent: "32" },
];

/** Material sub-groups under resource 11, one per division: "11" + the division number (1103 Concrete, 1105 Metals ...). */
export const MATERIAL_GROUP_SEEDS: readonly { code: string; name: string; parent: string }[] = MASTERFORMAT_DIVISIONS
  .filter((d) => d.code !== "00" && d.code !== "01" && d.code !== "11")
  .map((d) => ({ code: `11${d.code}`, name: d.name, parent: "11" }));

export const JUSTIFICATION_SEEDS: readonly { code: string; name: string }[] = [
  { code: "client_variation", name: "Client variation" },
  { code: "scope_change", name: "Scope change" },
  { code: "price_change", name: "Price change" },
  { code: "error_correction", name: "Error correction" },
  { code: "other", name: "Other" },
];
/** A revision made for this reason must say more in its note. */
export const JUSTIFICATION_NEEDS_NOTE = "other";

/** What a tender line becomes: the default resource is Material. */
export const DEFAULT_RESOURCE_CODE = "11";
export const DEFAULT_MARGIN_PCT = 15;

export type ProjectRow = {
  id: string;
  tenant_id: string;
  ref: string | null;
  name: string;
  account_id: string | null;
  source_opportunity_id: string | null;
  status: ProjectStatus;
  contract_value: number;
  currency: string | null;
  planned_start: string | null;
  planned_end: string | null;
  manager_id: string | null;
  erp_system: string | null;
  erp_id: string | null;
  custom_data: Record<string, unknown> | null;
  /** 0240: when the budget file was last downloaded for the ERP (the "Handed over" step). Null until then, and while that migration is pending. */
  handover_sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RevisionRow = {
  id: string;
  project_id: string;
  rev_no: number;
  status: RevisionStatus;
  justification_code: string | null;
  justification_text: string | null;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  locked_at: string | null;
  total: number;
};

/** One budget line as the screens and routes carry it. `committed` and `actual` are read-only here (slice 5b fills them). */
export type BudgetLine = {
  id: string;
  line_key: string;
  line_no: number;
  resource_code: string | null;
  cost_code: string | null;
  wbs: string | null;
  description: string;
  qty: number;
  unit: string | null;
  unit_cost: number;
  amount: number;
  cost_known: boolean;
  source_ref: string | null;
  reserve: boolean;
  committed: number | null;
  actual: number | null;
};

/** A line a person or the tender copy is about to save: no id, no committed / actual. */
export type DraftLine = {
  line_key?: string | null;
  resource_code: string | null;
  cost_code: string | null;
  wbs: string | null;
  description: string;
  qty: number;
  unit: string | null;
  unit_cost: number;
  cost_known: boolean;
  source_ref: string | null;
  reserve: boolean;
};

export const LINE_LIMITS = { maxLines: 5000, maxQty: 999_999_999, maxUnitCost: 999_999_999, maxAmount: 999_999_999_999 } as const;
