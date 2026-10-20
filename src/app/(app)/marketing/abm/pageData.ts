import "server-only";
import { notFound } from "next/navigation";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { abmAccess, type AbmCtx } from "@/lib/abm/server";

/**
 * The start of every ABM page: the workcenter and both feature flags
 * (Marketing and the platform-admin ABM flag), then the tenant context.
 * A workspace without ABM gets "not found", exactly like a route that does not exist.
 */
export async function abmPage(): Promise<AbmCtx> {
  await requireWorkcenterView("abm");
  await requireFeature("marketing");
  await requireFeature("abm");
  try {
    return await abmAccess("view");
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 404 || status === 403) notFound();
    throw e;
  }
}

export const fmtDate = (s: string | null | undefined): string => {
  if (!s) return "—";
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};

export const isOverdue = (due: string | null | undefined): boolean => !!due && due < new Date().toISOString().slice(0, 10);
