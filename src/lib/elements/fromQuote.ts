import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLines } from "@/lib/contractProjects/server";
import { BUILDING_CODE_RE, TYPE_CODE_RE } from "./types";

// A project made from a quote has no tender WBS to copy. The quote's lines may carry a free building label and an element type (migration 0253,
// standard_quote_lines.building / element_type); when the project is made those labels become buildings (level-1 WBS items with a code), matched by
// name, and the lines are put in them. A quote with no label at all gives one building, "Main", that holds every line (renamed later on the project).
// Best effort and never fatal: while 0243 or 0253 is pending the project is made without buildings and says so in the log, nothing else changes.

export const MAIN_BUILDING = { code: "MAIN", name: "Main" } as const;

/** The element type a quote line may carry: a 2 to 5 character code, upper-cased; anything else is not an element type. */
export const quoteElementType = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim().toUpperCase() : "";
  return TYPE_CODE_RE.test(t) ? t : null;
};

/** A building label as typed on a quote line: trimmed, one space between words, at most 100 characters. */
export const cleanLabel = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 100) : "";
  return t || null;
};

/**
 * The distinct labels, in the order they first appear, each with the building code it gets: the label itself when it is 1 to 6 letters or digits
 * (B01, A, 12), else B01, B02 ... Two labels that differ only in case or spacing are one building. A code already taken is stepped over.
 */
export function planBuildings(labels: readonly (string | null)[]): { name: string; code: string; key: string }[] {
  const seen = new Map<string, { name: string; code: string; key: string }>();
  const taken = new Set<string>();
  let n = 0;
  for (const label of labels) {
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    let code = label.toUpperCase();
    if (!BUILDING_CODE_RE.test(code) || taken.has(code)) {
      do { n += 1; code = `B${String(n).padStart(2, "0")}`; } while (taken.has(code));
    }
    taken.add(code);
    seen.set(key, { name: label, code, key });
  }
  return [...seen.values()];
}

/**
 * Makes the buildings and puts each budget line in its building. `labels` maps a budget line's source_line_id to its building label; a line with no
 * label goes to "Main" when no line has one, and stays in no building otherwise. Returns a sentence for the log, or null when nothing was made.
 */
export async function applyBuildingLabels(
  admin: SupabaseClient, tenantId: string, userId: string, projectId: string, revisionId: string, labels: Readonly<Record<string, string>>,
): Promise<string | null> {
  const lines = await loadLines(admin, tenantId, revisionId);
  if (lines.length === 0) return null;
  const hasLabels = Object.keys(labels).length > 0;
  const labelOf = (sourceLineId: string | null) => (sourceLineId ? cleanLabel(labels[sourceLineId]) : null);
  const plan = hasLabels ? planBuildings(lines.map((l) => labelOf(l.source_line_id))) : [{ name: MAIN_BUILDING.name, code: MAIN_BUILDING.code, key: MAIN_BUILDING.name.toLowerCase() }];
  if (plan.length === 0) return null;

  const ids = new Map(plan.map((b) => [b.key, randomUUID()]));
  const made = await admin.from("project_work_packages").insert(plan.map((b, i) => ({
    id: ids.get(b.key), tenant_id: tenantId, project_id: projectId, code: String(i + 1), name: b.name, building_code: b.code, sort_order: (i + 1) * 10, code_is_manual: false, created_by: userId,
  })));
  if (made.error) return `Buildings were not made (${made.error.code ?? "error"}); the project has none`;

  const links = lines.flatMap((l, i) => {
    const key = hasLabels ? labelOf(l.source_line_id)?.toLowerCase() : MAIN_BUILDING.name.toLowerCase();
    const id = key ? ids.get(key) : undefined;
    return id ? [{ tenant_id: tenantId, project_id: projectId, package_id: id, line_key: l.line_key, sort_order: i }] : [];
  });
  if (links.length > 0) {
    const put = await admin.from("project_work_package_lines").insert(links);
    if (put.error) return `${plan.length} building${plan.length === 1 ? "" : "s"} made, but the lines could not be put in them`;
  }
  return `${plan.length} building${plan.length === 1 ? "" : "s"} from the quote: ${plan.map((b) => b.code).join(", ")}`;
}
