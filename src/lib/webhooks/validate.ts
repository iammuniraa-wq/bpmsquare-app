import { isCallObject, CALL_OBJECTS, type CallObject } from "./tokens";
import { validateTemplate, validateUrlTemplate, type FieldError } from "./render";

// Input rules and the outward shape of a webhook definition. Pure, so the same
// rules are tested without a database. Nothing here ever returns a secret: a
// header value or the signing secret reads back as "set".

export const WEBHOOK_KINDS = ["event", "call"] as const;
export type WebhookKind = (typeof WEBHOOK_KINDS)[number];
export const METHODS = ["GET", "POST", "PUT", "PATCH"] as const;
export type Method = (typeof METHODS)[number];
export const PAYLOAD_MODES = ["standard", "template", "mapping"] as const;
export type PayloadMode = (typeof PAYLOAD_MODES)[number];

/** Consecutive failures after which a webhook pauses itself (the dispatcher's existing threshold). */
export const AUTO_PAUSE_AFTER = 15;
export const MAX_HEADERS = 10;
export const MAX_HEADER_VALUE = 1024;
export const TIMEOUT_MIN_MS = 5000;
export const TIMEOUT_MAX_MS = 30000;
export const TIMEOUT_DEFAULT_MS = 15000;

/** Object types an Event webhook may subscribe to (the change feed's own list). */
export const SUBSCRIBABLE_OBJECTS = [
  "accounts", "contacts", "assets", "suppliers", "quotes", "cases",
  "work_orders", "invoices", "purchase_orders", "inventory",
];

/** One stored header: the value is sealed (enc:v1:...). */
export type StoredHeader = { name: string; value: string };

/** The columns of a webhooks row the library reads. */
export type WebhookRow = {
  id: string;
  tenant_id: string;
  kind: WebhookKind;
  name: string;
  url: string;
  secret: string;
  method: Method;
  object_type: string | null;
  object_types: string[] | null;
  headers: StoredHeader[] | null;
  payload_mode: PayloadMode;
  template: string | null;
  allow_personal_data: boolean;
  timeout_ms: number;
  active: boolean;
  paused_reason: string | null;
  last_delivery_at: string | null;
  last_status: number | null;
  last_error: string | null;
  failure_count: number;
  legacy_key: string | null;
  created_at: string;
  updated_at: string | null;
  /** Read separately from WEBHOOK_COLUMNS (migration 0203): absent until the database update has run. */
  mapping_id?: string | null;
  response_key_path?: string | null;
};

export const WEBHOOK_COLUMNS =
  "id, tenant_id, kind, name, url, secret, method, object_type, object_types, headers, payload_mode, template, allow_personal_data, timeout_ms, active, paused_reason, last_delivery_at, last_status, last_error, failure_count, legacy_key, created_at, updated_at";

export type UsedBy = { kind: "link" | "coverage" | "button"; label: string };

export type ApiWebhook = {
  id: string; kind: WebhookKind; name: string; url: string; method: Method; object_type: string | null; object_types: string[];
  headers: { name: string; set: true }[]; payload_mode: PayloadMode; template: string | null; allow_personal_data: boolean; timeout_ms: number;
  active: boolean; paused_reason: string | null; secret: "set"; last_delivery_at: string | null; last_status: number | null; last_error: string | null;
  failure_count: number; needs_attention: string | null; used_by: UsedBy[]; created_at: string; updated_at: string | null;
  /** The mapping that builds the body in payload mode "mapping" (Integration middleware > Mapping), and where the readable id sits in the response. */
  mapping_id: string | null; response_key_path: string | null;
};

/** Why a webhook will not fire as it stands, in the words the list shows; null = fine. A migrated http:// address
 *  is kept but refuses to fire until it is edited to https. */
export function needsAttention(row: Pick<WebhookRow, "url">): string | null {
  return /^https:\/\//i.test(row.url.trim()) ? null : "Needs https. Edit the address to start with https://.";
}

export function toApiWebhook(row: WebhookRow, usedBy: UsedBy[] = []): ApiWebhook {
  return {
    id: row.id, kind: row.kind ?? "event", name: row.name, url: row.url, method: row.method ?? "POST",
    object_type: row.object_type ?? null, object_types: Array.isArray(row.object_types) ? row.object_types : ["*"],
    headers: (Array.isArray(row.headers) ? row.headers : []).map((h) => ({ name: h.name, set: true as const })),
    payload_mode: row.payload_mode ?? "standard", template: row.template ?? null, allow_personal_data: row.allow_personal_data === true,
    timeout_ms: row.timeout_ms ?? TIMEOUT_DEFAULT_MS, active: row.active === true, paused_reason: row.paused_reason ?? null,
    secret: "set", last_delivery_at: row.last_delivery_at ?? null, last_status: row.last_status ?? null, last_error: row.last_error ?? null,
    failure_count: row.failure_count ?? 0, needs_attention: needsAttention(row), used_by: usedBy, created_at: row.created_at, updated_at: row.updated_at ?? null,
    mapping_id: row.mapping_id ?? null, response_key_path: row.response_key_path ?? null,
  };
}

// ── headers ──────────────────────────────────────────────────────────────────

const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;
const FORBIDDEN_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection", "upgrade", "te", "trailer", "proxy-authorization"]);

export type HeaderInput = { name: string; value: string | null };

/** The headers a person typed: names checked, values only checked for shape. A value of "" means "keep the stored one". */
export function parseHeaderInput(raw: unknown): Validated<HeaderInput[]> {
  if (!Array.isArray(raw)) return fail("headers", "Send the headers as a list.");
  if (raw.length > MAX_HEADERS) return fail("headers", `Use at most ${MAX_HEADERS} headers.`);
  const out: HeaderInput[] = [];
  const seen = new Set<string>();
  for (const h of raw) {
    const name = typeof (h as { name?: unknown })?.name === "string" ? (h as { name: string }).name.trim() : "";
    const value = (h as { value?: unknown })?.value;
    if (!HEADER_NAME_RE.test(name)) return fail("headers", `"${name.slice(0, 40)}" is not a valid header name (letters, digits and dashes).`);
    const lower = name.toLowerCase();
    if (FORBIDDEN_HEADERS.has(lower) || lower.startsWith("x-bpmsquare-")) return fail("headers", `${name} is set by BPMSquare and cannot be changed.`);
    if (seen.has(lower)) return fail("headers", `${name} appears twice.`);
    seen.add(lower);
    if (value !== undefined && value !== null && typeof value !== "string") return fail("headers", `${name}: the value must be text.`);
    const v = typeof value === "string" ? value : "";
    if (v.length > MAX_HEADER_VALUE) return fail("headers", `${name}: the value is longer than ${MAX_HEADER_VALUE} characters.`);
    if (/[\r\n\0]/.test(v)) return fail("headers", `${name}: the value cannot contain a line break.`);
    out.push({ name, value: v === "" ? null : v });
  }
  return { ok: true, value: out };
}

type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };
const fail = (field: string, message: string): { ok: false; errors: FieldError[] } => ({ ok: false, errors: [{ field, message }] });

// ── the whole definition ─────────────────────────────────────────────────────

/** What a validated create or update carries. `headers` is the typed list (value null = keep); the library seals and merges it. */
export type DefinitionPatch = {
  kind?: WebhookKind;
  name?: string;
  url?: string;
  method?: Method;
  object_type?: CallObject | null;
  object_types?: string[];
  headers?: HeaderInput[];
  payload_mode?: PayloadMode;
  template?: string | null;
  allow_personal_data?: boolean;
  timeout_ms?: number;
  active?: boolean;
  regenerate_secret?: boolean;
  button_on?: "accounts" | null;
  /** Verified against the tenant by the library before it is stored. */
  mapping_id?: string | null;
  response_key_path?: string | null;
};

/** `$.data.number`, `$.items[0].id`: a literal path of names and numbers, never an expression. */
export const RESPONSE_PATH_RE = /^\$(?:\.[A-Za-z_][A-Za-z0-9_]{0,40}|\[\d{1,3}\]){1,10}$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const KNOWN = ["kind", "name", "url", "method", "object_type", "object_types", "headers", "payload_mode", "template", "allow_personal_data", "timeout_ms", "active", "regenerate_secret", "button_on", "mapping_id", "response_key_path"];

/**
 * Check a submitted definition against the rules of the spec. `existing` is the stored row on an update (kind and
 * object fixed after create; the template and address are judged with the stored values where the patch is silent).
 * The address host is checked by the caller (it needs DNS); everything else is decided here.
 */
export function validateDefinition(raw: unknown, mode: "create" | "update", existing?: WebhookRow): Validated<DefinitionPatch> {
  if (!isObj(raw)) return fail("body", "Send the webhook as an object.");
  const errors: FieldError[] = [];
  const out: DefinitionPatch = {};
  for (const k of Object.keys(raw)) if (!KNOWN.includes(k)) errors.push({ field: k, message: "Unknown setting." });

  const kind: WebhookKind | undefined = mode === "update" ? existing?.kind : (raw.kind as WebhookKind);
  if (mode === "create") {
    if (!(WEBHOOK_KINDS as readonly unknown[]).includes(raw.kind)) errors.push({ field: "kind", message: "Choose Event or Call." });
    else out.kind = raw.kind as WebhookKind;
  } else if (raw.kind !== undefined && raw.kind !== existing?.kind) errors.push({ field: "kind", message: "The kind cannot be changed after the webhook is created." });

  if (raw.name !== undefined || mode === "create") {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name || name.length > 80) errors.push({ field: "name", message: "Give it a name of 1 to 80 characters." });
    else out.name = name;
  }

  // The object: a Call webhook accepts one object; its token list depends on it, so it is fixed after create.
  let objectType: CallObject | null = null;
  if (kind === "call") {
    if (mode === "create") {
      if (!isCallObject(raw.object_type)) errors.push({ field: "object_type", message: `Choose what it sends: ${CALL_OBJECTS.map((o) => o.label).join(" or ")}.` });
      else { objectType = raw.object_type; out.object_type = objectType; }
    } else {
      objectType = isCallObject(existing?.object_type) ? existing!.object_type as CallObject : null;
      if (raw.object_type !== undefined && raw.object_type !== existing?.object_type) errors.push({ field: "object_type", message: "The object cannot be changed after the webhook is created." });
    }
  } else if (kind === "event") {
    if (raw.object_type !== undefined && raw.object_type !== null) errors.push({ field: "object_type", message: "An Event webhook has no single object." });
    if (raw.object_types !== undefined || mode === "create") {
      const list = raw.object_types === undefined ? ["*"] : raw.object_types;
      if (!Array.isArray(list)) errors.push({ field: "object_types", message: "Choose the objects as a list." });
      else {
        const names = list.filter((o): o is string => typeof o === "string");
        if (names.includes("*") || names.length === 0) out.object_types = ["*"];
        else {
          const bad = names.filter((o) => !SUBSCRIBABLE_OBJECTS.includes(o));
          if (bad.length) errors.push({ field: "object_types", message: `Unknown object(s): ${bad.join(", ")}.` });
          else out.object_types = names;
        }
      }
    }
  }

  const allowPii = raw.allow_personal_data !== undefined ? raw.allow_personal_data === true : existing?.allow_personal_data === true;
  if (raw.allow_personal_data !== undefined) {
    if (typeof raw.allow_personal_data !== "boolean") errors.push({ field: "allow_personal_data", message: "On or off." });
    else if (kind === "event") errors.push({ field: "allow_personal_data", message: "An Event webhook sends the change feed; this setting is for Call webhooks." });
    else out.allow_personal_data = raw.allow_personal_data;
  }

  // The address: https only, tokens in the path or query only, no personal data in it.
  if (raw.url !== undefined || mode === "create") {
    const v = typeof raw.url === "string" ? validateUrlTemplate(raw.url, kind === "call" ? objectType : null) : fail("url", "The address is required.");
    if (!v.ok) errors.push(...v.errors);
    else out.url = (raw.url as string).trim();
  }

  if (raw.method !== undefined) {
    if (!(METHODS as readonly unknown[]).includes(raw.method)) errors.push({ field: "method", message: `Use one of ${METHODS.join(", ")}.` });
    else if (kind === "event" && raw.method !== "POST") errors.push({ field: "method", message: "An Event webhook always uses POST." });
    else out.method = raw.method as Method;
  }

  if (raw.timeout_ms !== undefined) {
    const n = raw.timeout_ms;
    if (typeof n !== "number" || !Number.isInteger(n) || n < TIMEOUT_MIN_MS || n > TIMEOUT_MAX_MS) errors.push({ field: "timeout_ms", message: "The timeout is 5 to 30 seconds." });
    else out.timeout_ms = n;
  }

  if (raw.headers !== undefined) {
    if (kind === "event") errors.push({ field: "headers", message: "An Event webhook sends the change feed with the standard signed headers only." });
    else {
      const h = parseHeaderInput(raw.headers);
      if (!h.ok) errors.push(...h.errors); else out.headers = h.value;
    }
  }

  if (raw.payload_mode !== undefined) {
    if (!(PAYLOAD_MODES as readonly unknown[]).includes(raw.payload_mode)) errors.push({ field: "payload_mode", message: "Choose Standard, Template or Mapping." });
    else if (kind === "event" && raw.payload_mode !== "standard") errors.push({ field: "payload_mode", message: "An Event webhook sends the change feed." });
    else if (raw.payload_mode === "mapping" && mode === "create") errors.push({ field: "payload_mode", message: "Save the webhook first, then build its body in Mapping and choose it here." });
    else if (raw.payload_mode === "mapping" && objectType !== "standard_quotes") errors.push({ field: "payload_mode", message: "Mapping builds the body of a Standard Quote webhook." });
    else out.payload_mode = raw.payload_mode as PayloadMode;
  }
  const payloadMode = out.payload_mode ?? existing?.payload_mode ?? "standard";
  if (raw.template !== undefined) {
    if (raw.template !== null && typeof raw.template !== "string") errors.push({ field: "template", message: "The template must be text." });
    else if (kind === "event" && raw.template) errors.push({ field: "template", message: "An Event webhook has no template." });
    else out.template = raw.template === "" ? null : (raw.template as string | null);
  }
  // A template is judged whenever it is in use or being saved: tokens against the object, personal data against the switch.
  const template = raw.template !== undefined ? out.template ?? null : existing?.template ?? null;
  if (kind === "call" && objectType && (payloadMode === "template" || raw.template)) {
    if (payloadMode === "template" && !template) errors.push({ field: "template", message: "Write the template, or switch to the standard payload." });
    else if (template) {
      const t = validateTemplate(template, objectType, allowPii);
      if (!t.ok) errors.push(...t.errors);
    }
  }

  if (raw.mapping_id !== undefined) {
    if (kind !== "call") errors.push({ field: "mapping_id", message: "Only a Call webhook can take its body from a mapping." });
    else if (raw.mapping_id !== null && (typeof raw.mapping_id !== "string" || !/^[0-9a-f-]{32,40}$/i.test(raw.mapping_id))) errors.push({ field: "mapping_id", message: "Choose a mapping from the list." });
    else out.mapping_id = raw.mapping_id as string | null;
  }
  if (raw.response_key_path !== undefined) {
    if (kind !== "call") errors.push({ field: "response_key_path", message: "Only a Call webhook reads an id from the response." });
    else if (raw.response_key_path === null || raw.response_key_path === "") out.response_key_path = null;
    else if (typeof raw.response_key_path !== "string" || !RESPONSE_PATH_RE.test(raw.response_key_path)) errors.push({ field: "response_key_path", message: "Write a path like $.data.number or $.items[0].id." });
    else out.response_key_path = raw.response_key_path;
  }

  if (raw.active !== undefined) {
    if (typeof raw.active !== "boolean") errors.push({ field: "active", message: "On or off." });
    else out.active = raw.active;
  }
  if (raw.regenerate_secret !== undefined) {
    if (raw.regenerate_secret !== true) errors.push({ field: "regenerate_secret", message: "Send true to generate a new signing secret." });
    else out.regenerate_secret = true;
  }
  if (raw.button_on !== undefined) {
    if (raw.button_on !== null && raw.button_on !== "accounts") errors.push({ field: "button_on", message: "A button can be on Accounts." });
    else if (kind !== "call" || objectType !== "accounts") errors.push({ field: "button_on", message: "Only a Call webhook for Accounts can be a record button." });
    else out.button_on = raw.button_on;
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}
