import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter, canEditWorkcenter } from "@/lib/permissions";

// PricingEngine config versions (spec §7). Gated on the "pricing" workcenter
// (Business Role scoped -- an admin is always unrestricted) rather than a
// blunt admin-only check, per the owner decision that Pricing gets its own
// Business Role. All pricing tables are select-only under RLS -- these
// service-role routes are the only write path, which is what makes the
// draft->publish state machine enforceable at all.

async function requireView() {
  const auth = await requireTenantUser();
  const perms = await resolvePermissions(auth.supabase, auth.tenantId, auth.userId, auth.role);
  if (!canViewWorkcenter(perms, "pricing")) throw { status: 403, message: "Forbidden" };
  return auth;
}

async function requireEdit() {
  const auth = await requireTenantUser();
  const perms = await resolvePermissions(auth.supabase, auth.tenantId, auth.userId, auth.role);
  if (!canEditWorkcenter(perms, "pricing")) throw { status: 403, message: "Forbidden" };
  return auth;
}

export async function GET(req: Request) {
  let tenantId: string;
  try {
    ({ tenantId } = await requireView());
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  const area = new URL(req.url).searchParams.get("area") ?? "default";

  const { data, error } = await createAdminSupabase()
    .from("pricing_config_versions")
    .select("version, status, dsl_version, notes, created_at, published_at")
    .eq("tenant_id", tenantId)
    .eq("pricing_area", area)
    .order("version", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ area, versions: data ?? [] });
}

// POST { area?, notes?, clone_from? } — create a new DRAFT version, optionally
// cloning an existing version's components/procedures/rules/cost models.
export async function POST(req: Request) {
  let tenantId: string, userId: string;
  try {
    ({ tenantId, userId } = await requireEdit());
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const area = typeof body.area === "string" && body.area.trim() ? body.area.trim() : "default";
  const cloneFrom = typeof body.clone_from === "number" ? body.clone_from : null;

  const admin = createAdminSupabase();

  const { data: latest } = await admin
    .from("pricing_config_versions")
    .select("version")
    .eq("tenant_id", tenantId)
    .eq("pricing_area", area)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((latest?.version as number) ?? 0) + 1;

  const { data: created, error } = await admin
    .from("pricing_config_versions")
    .insert({
      tenant_id: tenantId, pricing_area: area, version: nextVersion,
      status: "DRAFT", notes: (body.notes as string) ?? null, created_by: userId,
    })
    .select("version, status, dsl_version, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (cloneFrom !== null) {
    // Copy the versioned entities; dimensions and cost inputs are
    // version-independent and need no copying.
    for (const table of ["pricing_components", "pricing_procedures", "pricing_rules", "pricing_cost_models"] as const) {
      const { data: rows, error: readErr } = await admin
        .from(table).select("*").eq("tenant_id", tenantId).eq("config_version", cloneFrom);
      if (readErr) return NextResponse.json({ error: `Clone failed reading ${table}: ${readErr.message}` }, { status: 500 });
      if (!rows?.length) continue;
      const copies = rows.map((r) => {
        const { id: _id, created_at: _c, ...rest } = r as Record<string, unknown>;
        return { ...rest, config_version: nextVersion };
      });
      const { error: writeErr } = await admin.from(table).insert(copies);
      if (writeErr) return NextResponse.json({ error: `Clone failed writing ${table}: ${writeErr.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({ area, version: created }, { status: 201 });
}
