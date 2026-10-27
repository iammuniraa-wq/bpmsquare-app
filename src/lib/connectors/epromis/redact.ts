// What ePROMIS says back is shown to an admin, so it is read as untrusted text: a server may echo the request (its
// Authorization header, the API key, the password) into an error page. Every secret we sent is removed first, then
// anything that looks like a credential, then markup and length.

const MIN_SECRET = 4;

/** Text safe to show: the given secrets, bearer/basic tokens and key=value credentials removed. */
export function redactSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = text;
  // Longest first, so "user:pw" goes before "pw" and no half of a secret is left behind.
  const list = secrets.filter((s): s is string => typeof s === "string" && s.length >= MIN_SECRET).sort((a, b) => b.length - a.length);
  for (const s of list) {
    out = out.split(s).join("[hidden]");
    const b64 = Buffer.from(s).toString("base64").replace(/=+$/, "");
    if (b64.length >= MIN_SECRET) out = out.split(b64).join("[hidden]");
  }
  out = out
    .replace(/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [hidden]")
    .replace(/(["']?(?:api[_-]?key|x-api-key|authorization|password|passwd|secret|token|access[_-]?token)["']?\s*[:=]\s*)(["']?)[^\s"',;}]{3,}\2/gi, "$1[hidden]");
  return out;
}

const MESSAGE_KEYS = ["message", "Message", "error_description", "errorMessage", "detail", "title", "error"] as const;

function firstMessage(json: unknown): string | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return typeof json === "string" ? json : null;
  const o = json as Record<string, unknown>;
  for (const k of MESSAGE_KEYS) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object") {
      const inner = firstMessage(v);
      if (inner) return inner;
    }
  }
  return null;
}

/**
 * The vendor's own words for what went wrong: the message inside a JSON error body, or the start of a text body. An
 * HTML page is reported as such, never reproduced. Secrets removed, whitespace collapsed, at most 240 characters.
 */
export function vendorMessage(body: string, secrets: readonly (string | null | undefined)[]): string | null {
  const t = body.trim();
  if (!t) return null;
  let text: string | null = null;
  if (t.startsWith("{") || t.startsWith("[")) {
    try { text = firstMessage(JSON.parse(t)); } catch { text = null; }
  } else if (t.startsWith("<")) {
    text = "(an HTML page, not a message)";
  } else {
    text = t;
  }
  if (!text) return null;
  const clean = redactSecrets(text, secrets).replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 240) : null;
}
