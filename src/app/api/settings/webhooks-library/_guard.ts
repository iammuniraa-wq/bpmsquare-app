import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import type { TenantFeatures } from "@/lib/constants";
import { SQL_BUNDLES } from "@/lib/middleware/types";
import { isCallObject, type CallObject } from "@/lib/webhooks/tokens";

// Every /api/settings/webhooks-library route starts here: a signed-in ADMIN of this host's workspace, in a
// workspace that has the webhooks_library flag. The tenant comes from the session only, never from the body
// or the query. A workspace without the flag gets 404 so the module does not announce itself.

export type LibraryCtx = { supabase: SupabaseClient; admin: SupabaseClient; tenantId: string; userId: string; email: string | null };

export async function guard(): Promise<{ ok: true; ctx: LibraryCtx } | { ok: false; res: NextResponse }> {
  let a: Awaited<ReturnType<typeof requireTenantUser>>;
  try {
    a = await requireTenantUser();
  } catch (e) {
    const x = e as { status?: number; message?: string };
    return { ok: false, res: NextResponse.json({ error: x.message ?? "Unauthorized" }, { status: x.status ?? 401 }) };
  }
  if (a.role !== "admin") return { ok: false, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const admin = createAdminSupabase();
  const { data } = await admin.from("tenants").select("features").eq("id", a.tenantId).maybeSingle();
  if ((data?.features as TenantFeatures | undefined)?.webhooks_library !== true) return { ok: false, res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const u = await getAuthUser();
  return { ok: true, ctx: { supabase: a.supabase, admin, tenantId: a.tenantId, userId: a.userId, email: u?.email ?? null } };
}

/** The explicit "database update needed" answer: a 200 the page renders, never a 500. */
export const needsUpdate = (extra: Record<string, unknown> = {}) => NextResponse.json({ needsDatabaseUpdate: true, bundle: SQL_BUNDLES.webhooks, ...extra });

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function jsonBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  return ((await req.json().catch(() => ({}))) ?? {}) as T;
}

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

export const objectOf = (v: string | null): CallObject | null => (isCallObject(v) ? v : null);
