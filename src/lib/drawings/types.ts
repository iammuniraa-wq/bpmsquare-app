// The Drawing register's shapes (migrations 0255-0257, docs/design/pcbs-drawing-register.md). Pure: no server import, so a client
// screen can use them. Generic: nothing here names a client; what differs per workspace is a drawing TYPE, which is data.

export const REVISION_STATUSES = ["draft", "in_review", "released", "superseded"] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const STATUS_LABEL: Record<RevisionStatus, string> = {
  draft: "Draft", in_review: "In review", released: "Released", superseded: "Superseded",
};

export const REV_SCHEMES = ["letters", "numbers"] as const;
export type RevScheme = (typeof REV_SCHEMES)[number];

export const REVISION_SOURCES = ["upload", "email", "ifc", "schedule", "acc", "import"] as const;
export type RevisionSource = (typeof REVISION_SOURCES)[number];

/** What a drawing type can feed (the downstream readers of released elements). */
export const FEEDS = ["estimate", "boq", "handover"] as const;
export type Feed = (typeof FEEDS)[number];
export const FEED_LABEL: Record<Feed, string> = { estimate: "Estimate", boq: "Bill of quantities", handover: "Handover" };

/** The header fields a type can make mandatory before a revision is submitted. */
export const REQUIRED_FIELD_KEYS = ["external_no", "opportunity_id", "project_id", "wbs_item_id", "notes"] as const;
export type RequiredFieldKey = (typeof REQUIRED_FIELD_KEYS)[number];
export const REQUIRED_FIELD_LABEL: Record<RequiredFieldKey, string> = {
  external_no: "External number", opportunity_id: "Tender", project_id: "Project", wbs_item_id: "Building", notes: "Revision note",
};

export type DrawingTypeRow = {
  id: string;
  tenant_id: string;
  name: string;
  numbering_pattern: string | null;
  rev_scheme: RevScheme;
  approver_ids: string[];
  second_person: boolean;
  required_fields: string[];
  feeds: string[];
  schedule_map: Record<string, unknown> | null;
  active: boolean;
  sort_order: number;
};

export type DrawingRow = {
  id: string;
  tenant_id: string;
  ref: string | null;
  drawing_no: string;
  external_no: string | null;
  title: string;
  type_id: string | null;
  opportunity_id: string | null;
  project_id: string | null;
  wbs_item_id: string | null;
  current_rev_id: string | null;
  custom_data: Record<string, unknown> | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ChangeSummary = {
  added?: number; removed?: number; changed?: number; unchanged?: number;
  /** Where the elements of this revision were read from (kept on the revision; the file itself is never kept for a schedule). */
  elements?: { source: string; file_name: string; sha256: string; rows: number; loaded_at: string };
};

export type RevisionRow = {
  id: string;
  tenant_id: string;
  drawing_id: string;
  rev_no: number;
  rev_label: string;
  status: RevisionStatus;
  file_path: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  file_sha256: string | null;
  source: RevisionSource;
  source_ref: string | null;
  notes: string | null;
  return_reason: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  released_by: string | null;
  released_at: string | null;
  effective_from: string | null;
  supersedes_rev_id: string | null;
  change_summary: ChangeSummary | null;
  created_by: string | null;
  created_at: string;
};

export type ElementRow = {
  id: string;
  tenant_id: string;
  revision_id: string;
  drawing_id: string;
  row_no: number;
  model_uid: string | null;
  element_code: string | null;
  element_type: string | null;
  building: string | null;
  wbs_item_id: string | null;
  level: string | null;
  qty: number;
  unit: string | null;
  volume_m3: number | null;
  area_m2: number | null;
  length_m: number | null;
  weight_t: number | null;
  weight_calculated: boolean;
  attrs: Record<string, unknown> | null;
};

/** The fields of an element that a comparison looks at (everything a quantity depends on). */
export const COMPARED_FIELDS = ["qty", "unit", "volume_m3", "area_m2", "length_m", "weight_t", "element_type", "building", "level"] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];

/** An element as the readers produce it, before it has an id or a revision. */
export type NewElement = Omit<ElementRow, "id" | "tenant_id" | "revision_id" | "drawing_id" | "row_no" | "wbs_item_id"> & { wbs_item_id?: string | null };
