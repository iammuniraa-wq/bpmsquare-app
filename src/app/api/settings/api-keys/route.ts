import { NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

// Management API for scoped v1 API keys (Settings -> General -> Developer).
// Admin-only. The plaintext token is shown exactly once, at creation; only its
// SHA-256 hash is ever stored, so a lost key can only be revoked + reissued,
// never recovered -- same posture as GitHub/Stripe.

// Objects a key's scope may name. Aligns with the v1 endpoint slugs; "*" = all.
const SCOPABLE_OBJECTS = ["quotations", "accounts", "cases", "inventory", "invoices", "purchase-orders"];

type ScopeInput = { read?: unknown; write?: unknown; objects?: unknown };

function normalizeScopes(raw: ScopeInput): { ok: true; scopes: { read: boolean; write: boolean; objects: string[] } } | { ok: false; error: string } {
  const read = raw.read !== false;
  const write = raw.write === true;
  let objects: string[] = ["*"];
  if (raw.objects !== undefined) {
    if (!Array.isArray(raw.objects)) return { ok: false, error: "`objects` must be an array." };
    const list = raw.objects.filter((o): o is string => typeof o === "string");
    if (list.includes("*")) {
      objects = ["*"];
    } else {
      const bad = list.filter((o) => !SCOPABLE_OBJECTS.includes(o));
      if (bad.length) return { ok: false, error: `Unknown object(s): ${bad.join(", ")}. Allowed: ${SCOPABLE_OBJECTS.join(", ")} or "*".` };
      objects = list.length ? list : ["*"];
    }
  }
  if (!read && !write) return { ok: false, error: "A key must grant at least read or write." };
  return { ok: true, scopes: { read, write, objects } };
}

async function requireAdmin() {
  const { tenantId, role } = await requireTenantUser();
  if (role !== "admin") throw { status: 403, message: "Forbidden" };
  return tenantId;
}

export async function GET() {
  let tenantId: string;
  try {
    tenantId = await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }

  const { data, error } = await createAdminSupabase()
    .from("api_keys")
    .select("id, name, token_prefix, scopes, last_used_at, expires_at, revoked_at, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ keys: data ?? [] });
}

export async function POST(req: Request) {
  let tenantId: string;
  let userId: string | null = null;
  try {
    const auth = await requireTenantUser();
    if (auth.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    tenantId = auth.tenantId;
    userId = auth.userId;
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "A key name is required." }, { status: 422 });

  const scopeResult = normalizeScopes((body.scopes ?? {}) as ScopeInput);
  if (!scopeResult.ok) return NextResponse.json({ error: scopeResult.error }, { status: 422 });

  let expiresAt: string | null = null;
  if (body.expires_at != null && body.expires_at !== "") {
    const t = new Date(body.expires_at as string);
    if (isNaN(t.getTime())) return NextResponse.json({ error: "`expires_at` is not a valid date." }, { status: 422 });
    if (t.getTime() <= Date.now()) return NextResponse.json({ error: "`expires_at` must be in the future." }, { status: 422 });
    expiresAt = t.toISOString();
  }

  const token = `bpm_${randomBytes(24).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const tokenPrefix = token.slice(0, 12);

  const { data, error } = await createAdminSupabase()
    .from("api_keys")
    .insert({
      tenant_id: tenantId,
      name,
      token_prefix: tokenPrefix,
      token_hash: tokenHash,
      scopes: scopeResult.scopes,
      expires_at: expiresAt,
      created_by: userId,
    })
    .select("id, name, token_prefix, scopes, expires_at, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // token is returned ONCE here and never again.
  return NextResponse.json({ key: data, token }, { status: 201 });
}
