import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { loadMasters } from "@/lib/contractProjects/server";
import { resolveElementsSettings, type ElementsSettings } from "./types";

// Shared by the project and tender servers of buildings and elements: the workspace settings, the element type list, the "not there yet" test.

/** A column or table that migration 0253 / 0254 adds is not in the database yet. */
export const isMissingElementSchema = (e: { code?: string } | null | undefined): boolean =>
  !!e && (e.code === "42P01" || e.code === "42703" || e.code === "PGRST204" || e.code === "PGRST205");

export async function loadElementSettings(): Promise<ElementsSettings> {
  const tenant = await getTenant();
  return resolveElementsSettings(tenant?.config?.contract_elements);
}

export type ElementTypeChoice = { code: string; name: string };

/** The ACTIVE element types of the workspace, for the type picker and for checking a typed one. */
export async function loadElementTypes(admin: SupabaseClient, tenantId: string): Promise<ElementTypeChoice[]> {
  const rows = await loadMasters(admin, tenantId, "element_type", { activeOnly: true });
  return rows.map((r) => ({ code: r.code, name: r.name }));
}

/**
 * Buildings and element codes are an add-on of Contract projects (the platform-admin flag `contract_buildings`, default off). A workspace without it
 * sees none of it: its routes answer 404, its screens render nothing.
 */
export async function buildingsOn(supabase: SupabaseClient, tenantId: string): Promise<boolean> {
  return (await tenantHasFeature(supabase, tenantId, "contract_projects")) && (await tenantHasFeature(supabase, tenantId, "contract_buildings"));
}

export type Failure = { status: number; error: string; extra?: Record<string, unknown> };
export type Result<T> = ({ ok: true } & T) | ({ ok: false } & Failure);
export const fail = (status: number, error: string, extra?: Record<string, unknown>): { ok: false } & Failure => ({ ok: false, status, error, ...(extra ? { extra } : {}) });

export const chunks = <T,>(a: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};
