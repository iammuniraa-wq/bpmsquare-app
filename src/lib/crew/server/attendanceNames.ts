import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { namesForAliases } from "@/lib/wfm/crewReads";
import { renderWithNames, type AliasMap } from "../attendance/alias";

// Names are put back only here, when the screen of a viewer who is already allowed to see the finding is built (design 5.4). The stored text keeps the run's
// aliases (P4, S1); the map that resolves them (crew_runs.alias_map) is service-role only and is read for exactly the runs on that screen, tenant-scoped.

export type AliasRenderer = (text: string) => string;

export async function aliasRenderers(admin: SupabaseClient, tenantId: string, runIds: readonly string[]): Promise<Map<string, AliasRenderer>> {
  const out = new Map<string, AliasRenderer>();
  const ids = [...new Set(runIds)].slice(0, 100);
  if (ids.length === 0) return out;
  const { data } = await admin.from("crew_runs").select("id, alias_map").eq("tenant_id", tenantId).in("id", ids);
  const maps = new Map<string, AliasMap>();
  for (const r of (data ?? []) as { id: string; alias_map: AliasMap | null }[]) {
    if (r.alias_map && typeof r.alias_map === "object") maps.set(r.id, { persons: r.alias_map.persons ?? {}, sites: r.alias_map.sites ?? {} });
  }
  const names = await namesForAliases(
    admin, tenantId,
    [...new Set([...maps.values()].flatMap((m) => Object.values(m.persons)))],
    [...new Set([...maps.values()].flatMap((m) => Object.values(m.sites)))],
  );
  for (const [runId, m] of maps) {
    out.set(runId, (text) => renderWithNames(text, (alias) => {
      const person = m.persons[alias];
      if (person) return names.employees.get(person) ?? null;
      const site = m.sites[alias];
      return site ? names.sites.get(site) ?? null : null;
    }));
  }
  return out;
}

/** The people a recheck note would reach, by name, for the viewer who may send it. Only ids that were stored on the proposal by the run. */
export async function recheckTargets(admin: SupabaseClient, tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const { employees } = await namesForAliases(admin, tenantId, [...new Set(ids)], []);
  return employees;
}
