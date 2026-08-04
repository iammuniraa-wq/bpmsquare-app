/**
 * Every v1 route resolves its tenant from a per-tenant bearer key
 * (tenants.api_key) -- no shared/global key. Generated in Settings → Admin →
 * this tenant.
 *
 * Note on scope: that one key now grants writes as well as reads on the
 * endpoints that expose them. It is a full-access tenant credential -- treat
 * it like a password, and regenerate it in Admin if it leaks.
 */
export async function resolveTenantFromBearer(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const { createAdminSupabase } = await import("@/lib/supabase-server");
  const { data } = await createAdminSupabase().from("tenants").select("id").eq("api_key", token).maybeSingle();
  return data?.id ?? null;
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
