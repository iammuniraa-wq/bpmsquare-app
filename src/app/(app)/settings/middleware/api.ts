// The ONE file that talks to the server for the Integration middleware page:
// every fetch, and the shape of every answer. The screens never build a URL or
// read a raw response, so when a route's final contract differs from what is
// written here, only this file changes. Client-safe (no server imports).
// Routes live under /api/middleware (see src/app/api/middleware/*); saving,
// testing and disconnecting a connection reuse the connector's own routes.

import type { D365Config, D365EntityConfig, D365EntityKey, D365PublicState, ScopeCondition } from "@/lib/connectors/d365/types";
import type { ScopeAttribute } from "@/lib/connectors/d365/scope";
import type { SapAuthMode, SapPublicState } from "@/lib/connectors/sap_s4/types";
import type { Converter, EngineMappingExtras, MapRow as MapRowT, TryResult, ValueListRow } from "@/lib/middleware/mapping/types";

export type ScopeEntityKey = Exclude<D365EntityKey, "fence_projects">;

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
    /** Every row the server refused (a save answers 422 with one entry per row). */
    readonly errors: ErrorItem[] = [],
  ) {
    super(message);
  }
}

export type ErrorItem = { rowId?: string; field?: string; row?: number; message: string };

export const INSTALLING = "This part is still being installed.";

type Json = Record<string, unknown>;

// The connector the page is showing. Every /api/middleware call names it (`?connector=`) unless it is the first one, Dynamics
// 365, whose calls are exactly what they always were.
let activeConnector = "dynamics365";
export function setActiveConnector(id: string): void { activeConnector = id; }
export const getActiveConnector = (): string => activeConnector;
/** Add `connector=<id>` to a middleware url for a connector other than the first. */
export function withConnector(url: string, id: string = activeConnector): string {
  if (id === "dynamics365" || !url.startsWith("/api/middleware/") || /[?&]connector=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connector=${encodeURIComponent(id)}`;
}

async function request<T>(method: string, url: string, body?: unknown, opts: { keep4xx?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(withConnector(url), {
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
  // A 4xx whose JSON body IS the answer (a refused test, a refused send) is returned, not thrown.
  if (!res.ok && opts.keep4xx && res.status < 500 && json) return json as T;
  if (!res.ok) {
    const all = Array.isArray(json?.errors) ? (json!.errors as ErrorItem[]).filter((x) => x && typeof x.message === "string") : [];
    const first = all[0];
    const msg = (typeof json?.headline === "string" && json.headline) || (typeof json?.error === "string" && json.error) || first?.message || `Request failed (${res.status})`;
    throw new ApiProblem(msg, res.status, false, typeof json?.fix === "string" ? json.fix : null, first?.field ?? null, all);
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

// ── Documents: what goes out (spec section 6) ──────────────────────────────

export type DocumentTarget = { key: string; label: string; available: boolean; hint: string | null };
export type WebhookChoice = { id: string; name: string };
export type DocumentInclude = { key: string; label: string; on: boolean; allowed: boolean; hint: string | null };
export type DocumentView = {
  key: string;
  label: string;
  source: string;
  enabled: boolean;
  /** One line, e.g. "Awarded → Dynamics 365 Quote". Not shown in the Links table (it has its own columns). */
  summary: string;
  target: { key: string; label: string };
  targets: DocumentTarget[];
  include: DocumentInclude[];
  /** The Dynamics price list used when the customer has none of their own; null = none set. */
  fallbackPriceListId: string | null;
  /** The server says whether the fallback line applies (a Dynamics Quote or Sales Order); null when it did not say. */
  showFallbackPriceList: boolean | null;
  /** Set once the owner has saved the panel; the set-up tick follows it, not the defaults. */
  confirmedAt: string | null;
  /** Target "Webhook" only: the library webhook a quote is sent to, and the ones that can be chosen. Absent without the library. */
  webhookId?: string | null;
  webhooks?: WebhookChoice[];
};
export type DocumentsView = { documents: DocumentView[] };
/** A quote goes only when it is awarded and a rejected one never leaves (round 2): there is no "when" and no "mode" to save. */
export type DocumentPatch = {
  enabled?: boolean;
  target?: string;
  include?: Record<string, boolean>;
  /** null clears it. */
  fallbackPriceListId?: string | null;
  /** With target "webhook": the library webhook to send to. */
  webhookId?: string | null;
};

type RawDoc = Partial<DocumentView> & { confirmed_at?: string | null; webhook_id?: string | null };
const bool = (v: unknown, d = false) => (typeof v === "boolean" ? v : d);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** One document as the screens use it: every optional part given a safe default. */
export function normalizeDocument(raw: RawDoc, fallbackConfirmed: string | null = null, webhooks: WebhookChoice[] = []): DocumentView {
  const target = raw.target && typeof raw.target === "object" ? raw.target : { key: "", label: "" };
  return {
    key: String(raw.key ?? "quote"),
    label: String(raw.label ?? "Quote"),
    source: String(raw.source ?? ""),
    enabled: bool(raw.enabled),
    summary: String(raw.summary ?? ""),
    target: { key: String(target.key ?? ""), label: String(target.label ?? "") },
    targets: Array.isArray(raw.targets) ? raw.targets.map((t) => ({ key: String(t.key), label: String(t.label ?? t.key), available: bool(t.available, true), hint: str(t.hint) })) : [],
    include: Array.isArray(raw.include) ? raw.include.map((i) => ({ key: String(i.key), label: String(i.label ?? i.key), on: bool(i.on), allowed: bool(i.allowed, true), hint: str(i.hint) })) : [],
    fallbackPriceListId: str(raw.fallbackPriceListId),
    showFallbackPriceList: typeof raw.showFallbackPriceList === "boolean" ? raw.showFallbackPriceList : null,
    confirmedAt: str(raw.confirmed_at ?? raw.confirmedAt) ?? fallbackConfirmed,
    webhookId: str(raw.webhook_id ?? raw.webhookId),
    webhooks: Array.isArray(raw.webhooks) ? normalizeWebhookChoices(raw.webhooks) : webhooks,
  };
}

function normalizeWebhookChoices(v: unknown): WebhookChoice[] {
  return Array.isArray(v) ? v.flatMap((w) => { const o = w as { id?: unknown; name?: unknown }; return typeof o?.id === "string" ? [{ id: o.id, name: String(o.name ?? o.id) }] : []; }) : [];
}

export async function getDocuments(): Promise<DocumentsView> {
  const r = await get<{ documents?: RawDoc[]; confirmed_at?: string | null; webhooks?: unknown }>("/api/middleware/documents");
  const webhooks = normalizeWebhookChoices(r.webhooks);
  return { documents: (r.documents ?? []).map((d) => normalizeDocument(d, str(r.confirmed_at), webhooks)) };
}
export async function saveDocument(key: string, patch: DocumentPatch): Promise<DocumentView> {
  const { webhookId, ...rest } = patch;
  const body = webhookId === undefined ? rest : { ...rest, webhook_id: webhookId };
  const r = await put<RawDoc | { document: RawDoc }>(`/api/middleware/documents/${encodeURIComponent(key)}`, body);
  return normalizeDocument("document" in r && r.document ? (r.document as RawDoc) : (r as RawDoc));
}

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
  /** What the line is about in words: the document ("Quote") or the entity ("Customers"). */
  what: string | null;
  /** The ERP's own readable number (never a GUID). */
  erpNumber: string | null;
  /** A line that can be restarted shows a tick box. */
  restartable: boolean;
  /** The one thing to do, in plain words; null when there is nothing to do. */
  fix: string | null;
  /** The request and response were kept for this line. */
  hasPayload: boolean;
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
  /** A document (quote) or an inbound entity (customers, contacts, products, projects). */
  document?: string;
  q?: string;
};

/** The server sends a label under `label`, `document` or `entity` depending on the source; the screens only know `what`. */
export function normalizeMessage(raw: Partial<MonitorMessage> & Record<string, unknown>): MonitorMessage {
  const pick = (...vals: unknown[]) => vals.find((v): v is string => typeof v === "string" && v.length > 0) ?? null;
  return {
    id: String(raw.id), source: String(raw.source ?? ""), at: String(raw.at ?? ""),
    direction: raw.direction === "in" ? "in" : "out",
    channel: (MESSAGE_CHANNELS as readonly string[]).includes(raw.channel as string) ? (raw.channel as MessageChannel) : "connector",
    counterpart: pick(raw.counterpart), summary: String(raw.summary ?? ""),
    status: (MONITOR_STATUSES as readonly string[]).includes(raw.status as string) ? (raw.status as MonitorStatus) : "ok",
    record: (raw.record as MonitorMessage["record"]) ?? null,
    duration_ms: typeof raw.duration_ms === "number" ? raw.duration_ms : null,
    what: pick(raw.what, raw.label, raw.document, raw.entity),
    erpNumber: pick(raw.erpNumber, raw.erp_number),
    restartable: raw.restartable === true,
    fix: pick(raw.fix),
    hasPayload: raw.hasPayload === true || raw.has_payload === true,
  };
}

export type MessagePage = {
  items: MonitorMessage[];
  nextCursor: string | null;
  needsDatabaseUpdate: boolean;
  bundle: string | null;
  missingSources: string[];
  failedSources: string[];
};

export async function getMessages(query: string): Promise<MessagePage> {
  const r = await get<MessagePage>(`/api/middleware/messages${query ? `?${query}` : ""}`);
  return { ...r, items: (r.items ?? []).map((m) => normalizeMessage(m as never)) };
}

/** The request and the answer kept for one line (spec section 8). Read only when the person opens it. */
export type PayloadView = {
  request: { method: string; url: string; body: unknown } | null;
  response: { status: number | null; body: unknown; durationMs: number | null } | null;
  truncated: boolean;
};
export type MessageDetail = { message: MonitorMessage; detail: Record<string, unknown>; payload: PayloadView | null };
export async function getMessage(id: string): Promise<MessageDetail | NeedsUpdate> {
  const r = await get<(Omit<MessageDetail, "payload"> & { payload?: PayloadView | null }) | NeedsUpdate>(`/api/middleware/messages/${encodeURIComponent(id)}`);
  if (needsUpdate(r)) return r;
  const d = r as Omit<MessageDetail, "payload"> & { payload?: PayloadView | null };
  return { ...d, message: normalizeMessage(d.message as never), payload: d.payload ?? null };
}

export type RestartOutcome = "done" | "failed" | "already_ok" | "not_restartable";
export type RestartResult = { id: string; outcome: RestartOutcome; message: string };
/** Restart ticked lines, or every line the filter shows (capped by the server). Safe to repeat. */
export async function restartMessages(target: { messageIds: string[] } | { filter: Record<string, string>; limit?: number }): Promise<RestartResult[]> {
  const body = "messageIds" in target ? { message_ids: target.messageIds } : { filter: target.filter, ...(target.limit ? { limit: target.limit } : {}) };
  const r = await post<{ results?: RestartResult[] }>("/api/middleware/restart", body);
  return (r.results ?? []).map((x) => ({ id: String(x.id), outcome: x.outcome, message: String(x.message ?? "") }));
}

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
export const saveConnection = (connectorId: string, config: Partial<Omit<ConnectionConfig, "outbound">> & { outbound?: OutboundMaps | null }, secrets: Secrets = {}) =>
  put<ConnectionState>(`/api/middleware/connections/${connectorId}`, { config, secrets });
/** SAP S/4HANA: the login type, the host and user (a Communication user) or nothing more (the sandbox API key). Secrets are write-only. */
export type SapConnectionInput = { auth_mode: SapAuthMode; api_host?: string; username?: string };
export const saveSapConnection = (config: SapConnectionInput, secrets: Partial<Record<"password" | "api_key", string>> = {}) =>
  put<SapPublicState>("/api/middleware/connections/sap_s4", { config, secrets });
/** Test = the connection AND the permission probes, as ONE answer: one line, and only what failed for the details toggle.
 *  A refused connection comes back as 400 with the same body; it is an answer to show, not an exception. */
export type TestView = { ok: boolean; line: string; failures: { label: string; fix: string | null }[]; message?: string; error?: string };
export async function testConnection(connectorId: string): Promise<TestView> {
  const r = await request<Partial<TestView>>("POST", `/api/middleware/connections/${connectorId}/test`, {}, { keep4xx: true });
  const failures = Array.isArray(r.failures) ? r.failures.map((f) => ({ label: String(f.label ?? ""), fix: str(f.fix) })) : [];
  const ok = r.ok === true || (r.ok === undefined && !r.error);
  return { ok, line: str(r.line) ?? str(r.message) ?? str(r.error) ?? (ok ? "The connection works." : "Could not connect."), failures, message: str(r.message) ?? undefined, error: str(r.error) ?? undefined };
}
export const disconnect = (connectorId: string) => del<unknown>(`/api/middleware/connections/${connectorId}`);
/** "Sign in as a user" still starts at the connector's own route, which comes back to the connector screen's callback. */
export const oauthStartUrl = (connectorId: string) => `/api/connectors/${connectorId}/oauth/start`;

/** Only what needs attention: an empty `problems` means nothing to show. `secretSoon` only within 30 days of the secret ending. */
export type HealthProblem = { kind: "database" | "connection" | "secret"; message: string; bundle: string | null };
export type HealthView = {
  problems: HealthProblem[];
  secretSoon: { days: number } | null;
  connection: { connected: boolean; product: { key: string; name: string } | null };
};
type RawHealth = {
  problems?: HealthProblem[];
  secretSoon?: { days: number } | null;
  connection?: Partial<HealthView["connection"]> & { state?: string; last_error?: string | null };
  /** The older answer listed every table and the secret's state; it is folded into `problems` here. */
  schema?: { label: string; exists: boolean; bundle: string | null }[];
  secret?: { state: string; days_left: number | null };
};
export function normalizeHealth(raw: RawHealth): HealthView {
  const problems: HealthProblem[] = Array.isArray(raw.problems)
    ? raw.problems.map((p) => ({ kind: p.kind, message: String(p.message ?? ""), bundle: str(p.bundle) }))
    : [];
  if (!Array.isArray(raw.problems)) {
    const missing = (raw.schema ?? []).filter((r) => !r.exists);
    for (const bundle of [...new Set(missing.map((r) => r.bundle))]) problems.push({ kind: "database", message: `A database update is needed (${missing.filter((r) => r.bundle === bundle).map((r) => r.label).join(", ")}).`, bundle });
    if (raw.connection?.state === "error") problems.push({ kind: "connection", message: raw.connection.last_error || "The connection needs attention. Press Test.", bundle: null });
    if (raw.secret?.state === "expired") problems.push({ kind: "secret", message: "The Dynamics client secret has expired. Create a new one and save it under Edit.", bundle: null });
  }
  const soon = raw.secretSoon && typeof raw.secretSoon.days === "number" ? { days: raw.secretSoon.days }
    : raw.secret?.state === "soon" && typeof raw.secret.days_left === "number" ? { days: raw.secret.days_left } : null;
  const c = raw.connection ?? {};
  return { problems, secretSoon: soon, connection: { connected: c.connected === true || c.state === "connected", product: c.product ?? null } };
}
export const getHealth = async () => normalizeHealth(await get<RawHealth>("/api/middleware/health"));

export type PickItem = { id: string; name: string; code: string | null };
export type PickList = { applicable: boolean; items: PickItem[]; hint?: string };
export const getPriceLists = () => get<PickList>("/api/middleware/pricelists");
export const getCurrencies = () => get<PickList>("/api/middleware/currencies");

export type PermissionCheck = { id: string; label: string; ok: boolean | null; fix: string | null };
export const checkPermissions = () => post<{ checks: PermissionCheck[] }>("/api/middleware/check-permissions");

// ── Mapping ─────────────────────────────────────────────────────────────────

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

// ── Mapping: the engine (docs/design/mapping-engine.md) ────────────────────

export const MAP_DOCUMENTS = ["quote", "customers", "contacts", "vendors", "products", "projects"] as const;
export type MapDocumentKey = (typeof MAP_DOCUMENTS)[number];
export type MapSide = { label: string; name: string };
/** The older per-field row the server still sends (the preset lane); the screen works from `engine.rows`. */
export type MapRowView = { id: string; bpm: MapSide; erp: MapSide | null; standard: boolean; composite: string | null };
export type MapSection = { key: string; label: string; rows: MapRowView[] };
export type MapRowEdit = { id: string; erp: string | null };

export type EngineRow = MapRowT;
export type EngineData = EngineMappingExtras;
export type EngineRows = { header: MapRowT[]; lines: MapRowT[] };

export type MappingDocView = {
  connected: boolean;
  document: { key: string; label: string; targetLabel: string };
  sections: MapSection[];
  erpFields: Record<string, MapSide[]>;
  usingStandard: boolean;
  missingRequired: string[];
  /** Null when the server does not send the engine's part. */
  engine: EngineData | null;
  /** Set while the database update (bundle 12) has not been run: one plain notice, never a crash. */
  pending: { bundle: string | null } | null;
};

/** The 200 answer a mapping route gives while the database update is pending. */
export const pendingBundle = (x: unknown): { bundle: string | null } | null =>
  x && typeof x === "object" && (x as Json).needsDatabaseUpdate === true ? { bundle: typeof (x as Json).bundle === "string" ? ((x as Json).bundle as string) : null } : null;

export const pendingWords = (bundle: string | null): string =>
  bundle ? `A database update is needed first: run ${bundle} once.` : "A database update is needed first.";

export class PendingProblem extends ApiProblem {
  constructor(readonly bundle: string | null) {
    super(pendingWords(bundle), 200);
  }
}
/** Every call below throws this instead of returning a half answer while the update is pending. */
function settled<T>(x: T): T {
  const p = pendingBundle(x);
  if (p) throw new PendingProblem(p.bundle);
  return x;
}

const side = (v: unknown): MapSide | null =>
  v && typeof v === "object" && "name" in v ? { label: String((v as MapSide).label ?? (v as MapSide).name), name: String((v as MapSide).name) } : null;

type RawSection = { key?: unknown; label?: unknown; rows?: { id?: unknown; bpm?: unknown; erp?: unknown; standard?: unknown; composite?: unknown }[] };

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function normalizeEngine(raw: Record<string, unknown>): EngineData | null {
  const rows = raw.rows as { header?: unknown; lines?: unknown } | undefined;
  if (!rows || typeof rows !== "object" || Array.isArray(rows) || !raw.engine || !raw.target) return null;
  const eng = raw.engine as Json;
  const tgt = raw.target as Json;
  const schema = (tgt.schema && typeof tgt.schema === "object" ? tgt.schema : {}) as Json;
  const counts = (schema.counts && typeof schema.counts === "object" ? schema.counts : {}) as Json;
  const sf = (raw.sourceFields ?? {}) as Json;
  const tf = (raw.targetFields ?? {}) as Json;
  return {
    engine: {
      active: eng.active === true, version: typeof eng.version === "number" ? eng.version : null,
      versions: arr(eng.versions), usingStandard: eng.usingStandard === true,
    },
    target: {
      kind: (tgt.kind as EngineData["target"]["kind"]) ?? "adapter", entity: String(tgt.entity ?? ""), linesPath: typeof tgt.linesPath === "string" ? tgt.linesPath : null,
      schema: {
        fetchedAt: typeof schema.fetchedAt === "string" ? schema.fetchedAt : null, sourceUrl: typeof schema.sourceUrl === "string" ? schema.sourceUrl : null,
        counts: { total: Number(counts.total ?? 0), new: Number(counts.new ?? 0), missing: Number(counts.missing ?? 0) },
      },
    },
    sourceFields: { header: arr(sf.header), lines: arr(sf.lines) },
    targetFields: { header: arr(tf.header), lines: arr(tf.lines) },
    rows: { header: arr(rows.header), lines: arr(rows.lines) },
    missingRequired: arr<unknown>(raw.missingRequired).map(String),
    lists: arr(raw.lists),
    ai: { available: (raw.ai as Json | undefined)?.available === true },
  };
}

export function normalizeMappingDoc(raw: Record<string, unknown>): MappingDocView {
  const sections = arr<RawSection>(raw.sections);
  const fields = (raw.erpFields && typeof raw.erpFields === "object" ? raw.erpFields : {}) as Record<string, unknown[]>;
  const doc = (raw.document && typeof raw.document === "object" ? raw.document : {}) as Record<string, unknown>;
  return {
    connected: raw.connected !== false,
    document: { key: String(doc.key ?? ""), label: String(doc.label ?? ""), targetLabel: String(doc.targetLabel ?? "") },
    sections: sections.map((sec) => ({
      key: String(sec.key), label: String(sec.label ?? sec.key),
      rows: (sec.rows ?? []).map((r) => ({
        id: String(r.id), bpm: side(r.bpm) ?? { label: String(r.id), name: String(r.id) }, erp: side(r.erp),
        standard: r.standard === true, composite: typeof r.composite === "string" && r.composite ? r.composite : null,
      })),
    })),
    erpFields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, (Array.isArray(v) ? v : []).map(side).filter((x): x is MapSide => !!x)])),
    usingStandard: raw.usingStandard === true,
    missingRequired: Array.isArray(raw.missingRequired) ? raw.missingRequired.map(String) : [],
    engine: normalizeEngine(raw),
    pending: pendingBundle(raw),
  };
}

const q = (connection: string | undefined) => (connection ? `&connection=${encodeURIComponent(connection)}` : "");

export async function getMappingDoc(document: MapDocumentKey, connection?: string): Promise<MappingDocView> {
  return normalizeMappingDoc(await get<Record<string, unknown>>(`/api/middleware/mapping?document=${encodeURIComponent(document)}${q(connection)}`));
}
/** The older per-section save: plain field changes keep working while the database update is pending. */
export const saveMappingRows = (document: MapDocumentKey, section: string, rows: MapRowEdit[]) =>
  put<unknown>("/api/middleware/mapping", { document, section, rows });
export async function saveEngineRows(connection: string, document: MapDocumentKey, rows: EngineRows, target?: { entity?: string; linesPath?: string | null }): Promise<MappingDocView> {
  const r = settled(await put<Record<string, unknown>>("/api/middleware/mapping", { connection, document, rows, ...(target ? { target } : {}) }));
  return normalizeMappingDoc(r);
}
export async function resetMapping(document: MapDocumentKey, connection?: string): Promise<void> {
  await post<unknown>("/api/middleware/mapping/reset", { document, ...(connection ? { connection } : {}) });
}

export type SchemaSource = "adapter" | "openapi" | "odata" | "sample" | "manual";
export type ManualField = { path: string; type: string; required?: boolean; block?: "lines" };
export type SchemaRequest = {
  source: SchemaSource; url?: string; sample?: string; fields?: ManualField[];
  linesPath?: string; sendWebhookHeaders?: boolean; operation?: { method: string; path: string };
};
export type SchemaOperation = { method: string; path: string; summary: string };
export type SchemaResult = {
  needsOperation: boolean; message: string | null; operations: SchemaOperation[];
  target: EngineData["target"] | null; targetFields: EngineData["targetFields"]; counts: { total: number; new: number; missing: number };
};
export async function fetchSchema(connection: string, document: MapDocumentKey, req: SchemaRequest): Promise<SchemaResult> {
  const r = settled(await post<Record<string, unknown>>("/api/middleware/mapping/schema", { connection, document, ...req }));
  const tf = (r.targetFields ?? {}) as Json;
  const c = (r.counts ?? {}) as Json;
  return {
    needsOperation: r.needsOperation === true, message: typeof r.message === "string" ? r.message : null, operations: arr(r.operations),
    target: (r.target as SchemaResult["target"]) ?? null, targetFields: { header: arr(tf.header), lines: arr(tf.lines) },
    counts: { total: Number(c.total ?? 0), new: Number(c.new ?? 0), missing: Number(c.missing ?? 0) },
  };
}

export type ProposedList = { kind: string; label: string; rows: ValueListRow[]; default_in: string | null; proposed?: true };
export type ProposeResult = { rows: EngineRows; lists: ProposedList[]; missingRequired: string[] };
export async function proposeRows(connection: string, document: MapDocumentKey, mode: "fill" | "replace"): Promise<ProposeResult> {
  const r = settled(await post<Record<string, unknown>>("/api/middleware/mapping/propose", { connection, document, mode }));
  const rows = (r.rows ?? {}) as Json;
  return { rows: { header: arr(rows.header), lines: arr(rows.lines) }, lists: arr(r.lists), missingRequired: arr<unknown>(r.missingRequired).map(String) };
}

export type AiSuggestion = { source: string; target: string; reason: string; convert: Converter | null; block: "header" | "lines" };
export async function proposeAi(connection: string, document: MapDocumentKey): Promise<{ suggestions: AiSuggestion[]; usage: { percent: number; off: boolean } | null }> {
  const r = settled(await post<Record<string, unknown>>("/api/middleware/mapping/propose-ai", { connection, document }));
  const u = r.usage as { percent?: unknown; off?: unknown } | undefined;
  return { suggestions: arr(r.suggestions), usage: u ? { percent: Number(u.percent ?? 0), off: u.off === true } : null };
}

export async function tryMapping(connection: string, document: MapDocumentKey, recordId?: string): Promise<TryResult> {
  const r = settled(await post<Record<string, unknown>>("/api/middleware/mapping/try", { connection, document, ...(recordId ? { record_id: recordId } : {}) }));
  const req = (r.request ?? {}) as Json;
  return {
    words: arr<unknown>(r.words).map(String),
    request: { method: String(req.method ?? ""), url: String(req.url ?? ""), headers: arr<unknown>(req.headers).map(String), body: req.body ?? null },
    problems: arr(r.problems),
  };
}

// ── Value lists ─────────────────────────────────────────────────────────────

export type ValueListView = {
  kind: string; label: string; rows: ValueListRow[]; default_in: string | null;
  counts: { rows: number; unused: number; unmapped: number };
  unmapped: { out: string[]; in: string[] };
};
export type ValueListsView = { lists: ValueListView[]; standardKinds: { kind: string; label: string; created: boolean }[]; pending: { bundle: string | null } | null };

export async function getValueLists(connection: string): Promise<ValueListsView> {
  const r = await get<Record<string, unknown>>(`/api/middleware/value-lists?connection=${encodeURIComponent(connection)}`);
  return { lists: arr(r.lists), standardKinds: arr(r.standardKinds), pending: pendingBundle(r) };
}
export async function saveValueList(connection: string, kind: string, body: { label?: string; rows: ValueListRow[]; default_in: string | null }): Promise<ValueListView> {
  return settled(await put<ValueListView>(`/api/middleware/value-lists/${encodeURIComponent(kind)}?connection=${encodeURIComponent(connection)}`, body));
}
export async function deleteValueList(connection: string, kind: string): Promise<void> {
  settled(await del<unknown>(`/api/middleware/value-lists/${encodeURIComponent(kind)}?connection=${encodeURIComponent(connection)}`));
}
export async function proposeValueLists(connection: string, kind?: string): Promise<ProposedList[]> {
  const r = settled(await post<Record<string, unknown>>(`/api/middleware/value-lists/propose?connection=${encodeURIComponent(connection)}`, kind ? { kind } : {}));
  return arr(r.lists);
}
export const valueListCsvUrl = (connection: string, kind: string) =>
  `/api/middleware/value-lists/${encodeURIComponent(kind)}/csv?connection=${encodeURIComponent(connection)}`;
export type CsvPreview = { added: number; changed: number; removed: number };
/** Without `confirm` the file is only compared; with it the list is replaced. */
export async function importValueListCsv(connection: string, kind: string, file: File, confirm: boolean): Promise<{ preview: CsvPreview; rows: number; applied: boolean }> {
  const form = new FormData();
  form.set("file", file);
  let res: Response;
  try {
    res = await fetch(`${valueListCsvUrl(connection, kind)}${confirm ? "&confirm=1" : ""}`, { method: "POST", body: form });
  } catch {
    throw new ApiProblem("Could not reach the server. Check your connection and try again.", 0);
  }
  let json: Json | null = null;
  try { json = (await res.json()) as Json; } catch { json = null; }
  if (!res.ok || !json) throw new ApiProblem(typeof json?.error === "string" ? json.error : `Request failed (${res.status})`, res.status);
  settled(json);
  const p = (json.preview ?? {}) as Json;
  return { preview: { added: Number(p.added ?? 0), changed: Number(p.changed ?? 0), removed: Number(p.removed ?? 0) }, rows: Number(json.rows ?? 0), applied: json.applied === true };
}

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
  /** Whether single records can be read by number for this entity (absent from an older server). */
  filters?: { numbers: boolean };
  /** The saved scope in one line, and whether it narrows anything or was changed since the last full resync. Null for the push. */
  scope?: { summary: string; narrowed: boolean; needs_full: boolean } | null;
  last_run: { status: string; trigger: string; started_at: string; finished_at: string | null; counts: Record<string, number> | null; error: string | null } | null;
};
export type SyncOverview =
  | { connected: false; entities: [] }
  | { connected: true; product: { key: string; name: string }; pending_migration: boolean; entities: SyncEntity[] };

export const getSync = () => get<SyncOverview>("/api/middleware/sync");
export type SyncRunResult = { runId?: string; counts?: Record<string, number>; issues?: string[]; error?: string | null; unsupported?: string[] };
export type RunSelection = { ids: string[] };
/** A run that reads only the listed records. It ignores the scope and never moves the incremental position. */
export const runSelected = (entity: D365EntityKey, selection: RunSelection) =>
  post<SyncRunResult>("/api/middleware/resync", { entity, full: true, ...selection });

// ── Scope ───────────────────────────────────────────────────────────────────

export type ScopeViewData = {
  entity: ScopeEntityKey; label: string; conditions: ScopeCondition[]; summary: string; needs_full: boolean;
  attributes: ScopeAttribute[]; source: "system" | "presets";
};
export type ScopeValuesData = { kind: ScopeAttribute["kind"]; typed: boolean; values: { value: string; label: string }[]; more: boolean };
export type ScopeSave = { attribute: string; values: string[]; labels?: string[]; via?: "customer" }[];

export const getScope = (entity: ScopeEntityKey) => get<ScopeViewData>(`/api/middleware/scope?entity=${encodeURIComponent(entity)}`);
export const getScopeValues = (entity: ScopeEntityKey, attribute: string, q = "") =>
  get<ScopeValuesData>(`/api/middleware/scope/values?entity=${encodeURIComponent(entity)}&attribute=${encodeURIComponent(attribute)}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
export const saveScope = (entity: ScopeEntityKey, conditions: ScopeSave) => put<ScopeViewData>("/api/middleware/scope", { entity, conditions });
/** A refused run (one is already running, the ERP said no) comes back as an ApiProblem carrying the server's message. */
export const runSync = (entity: D365EntityKey, full = false, ids?: string[]) =>
  post<SyncRunResult>("/api/middleware/resync", { entity, full, ...(ids && ids.length ? { ids } : {}) });
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
