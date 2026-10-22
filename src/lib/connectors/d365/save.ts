import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/encryption";
import { CONNECTOR_ID, loadD365, publicState, validateConfig } from "./server";
import { checkCertificatePair } from "./jwt";
import { validateOutboundMap } from "@/lib/middleware/payload";
import {
  D365_PRODUCTS, D365_AUTH_MODES, D365_ENTITY_KEYS,
  type D365Config, type D365EntityConfig, type D365EntityKey, type D365OutboundConfig, type D365PublicState,
} from "./types";

// Saving a Dynamics 365 connection, shared by the original connector route and
// /api/middleware/connections so the two can never disagree on what is valid.
// Secrets are write-only: a blank or missing secret means "unchanged", and no
// response ever carries one.

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_.]*(@odata\.bind)?$/;
const SET_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class SaveError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const SCHEDULES = ["off", "hourly", "daily"] as const;

export function cleanEntities(raw: unknown, prev?: Partial<Record<D365EntityKey, D365EntityConfig>>): Partial<Record<D365EntityKey, D365EntityConfig>> {
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
    // A screen that does not know about the per-entity schedule must not wipe it.
    const sched = (SCHEDULES as readonly unknown[]).includes(e.schedule) ? e.schedule : prev?.[key]?.schedule;
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
      ...(sched ? { schedule: sched as "off" | "hourly" | "daily" } : {}),
      // The scope has its own route (Resync tab); a connection save keeps it exactly as stored.
      ...(prev?.[key]?.scope ? { scope: prev[key]!.scope } : {}),
    };
  }
  return out;
}

/** Validate the middleware's outbound maps; throws SaveError naming the field. */
export function cleanOutbound(raw: unknown): D365OutboundConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new SaveError(422, "Outbound mapping must be an object.");
  const r = raw as Record<string, unknown>;
  const out: D365OutboundConfig = {};
  for (const kind of ["quote", "quote_line"] as const) {
    const part = r[kind] as { field_map?: unknown } | undefined;
    if (!part) continue;
    const v = validateOutboundMap(kind, part.field_map);
    if (!v.ok) throw new SaveError(422, `${kind === "quote" ? "Quote" : "Quote line"} mapping: ${v.errors[0].field}: ${v.errors[0].message}`);
    if (Object.keys(v.value).length) out[kind] = { field_map: v.value };
  }
  const p = r.project as { entity_set?: unknown; id_field?: unknown; field_map?: unknown; tasks?: unknown; bom?: unknown } | undefined;
  if (p && typeof p === "object") {
    const v = validateOutboundMap("project", p.field_map);
    if (!v.ok) throw new SaveError(422, `Project mapping: ${v.errors[0].field}: ${v.errors[0].message}`);
    const set = (x: unknown) => (typeof x === "string" && SET_RE.test(x.trim()) ? x.trim() : undefined);
    const child = (x: unknown) => {
      if (!x || typeof x !== "object") return undefined;
      const c = x as { entity_set?: unknown; link_field?: unknown };
      const es = set(c.entity_set);
      if (!es) return undefined;
      const lf = typeof c.link_field === "string" && FIELD_RE.test(c.link_field.trim()) ? c.link_field.trim() : undefined;
      return { entity_set: es, ...(lf ? { link_field: lf } : {}) };
    };
    const project = {
      entity_set: set(p.entity_set), id_field: set(p.id_field),
      field_map: Object.keys(v.value).length ? v.value : undefined,
      tasks: child(p.tasks), bom: child(p.bom),
    };
    if (Object.values(project).some((x) => x !== undefined)) out.project = project;
  }
  return Object.keys(out).length ? out : undefined;
}

export type SaveBody = { config?: Partial<D365Config> & { outbound?: unknown }; secrets?: Record<string, string> };

/**
 * Validate and store a connection. Returns the public state (never a secret).
 * Settings the sender did not mention (the middleware's pick-list choices, its
 * outbound maps, per-entity schedules) are kept as they were; `null` clears.
 */
export async function saveConnection(admin: SupabaseClient, tenantId: string, userId: string, body: SaveBody | null): Promise<D365PublicState> {
  const c = body?.config;
  if (!c) throw new SaveError(422, "config is required");
  if (!D365_PRODUCTS.includes(c.product as never) || !D365_AUTH_MODES.includes(c.auth_mode as never)) {
    throw new SaveError(422, "Choose the Dynamics 365 product and a login type.");
  }
  const prev = await loadD365(admin, tenantId);
  const p = prev?.cfg;
  const s = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

  // undefined = keep what was stored; null or blank = clear it.
  const keep = <T,>(incoming: unknown, stored: T | undefined, clean: (v: unknown) => T | undefined): T | undefined => {
    if (incoming === undefined) return stored;
    if (incoming === null || incoming === "") return undefined;
    return clean(incoming);
  };
  const date = (v: unknown) => {
    const x = s(v, 10);
    if (!x || !DATE_RE.test(x) || Number.isNaN(Date.parse(`${x}T00:00:00Z`))) throw new SaveError(422, "Enter the secret's expiry as a date, e.g. 2027-04-19.");
    return x;
  };
  const guid = (what: string) => (v: unknown) => {
    const x = s(v, 40);
    if (!x || !GUID_RE.test(x)) throw new SaveError(422, `Choose the ${what} from the list.`);
    return x;
  };
  const rawOutbound = (c as { outbound?: unknown }).outbound;

  const cfg: D365Config = {
    product: c.product!,
    auth_mode: c.auth_mode!,
    environment_url: s(c.environment_url) ?? "",
    directory_id: s(c.directory_id, 100),
    client_id: s(c.client_id, 60),
    company: s(c.company, 60),
    username: s(c.username, 200),
    schedule: c.schedule === "hourly" || c.schedule === "daily" ? c.schedule : "off",
    entities: cleanEntities(c.entities, p?.entities),
    secret_expires_on: keep(c.secret_expires_on, p?.secret_expires_on, date),
    price_list_id: keep(c.price_list_id, p?.price_list_id, guid("price list")),
    currency_id: keep(c.currency_id, p?.currency_id, guid("currency")),
    outbound: rawOutbound === undefined ? p?.outbound : rawOutbound === null ? undefined : cleanOutbound(rawOutbound),
    // The sales order maps are edited through the middleware Mapping API only; a connection save keeps them.
    orders: p?.orders,
  };
  for (const k of ["secret_expires_on", "price_list_id", "currency_id", "outbound", "orders"] as const) if (cfg[k] === undefined) delete cfg[k];
  await validateConfig(cfg).catch((e: { status?: number; message?: string }) => { throw new SaveError(e.status ?? 422, e.message ?? "Invalid configuration"); });

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
    if (problem) throw new SaveError(422, problem);
  }
  // Anything that changes WHO we sign in as, or WHERE, invalidates the cached
  // token -- and a different app/directory invalidates the delegated refresh
  // token too.
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
  if (error) throw new SaveError(500, error.message);
  return publicState(await loadD365(admin, tenantId));
}
