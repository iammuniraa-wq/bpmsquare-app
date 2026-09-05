import { createHash } from "crypto";

/**
 * A v1 credential resolves to a tenant AND a scope. Two kinds of key exist:
 *
 *  - Scoped keys (api_keys table) -- SHA-256-hashed, read/write + per-object
 *    scopes, revocable, optionally expiring. This is the modern path.
 *  - The legacy tenants.api_key -- one plaintext, full-access key per tenant.
 *    Still honoured (existing integrations don't break) and treated as an
 *    unrestricted scope: { read, write, objects: ["*"] }.
 *
 * Both are per-tenant; there is no shared/global key. Treat any key like a
 * password and revoke/regenerate it in Settings if it leaks.
 */
export type ApiScopes = { read: boolean; write: boolean; objects: string[] }; // objects ["*"] = every object
export type ApiAuth = { tenantId: string; scopes: ApiScopes; keyId: string | null };

const FULL_SCOPE: ApiScopes = { read: true, write: true, objects: ["*"] };

function bearerToken(req: Request): string {
  const auth = req.headers.get("Authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function normalizeScopes(raw: unknown): ApiScopes {
  const s = (raw ?? {}) as Record<string, unknown>;
  const objects = Array.isArray(s.objects) ? s.objects.filter((o): o is string => typeof o === "string") : ["*"];
  return {
    read: s.read !== false, // default read=true unless explicitly disabled
    write: s.write === true, // default write=false unless explicitly enabled
    objects: objects.length ? objects : ["*"],
  };
}

/**
 * Resolve the presented bearer token to { tenantId, scopes }. Scoped keys are
 * matched by hash among live (non-revoked, non-expired) rows; the legacy
 * plaintext tenants.api_key is the fallback and resolves to a full scope.
 */
export async function resolveApiAuth(req: Request): Promise<ApiAuth | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const { createAdminSupabase } = await import("@/lib/supabase-server");
  const admin = createAdminSupabase();

  const { data: key } = await admin
    .from("api_keys")
    .select("id, tenant_id, scopes, expires_at, revoked_at")
    .eq("token_hash", sha256Hex(token))
    .is("revoked_at", null)
    .maybeSingle();

  if (key) {
    if (key.expires_at && new Date(key.expires_at as string).getTime() <= Date.now()) return null;
    // Stamp last-used; best-effort, never blocks or fails the request.
    admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id).then(
      () => {}, () => {}
    );
    return { tenantId: key.tenant_id as string, scopes: normalizeScopes(key.scopes), keyId: key.id as string };
  }

  // Legacy full-access key.
  const { data: tenant } = await admin.from("tenants").select("id").eq("api_key", token).maybeSingle();
  if (tenant) return { tenantId: tenant.id as string, scopes: FULL_SCOPE, keyId: null };
  return null;
}

/**
 * Objects a wildcard scope does NOT reach -- they need naming explicitly.
 * "employees" is staff personal data (name, work email, phone, employment
 * dates); every key minted before that endpoint existed carries objects
 * ["*"], and so does the legacy plaintext tenants.api_key, so honouring the
 * wildcard here would silently hand existing integrations a category of data
 * their owner never granted. Opting in is one checkbox in Settings →
 * General → Developer.
 */
// Objects carrying personal data never ride the "*" wildcard -- an existing
// key in the wild must not silently gain them when a new object joins
// LIST_SOURCES (bpmsquarecore §3b). employees: staff PII; contacts: named
// people at customer accounts (their phone/email are excluded from the
// query surface entirely, but even the name/role/account graph is personal).
const EXPLICIT_SCOPE_ONLY = new Set(["employees", "contacts"]);

/** Does this scope permit read (write=false) or write (write=true) on `object`? */
export function scopeAllows(scopes: ApiScopes, object: string, write: boolean): boolean {
  if (write ? !scopes.write : !scopes.read) return false;
  if (EXPLICIT_SCOPE_ONLY.has(object)) return scopes.objects.includes(object);
  return scopes.objects.includes("*") || scopes.objects.includes(object);
}

export const ERR_403_SCOPE = (object: string, write: boolean) =>
  jsonError(403, "Forbidden", {
    message: `This API key is not scoped for ${write ? "write" : "read"} access to "${object}".`,
  });

/**
 * One-call route guard. Resolves the key, enforces read/write + object scope,
 * and returns either the tenantId to use or a ready-to-return error Response.
 *
 *   const a = await authorizeApi(req, "quotations", true);
 *   if ("error" in a) return a.error;
 *   const { tenantId } = a;
 */
export async function authorizeApi(
  req: Request,
  object: string,
  write = false
): Promise<{ tenantId: string; scopes: ApiScopes; keyId: string | null } | { error: Response }> {
  const auth = await resolveApiAuth(req);
  if (!auth) return { error: ERR_401_TENANT() };
  if (!scopeAllows(auth.scopes, object, write)) return { error: ERR_403_SCOPE(object, write) };
  return { tenantId: auth.tenantId, scopes: auth.scopes, keyId: auth.keyId };
}

/**
 * Object-agnostic tenant resolution for the meta endpoints (index, metadata,
 * openapi, changes) -- any live key with read scope resolves its tenant.
 * Kept as the original name so those routes are untouched.
 */
export async function resolveTenantFromBearer(req: Request): Promise<string | null> {
  const auth = await resolveApiAuth(req);
  if (!auth || !auth.scopes.read) return null;
  return auth.tenantId;
}

export const READ_METHODS = "GET, OPTIONS";
export const RW_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";

export function corsHeaders(methods: string = READ_METHODS): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };
}

export const ERR_401_TENANT = () =>
  Response.json(
    { error: "Unauthorized", message: "Include header: Authorization: Bearer <tenant API key>. Generate one in Settings → Admin → this tenant." },
    { status: 401, headers: { "Content-Type": "application/json" } }
  );

export const jsonOk = (data: unknown, methods: string = READ_METHODS) =>
  Response.json(data, { headers: corsHeaders(methods) });

export const jsonCreated = (data: unknown) =>
  Response.json(data, { status: 201, headers: corsHeaders(RW_METHODS) });

export const jsonError = (status: number, error: string, extra?: Record<string, unknown>) =>
  Response.json({ error, ...(extra ?? {}) }, { status, headers: corsHeaders(RW_METHODS) });

/**
 * 422 with a per-field breakdown. Bulk loaders need to know which row and
 * which column failed, not just that "something was invalid".
 */
export const jsonValidationError = (errors: { field: string; message: string }[]) =>
  jsonError(422, "Validation failed", {
    message: `${errors.length} field${errors.length === 1 ? "" : "s"} rejected. See "details". Full field reference: GET /api/v1/metadata/quotations`,
    details: errors,
  });

/** Parses a JSON body, turning a malformed one into a clean 400 instead of a crash. */
export async function readJsonBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false, response: jsonError(400, "Malformed JSON", { message: "The request body could not be parsed as JSON." }) };
  }
}

export const optionsResponse = (methods: string = READ_METHODS) =>
  new Response(null, { headers: corsHeaders(methods) });
