// The generic Connection model of the Integration middleware page (owner request 2026-11-22): one concept, a type, a few fields
// and a Test button. Client-safe: no server imports, so the panel and the routes read the same field list and the same rules.
// Everything a connection needs to sign in is here; nothing about any one client's system is.

export const CONNECTION_FAMILIES = ["rest", "odata"] as const;
export type ConnectionFamily = (typeof CONNECTION_FAMILIES)[number];

export const FAMILY_LABEL: Record<ConnectionFamily, string> = { rest: "REST API", odata: "OData v4 service" };

export const AUTH_MODES = ["none", "api_key", "basic", "bearer", "oauth2_cc"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export const AUTH_LABEL: Record<AuthMode, string> = {
  none: "No sign-in",
  api_key: "API key",
  basic: "User name and password",
  bearer: "Bearer token",
  oauth2_cc: "OAuth 2 client credentials",
};

export const OAUTH_PROVIDERS = ["entra", "custom"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];
export const OAUTH_PROVIDER_LABEL: Record<OAuthProvider, string> = { entra: "Microsoft Entra (Dynamics 365)", custom: "Another sign-in server" };

/** The non-secret settings, stored as given. Which keys apply depends on `auth`. */
export type ConnectionConfig = {
  base_url: string;
  auth: AuthMode;
  /** REST only: a path (such as /health) the Test reads. OData always reads $metadata. */
  test_path?: string;
  key_name?: string;
  key_in?: "header" | "query";
  username?: string;
  oauth_provider?: OAuthProvider;
  directory_id?: string;
  token_url?: string;
  client_id?: string;
  scope?: string;
};

/** The write-only values, by the key they are stored under. Never returned by any route. */
export const SECRET_KEYS = ["api_key", "password", "token", "client_secret"] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];
export type ConnectionSecrets = Partial<Record<SecretKey, string>>;

/** The one secret each sign-in needs. */
export const SECRET_FOR_AUTH: Record<AuthMode, SecretKey | null> = { none: null, api_key: "api_key", basic: "password", bearer: "token", oauth2_cc: "client_secret" };

const SECRET_WORD: Record<SecretKey, string> = { api_key: "API key", password: "password", token: "token", client_secret: "client secret" };

export type FieldError = { field: string; message: string };

export type ConnectionInput = {
  name?: unknown;
  family?: unknown;
  config?: Record<string, unknown> | null;
  /** Blank or missing = unchanged (never cleared). */
  secrets?: Record<string, unknown> | null;
};

export type ParsedConnection =
  | { ok: true; name: string; family: ConnectionFamily; config: ConnectionConfig; secrets: ConnectionSecrets }
  | { ok: false; errors: FieldError[] };

const str = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const KEY_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
/** Headers the request line or the network layer owns: a key can not be sent under these names. */
const RESERVED_HEADER = /^(host|content-length|content-type|transfer-encoding|connection|upgrade|te|trailer|expect|cookie|proxy-.*|x-bpmsquare-.*)$/i;
/** A line break or a control character in a credential would split a header; it is never a real credential. */
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Is it an https address with no credentials and no query? The public-address check is a server job (assertSafeHttpsUrl). */
export function checkHttpsAddress(raw: string, what: string, opts: { allowQuery?: boolean } = {}): string | null {
  if (!raw) return `${what} is required.`;
  let u: URL;
  try { u = new URL(raw); } catch { return `${what} is not a web address. Start it with https://.`; }
  if (u.protocol !== "https:") return `${what} must start with https://.`;
  if (u.username || u.password) return `Do not put a user name or password inside ${what}. Use the sign-in fields.`;
  if (!opts.allowQuery && (u.search || u.hash)) return `${what} must not carry a ?key=value part. Put keys in the sign-in fields.`;
  return null;
}

export function checkTestPath(raw: string): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || /\.\.|[\s\\]/.test(raw)) return "The check path must start with a single / and stay on the same server, such as /health.";
  if (raw.length > 200) return "The check path is too long.";
  return null;
}

/** The sign-in server's address for a Microsoft Entra connection. */
export const entraTokenUrl = (directory: string): string => `https://login.microsoftonline.com/${encodeURIComponent(directory)}/oauth2/v2.0/token`;

/** The scope Entra needs for a service: the server's own address plus /.default, unless the person wrote one. */
export function defaultScope(baseUrl: string): string {
  try { return `${new URL(baseUrl).origin}/.default`; } catch { return ""; }
}

/**
 * Validate and normalise what the panel sends. `stored` is the connection being edited (its config and which secrets exist),
 * so a blank secret keeps the stored one and a change of sign-in type asks for the new type's secret.
 */
export function parseConnectionInput(
  input: ConnectionInput,
  stored?: { config: Partial<ConnectionConfig>; has: Partial<Record<SecretKey, boolean>> } | null,
): ParsedConnection {
  const errors: FieldError[] = [];
  const err = (field: string, message: string) => errors.push({ field, message });

  const name = str(input.name, 80);
  if (!name) err("name", "Give the connection a name.");

  const family = (CONNECTION_FAMILIES as readonly string[]).includes(String(input.family)) ? (input.family as ConnectionFamily) : null;
  if (!family) err("family", "Choose a type.");

  const c = (input.config ?? {}) as Record<string, unknown>;
  const base = str(c.base_url, 500).replace(/\/+$/, "");
  const baseProblem = checkHttpsAddress(base, family === "odata" ? "The service address" : "The address");
  if (baseProblem) err("base_url", baseProblem);

  const auth = (AUTH_MODES as readonly string[]).includes(String(c.auth)) ? (c.auth as AuthMode) : null;
  if (!auth) err("auth", "Choose how to sign in.");

  const config: ConnectionConfig = { base_url: base, auth: auth ?? "none" };
  const secrets: ConnectionSecrets = {};
  const given = (input.secrets ?? {}) as Record<string, unknown>;
  const need = auth ? SECRET_FOR_AUTH[auth] : null;
  const sameAuth = stored?.config.auth === auth;

  if (family === "rest") {
    const tp = str(c.test_path, 200);
    const tpProblem = checkTestPath(tp);
    if (tpProblem) err("test_path", tpProblem);
    else if (tp) config.test_path = tp;
  }

  if (auth === "api_key") {
    const keyName = str(c.key_name, 64) || "X-API-Key";
    if (!KEY_NAME.test(keyName)) err("key_name", "The key name can use letters, numbers, dash, dot and underscore.");
    else if (c.key_in !== "query" && RESERVED_HEADER.test(keyName)) err("key_name", "That header name is used by the connection itself. Choose another name for the key.");
    config.key_name = keyName;
    config.key_in = c.key_in === "query" ? "query" : "header";
  } else if (auth === "basic") {
    const user = str(c.username, 200);
    if (!user) err("username", "Enter the user name.");
    else if (user.includes(":") || CONTROL.test(user)) err("username", "A user name for Basic sign-in can not contain a colon or a line break.");
    config.username = user;
  } else if (auth === "oauth2_cc") {
    const provider: OAuthProvider = c.oauth_provider === "custom" ? "custom" : "entra";
    config.oauth_provider = provider;
    const clientId = str(c.client_id, 200);
    if (!clientId) err("client_id", "Enter the client (application) ID.");
    config.client_id = clientId;
    if (provider === "entra") {
      const dir = str(c.directory_id, 200);
      if (!GUID.test(dir) && !DOMAIN.test(dir)) err("directory_id", "Enter the directory (tenant) ID: a long ID with dashes, or your Microsoft domain such as contoso.onmicrosoft.com.");
      config.directory_id = dir;
    } else {
      const tokenUrl = str(c.token_url, 500);
      const p = checkHttpsAddress(tokenUrl, "The sign-in server address");
      if (p) err("token_url", p);
      config.token_url = tokenUrl;
    }
    const scope = str(c.scope, 300);
    if (scope) config.scope = scope;
  }

  if (need) {
    const v = typeof given[need] === "string" ? (given[need] as string).trim() : "";
    if (v && CONTROL.test(v)) err(need, `The ${SECRET_WORD[need]} contains a line break. Paste it again without one.`);
    else if (v) secrets[need] = v;
    else if (!(sameAuth && stored?.has[need])) err(need, `Enter the ${SECRET_WORD[need]}.`);
  }

  if (errors.length || !family || !auth) return { ok: false, errors };
  return { ok: true, name, family, config, secrets };
}

/** What the screen may know about a stored connection: never a secret, only whether one is stored. */
export type PublicConnection = {
  id: string;
  name: string;
  family: ConnectionFamily;
  config: ConnectionConfig;
  secretsSet: Partial<Record<SecretKey, boolean>>;
  status: "ok" | "failed" | "untested";
  lastTestAt: string | null;
  lastTestMessage: string | null;
  endpointCount: number;
};

/** The result of a Test, in words a person acts on. `reference` is a short vendor code (AADSTS7000222), never an error string. */
export type TestResult = {
  ok: boolean;
  message: string;
  fix: string | null;
  httpStatus: number | null;
  reference: string | null;
  /** What the check learned, such as "42 entity sets found". */
  note: string | null;
};
