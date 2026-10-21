// The token grammar of a Call webhook (docs/design/webhooks-library.md). Pure: no
// server imports, so the Webhooks screen can offer the same list it is judged by.
//
// {{alias.field}} against a CLOSED whitelist per object. There are no expressions,
// no loops and no code: a token names a field, nothing more. Personal-data tokens
// (the encrypted account fields) are marked `pii` and are only ever filled when the
// webhook has allow_personal_data on. Cost and margin fields are in no whitelist.

export const CALL_OBJECTS = [
  { key: "accounts", label: "Accounts" },
  { key: "standard_quotes", label: "Standard Quotes" },
] as const;
export type CallObject = (typeof CALL_OBJECTS)[number]["key"];

export const isCallObject = (v: unknown): v is CallObject => CALL_OBJECTS.some((o) => o.key === v);

export type TokenKind = "text" | "number" | "array" | "object";
export type TokenSpec = { token: string; label: string; pii: boolean; kind: TokenKind };

/** What the renderer reads: system values plus the record(s) of the object. */
export type RenderContext = {
  event: string;
  sent_at: string;
  delivery_id: string;
  workspace: { name: string };
  record: { id: string; url: string };
  account?: Record<string, unknown>;
  quote?: Record<string, unknown>;
};

type Field = { path: string; label: string; pii?: boolean; kind?: TokenKind };

const SYSTEM_FIELDS: Field[] = [
  { path: "event", label: "Event name" },
  { path: "sent_at", label: "Sent at" },
  { path: "delivery_id", label: "Delivery id" },
  { path: "workspace.name", label: "Workspace name" },
  { path: "record.id", label: "Record id" },
  { path: "record.url", label: "Record link" },
];

const ACCOUNT_FIELDS: Field[] = [
  { path: "account.id", label: "Account id" },
  { path: "account.ref", label: "Account reference" },
  { path: "account.name", label: "Account name" },
  { path: "account.type", label: "Account type" },
  { path: "account.address_line1", label: "Address line 1" },
  { path: "account.address_line2", label: "Address line 2" },
  { path: "account.city", label: "City" },
  { path: "account.state", label: "State" },
  { path: "account.postal_code", label: "Postal code" },
  { path: "account.country", label: "Country" },
  { path: "account.website", label: "Website" },
  { path: "account.industry", label: "Industry" },
  { path: "account.employee_count", label: "Employee count" },
  { path: "account.annual_revenue", label: "Annual revenue" },
  { path: "account.notes", label: "Notes" },
  { path: "account.created_at", label: "Created at" },
  { path: "account.email", label: "Email", pii: true },
  { path: "account.email2", label: "Second email", pii: true },
  { path: "account.phone", label: "Phone", pii: true },
  { path: "account.phone2", label: "Second phone", pii: true },
  { path: "account.gstin", label: "Tax number (GSTIN)", pii: true },
];

// The account of a quote: a small, customer-facing subset.
const QUOTE_ACCOUNT_FIELDS: Field[] = [
  { path: "account.id", label: "Account id" },
  { path: "account.ref", label: "Account reference" },
  { path: "account.name", label: "Account name" },
  { path: "account.city", label: "City" },
  { path: "account.country", label: "Country" },
  { path: "account.email", label: "Account email", pii: true },
  { path: "account.phone", label: "Account phone", pii: true },
  { path: "account.gstin", label: "Account tax number (GSTIN)", pii: true },
];

const QUOTE_FIELDS: Field[] = [
  { path: "quote.id", label: "Quote id" },
  { path: "quote.ref", label: "Quote reference" },
  { path: "quote.status", label: "Status" },
  { path: "quote.currency", label: "Currency" },
  { path: "quote.subtotal", label: "Subtotal", kind: "number" },
  { path: "quote.total", label: "Total", kind: "number" },
  { path: "quote.tax_pct", label: "Tax %", kind: "number" },
  { path: "quote.header_discount_pct", label: "Header discount %", kind: "number" },
  { path: "quote.shipping_amount", label: "Shipping", kind: "number" },
  { path: "quote.valid_until", label: "Valid until" },
  { path: "quote.terms", label: "Terms" },
  { path: "quote.notes", label: "Notes" },
  { path: "quote.created_at", label: "Created at" },
  { path: "quote.lines", label: "Quote lines (customer prices)", kind: "array" },
];

const OBJECT_FIELDS: Record<CallObject, Field[]> = {
  accounts: [...SYSTEM_FIELDS, ...ACCOUNT_FIELDS],
  standard_quotes: [...SYSTEM_FIELDS, ...QUOTE_FIELDS, ...QUOTE_ACCOUNT_FIELDS],
};

/** The alias a record sits under in the standard body and in the tokens. */
export const PRIMARY_ALIAS: Record<CallObject, string> = { accounts: "account", standard_quotes: "quote" };

// Dynamic families: a custom field of the account and the ERP number of a quote.
const CUSTOM_RE = /^account\.custom\.(cf_[a-z0-9_]{1,60})$/;
const EXTERNAL_RE = /^quote\.external\.([a-z0-9_]{1,40})$/;

const toSpec = (f: Field): TokenSpec => ({ token: `{{${f.path}}}`, label: f.label, pii: f.pii === true, kind: f.kind ?? "text" });

/** The static whitelist, for the token picker. */
export function tokenSpecs(objectType: CallObject): TokenSpec[] {
  return OBJECT_FIELDS[objectType].map(toSpec);
}

/** Resolve the text between the braces to its spec, or null when it is not on the whitelist. */
export function resolveToken(objectType: CallObject, name: string): TokenSpec | null {
  const n = name.trim();
  const hit = OBJECT_FIELDS[objectType].find((f) => f.path === n);
  if (hit) return toSpec(hit);
  if (objectType === "accounts" && CUSTOM_RE.test(n)) return { token: `{{${n}}}`, label: "Custom field", pii: false, kind: "text" };
  if (objectType === "standard_quotes" && EXTERNAL_RE.test(n)) return { token: `{{${n}}}`, label: "ERP number", pii: false, kind: "text" };
  return null;
}

/** The path fields of the object (no system fields), for building the standard record. */
export function recordFields(objectType: CallObject): { path: string; pii: boolean }[] {
  const sys = new Set(SYSTEM_FIELDS.map((f) => f.path));
  return OBJECT_FIELDS[objectType].filter((f) => !sys.has(f.path)).map((f) => ({ path: f.path, pii: f.pii === true }));
}

const TOKEN_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

export type Scan = { names: string[]; stray: boolean };

/** Every token name in a string, and whether a lone `{{` or `}}` is left over. */
export function scanTokens(s: string): Scan {
  const names: string[] = [];
  const rest = s.replace(TOKEN_RE, (_m, name: string) => {
    names.push(name);
    return "";
  });
  return { names, stray: rest.includes("{{") || rest.includes("}}") };
}

/** The name when the whole string is exactly one token (so it can emit a JSON value, not text). */
export function soleToken(s: string): string | null {
  const m = /^\{\{\s*([^{}]*?)\s*\}\}$/.exec(s);
  return m ? m[1] : null;
}

const SAFE_SEGMENT = /^[A-Za-z0-9_]+$/;

/** Read a whitelisted token's value out of the context. Segments are checked, so a path can never reach a prototype. */
export function readPath(ctx: RenderContext, name: string): unknown {
  let cur: unknown = ctx;
  for (const seg of name.trim().split(".")) {
    if (!SAFE_SEGMENT.test(seg) || cur === null || typeof cur !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
