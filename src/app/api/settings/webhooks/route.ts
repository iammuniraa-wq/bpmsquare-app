import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

// Management API for outbound webhooks (Settings -> Developer). Admin-only.
// A new webhook's cursor is seeded to the CURRENT tip of change_log, so it only
// ever delivers events that happen AFTER registration -- registering a webhook
// never replays the tenant's entire history in one burst.

const SUBSCRIBABLE_OBJECTS = [
  "accounts", "contacts", "assets", "suppliers", "quotes", "cases",
  "work_orders", "invoices", "purchase_orders", "inventory",
];

function normalizeObjectTypes(raw: unknown): { ok: true; objectTypes: string[] } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, objectTypes: ["*"] };
  if (!Array.isArray(raw)) return { ok: false, error: "`object_types` must be an array." };
  const list = raw.filter((o): o is string => typeof o === "string");
  if (list.includes("*") || list.length === 0) return { ok: true, objectTypes: ["*"] };
  const bad = list.filter((o) => !SUBSCRIBABLE_OBJECTS.includes(o));
  if (bad.length) return { ok: false, error: `Unknown object_type(s): ${bad.join(", ")}. Allowed: ${SUBSCRIBABLE_OBJECTS.join(", ")} or "*".` };
  return { ok: true, objectTypes: list };
}

async function requireAdmin() {
  const auth = await requireTenantUser();
  if (auth.role !== "admin") throw { status: 403, message: "Forbidden" };
  return auth;
}

export async function GET() {
  let tenantId: string;
  try {
    ({ tenantId } = await requireAdmin());
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }

  const { data, error } = await createAdminSupabase()
    .from("webhooks")
    .select("id, name, url, secret, object_types, active, last_delivery_at, last_status, last_error, failure_count, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ webhooks: data ?? [] });
}

export async function POST(req: Request) {
  let tenantId: string, userId: string;
  try {
    ({ tenantId, userId } = await requireAdmin());
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
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!name) return NextResponse.json({ error: "A webhook name is required." }, { status: 422 });
  if (!/^https:\/\/.+/i.test(url)) return NextResponse.json({ error: "`url` must be an https:// URL." }, { status: 422 });

  const objectTypes = normalizeObjectTypes(body.object_types);
  if (!objectTypes.ok) return NextResponse.json({ error: objectTypes.error }, { status: 422 });

  const admin = createAdminSupabase();

  // Seed the cursor to the current change_log tip for this tenant, so only
  // future events are delivered.
  const { data: tip } = await admin
    .from("change_log")
    .select("id, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  const secret = `whsec_${randomBytes(24).toString("hex")}`;

  const { data, error } = await admin
    .from("webhooks")
    .insert({
      tenant_id: tenantId,
      name,
      url,
      secret,
      object_types: objectTypes.objectTypes,
      cursor_ts: tip?.created_at ?? null,
      cursor_id: tip?.id ?? null,
      created_by: userId,
    })
    .select("id, name, url, secret, object_types, active, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ webhook: data }, { status: 201 });
}
