// ePROMIS connector -- shared, client-safe shapes (no server imports).
//
// ePROMIS publishes no API documentation, so nothing here names a vendor path or a vendor field. The connector is a
// configurable REST client: the workspace's endpoint map (paths, methods, JSON paths) says where each operation lives,
// and every operation answers "Not configured" until it is filled. The normalised shapes below are what the rest of
// BPMSquare talks in, whatever the vendor's JSON looks like.

export const EPROMIS_CONNECTOR_ID = "epromis";
export const EPROMIS_NAME = "ePROMIS";

export const EPROMIS_AUTH_TYPES = ["api_key", "bearer", "basic"] as const;
export type EpromisAuthType = (typeof EPROMIS_AUTH_TYPES)[number];
export const EPROMIS_AUTH_LABEL: Record<EpromisAuthType, string> = {
  api_key: "API key in a header",
  bearer: "Bearer token",
  basic: "User name and password",
};

export type CompanyPlacement = "header" | "query";

export const EPROMIS_OPERATIONS = [
  "ping", "list_tenders", "get_project", "create_project", "create_budget", "replace_budget",
  "list_resources", "list_cost_codes", "list_justifications",
] as const;
export type EpromisOperation = (typeof EPROMIS_OPERATIONS)[number];

export const EPROMIS_OPERATION_LABEL: Record<EpromisOperation, string> = {
  ping: "Test address",
  list_tenders: "Tenders list",
  get_project: "Project read",
  create_project: "Project create",
  create_budget: "Budget create",
  replace_budget: "Budget replace",
  list_resources: "Resource Master list",
  list_cost_codes: "Cost Code list",
  list_justifications: "Justification list",
};

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * One operation of the vendor's API. Every key is optional: an operation with no `path` is "not configured".
 * All "paths into JSON" are simple dotted paths (`data.items`, `rows[0].code`).
 */
export type EndpointDef = {
  /** Relative to the base URL, starting with "/". May contain {placeholders} (see OPERATION_PLACEHOLDERS). */
  path?: string;
  method?: HttpMethod;
  /** Lists: where the array of rows is in the answer. Project read: where the project is. Empty means the answer itself. */
  rows_path?: string;
  /** Lists: where the answer names the next page (a link on the same host). Empty means one page. */
  next_path?: string;
  /** Reads: normalised field (code, name, parent_code ...) to the path inside one row. */
  fields?: Record<string, string>;
  /** Reads: a flag name to the path inside one row. Carried on the normalised row as `flags`. */
  flags?: Record<string, string>;
  /** Writes: path in the vendor's request body to a value, either a literal or a {placeholder} of the normalised payload. */
  body?: Record<string, string>;
  /** Budget writes: where the line array goes in the body, and how one line is shaped (same value rules as `body`). */
  lines_path?: string;
  line?: Record<string, string>;
  /** Writes: where the answer names the id of the record that was created. */
  id_path?: string;
};

export type EndpointMap = Partial<Record<EpromisOperation, EndpointDef>>;

export type EpromisConfig = {
  /** https://host[/prefix], no trailing slash. */
  base_url: string;
  auth_type: EpromisAuthType;
  /** api_key only: the header the key travels in. */
  key_header: string;
  /** basic only. The password is a secret and lives only in tenant_connectors.credentials. */
  username: string;
  /** Optional company or database code, sent as a header or a query value under this name. */
  company_name: string;
  company_value: string;
  company_in: CompanyPlacement;
  endpoints: EndpointMap;
};

export type EpromisPublicState = {
  config: EpromisConfig | null;
  /** Whether a credential is stored -- never its value. */
  secret_stored: boolean;
  status: "connected" | "error" | "not_connected";
  last_error: string | null;
};

// ── Normalised data ─────────────────────────────────────────────────────────

export const MASTER_KINDS = ["tenders", "resources", "cost_codes", "justifications"] as const;
export type MasterKind = (typeof MASTER_KINDS)[number];

export const MASTER_OPERATION: Record<MasterKind, EpromisOperation> = {
  tenders: "list_tenders",
  resources: "list_resources",
  cost_codes: "list_cost_codes",
  justifications: "list_justifications",
};

export type FlagValue = string | number | boolean | null;

/** One row of a reference list, whatever the vendor calls its fields. */
export type MasterRow = { code: string; name: string; parent_code: string | null; flags: Record<string, FlagValue> };

export type ProjectPayload = {
  code: string;
  name: string;
  description?: string | null;
  client_code?: string | null;
  client_name?: string | null;
  contract_value?: number | null;
  currency?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  manager_name?: string | null;
  /** The BPMSquare record the project came from (the won tender's reference). */
  source_ref?: string | null;
};

export type ProjectInfo = { code: string; name: string; flags: Record<string, FlagValue>; id: string | null };

export type BudgetLine = {
  line_no: number;
  resource_code: string;
  cost_code: string;
  description?: string | null;
  qty?: number | null;
  unit?: string | null;
  unit_cost?: number | null;
  amount: number;
  reserve?: boolean;
};

export type BudgetPayload = {
  /** ePROMIS's own project code (and its id, when the vendor addresses projects by id). */
  project_code: string;
  project_id?: string | null;
  revision_no: number;
  /** "replace" sends the whole budget over the one already there; "create" sends a first budget. */
  mode: "create" | "replace";
  justification_code?: string | null;
  justification_text?: string | null;
  currency?: string | null;
  total: number;
  lines: BudgetLine[];
};

/** What every operation answers. Never thrown: a screen shows `message` as it stands. */
export type EpResult<T> =
  | { ok: true; data: T }
  | { ok: false; state: "not_configured" | "not_connected" | "error"; message: string; status?: number };

export type MasterPull = { rows: MasterRow[]; skipped: number; pages: number; truncated: boolean };
export type CreateResult = { external_id: string | null };

export type EpromisTestResult = { ok: boolean; line: string; failures: { label: string; fix: string | null }[]; verified: boolean };

/** The {placeholders} each operation's path and body may use. A map that names another is refused on save. */
export const PROJECT_PLACEHOLDERS = ["code", "name", "description", "client_code", "client_name", "contract_value", "currency", "start_date", "end_date", "manager_name", "source_ref"] as const;
export const BUDGET_PLACEHOLDERS = ["project_code", "project_id", "revision_no", "justification_code", "justification_text", "currency", "total"] as const;
export const LINE_PLACEHOLDERS = ["line_no", "resource_code", "cost_code", "description", "qty", "unit", "unit_cost", "amount", "reserve"] as const;

export const OPERATION_PLACEHOLDERS: Record<EpromisOperation, readonly string[]> = {
  ping: [],
  list_tenders: [],
  list_resources: [],
  list_cost_codes: [],
  list_justifications: [],
  get_project: ["code"],
  create_project: PROJECT_PLACEHOLDERS,
  create_budget: BUDGET_PLACEHOLDERS,
  replace_budget: BUDGET_PLACEHOLDERS,
};

/** Which normalised fields a list may map. `code` is the one a list cannot work without. */
export const MASTER_FIELDS = ["code", "name", "parent_code"] as const;
export const PROJECT_READ_FIELDS = ["code", "name", "id"] as const;
