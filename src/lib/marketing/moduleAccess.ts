import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { DEFAULT_WFM_CONFIG, type TenantConfig, type TenantFeatures } from "@/lib/constants";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { canCreateWorkcenter, canDeleteWorkcenter, canEditWorkcenter, canViewWorkcenter, requireWorkcenterView, resolvePermissions } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import type { WorkcenterKey } from "@/lib/workcenters";
import { isSchemaPending } from "./pending";

// The start of every route and page of the small marketing modules (WhatsApp, Attribution, Events).
// How tenant isolation holds (MULTI_TENANT_GUARDRAILS.md):
//   - every route begins with moduleAccess() -> requireTenantUser(); the tenantId used afterwards is only
//     the one that returns, never a body or query field;
//   - the workspace must own `marketing` AND the module's own platform-admin flag(s), otherwise the answer
//     is 404, exactly like a route that does not exist;
//   - the module tables that carry a trust claim are select-only for members, so writes use the service-role
//     client and EVERY query on it chains .eq("tenant_id", tenantId).

export type ModuleSpec = {
  /** The module's own platform-admin flag. */
  flag: keyof TenantFeatures;
  /** Other flags the module needs (besides `marketing`, always required). */
  also?: (keyof TenantFeatures)[];
  workcenter: WorkcenterKey;
  /** For the "waiting for a database update" sentence. */
  label: string;
  migrations: string;
};

export type ModuleAction = "view" | "create" | "edit" | "delete";

export type ModuleCtx = {
  /** The session client: RLS applies. */
  supabase: SupabaseClient;
  /** The service-role client: bypasses RLS. Always with a tenant filter. */
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  email: string | null;
  tenant: {
    name: string;
    slug: string;
    isDemo: boolean;
    customDomain: string | null;
    config: TenantConfig;
    features: Partial<TenantFeatures>;
    timezone: string;
  };
  can: { view: boolean; create: boolean; edit: boolean; delete: boolean };
};

export function moduleEnabled(spec: Pick<ModuleSpec, "flag" | "also">, features: Partial<TenantFeatures> | null | undefined): boolean {
  if (features?.marketing !== true || features?.[spec.flag] !== true) return false;
  return (spec.also ?? []).every((k) => features?.[k] === true);
}

export async function moduleAccess(spec: ModuleSpec, action: ModuleAction): Promise<ModuleCtx> {
  const a = await requireTenantUser();
  const admin = createAdminSupabase();
  const [user, tenant] = await Promise.all([
    getAuthUser(),
    admin.from("tenants").select("name, slug, is_demo, custom_domain, config, features").eq("id", a.tenantId).maybeSingle(),
  ]);
  const t = tenant.data as { name: string; slug: string; is_demo: boolean | null; custom_domain: string | null; config: TenantConfig | null; features: Partial<TenantFeatures> | null } | null;
  if (!t || !moduleEnabled(spec, t.features)) throw { status: 404, message: "Not found" };
  const perms = await resolvePermissions(a.supabase, a.tenantId, a.userId, a.role);
  const can = {
    view: canViewWorkcenter(perms, spec.workcenter), create: canCreateWorkcenter(perms, spec.workcenter),
    edit: canEditWorkcenter(perms, spec.workcenter), delete: canDeleteWorkcenter(perms, spec.workcenter),
  };
  if (!can[action]) throw { status: 403, message: "Forbidden" };
  const config = (t.config ?? {}) as TenantConfig;
  const tz = config.wfm?.timezone;
  return {
    ...a, admin, email: user?.email ?? null, can,
    tenant: {
      name: t.name, slug: t.slug, isDemo: t.is_demo === true, customDomain: t.custom_domain, config, features: t.features ?? {},
      timezone: typeof tz === "string" && tz ? tz : DEFAULT_WFM_CONFIG.timezone,
    },
  };
}

export const pendingMessage = (spec: Pick<ModuleSpec, "label" | "migrations">): string =>
  `${spec.label} is waiting for a database update (migrations ${spec.migrations} have not been applied to this database).`;

export function moduleErrorResponse(spec: Pick<ModuleSpec, "label" | "migrations">, e: unknown): Response {
  const err = e as { status?: number; message?: string; extra?: Record<string, unknown> };
  if (typeof err.status !== "number") {
    if (isSchemaPending(err)) return Response.json({ error: pendingMessage(spec), pending_migration: true }, { status: 503 });
    console.error(`${spec.label} route failed:`, e);
  }
  return Response.json(
    { error: typeof err.status === "number" ? (err.message ?? "Unexpected error") : "Unexpected error", ...(typeof err.status === "number" ? (err.extra ?? {}) : {}) },
    { status: err.status ?? 500 },
  );
}

/** The start of every page: the workcenter, every flag, then the context. A workspace without the module gets "not found". */
export async function modulePage(spec: ModuleSpec, action: ModuleAction = "view"): Promise<ModuleCtx> {
  await requireWorkcenterView(spec.workcenter);
  await requireFeature("marketing");
  await requireFeature(spec.flag);
  for (const k of spec.also ?? []) await requireFeature(k);
  try {
    return await moduleAccess(spec, action);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 404 || status === 403) notFound();
    throw e;
  }
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
