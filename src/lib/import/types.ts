export type ImportObjectId = "accounts" | "contacts" | "assets" | "quotes" | "users";

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
  status: "inserted" | "skipped" | "failed";
  reason?: string;
};

export type ImportResponse = {
  inserted: number;
  skipped: number;
  failed: number;
  outcomes: RowOutcome[];
};
