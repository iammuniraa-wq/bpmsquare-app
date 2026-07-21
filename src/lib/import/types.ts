export type ImportObjectId =
  | "accounts" | "contacts" | "assets" | "suppliers" | "quotes"
  | "cases" | "work_orders" | "invoices" | "purchase_orders" | "inventory"
  | "users";

/**
 * quotes is excluded from Export and Update: it isn't on FIELD_REGISTRY (reverted
 * back to the old page_layouts system — see FIELD_REGISTRY_ROLLOUT.md), so there's
 * no live field list to build a spec from. Import still nominally accepts quotes
 * (header/reference/line fields only), but Export/Update need a real field list.
 */
export type ExportableObjectId = Exclude<ImportObjectId, "quotes">;

/** users is additionally excluded from Update — invite/role changes don't fit the id-match bulk-patch shape. */
export type UpdatableObjectId = Exclude<ExportableObjectId, "users">;

export type FieldType =
  | "text"
  | "longtext"
  | "enum"
  | "number"
  | "integer"
  | "date"
  | "boolean"
  | "email"
  | "ref";

export type FieldSpec = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  hint: string;
  options?: readonly string[];
  /** Header spellings seen in real customer files, matched case/punctuation-insensitively. */
  aliases?: readonly string[];
  /** Populated per-tenant from custom field definitions. */
  custom?: boolean;
  /** Quote line-item columns repeat per row; header columns only read from a group's first row. */
  scope?: "header" | "line";
  example?: string;
};

export type ObjectSpec = {
  id: ImportObjectId;
  label: string;
  icon: string;
  description: string;
  /** Objects this one resolves references against — drives the import-order hint. */
  dependsOn: ImportObjectId[];
  fields: FieldSpec[];
  sampleRows: Record<string, string>[];
};

export type ParsedSheet = {
  headers: string[];
  rows: string[][];
  /** Source line number for each row, for error messages that match the user's file. */
  rowNumbers: number[];
  format: "csv" | "xlsx";
  sheetName?: string;
};

/** headerIndex -> field key, or null when a column is ignored. */
export type ColumnMapping = Record<number, string | null>;

export type RowIssue = {
  field: string;
  message: string;
  severity: "error" | "warning";
};

export type ValidatedRow = {
  rowNum: number;
  values: Record<string, string>;
  issues: RowIssue[];
};

export type RowOutcome = {
  rowNum: number;
  status: "inserted" | "updated" | "skipped" | "failed";
  reason?: string;
};

export type ImportResponse = {
  inserted: number;
  skipped: number;
  failed: number;
  outcomes: RowOutcome[];
};

export type UpdateResponse = {
  updated: number;
  skipped: number;
  failed: number;
  outcomes: RowOutcome[];
};

// ── Export ───────────────────────────────────────────────────────────────────

export type ExportFilterOp =
  | "equals" | "not_equals" | "contains"
  | "gt" | "lt" | "on" | "before" | "after"
  | "is_empty" | "is_not_empty";

export type ExportFilter = {
  field: string;
  op: ExportFilterOp;
  value: string;
};

export type ExportResponse = {
  /** Every field value as a display string, keyed by field key — always includes "id". */
  rows: Record<string, string>[];
};
