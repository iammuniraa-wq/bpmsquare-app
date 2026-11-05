import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase, getAuthUser, requireTenantUser } from "@/lib/supabase-server";
import { canViewWorkcenter, resolvePermissions, type PermissionSet } from "@/lib/permissions";
import { agentEntry, availableAgents, type AgentEntry } from "../registry";
import type { AgentKey } from "../types";
import type { Viewer } from "../core/visibility";
import { requireWfm } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { loadCrewTenant, type CrewTenant } from "./tenant";

// The one door for every AI automation route and page (design section 3.6 and 5.5): the session, the workspace from the HOST (never from the
// request), the `crew` flag, the agent's own flags, and the AI automation workcenter. Any miss is the same 404, so a workspace without the
// module learns nothing. Reads of findings are filtered here per viewer, because these tables carry no member policy.

export type CrewCtx = {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  userEmail: string | null;
  role: "admin" | "member";
  perms: PermissionSet;
  tenant: CrewTenant;
  agents: AgentEntry[];
};

export type Door = { ok: true; ctx: CrewCtx; entry: AgentEntry | null } | { ok: false; res: NextResponse };

const fail = (status: number, error: string): Door => ({ ok: false, res: NextResponse.json({ error }, { status }) });

export async function openCrew(agent?: string | null, opts: { adminOnly?: boolean } = {}): Promise<Door> {
  let base;
  try {
    base = await requireTenantUser();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return fail(err.status ?? 401, err.message ?? "Unauthorized");
  }
  const admin = createAdminSupabase();
  const tenant = await loadCrewTenant(admin, base.tenantId);
  if (!tenant || tenant.features.crew !== true) return fail(404, "Not found");
  const perms = await resolvePermissions(base.supabase, base.tenantId, base.userId, base.role);
  if (!canViewWorkcenter(perms, "crew")) return fail(404, "Not found");
  const agents = availableAgents(tenant.features);
  let entry: AgentEntry | null = null;
  if (agent) {
    entry = agentEntry(agent) ?? null;
    if (!entry || !agents.some((a) => a.key === entry!.key)) return fail(404, "Not found");
  }
  if (opts.adminOnly && base.role !== "admin") return fail(403, "Only a workspace admin can do this");
  const user = await getAuthUser();
  return { ok: true, entry, ctx: { supabase: base.supabase, admin, tenantId: base.tenantId, userId: base.userId, userEmail: user?.email ?? null, role: base.role, perms, tenant, agents } };
}

/** The pure facts the visibility rules (core/visibility.ts) need about the signed-in person. */
export const viewerOf = (ctx: Pick<CrewCtx, "role" | "userId" | "perms">): Viewer => ({ role: ctx.role, userId: ctx.userId, pipeline: canViewWorkcenter(ctx.perms, "pipeline") });

export const AGENT_KEYS: readonly AgentKey[] = ["tender_watch", "attendance"];

/**
 * The viewer with their attendance scope when it matters: a supervisor (not an admin) in a workspace that has the attendance agent. The scope is
 * resolveWfmScope, the same answer the live board uses, so "who can see a finding" cannot drift from "whose rows can I see".
 */
export async function viewerWithScope(ctx: Pick<CrewCtx, "role" | "userId" | "perms" | "agents">): Promise<Viewer> {
  const v = viewerOf(ctx);
  if (ctx.role === "admin" || !ctx.agents.some((a) => a.key === "attendance")) return v;
  try {
    const wfm = await requireWfm();
    if (!wfm.isSupervisor) return v;
    const scope = await resolveWfmScope(wfm);
    return { ...v, attendance: { unrestricted: scope.unrestricted, employeeIds: scope.employeeIds, siteIds: scope.siteIds } };
  } catch {
    return v;
  }
}
