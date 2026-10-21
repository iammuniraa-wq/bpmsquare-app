import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import type { TenantConfig } from "@/lib/constants";
import { sealIntegrationPush, unsealIntegrationPush } from "@/lib/webhookPush";
import { assertPublicHttpUrl } from "@/lib/net/safeHost";

export async function GET() {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await createAdminSupabase()
    .from("tenants")
    .select("config")
    .eq("id", tenantId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Stored sealed (tenants.config is readable by every member); the admin who manages it sees the real value.
  return NextResponse.json(unsealIntegrationPush((data?.config as TenantConfig | null)?.integration_push ?? {}));
}

export async function PATCH(request: NextRequest) {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  type EndpointInput = { id?: string; name: string; webhook_url: string; regenerate_secret?: boolean };
  const body: { webhook_url?: string; regenerate_secret?: boolean; endpoints?: EndpointInput[] } = await request.json();

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin
    .from("tenants")
    .select("config")
    .eq("id", tenantId)
    .single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const currentConfig = (current?.config ?? {}) as TenantConfig;
  const currentPush = currentConfig.integration_push ?? {};

  // These URLs are fetched by OUR server, so a private or internal address is refused here
  // and again at send time (lib/webhookPush.ts).
  const urlsToCheck = [body.webhook_url, ...(Array.isArray(body.endpoints) ? body.endpoints.map((e) => e?.webhook_url) : [])]
    .filter((u): u is string => typeof u === "string" && u.trim() !== "");
  for (const u of urlsToCheck) {
    try {
      await assertPublicHttpUrl(u.trim());
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 422 });
    }
  }

  // Named ERP endpoints (Coverage's multi-ERP routing) -- full-array
  // replace, same "blank secret means unchanged" convention Account 360's
  // external sources already use: an entry with a matching id keeps its
  // secret unless it asks to regenerate; a new entry (no id) gets a fresh
  // id + secret. Omitting an existing entry from the array removes it.
  let endpoints = currentPush.endpoints ?? [];
  if (Array.isArray(body.endpoints)) {
    const byId = new Map(endpoints.map((e) => [e.id, e]));
    endpoints = body.endpoints
      .filter((e) => e.name?.trim() && e.webhook_url?.trim())
      .map((e) => {
        const existing = e.id ? byId.get(e.id) : undefined;
        return {
          id: existing?.id ?? randomBytes(8).toString("hex"),
          name: e.name.trim(),
          webhook_url: e.webhook_url.trim(),
          webhook_secret: existing && !e.regenerate_secret ? existing.webhook_secret : randomBytes(24).toString("hex"),
        };
      });
  }

  const merged = {
    ...currentPush,
    ...(body.webhook_url !== undefined ? { webhook_url: body.webhook_url || undefined } : {}),
    ...(body.regenerate_secret ? { webhook_secret: randomBytes(24).toString("hex") } : {}),
    endpoints,
  };

  const { error } = await admin
    .from("tenants")
    .update({ config: { ...currentConfig, integration_push: sealIntegrationPush(merged) } })
    .eq("id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(unsealIntegrationPush(merged));
}
