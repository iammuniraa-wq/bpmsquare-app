import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { encrypt } from "@/lib/encryption";
import { CONNECTOR_ID, loadD365, publicState, validateConfig } from "@/lib/connectors/d365/server";
import { checkCertificatePair } from "@/lib/connectors/d365/jwt";
import { D365_PRODUCTS, D365_AUTH_MODES, D365_ENTITY_KEYS, type D365Config, type D365EntityConfig, type D365EntityKey } from "@/lib/connectors/d365/types";

// Dynamics 365 connector setup (admin only).
// GET    -- the setup and WHICH secrets are stored, never their values
// PUT    { config, secrets?: { client_secret?, certificate?, private_key?, password? } }
//        a blank or missing secret means "unchanged", never "clear"
// DELETE -- disconnect; records already synced and their links stay

async function adminCtx() {
  const a = await requireTenantUser();
  if (a.role !== "admin") throw { status: 403, message: "Forbidden" };
  return a;
}

function err(e: unknown) {
  const x = e as { status?: number; message?: string };
  return NextResponse.json({ error: x.message ?? "Unexpected error" }, { status: x.status ?? 500 });
}

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_.]*(@odata\.bind)?$/;
const SET_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function cleanEntities(raw: unknown): Partial<Record<D365EntityKey, D365EntityConfig>> {
  const out: Partial<Record<D365EntityKey, D365EntityConfig>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of D365_ENTITY_KEYS) {
    const e = (raw as Record<string, unknown>)[key] as Partial<D365EntityConfig> | undefined;
    if (!e || typeof e !== "object") continue;
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(e.field_map ?? {})) {
      if (typeof v !== "string" || !v.trim() || k.length > 120 || v.length > 300) continue;
      // Pull maps name an external field; push maps hold a template.
      if (key === "fence_projects" ? !FIELD_RE.test(k) : !(/^[a-z_]+$/.test(k) && FIELD_RE.test(v.trim()))) continue;
      map[k] = v.trim();
    }
    const field = (v: unknown) => (typeof v === "string" && SET_RE.test(v.trim()) ? v.trim() : undefined);
    out[key] = {
      enabled: e.enabled === true,
      entity_set: field(e.entity_set) ?? "",
      id_field: field(e.id_field) ?? "id",
      key_field: field(e.key_field),
      modified_field: field(e.modified_field),
      // A filter is OData text sent to the customer's own Dynamics; bounded,
      // and never interpolated into anything of ours.
      filter: typeof e.filter === "string" && e.filter.trim() ? e.filter.trim().slice(0, 500) : undefined,
      field_map: map,
    };
  }
  return out;
}

export async function GET() {
  try {
    const { tenantId } = await adminCtx();
    return NextResponse.json(publicState(await loadD365(createAdminSupabase(), tenantId)));
  } catch (e) {
    return err(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { tenantId, userId } = await adminCtx();
    const body = (await req.json().catch(() => null)) as { config?: Partial<D365Config>; secrets?: Record<string, string> } | null;
    const c = body?.config;
    if (!c) return NextResponse.json({ error: "config is required" }, { status: 422 });
    if (!D365_PRODUCTS.includes(c.product as never) || !D365_AUTH_MODES.includes(c.auth_mode as never)) {
      return NextResponse.json({ error: "Choose the Dynamics 365 product and a login type." }, { status: 422 });
    }
    const s = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
    const cfg: D365Config = {
      product: c.product!,
      auth_mode: c.auth_mode!,
      environment_url: s(c.environment_url) ?? "",
      directory_id: s(c.directory_id, 100),
      client_id: s(c.client_id, 60),
      company: s(c.company, 60),
      username: s(c.username, 200),
      schedule: c.schedule === "hourly" || c.schedule === "daily" ? c.schedule : "off",
      entities: cleanEntities(c.entities),
    };
    await validateConfig(cfg);

    const admin = createAdminSupabase();
    const prev = await loadD365(admin, tenantId);
    const { data: row } = await admin.from("tenant_connectors").select("credentials").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).maybeSingle();
    const creds = { ...((row?.credentials ?? {}) as Record<string, string>) };
    const secrets = body?.secrets ?? {};
    for (const k of ["client_secret", "certificate", "private_key", "password"] as const) {
      const v = typeof secrets[k] === "string" ? secrets[k].trim() : "";
      if (v) creds[k] = encrypt(v.slice(0, 20000)) ?? "";
    }
    const newCert = typeof secrets.certificate === "string" ? secrets.certificate.trim() : "";
    const newKey = typeof secrets.private_key === "string" ? secrets.private_key.trim() : "";
    if (newCert || newKey) {
      // Check the pair as it will be stored: a new half against the stored
      // other half, so a renewed certificate with the old key is caught now.
      const problem = checkCertificatePair(newCert || prev?.creds.certificate || undefined, newKey || prev?.creds.private_key || undefined);
      if (problem) return NextResponse.json({ error: problem }, { status: 422 });
    }
    // Anything that changes WHO we sign in as, or WHERE, invalidates the
    // cached token -- and a different app/directory invalidates the
    // delegated refresh token too.
    const p = prev?.cfg;
    const identityChanged = !p || p.product !== cfg.product || p.auth_mode !== cfg.auth_mode || p.environment_url !== cfg.environment_url
      || p.directory_id !== cfg.directory_id || p.client_id !== cfg.client_id || p.username !== cfg.username
      || Object.keys(secrets).some((k) => typeof secrets[k] === "string" && secrets[k].trim());
    if (identityChanged) { delete creds.access_token; delete creds.expires_at; }
    if (!p || p.directory_id !== cfg.directory_id || p.client_id !== cfg.client_id || p.auth_mode !== cfg.auth_mode) delete creds.refresh_token;

    const { error } = await admin.from("tenant_connectors").upsert({
      tenant_id: tenantId, connector_id: CONNECTOR_ID, status: identityChanged ? "error" : (prev?.status ?? "error"),
      last_error: identityChanged ? "Not tested yet — press Test connection." : prev?.last_error ?? null,
      config: cfg as unknown as Record<string, string>, credentials: creds, connected_by: userId,
      connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id,connector_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(publicState(await loadD365(admin, tenantId)));
  } catch (e) {
    return err(e);
  }
}

export async function DELETE() {
  try {
    const { tenantId } = await adminCtx();
    await createAdminSupabase().from("tenant_connectors").delete().eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
