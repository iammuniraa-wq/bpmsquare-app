import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { flagOn } from "@/lib/middleware/ops";
import { SQL_BUNDLES } from "@/lib/middleware/types";

// Every /api/middleware route starts here: a signed-in ADMIN of this host's
// workspace, in a workspace that has the integration_middleware flag. The
// tenant comes from the session only -- never from the request body or query.
// A workspace without the flag gets 404, so the module does not announce itself.

export type MiddlewareCtx = { supabase: SupabaseClient; admin: SupabaseClient; tenantId: string; userId: string };

export async function guard(): Promise<{ ok: true; ctx: MiddlewareCtx } | { ok: false; res: NextResponse }> {
  let a: Awaited<ReturnType<typeof requireTenantUser>>;
  try {
    a = await requireTenantUser();
  } catch (e) {
    const x = e as { status?: number; message?: string };
    return { ok: false, res: NextResponse.json({ error: x.message ?? "Unauthorized" }, { status: x.status ?? 401 }) };
  }
  if (a.role !== "admin") return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const admin = createAdminSupabase();
  if (!(await flagOn(admin, a.tenantId))) return { ok: false, res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { ok: true, ctx: { supabase: a.supabase, admin, tenantId: a.tenantId, userId: a.userId } };
}

/** The explicit "database update needed" answer: a 200 the page renders, never a 500. */
export const needsUpdate = (extra: Record<string, unknown> = {}) =>
  NextResponse.json({ needsDatabaseUpdate: true, bundle: SQL_BUNDLES.middleware, ...extra });

export async function jsonBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  return ((await req.json().catch(() => ({}))) ?? {}) as T;
}

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });
