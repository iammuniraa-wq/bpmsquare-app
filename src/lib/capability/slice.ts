import type { CapabilityEntry } from "./generate";
import type { AreaId } from "@/lib/studio/types";

// Which part of the catalogue the model sees when it rates one area of a
// business (docs/process-design-studio-architecture.md section 6.2): the entries
// of the modules that area touches, plus the cross-cutting ones, and the
// `capability_ids` enum of its answer is built from exactly that set. Small
// enough to read, sharp enough to answer, and a citation outside it cannot exist.

/** Modules each guided area can be covered by. Keys are TenantFeatures flags. */
export const AREA_MODULES: Record<AreaId, string[]> = {
  sales: ["accounts", "contacts", "leads", "pipeline", "quotations", "standard_quotes", "quote_lines_dw", "invoices", "partners", "estimator", "products", "pricing_engine"],
  service: ["cases", "assets", "work_orders", "technicians", "dispatch", "amc", "quotations", "invoices", "accounts", "contacts", "partners", "products"],
  production: ["estimator", "products", "purchasing", "dispatch", "fence_projects", "work_orders", "assets", "wfm_projects"],
  procurement: ["purchasing", "suppliers", "rfq", "products", "estimator"],
  workforce: ["wfm", "wfm_projects", "business_roles", "technicians"],
  pricing: ["pricing_engine", "pricing_engine_quotes", "estimator", "standard_quotes", "quotations", "products", "coverage_model"],
  marketing: ["marketing", "leads", "partners", "accounts", "contacts"],
  finance: ["invoices", "outbound_email", "accounts"],
};

/** Always in the slice: how people and data get in and out, who sees what, and reporting. */
export const CROSS_CUTTING_MODULES = [
  "reports", "ai_reports", "data_workbench", "db_export", "business_roles", "administration", "change_history",
  "outbound_email", "ai_assistant",
];

/** Kinds that are noise for a fit question (hundreds of tools, a development hook): left out of the slice. */
const SLICE_EXCLUDED_KINDS = new Set(["mcp", "extension_point"]);

export function sliceForArea(
  catalog: readonly CapabilityEntry[],
  area: AreaId,
  opts: { includeUnreleased?: boolean } = {},
): CapabilityEntry[] {
  const modules = new Set([...AREA_MODULES[area], ...CROSS_CUTTING_MODULES]);
  return catalog.filter((e) => {
    if (SLICE_EXCLUDED_KINDS.has(e.kind)) return false;
    if (e.status !== "live" && !opts.includeUnreleased) return false;
    // Platform-level entries (company settings, the REST API, connectors, custom
    // fields) belong to every area; module entries only to the areas that use them.
    if (e.module === null) return true;
    return modules.has(e.module);
  });
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** One compact line per entry for the prompt: id | label | plain [limit]. */
export function catalogueLine(e: CapabilityEntry): string {
  return `${e.id} | ${e.label} | ${clip(e.plain, 170)}${e.caveat ? ` [limit: ${e.caveat}]` : ""}`;
}
