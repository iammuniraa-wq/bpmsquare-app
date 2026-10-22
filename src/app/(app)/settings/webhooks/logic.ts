import type { DeliveryItem, FieldError, HeaderView, Method, PayloadMode, TokenChoice, UsedBy, Webhook, WebhookInput, WebhookKind } from "./api";

// The pure parts of the Webhooks library screen: the words for a row, the draft a panel edits, the one reason a
// save is refused before asking, and the token picker. Nothing here touches the network or the DOM.

// ── The flag ────────────────────────────────────────────────────────────────

/** The platform-admin flag that switches the library on. Read through this so a stale or missing key is simply off. */
export const WEBHOOKS_FLAG = "webhooks_library";
export const WEBHOOKS_ROUTE = "/settings/webhooks";
export const webhooksLibraryOn = (features: unknown): boolean =>
  !!features && typeof features === "object" && (features as Record<string, unknown>)[WEBHOOKS_FLAG] === true;

/** The failure count after which the sender pauses a webhook (the dispatcher's own limit). */
export const MAX_FAILURES = 15;

// ── Rows ────────────────────────────────────────────────────────────────────

export const KIND_LABEL: Record<WebhookKind, string> = { event: "Event", call: "Call" };
export const KIND_ORDER: WebhookKind[] = ["call", "event"];

export type StateKey = "on" | "off" | "paused" | "attention";
export type WebhookState = { key: StateKey; word: string };

/** Needs attention beats paused beats off: the most urgent plain status wins. */
export function webhookState(w: Pick<Webhook, "active" | "paused_reason" | "failure_count" | "needs_attention">): WebhookState {
  if (w.needs_attention) return { key: "attention", word: "Needs attention" };
  if (w.paused_reason) return { key: "paused", word: w.failure_count >= MAX_FAILURES ? `Paused after ${MAX_FAILURES} failures` : "Paused" };
  if (!w.active) return { key: "off", word: "Off" };
  return { key: "on", word: "On" };
}

export const canResume = (w: Pick<Webhook, "paused_reason">): boolean => !!w.paused_reason;

/** The host of an address, or the address itself (cut) when it does not parse. */
export function hostOf(url: string): string {
  try { return new URL(url).host || url; } catch { return url.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0] || url; }
}

export const targetWord = (w: Pick<Webhook, "kind" | "method" | "url">): string =>
  `${w.kind === "event" ? "POST" : w.method} ${hostOf(w.url)}`;

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today 14:02", "Yesterday 09:10", "12 Oct 14:02" in the viewer's own time; `now` is injected so a test is stable. */
export function whenWord(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

const GOOD = /^(2\d\d|ok|sent|delivered|success|succeeded)$/i;
/** "OK", "Failed" or "Not sent" for a stored status; empty when there is none yet. */
export function statusWord(status: string | null, error: string | null = null): string {
  if (!status) return error ? "Failed" : "";
  if (GOOD.test(status.trim())) return "OK";
  if (/^redirected$/i.test(status.trim())) return "Not sent";
  return "Failed";
}

export function lastCallWord(w: Pick<Webhook, "last_delivery_at" | "last_status" | "last_error">, now: Date = new Date()): string {
  const when = whenWord(w.last_delivery_at, now);
  if (!when) return "Never called";
  const st = statusWord(w.last_status, w.last_error);
  return st ? `${when} ${st}` : when;
}

export const KIND_USED_WORD: Record<UsedBy["kind"], string> = { link: "Links", coverage: "Coverage", button: "Button" };
export const usedByLine = (u: UsedBy): string => `${KIND_USED_WORD[u.kind]}: ${u.label}`;
/** The chip on a row: "2 uses", or nothing when nothing uses it. */
export const usedByChip = (list: readonly UsedBy[]): string | null => (list.length === 0 ? null : `${list.length} ${list.length === 1 ? "use" : "uses"}`);

/** The refusal to delete, in words that name what still uses it. */
export const deleteBlockedWord = (list: readonly UsedBy[]): string =>
  `It is still used by ${list.map(usedByLine).join(", ")}. Remove it there first.`;

export function deliveryLine(d: DeliveryItem, now: Date = new Date()): { when: string; status: string; ok: boolean; duration: string; headline: string } {
  const ok = GOOD.test(d.status.trim()) || (d.http_status !== null && d.http_status >= 200 && d.http_status < 300);
  const ms = d.duration_ms;
  return {
    when: whenWord(d.at, now),
    status: d.http_status !== null ? String(d.http_status) : statusWord(d.status) || d.status,
    ok,
    duration: ms === null ? "" : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`,
    headline: d.headline ?? "",
  };
}

// ── Choices ─────────────────────────────────────────────────────────────────

/** What an Event webhook can subscribe to (the dispatcher's own list); "*" is every object. */
export const EVENT_OBJECTS: { key: string; label: string }[] = [
  { key: "quotes", label: "Quotes" }, { key: "accounts", label: "Accounts" },
  { key: "contacts", label: "Contacts" }, { key: "cases", label: "Cases" },
  { key: "work_orders", label: "Work orders" }, { key: "invoices", label: "Invoices" },
  { key: "purchase_orders", label: "Purchase orders" }, { key: "inventory", label: "Inventory" },
  { key: "assets", label: "Assets" }, { key: "suppliers", label: "Suppliers" },
];

/** Fallback when the server did not list the objects a Call webhook may accept. */
export const CALL_OBJECTS_FALLBACK = [{ key: "accounts", label: "Accounts" }, { key: "standard_quotes", label: "Standard Quotes" }];

// ── The draft a panel edits ─────────────────────────────────────────────────

export type HeaderDraft = {
  name: string;
  /** Empty on a stored header means "keep the stored value"; the value is never read back. */
  value: string;
  stored: boolean;
  /** A stored header the person chose to replace: it then needs a new value. */
  replacing: boolean;
};

const headerKeepsValue = (h: HeaderDraft) => h.stored && !h.replacing;

export type Draft = {
  kind: WebhookKind;
  name: string;
  url: string;
  method: Method;
  objectType: string;
  /** Event only: ["*"] = every object. */
  objectTypes: string[];
  headers: HeaderDraft[];
  payloadMode: PayloadMode;
  template: string;
  /** Mode "mapping" only: where the readable id sits in the answer, or "". */
  responseKeyPath: string;
  allowPii: boolean;
  timeoutSec: number;
  active: boolean;
  /** Call on accounts only: the "Send to <name>" entry on the account page. */
  buttonOnAccounts: boolean;
};

export const DEFAULT_TEMPLATE = '{\n  "event": "{{event}}",\n  "id": "{{record.id}}"\n}';

export function emptyDraft(kind: WebhookKind, objectType = "accounts"): Draft {
  return {
    kind, name: "", url: "", method: "POST", objectType: kind === "call" ? objectType : "", objectTypes: kind === "event" ? ["*"] : [],
    headers: [], payloadMode: "standard", template: "", responseKeyPath: "", allowPii: false, timeoutSec: 15, active: true, buttonOnAccounts: false,
  };
}

export function draftFromWebhook(w: Webhook, recordButtonAccounts: string | null): Draft {
  return {
    kind: w.kind, name: w.name, url: w.url, method: w.method, objectType: w.object_type ?? "", objectTypes: [...w.object_types],
    headers: w.headers.map((h: HeaderView) => ({ name: h.name, value: "", stored: true, replacing: false })),
    payloadMode: w.payload_mode, template: w.template ?? "", responseKeyPath: w.response_key_path ?? "", allowPii: w.allow_personal_data, timeoutSec: Math.round(w.timeout_ms / 1000),
    active: w.active, buttonOnAccounts: recordButtonAccounts === w.id,
  };
}

const headersOut = (h: readonly HeaderDraft[]) => h.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), value: headerKeepsValue(x) ? "" : x.value }));
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A new webhook sends everything it has; an existing one sends only what differs, so an untouched panel sends nothing. */
export function buildInput(draft: Draft, original: Webhook | null, recordButtonAccounts: string | null = null): WebhookInput {
  const isEvent = draft.kind === "event";
  if (!original) {
    const input: WebhookInput = {
      kind: draft.kind, name: draft.name.trim(), url: draft.url.trim(), headers: headersOut(draft.headers), active: draft.active,
    };
    if (isEvent) input.object_types = draft.objectTypes;
    else {
      input.object_type = draft.objectType;
      input.method = draft.method;
      // A mapping needs the saved webhook first (the server refuses it on create), so a new one starts standard.
      input.payload_mode = draft.payloadMode === "mapping" ? "standard" : draft.payloadMode;
      if (draft.payloadMode === "template") input.template = draft.template;
      input.allow_personal_data = draft.allowPii;
      input.timeout_ms = draft.timeoutSec * 1000;
      if (draft.objectType === "accounts") input.button_on = draft.buttonOnAccounts ? "accounts" : null;
    }
    if (isEvent) input.timeout_ms = draft.timeoutSec * 1000;
    return input;
  }
  const base = draftFromWebhook(original, recordButtonAccounts);
  const input: WebhookInput = {};
  if (draft.name.trim() !== base.name) input.name = draft.name.trim();
  if (draft.url.trim() !== base.url) input.url = draft.url.trim();
  if (draft.active !== base.active) input.active = draft.active;
  if (!sameJson(headersOut(draft.headers), headersOut(base.headers)) || draft.headers.some((h) => !headerKeepsValue(h) && h.value !== "")) input.headers = headersOut(draft.headers);
  if (draft.timeoutSec !== base.timeoutSec) input.timeout_ms = draft.timeoutSec * 1000;
  if (isEvent) {
    if (!sameJson([...draft.objectTypes].sort(), [...base.objectTypes].sort())) input.object_types = draft.objectTypes;
  } else {
    if (draft.method !== base.method) input.method = draft.method;
    if (draft.payloadMode !== base.payloadMode) input.payload_mode = draft.payloadMode;
    if (draft.payloadMode === "template" && (draft.template !== base.template || draft.payloadMode !== base.payloadMode)) input.template = draft.template;
    if (draft.payloadMode === "mapping" && draft.responseKeyPath.trim() !== base.responseKeyPath) input.response_key_path = draft.responseKeyPath.trim() || null;
    if (draft.allowPii !== base.allowPii) input.allow_personal_data = draft.allowPii;
    if (original.object_type === "accounts" && draft.buttonOnAccounts !== base.buttonOnAccounts) input.button_on = draft.buttonOnAccounts ? "accounts" : null;
  }
  return input;
}

export const isDraftDirty = (draft: Draft, original: Webhook | null, recordButtonAccounts: string | null = null): boolean =>
  original ? Object.keys(buildInput(draft, original, recordButtonAccounts)).length > 0 : true;

// ── Checks before asking the server ─────────────────────────────────────────

export const RESERVED_HEADERS = ["host", "content-length"];
export const isReservedHeader = (name: string): boolean => {
  const n = name.trim().toLowerCase();
  return RESERVED_HEADERS.includes(n) || n.startsWith("x-bpmsquare-");
};
export const MAX_HEADERS = 10;
export const TEMPLATE_MAX_BYTES = 16 * 1024;

/** The same shape the server accepts for `response_key_path` (src/lib/webhooks/validate.ts). */
export const RESPONSE_PATH_RE = /^\$(?:\.[A-Za-z_][A-Za-z0-9_]{0,40}|\[\d{1,3}\]){1,10}$/;

const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
/** Every token in a text, as the bare name ("account.name"). */
export const tokensIn = (text: string): string[] => Array.from(text.matchAll(TOKEN_RE), (m) => m[1]);
/** A token as the picker stores it, with or without braces, as the bare name. */
export const bareToken = (t: string): string => t.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "");
export const wrapToken = (t: string): string => `{{${bareToken(t)}}}`;

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export function isHttps(url: string): boolean {
  try { return new URL(url.trim()).protocol === "https:"; } catch { return false; }
}

/**
 * The sentences that stop a save before the server is asked, each tied to the field it is about. `tokens` is
 * what the picker loaded for this object (empty = not loaded, so unknown/personal tokens are left to the server).
 */
export function draftProblems(draft: Draft, tokens: readonly TokenChoice[] = []): FieldError[] {
  const out: FieldError[] = [];
  const add = (field: string, message: string) => out.push({ field, message });
  const name = draft.name.trim();
  if (!name) add("name", "Give the webhook a name.");
  else if (name.length > 80) add("name", "The name can be at most 80 characters.");
  if (draft.kind === "call" && !draft.objectType) add("object_type", "Choose which kind of record it sends.");
  if (draft.kind === "event" && draft.objectTypes.length === 0) add("object_types", "Choose at least one object, or all of them.");

  const url = draft.url.trim();
  const known = new Map(tokens.map((t) => [bareToken(t.token), t]));
  if (!url) add("url", "Enter the address to call.");
  else if (!isHttps(url)) add("url", "The address must use https.");
  else if (tokensIn(url).some((t) => known.get(t)?.pii)) add("url", "Personal data cannot go in the address.");

  if (draft.headers.length > MAX_HEADERS) add("headers", `Use at most ${MAX_HEADERS} headers.`);
  const seen = new Set<string>();
  for (const h of draft.headers) {
    const hn = h.name.trim();
    if (!hn) { if (h.value) add("headers", "A header needs a name."); continue; }
    if (!/^[A-Za-z0-9-]{1,64}$/.test(hn)) add("headers", `"${hn}" is not a valid header name. Use letters, digits and dashes.`);
    else if (isReservedHeader(hn)) add("headers", `"${hn}" is set by BPMSquare and cannot be changed.`);
    else if (seen.has(hn.toLowerCase())) add("headers", `"${hn}" is listed twice.`);
    seen.add(hn.toLowerCase());
    if (!headerKeepsValue(h) && !h.value) add("headers", `Give "${hn}" a value, or remove it.`);
    if (h.value.length > 1024) add("headers", `The value of "${hn}" is too long.`);
  }

  if (draft.kind === "call" && draft.payloadMode === "mapping" && draft.responseKeyPath.trim() && !RESPONSE_PATH_RE.test(draft.responseKeyPath.trim())) {
    add("response_key_path", "Write a path like $.data.number or $.items[0].id.");
  }
  if (draft.kind === "call" && draft.payloadMode === "template") {
    const t = draft.template;
    if (!t.trim()) add("template", "Write the body to send, or choose the standard body.");
    else if (byteLength(t) > TEMPLATE_MAX_BYTES) add("template", "The body is over 16 KB. Make it shorter.");
    else {
      let parses = true;
      try { JSON.parse(t); } catch { parses = false; }
      if (!parses) add("template", "The body must be valid JSON. Keep each {{token}} inside quotes.");
      else if (tokens.length > 0) {
        const unknown = tokensIn(t).filter((x) => !known.has(x));
        if (unknown.length > 0) add("template", `{{${unknown[0]}}} is not a token you can use here.`);
        else if (!draft.allowPii) {
          const pii = tokensIn(t).find((x) => known.get(x)?.pii);
          if (pii) add("template", `{{${pii}}} is personal data. Switch on "Send personal data", or remove it.`);
        }
      }
    }
  }
  if (!(draft.timeoutSec >= 5 && draft.timeoutSec <= 30)) add("timeout_ms", "The wait must be between 5 and 30 seconds.");
  return out;
}

/** The panel tab a server field belongs to, so a refusal opens where it can be fixed. */
export function tabForField(field: string): "basics" | "request" | "security" {
  if (field === "name" || field === "object_type" || field === "object_types" || field === "button_on" || field === "kind") return "basics";
  return "request";
}

// ── Token picker ────────────────────────────────────────────────────────────

const SYSTEM_PREFIXES = new Set(["event", "sent_at", "delivery_id", "workspace", "record"]);
export type TokenGroup = { id: string; label: string; tokens: TokenChoice[] };

/** Tokens grouped by what they belong to (account, quote, ...), system tokens last under one heading. */
export function groupTokens(tokens: readonly TokenChoice[], query = ""): TokenGroup[] {
  const q = query.trim().toLowerCase();
  const shown = q ? tokens.filter((t) => `${t.label} ${bareToken(t.token)}`.toLowerCase().includes(q)) : tokens;
  const groups = new Map<string, TokenChoice[]>();
  for (const t of shown) {
    const head = bareToken(t.token).split(".")[0];
    const id = SYSTEM_PREFIXES.has(head) ? "system" : head;
    groups.set(id, [...(groups.get(id) ?? []), t]);
  }
  const label = (id: string) => (id === "system" ? "Always available" : id.charAt(0).toUpperCase() + id.slice(1));
  return Array.from(groups, ([id, list]) => ({ id, label: label(id), tokens: list }))
    .sort((a, b) => (a.id === "system" ? 1 : 0) - (b.id === "system" ? 1 : 0));
}

/** Put a token where the caret is (replacing a selection); returns the new text and where the caret goes. */
export function insertToken(text: string, token: string, start: number, end: number): { text: string; caret: number } {
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  const put = wrapToken(token);
  return { text: text.slice(0, a) + put + text.slice(b), caret: a + put.length };
}

/** The headers every call carries, from the contract; the tenant's own headers cannot replace the X-BPMSquare ones. */
export const FIXED_HEADERS = [
  "Content-Type", "X-BPMSquare-Signature", "X-BPMSquare-Delivery", "X-BPMSquare-Event", "X-BPMSquare-Timestamp", "X-BPMSquare-Idempotency-Key",
] as const;

/** Where a call lands in the Monitor (the middleware page, Monitor tab). */
export const MONITOR_HREF = "/settings/middleware?tab=monitor";
