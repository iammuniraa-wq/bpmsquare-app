// The ONE file that talks to the server for the Integration middleware page:
// every fetch, and the shape of every answer. The screens never build a URL or
// read a raw response, so when a route's final contract differs from what is
// written here, only this file changes. Client-safe (no server imports).
// Routes live under /api/middleware (see src/app/api/middleware/*); saving,
// testing and disconnecting a connection reuse the connector's own routes.

import type { D365Config, D365EntityConfig, D365EntityKey, D365PublicState } from "@/lib/connectors/d365/types";

// ── Errors ──────────────────────────────────────────────────────────────────

/** A request that did not work, in words a person can act on. */
export class ApiProblem extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The route is not there yet (an HTML 404/405/500, not our JSON): the screen says "still being installed". */
    readonly installing = false,
    readonly fix: string | null = null,
    readonly field: string | null = null,
  ) {
    super(message);
  }
}

export const INSTALLING = "This part is still being installed.";

type Json = Record<string, unknown>;

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiProblem("Could not reach the server. Check your connection and try again.", 0);
  }
  const text = await res.text();
  let json: Json | null = null;
  try { json = text ? (JSON.parse(text) as Json) : null; } catch { json = null; }
  if (json === null && !res.ok) throw new ApiProblem(INSTALLING, res.status, res.status === 404 || res.status === 405 || res.status >= 500);
  if (!res.ok) {
    const first = Array.isArray(json?.errors) ? (json!.errors as { field?: string; message?: string }[])[0] : undefined;
    const msg = (typeof json?.headline === "string" && json.headline) || (typeof json?.error === "string" && json.error) || first?.message || `Request failed (${res.status})`;
    throw new ApiProblem(msg, res.status, false, typeof json?.fix === "string" ? json.fix : null, first?.field ?? null);
  }
  return (json ?? {}) as T;
}

const get = <T,>(url: string) => request<T>("GET", url);
const post = <T,>(url: string, body?: unknown) => request<T>("POST", url, body ?? {});
const put = <T,>(url: string, body: unknown) => request<T>("PUT", url, body);
const del = <T,>(url: string) => request<T>("DELETE", url);

/** Some routes answer 200 with this instead of data when the SQL has not been run. */
export type NeedsUpdate = { needsDatabaseUpdate: true; bundle: string | null };
export const needsUpdate = (x: unknown): x is NeedsUpdate =>
  !!x && typeof x === "object" && (x as Json).needsDatabaseUpdate === true && !("items" in (x as Json)) && !("fields" in (x as Json));

// ── Vocabulary ──────────────────────────────────────────────────────────────

export type Outcome = "awarded" | "rejected";
export type RuleMode = "auto" | "manual";
export type OutcomeRule = { enabled: boolean; mode: RuleMode };

export const FENCE_PARTS = ["summary", "quantity_lines", "security_profile", "drawing_link", "notes_terms"] as const;
export type FencePart = (typeof FENCE_PARTS)[number];
export const FENCE_PART_LABEL: Record<FencePart, string> = {
  summary: "Design summary in the description",
  quantity_lines: "Quantity lines (posts, fabric, gates)",
  security_profile: "Security profile",
  drawing_link: "Drawing link",
  notes_terms: "Notes and terms",
};

export const ESTIMATE_PARTS = ["summary", "quote_lines", "bom", "wbs", "internal_costs"] as const;
export type EstimatePart = (typeof ESTIMATE_PARTS)[number];
export const ESTIMATE_PART_LABEL: Record<EstimatePart, string> = {
  summary: "Estimate summary in the description",
  quote_lines: "Quote lines (customer prices)",
  bom: "Bill of materials",
  wbs: "Project tasks (WBS) and casting schedule",
  internal_costs: "Internal cost breakdown",
};

export type TargetKind = "quote" | "project";
export type OptionContract = { allowed: boolean; hint: string | null };

// ── What goes out ───────────────────────────────────────────────────────────

export type RulesView = {
  rules: { quote_awarded: OutcomeRule; quote_rejected: OutcomeRule };
  fence: Record<FencePart, boolean>;
  estimate: Record<EstimatePart, boolean>;
  payload_capture: boolean;
  /** What the connected product receives, and which options it can take. */
  contract: { target: TargetKind | null; fence: Record<FencePart, OptionContract>; estimate: Record<EstimatePart, OptionContract> };
  product: { key: string; name: string } | null;
  /** "Quote" or "Project": what an awarded quote becomes there. */
  awarded_target: string | null;
  /** "Closes the quote as lost" or "Sends nothing". */
  rejected_target: string | null;
};

export type RulesPatch = {
  rules?: { quote_awarded?: Partial<OutcomeRule>; quote_rejected?: Partial<OutcomeRule> };
  fence?: Partial<Record<FencePart, boolean>>;
  estimate?: Partial<Record<EstimatePart, boolean>>;
  payload_capture?: boolean;
};

export const getRules = () => get<RulesView>("/api/middleware/rules");
export const saveRules = (patch: RulesPatch) => put<RulesView>("/api/middleware/rules", patch);

export type PreviewView = {
  ok: true;
  /** Read first: customer, lines, total, what is included or not sent. */
  words: string[];
  /** The exact body, behind a toggle. Holds no secrets. */
  body: Record<string, unknown> | null;
  extras: { tasks: number; bom: number; costs: boolean };
  included: string[];
  refused: { part: string; hint: string }[];
  problems: { code: string; message: string; fix: string }[];
  target: TargetKind;
  outcome: Outcome;
  nothingToSend: string | null;
};
export const previewQuote = (quoteId: string, outcome?: Outcome) =>
  post<PreviewView>("/api/middleware/preview", { quote_id: quoteId, ...(outcome ? { outcome } : {}) });

export type SendResult =
  | { ok: true; message: string; number?: string | null; link?: string | null }
  | { ok: false; headline: string; fix: string | null; needsDatabaseUpdate?: boolean };

/** Send routes answer 4xx with { ok:false, headline, fix }: that is a result to show, not an exception. */
async function sendLike(url: string, body: unknown): Promise<SendResult> {
  try {
    const r = await post<SendResult | NeedsUpdate>(url, body);
    if (needsUpdate(r)) return { ok: false, headline: "A database update is needed first.", fix: r.bundle ? `Run ${r.bundle} once.` : null, needsDatabaseUpdate: true };
    return r as SendResult;
  } catch (e) {
    if (e instanceof ApiProblem && !e.installing) return { ok: false, headline: e.message, fix: e.fix };
    throw e;
  }
}
export const sendQuoteNow = (quoteId: string, outcome?: Outcome) => sendLike("/api/middleware/send", { quote_id: quoteId, ...(outcome ? { outcome } : {}) });
export const sendRecord = (objectType: SendableObject, id: string) => sendLike("/api/middleware/send-record", { object_type: objectType, id });
export const retryMessage = (messageId: string) => sendLike("/api/middleware/retry", { message_id: messageId });

export type TestQuoteResult =
  | { ok: true; ref: string; number: string | null; link: string | null; messageId: string | null }
  | { ok: false; headline: string; fix: string | null };
export async function sendTestQuote(): Promise<TestQuoteResult> {
  try {
    const r = await post<TestQuoteResult | NeedsUpdate>("/api/middleware/test-quote");
    if (needsUpdate(r)) return { ok: false, headline: "A database update is needed first.", fix: r.bundle ? `Run ${r.bundle} once.` : null };
    return r as TestQuoteResult;
  } catch (e) {
    if (e instanceof ApiProblem && !e.installing) return { ok: false, headline: e.message, fix: e.fix };
    throw e;
  }
}

export const SENDABLE_OBJECTS = ["accounts", "standard_quotes"] as const;
export type SendableObject = (typeof SENDABLE_OBJECTS)[number];
export const SENDABLE_LABEL: Record<SendableObject, string> = { accounts: "Account", standard_quotes: "Standard Quote" };

// ── Monitor ─────────────────────────────────────────────────────────────────

export const MESSAGE_DIRECTIONS = ["in", "out"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];
export const MESSAGE_CHANNELS = ["email", "whatsapp", "webhook", "connector", "api"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];
export type MonitorStatus = "ok" | "failed" | "pending" | "skipped" | "redirected" | "dry_run";
export const MONITOR_STATUSES: readonly MonitorStatus[] = ["ok", "failed", "pending", "skipped", "redirected", "dry_run"];

export type MonitorMessage = {
  /** `<source>:<uuid>`: what the detail route takes. */
  id: string;
  source: string;
  at: string;
  direction: MessageDirection;
  channel: MessageChannel;
  counterpart: string | null;
  summary: string;
  status: MonitorStatus;
  record: { type: string; id: string | null; label: string | null } | null;
  duration_ms: number | null;
};

export type MessageFilters = {
  direction?: MessageDirection;
  channel?: MessageChannel;
  status?: MonitorStatus;
  /** Calendar days (YYYY-MM-DD) as the date pickers give them. */
  from?: string;
  to?: string;
  /** Show only rows about one record. */
  object_id?: string;
  q?: string;
};

export type MessagePage = {
  items: MonitorMessage[];
  nextCursor: string | null;
  needsDatabaseUpdate: boolean;
  bundle: string | null;
  missingSources: string[];
  failedSources: string[];
};

export const getMessages = (query: string) => get<MessagePage>(`/api/middleware/messages${query ? `?${query}` : ""}`);

export type MessageDetail = { message: MonitorMessage; detail: Record<string, unknown> };
export const getMessage = (id: string) => get<MessageDetail | NeedsUpdate>(`/api/middleware/messages/${encodeURIComponent(id)}`);

// ── Connections ─────────────────────────────────────────────────────────────

/** The stored connection as the screen edits it: the Dynamics shape plus the
 *  settings the middleware adds (pick-list choices, expiry, outbound maps). */
export type OutboundMaps = {
  quote?: { field_map?: Record<string, string> };
  quote_line?: { field_map?: Record<string, string> };
  project?: {
    entity_set?: string;
    id_field?: string;
    field_map?: Record<string, string>;
    tasks?: { entity_set: string; link_field?: string };
    bom?: { entity_set: string; link_field?: string };
  };
};
export type EntitySchedule = "off" | "hourly" | "daily";
export type EntityCfg = D365EntityConfig & { schedule?: EntitySchedule };
export type ConnectionConfig = Omit<D365Config, "entities"> & {
  entities: Partial<Record<D365EntityKey, EntityCfg>>;
  secret_expires_on?: string;
  price_list_id?: string;
  currency_id?: string;
  outbound?: OutboundMaps;
};
export type ConnectionState = Omit<D365PublicState, "config"> & { config: ConnectionConfig | null };
export type ConnectionItem = { id: string; label: string; kind: "erp"; state: ConnectionState };

export async function getConnections(): Promise<ConnectionItem[]> {
  const r = await get<ConnectionItem[] | { connections?: ConnectionItem[] }>("/api/middleware/connections");
  return Array.isArray(r) ? r : (r.connections ?? []);
}

export type Secrets = Partial<Record<"client_secret" | "certificate" | "private_key" | "password", string>>;
/** A blank or missing secret means "unchanged", never "clear". A setting left out of `config` keeps its stored value; null clears it (outbound: null = "Reset to standard"). */
export const saveConnection = (connectorId: string, config: Partial<ConnectionConfig> & { outbound?: OutboundMaps | null }, secrets: Secrets = {}) =>
  put<ConnectionState>(`/api/middleware/connections/${connectorId}`, { config, secrets });
export const testConnection = (connectorId: string) => post<{ ok?: boolean; message?: string }>(`/api/middleware/connections/${connectorId}/test`);
export const disconnect = (connectorId: string) => del<unknown>(`/api/middleware/connections/${connectorId}`);
/** "Sign in as a user" still starts at the connector's own route, which comes back to the connector screen's callback. */
export const oauthStartUrl = (connectorId: string) => `/api/connectors/${connectorId}/oauth/start`;

export type SecretExpiry = { state: "unknown" | "ok" | "soon" | "expired"; expires_on: string | null; days_left: number | null };
export type SchemaRow = { table: string; label: string; exists: boolean; bundle: string | null };
export type HealthView = {
  connection: {
    connected: boolean;
    state: "connected" | "error" | "not_connected";
    last_error: string | null;
    product: { key: string; name: string } | null;
    price_list_chosen: boolean;
    currency_chosen: boolean;
  };
  secret: SecretExpiry;
  schema: SchemaRow[];
  needsDatabaseUpdate: boolean;
  bundles: string[];
};
export const getHealth = () => get<HealthView>("/api/middleware/health");

export type PickItem = { id: string; name: string; code: string | null };
export type PickList = { applicable: boolean; items: PickItem[]; hint?: string };
export const getPriceLists = () => get<PickList>("/api/middleware/pricelists");
export const getCurrencies = () => get<PickList>("/api/middleware/currencies");

export type PermissionCheck = { id: string; label: string; ok: boolean | null; fix: string | null };
export const checkPermissions = () => post<{ checks: PermissionCheck[] }>("/api/middleware/check-permissions");

// ── Mapping ─────────────────────────────────────────────────────────────────

export const METADATA_ENTITIES = ["quote", "quote_line", "account", "contact", "product", "project", "customers", "contacts", "vendors", "products", "projects"] as const;
export type MetadataEntity = (typeof METADATA_ENTITIES)[number];
export type ErpField = { name: string; label: string; type: string; required: boolean; creatable: boolean };
export type MetadataView = {
  fields: ErpField[];
  fetchedAt: string | null;
  /** false where the product has no such table (a quote on Finance and Operations): `hint` says so. */
  applicable?: boolean;
  hint?: string;
  /** "sample" = the keys of a sample row (no required marks). */
  source?: string;
};
export const getMetadata = (entity: MetadataEntity, refresh = false) =>
  get<MetadataView>(`/api/middleware/metadata?entity=${encodeURIComponent(entity)}${refresh ? "&refresh=1" : ""}`);

/** Inbound preview: the first rows of an entity as the ERP returns them. Nothing is written. */
export const previewEntity = (entity: D365EntityKey) => post<{ rows: Record<string, unknown>[] }>("/api/middleware/preview-entity", { entity });

export type MapKind = "quote" | "quote_line" | "project";
export type FieldMap = Record<string, string>;
export type OutboundView = {
  quote: { field_map: FieldMap };
  quote_line: { field_map: FieldMap };
  project: { entity_set: string; id_field: string; field_map: FieldMap };
};
export type EntityMapView = {
  enabled: boolean;
  entity_set: string;
  id_field: string;
  key_field?: string;
  modified_field?: string;
  filter?: string;
  field_map: FieldMap;
  schedule?: EntitySchedule;
};
export type MappingView =
  | { connected: false }
  | {
      connected: true;
      product: string;
      /** true = "Using the standard mapping" */
      using_standard: Record<MapKind, boolean>;
      effective: OutboundView;
      /** "Reset to standard" saves outbound: null. */
      presets: OutboundView;
      /** The {fields} BPMSquare offers a map, per kind. */
      placeholders: Record<MapKind, string[]>;
      /** The inbound maps in force, null where the product has no such entity. */
      entities: Partial<Record<D365EntityKey, EntityMapView | null>>;
    };
export const getMapping = () => get<MappingView>("/api/middleware/mapping");

export type Suggestion = { bpm: string; erp: string; score: number; reason: string };
/** "Suggest mapping": matches between BPMSquare fields and the ERP's own, by name. */
export const suggestMapping = (entity: MetadataEntity, bpmFields: { key: string; label: string }[], mapped: string[]) =>
  post<{ suggestions: Suggestion[]; missing: ErpField[] }>("/api/middleware/mapping", { entity, bpm_fields: bpmFields, mapped });

// ── Resync ──────────────────────────────────────────────────────────────────

export type SyncEntity = {
  key: D365EntityKey;
  label: string;
  direction: "pull" | "push";
  enabled: boolean;
  entity_set: string | null;
  schedule: EntitySchedule;
  schedule_source: "entity" | "connector";
  running: boolean;
  linked: number;
  last_run: { status: string; trigger: string; started_at: string; finished_at: string | null; counts: Record<string, number> | null; error: string | null } | null;
};
export type SyncOverview =
  | { connected: false; entities: [] }
  | { connected: true; product: { key: string; name: string }; pending_migration: boolean; entities: SyncEntity[] };

export const getSync = () => get<SyncOverview>("/api/middleware/sync");
export type SyncRunResult = { runId?: string; counts?: Record<string, number>; issues?: string[]; error?: string | null };
/** A refused run (one is already running, the ERP said no) comes back as an ApiProblem carrying the server's message. */
export const runSync = (entity: D365EntityKey, full = false) => post<SyncRunResult>("/api/middleware/resync", { entity, full });
export const setSchedule = (entity: D365EntityKey, schedule: EntitySchedule) =>
  put<{ ok?: boolean; schedule?: EntitySchedule }>("/api/middleware/schedule", { entity, schedule });

// ── Pick lists for "Send a record" and "Send now" ───────────────────────────

export type QuoteChoice = { id: string; ref: string; status: string; total: number; account_id: string | null };
export type AccountChoice = { id: string; name: string };

export async function listQuoteChoices(): Promise<QuoteChoice[]> {
  const rows = await get<unknown>("/api/standard-quotes");
  return (Array.isArray(rows) ? rows : []).map((r: Json) => ({
    id: String(r.id), ref: String(r.ref ?? ""), status: String(r.status ?? ""), total: Number(r.total ?? 0), account_id: typeof r.account_id === "string" ? r.account_id : null,
  }));
}
export async function listAccountChoices(): Promise<AccountChoice[]> {
  const rows = await get<unknown>("/api/accounts");
  return (Array.isArray(rows) ? rows : []).map((r: Json) => ({ id: String(r.id), name: String(r.name ?? "") }));
}
