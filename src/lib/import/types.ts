export type ImportObjectId =
  | "accounts" | "contacts" | "assets" | "suppliers" | "quotes" | "quote_lines"
  | "cases" | "work_orders" | "invoices" | "purchase_orders" | "inventory"
  | "users" | "employees" | "products" | "wfm_projects" | "opportunities" | "rfqs" | "estimates"
  | "product_bom_lines" | "consents" | "abm_programs" | "abm_targets" | "abm_members"
  | "standard_quotes" | "standard_quote_lines"
  | "sales_orders" | "sales_order_lines"
  | "tender_boq_lines" | "tender_wbs_items";

/**
 * Which objects have an Export or an Update is decided by the route folders under src/app/api/{export,update} and
 * mirrored in DW_CATALOG (catalog.ts), which a test ties together. These two types only narrow the ids the server
 * helpers accept: users and consents have no Update (invites and an append-only ledger do not fit an id-match patch),
 * and rfqs has no Import.
 */
export type ExportableObjectId = ImportObjectId;

export type UpdatableObjectId = Exclude<ExportableObjectId, "users" | "consents">;

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
  /** In Export column lists but stripped from Import/Update specs — system-computed values an importer can't set. */
  exportOnly?: boolean;
  /** Read on Import (and offered for mapping on Update) but never an Export column: a spelling a client's file uses, such as a Narration column. */
  importOnly?: boolean;
  /** An Export column and mappable on Update, but not offered on Import: a column whose meaning on a new row would move existing data (a tender line's WBS code). */
  updateOnly?: boolean;
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
  /** Users import only. Client-admin-added logins get no invite email
   * (decision 2026-08-06), so the temporary password generated for each new
   * login is returned here for the admin to hand out. Shown once, on the
   * result screen -- never stored anywhere retrievable. */
  credentials?: { email: string; password: string }[];
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

// ── Document extraction ─────────────────────────────────────────────────────

/** One record an AI extraction pulled out of an uploaded document, keyed by
 * the same field keys as everything else in the import pipeline — so it can
 * go straight into validateRow/validateQuoteRows with no separate shape. */
export type ExtractedRow = {
  rowNum: number;
  values: Record<string, string>;
  /** Something the extraction was unsure about — shown to the user for review before import. */
  note?: string;
};

export type ExtractionResponse = {
  rows: ExtractedRow[];
  documentNotes: string[];
};
