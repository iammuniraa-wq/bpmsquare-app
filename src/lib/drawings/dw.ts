import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { canEditWorkcenter, canViewWorkcenter, resolvePermissions } from "@/lib/permissions";
import type { DrawingCtx } from "./server";

// The Data Workbench gate for the drawing register. The module flag is asked by assertObjectFeature in each route (the one map every
// surface reads). This asks the second question the Pipeline-style objects ask: may THIS person open Engineering (and, to import or update,
// change it)? Every write then uses the service role, because the register's tables have no member write policy (0255): the member's own
// session can read them and nothing more.

export async function drawingDwGate(supabase: SupabaseClient, tenantId: string, userId: string, role: "admin" | "member", mode: "view" | "edit"):
  Promise<{ ok: true; ctx: DrawingCtx } | { ok: false; response: NextResponse }> {
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "drawing_register")) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const canEdit = canEditWorkcenter(perms, "drawing_register");
  if (mode === "edit" && !canEdit) return { ok: false, response: NextResponse.json({ error: "You can view drawings but not change them" }, { status: 403 }) };
  return { ok: true, ctx: { admin: createAdminSupabase(), supabase, tenantId, userId, role, canEdit } };
}
