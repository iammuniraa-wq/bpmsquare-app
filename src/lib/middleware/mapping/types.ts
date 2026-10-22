// The mapping engine's shared, client-safe shapes (docs/design/mapping-engine.md, sections 1 and 4).
// No server imports: the Mapping tab reads these same types.

export type Primitive = string | number | boolean | null;

export const SOURCE_OBJECTS = ["standard_quote", "account", "contact", "product", "project"] as const;
export type SourceObject = (typeof SOURCE_OBJECTS)[number];

export const FIELD_TYPES = ["text", "integer", "number", "boolean", "date", "datetime", "enum", "lookup", "array", "object"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type TargetField = {
  path: string;
  label: string;
  type: FieldType;
  required: boolean;
  creatable: boolean;
  enum?: string[];
  /** Code -> label, when the target publishes labels for its codes (a Dataverse choice column). */
  enumLabels?: Record<string, string>;
  lookup?: string;
  state?: "new" | "missing";
};

export type SourceField = { key: string; label: string; type: FieldType; custom: boolean };

export const DATE_FORMATS = ["iso-date", "iso-datetime", "dd.MM.yyyy", "dd/MM/yyyy", "MM/dd/yyyy", "yyyyMMdd", "epoch-ms"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const CONVERTER_KINDS = ["value_list", "constant", "concat", "split", "date", "number", "text", "boolean"] as const;
export type ConverterKind = (typeof CONVERTER_KINDS)[number];

export type ConcatPart = { field: string } | { text: string };

export type Converter =
  | { kind: "value_list"; list: string }
  | { kind: "constant"; value: string | number | boolean }
  | { kind: "concat"; parts: ConcatPart[]; skipEmpty?: boolean; requireAll?: boolean }
  | { kind: "split"; sep: string; index: number }
  | { kind: "date"; format: DateFormat }
  | { kind: "number"; scale?: number; decimals?: number; asText?: boolean }
  | { kind: "text"; op: "trim" | "upper" | "lower" | "truncate"; max?: number }
  | { kind: "boolean"; trueValue: string | number | boolean; falseValue: string | number | boolean };

export type Confidence = "sure" | "likely" | "guess";
export type RowOrigin = "standard" | "proposed" | "ai" | "user";

export type MapRow = {
  id: string;
  target: string;
  source: string | null;
  convert: Converter | null;
  ifEmpty: string | null;
  origin: RowOrigin;
  confidence: Confidence | null;
};

export type MappingTarget = {
  kind: "adapter" | "openapi" | "odata" | "sample" | "manual";
  entity: string;
  linesPath: string | null;
  schema: {
    fetchedAt: string;
    sourceUrl: string | null;
    operation?: { method: string; path: string };
    fields: TargetField[];
    /** Where each field sits: the header block or the lines block. Fields of the lines block carry the lines path prefix in `block`. */
    lineFields?: TargetField[];
  };
};

export type MappingDocument = {
  source: { object: SourceObject; registryHash: string };
  target: MappingTarget;
  header: MapRow[];
  lines: MapRow[];
  note?: string;
};

export type ValueListRow = { bpm: string; erp: string; inbound: boolean };

export const STANDARD_LIST_KINDS = ["unit", "currency", "country", "payment_terms", "incoterms", "status"] as const;
export type StandardListKind = (typeof STANDARD_LIST_KINDS)[number];
export const STANDARD_LIST_LABEL: Record<StandardListKind, string> = {
  unit: "Unit", currency: "Currency", country: "Country", payment_terms: "Payment terms", incoterms: "Incoterms", status: "Status",
};
export const MAX_CUSTOM_LISTS = 20;
export const MAX_LIST_ROWS = 2000;

export type ValueList = {
  kind: string;
  label: string;
  rows: ValueListRow[];
  default_in: string | null;
  unknown_in: string[];
};

export type ProblemCode =
  | "value_unmapped" | "bad_date" | "bad_number" | "required_empty" | "target_field_missing" | "list_missing" | "row_invalid" | "no_lines";

export type MappingProblem = {
  code: ProblemCode;
  message: string;
  fix: string;
  rowId?: string;
  field?: string;
  list?: string;
  value?: string;
};

export type RowError = { rowId?: string; field?: string; message: string };

// ── The JSON contract between the backend and the Mapping tab ─────────────────

export type MappingVersionInfo = { version: number; at: string; by: string | null };

export type EngineState = { active: boolean; version: number | null; versions: MappingVersionInfo[]; usingStandard: boolean };

export type TargetInfo = {
  kind: MappingTarget["kind"];
  entity: string;
  linesPath: string | null;
  schema: { fetchedAt: string | null; sourceUrl: string | null; counts: { total: number; new: number; missing: number } };
};

export type EngineMappingExtras = {
  engine: EngineState;
  target: TargetInfo;
  sourceFields: { header: SourceField[]; lines: SourceField[] };
  targetFields: { header: TargetField[]; lines: TargetField[] };
  rows: { header: MapRow[]; lines: MapRow[] };
  missingRequired: string[];
  lists: { kind: string; label: string; rowCount: number }[];
  ai: { available: boolean };
};

export type TryRequest = { method: string; url: string; headers: string[]; body: unknown };
export type TryResult = { words: string[]; request: TryRequest; problems: MappingProblem[] };
