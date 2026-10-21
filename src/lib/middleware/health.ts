import { SQL_BUNDLES } from "./types";

// Pure parts of the Connections tab: secret expiry, schema health rows and the
// pick-lists read from the ERP. Nothing here is server-only.

export const SECRET_WARN_DAYS = 30;

export type SecretExpiry = { state: "unknown" | "ok" | "soon" | "expired"; expires_on: string | null; days_left: number | null };

/** The client secret's expiry as a person needs it: how long is left, and
 *  whether to warn (30 days before, and after). */
export function secretExpiry(expiresOn: string | null | undefined, now: Date = new Date()): SecretExpiry {
  if (!expiresOn || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return { state: "unknown", expires_on: null, days_left: null };
  const end = Date.parse(`${expiresOn}T23:59:59Z`);
  if (Number.isNaN(end)) return { state: "unknown", expires_on: null, days_left: null };
  const days = Math.floor((end - now.getTime()) / 86_400_000);
  return { state: days < 0 ? "expired" : days <= SECRET_WARN_DAYS ? "soon" : "ok", expires_on: expiresOn, days_left: days };
}

/** The tables the middleware module needs, and the SQL that creates each. */
export const REQUIRED_TABLES = [
  { table: "integration_messages", label: "Message log", bundle: SQL_BUNDLES.middleware },
  { table: "tenant_connectors", label: "ERP connections", bundle: SQL_BUNDLES.connectors },
  { table: "connector_links", label: "Links to ERP records", bundle: SQL_BUNDLES.connectors },
  { table: "connector_sync_runs", label: "Sync history", bundle: SQL_BUNDLES.connectors },
] as const;

export type SchemaRow = { table: string; label: string; exists: boolean; bundle: string | null };

export function schemaRows(exists: Record<string, boolean>): SchemaRow[] {
  return REQUIRED_TABLES.map((t) => ({ table: t.table, label: t.label, exists: exists[t.table] === true, bundle: exists[t.table] === true ? null : t.bundle }));
}

// ── Pick-lists ──────────────────────────────────────────────────────────────

export type PickItem = { id: string; name: string; code: string | null };

/** `pricelevels?$select=name,pricelevelid,statecode` -- active price lists only. */
export function parsePriceLists(json: unknown): PickItem[] {
  const rows = ((json as { value?: Record<string, unknown>[] } | null)?.value ?? []);
  return rows
    .filter((r) => typeof r.pricelevelid === "string" && (r.statecode === undefined || r.statecode === 0))
    .map((r) => ({ id: r.pricelevelid as string, name: typeof r.name === "string" && r.name.trim() ? r.name : "Price list", code: null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `transactioncurrencies?$select=currencyname,isocurrencycode,transactioncurrencyid,statecode`. */
export function parseCurrencies(json: unknown): PickItem[] {
  const rows = ((json as { value?: Record<string, unknown>[] } | null)?.value ?? []);
  return rows
    .filter((r) => typeof r.transactioncurrencyid === "string" && (r.statecode === undefined || r.statecode === 0))
    .map((r) => ({
      id: r.transactioncurrencyid as string,
      name: typeof r.currencyname === "string" && r.currencyname.trim() ? r.currencyname : String(r.isocurrencycode ?? "Currency"),
      code: typeof r.isocurrencycode === "string" ? r.isocurrencycode : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Permission probes ───────────────────────────────────────────────────────

export type PermissionCheck = { id: string; label: string; ok: boolean | null; fix: string | null };

/** What a probe's error means for a person. null ok = could not be checked from here. */
export function probeResult(id: string, label: string, e: { status?: number; message?: string } | null): PermissionCheck {
  if (!e) return { id, label, ok: true, fix: null };
  if (e.status === 403 || /privilege|permission|principal/i.test(e.message ?? "")) {
    return { id, label, ok: false, fix: "Give the app user a role that can read this, then check again." };
  }
  if (e.status === 401) return { id, label, ok: false, fix: "The login was refused. Test the connection first." };
  if (e.status === 404) return { id, label, ok: false, fix: "This table is not in the environment. Check the entity under Mapping." };
  return { id, label, ok: null, fix: "Could not check this just now. Try again, or use Send a test quote." };
}
