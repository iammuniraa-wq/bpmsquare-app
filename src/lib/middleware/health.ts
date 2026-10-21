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

// ── What the app user may do (Dataverse) ────────────────────────────────────

export const NOT_CHECKED = "Not checked: use Send a test quote";

export type UserAccess = {
  /** The app user holds the System Administrator role, which carries every privilege. */
  isSysAdmin: boolean;
  /** What RetrieveUserPrivileges returned (null = it could not be read). */
  privileges: { id: string | null; name: string | null }[] | null;
  /** Privilege name (lower case) to its id, looked up from the privileges table. */
  ids: Record<string, string>;
};

type Getter = { get(path: string, query?: Record<string, string | undefined>): Promise<unknown> };

/** The roles and privileges of the connected app user: an application user is its OWN systemuser, found
 *  through WhoAmI (which answers for the credential in use, not for any signed-in person). Every step is
 *  allowed to fail: what cannot be read simply leaves the answer undetermined. */
export async function userAccess(client: Getter, privilegeNames: readonly string[] = []): Promise<UserAccess> {
  const none: UserAccess = { isSysAdmin: false, privileges: null, ids: {} };
  let userId: string | undefined;
  try { userId = ((await client.get("WhoAmI")) as { UserId?: string } | null)?.UserId; } catch { return none; }
  if (!userId) return none;
  const out: UserAccess = { ...none };
  try {
    const roles = (await client.get(`systemusers(${userId})/systemuserroles_association`, { $select: "name,roleid" })) as { value?: { name?: string }[] } | null;
    out.isSysAdmin = (roles?.value ?? []).some((r) => r.name?.trim().toLowerCase() === "system administrator");
  } catch { /* undetermined */ }
  if (out.isSysAdmin) return out;
  try {
    const p = (await client.get(`systemusers(${userId})/Microsoft.Dynamics.CRM.RetrieveUserPrivileges`)) as { value?: Record<string, unknown>[] } | null;
    out.privileges = (p?.value ?? []).map((x) => ({ id: typeof x.PrivilegeId === "string" ? x.PrivilegeId : null, name: typeof x.PrivilegeName === "string" ? x.PrivilegeName : null }));
  } catch { /* undetermined */ }
  if (privilegeNames.length && out.privileges?.length) {
    try {
      const filter = privilegeNames.map((n) => `name eq '${n.replace(/'/g, "''")}'`).join(" or ");
      const r = (await client.get("privileges", { $select: "privilegeid,name", $filter: filter })) as { value?: { privilegeid?: string; name?: string }[] } | null;
      for (const x of r?.value ?? []) if (x.privilegeid && x.name) out.ids[x.name.toLowerCase()] = x.privilegeid.toLowerCase();
    } catch { /* names alone are used */ }
  }
  return out;
}

/** True only when every named privilege is confirmed. "False" never means "refused": it means "not confirmed",
 *  and the screen then says to use Send a test quote. */
export function privilegeVerdict(a: UserAccess, names: readonly string[]): boolean {
  if (a.isSysAdmin) return true;
  if (!a.privileges?.length) return false;
  const byName = new Set(a.privileges.map((p) => p.name?.toLowerCase()).filter((x): x is string => !!x));
  const byId = new Set(a.privileges.map((p) => p.id?.toLowerCase()).filter((x): x is string => !!x));
  return names.every((n) => byName.has(n.toLowerCase()) || (a.ids[n.toLowerCase()] !== undefined && byId.has(a.ids[n.toLowerCase()])));
}
