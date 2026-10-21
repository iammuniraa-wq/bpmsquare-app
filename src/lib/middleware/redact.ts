// Redaction for captured payloads (payload capture is off by default). Tokens,
// authorization values and personal data never reach integration_messages.
// Pure, unit-tested.

const SECRET_KEY = /(authorization|token|secret|password|passwd|api[-_]?key|bearer|credential|cookie|signature|private[-_]?key|certificate)/i;
const PERSONAL_KEY = /(^|[^a-z])(e?-?mail|emailaddress\d*|phone|mobile|telephone\d*|fax|firstname|lastname|fullname|first_name|last_name|full_name|contact_?name|address\d*_(line|street)\w*|street|iban|ssn|passport|birth)([^a-z]|$)/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const PHONE_RE = /(?<![\w-])\+?\d[\d\s().-]{7,}\d(?![\w-])/g;

export const REDACTED = "[redacted]";
const MAX_STRING = 2000;
const MAX_ITEMS = 50;
const MAX_DEPTH = 8;
const MAX_JSON = 64_000;

/** Scrub free text: bearer tokens, JWTs, e-mail addresses and phone numbers. */
export function redactText(s: string): string {
  let out = s.replace(BEARER_RE, (_m, kind: string) => `${kind} ${REDACTED}`).replace(JWT_RE, "[token]").replace(EMAIL_RE, "[email]");
  // A GUID is a record id, not a phone number: keep those intact.
  out = out.replace(PHONE_RE, (m) => (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(m) || (m.match(/\d/g)?.length ?? 0) < 8 ? m : "[phone]"));
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…` : out;
}

function walk(v: unknown, depth: number): unknown {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v === "string") return redactText(v);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (depth >= MAX_DEPTH) return "[too deep]";
  if (Array.isArray(v)) {
    const items = v.slice(0, MAX_ITEMS).map((x) => walk(x, depth + 1));
    if (v.length > MAX_ITEMS) items.push(`[${v.length - MAX_ITEMS} more]`);
    return items;
  }
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_KEY.test(k) || PERSONAL_KEY.test(k)) out[k] = val === null || val === undefined || val === "" ? val ?? null : REDACTED;
      else out[k] = walk(val, depth + 1);
    }
    return out;
  }
  return String(v);
}

/** A copy of `value` that is safe to store: secret keys and personal-data
 *  keys replaced, free text scrubbed, size bounded. */
export function redactPayload(value: unknown): unknown {
  const out = walk(value, 0);
  try {
    if (JSON.stringify(out).length > MAX_JSON) return { truncated: true };
  } catch {
    return { truncated: true };
  }
  return out;
}
