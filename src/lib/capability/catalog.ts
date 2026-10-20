import "server-only";
import { NAV } from "@/lib/constants";
import { SETTINGS_GROUPS, SETTINGS_MENU } from "@/lib/settingsMenu";
import { FIELD_REGISTRY } from "@/lib/fieldRegistry";
import { FEATURE_DEPENDENCIES } from "@/lib/moduleDependencies";
import { OBJECT_FEATURE } from "@/lib/objectFeatures";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { CONNECTOR_CATALOG } from "@/lib/connectors/registry";
import facts from "./facts.generated.json";
import { buildCapabilityCatalog, type CapabilityEntry, type Facts } from "./generate";

// The real inputs, wired. The catalogue describes the PRODUCT (code), never a
// tenant, so one module-level copy is safe to share across requests: nothing a
// tenant writes can change what another tenant is told BPMSquare can do
// (MULTI_TENANT_GUARDRAILS.md: the module-level-cache warning is about tenant data).

let cached: CapabilityEntry[] | null = null;

export function getCapabilityCatalog(): CapabilityEntry[] {
  if (cached) return cached;
  cached = buildCapabilityCatalog({
    facts: facts as unknown as Facts,
    nav: NAV,
    settingsGroups: SETTINGS_GROUPS,
    settings: SETTINGS_MENU,
    registry: FIELD_REGISTRY,
    listSources: Object.entries(LIST_SOURCES).map(([key, s]) => ({
      key, label: s.label, description: s.description,
      feature: (OBJECT_FEATURE[key === "project_hours" ? "projects" : key] as string | null | undefined) ?? null,
    })),
    connectors: CONNECTOR_CATALOG.map((c) => ({ id: c.id, name: c.name, description: c.description })),
    dependencies: FEATURE_DEPENDENCIES,
  });
  return cached;
}

export function catalogById(entries: readonly CapabilityEntry[] = getCapabilityCatalog()): Map<string, CapabilityEntry> {
  return new Map(entries.map((e) => [e.id, e]));
}
