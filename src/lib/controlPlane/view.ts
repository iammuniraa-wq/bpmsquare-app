import type { InstanceRow } from "./registry";
import { readStoredSummary, type InstanceSummary } from "./summary";

// The /admin/instances screen's data, shaped once on the server so the client component only draws it. Pure: no database, no env.

export type InstanceState = "healthy" | "unreachable" | "planned" | "unchecked" | "retired";

export type InstanceCard = {
  /** Null for the app the console itself runs on. */
  id: string | null;
  name: string;
  slug: string;
  url: string | null;
  region: string | null;
  build: string | null;
  state: InstanceState;
  problem: string | null;
  tenants: number | null;
  users: number | null;
  lastSeen: string | null;
};

export type TenantLine = {
  key: string;
  instanceId: string | null;
  instanceName: string;
  tenantId: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  users: number;
  isDemo: boolean;
};

export const LOCAL_NAME = "This app";

export function localCard(s: InstanceSummary): InstanceCard {
  return {
    id: null,
    name: s.instance.name || LOCAL_NAME,
    slug: s.instance.slug,
    url: null,
    region: s.instance.region,
    build: s.instance.build,
    state: s.health.db ? "healthy" : "unreachable",
    problem: s.health.db ? null : "The database did not answer",
    tenants: s.tenants.length,
    users: s.tenants.reduce((n, t) => n + t.user_count, 0),
    lastSeen: s.instance.now,
  };
}

export function instanceCard(row: InstanceRow): InstanceCard {
  const summary = readStoredSummary(row.last_summary);
  const failed = typeof row.last_summary?.fetch_error === "string" ? row.last_summary.fetch_error : null;
  let state: InstanceState;
  if (row.status === "planned") state = "planned";
  else if (row.status === "retired") state = "retired";
  else if (failed) state = "unreachable";
  else if (summary && summary.health.db) state = "healthy";
  else if (summary) state = "unreachable";
  else state = "unchecked";
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.base_url,
    region: summary?.instance.region ?? row.region,
    build: summary?.instance.build ?? null,
    state,
    problem: failed ?? (summary && !summary.health.db ? "The database did not answer" : null),
    tenants: summary ? summary.tenants.length : null,
    users: summary ? summary.tenants.reduce((n, t) => n + t.user_count, 0) : null,
    lastSeen: row.last_seen_at,
  };
}

export function tenantLines(local: InstanceSummary, rows: InstanceRow[]): TenantLine[] {
  const lines: TenantLine[] = [];
  const add = (instanceId: string | null, instanceName: string, s: InstanceSummary) => {
    for (const t of s.tenants) {
      lines.push({
        key: `${instanceId ?? "local"}:${t.id}`, instanceId, instanceName, tenantId: t.id, name: t.name, slug: t.slug,
        plan: t.plan, status: t.status, users: t.user_count, isDemo: t.is_demo,
      });
    }
  };
  add(null, local.instance.name || LOCAL_NAME, local);
  for (const r of rows) {
    const s = readStoredSummary(r.last_summary);
    if (s && r.status === "active") add(r.id, r.name, s);
  }
  return lines;
}
