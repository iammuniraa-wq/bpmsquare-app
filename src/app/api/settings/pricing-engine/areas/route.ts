import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";

// Lists every Price Book (pricing_area) the tenant has ever created a config
// version for -- every other pricing-engine route already accepts an `area`
// param and is fully area-scoped (spec: "Price Books... nothing prevents a
// tenant from running more than one"), but nothing previously enumerated
// what areas exist, so the UI could only ever operate on the hardcoded
// "default" area. This is the one new read the picker needs; area creation
// itself is just POST /versions {area} with a fresh name, already built.

export async function GET() {
  let tenantId: string;
  try {
    const auth = await requireTenantUser();
    const perms = await resolvePermissions(auth.supabase, auth.tenantId, auth.userId, auth.role);
    if (!canViewWorkcenter(perms, "pricing")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    tenantId = auth.tenantId;
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }

  const { data, error } = await createAdminSupabase()
    .from("pricing_config_versions")
    .select("pricing_area, status")
    .eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byArea = new Map<string, { area: string; hasPublished: boolean; hasDraft: boolean }>();
  for (const row of data ?? []) {
    const area = row.pricing_area as string;
    const entry = byArea.get(area) ?? { area, hasPublished: false, hasDraft: false };
    if (row.status === "PUBLISHED") entry.hasPublished = true;
    if (row.status === "DRAFT") entry.hasDraft = true;
    byArea.set(area, entry);
  }
  // "default" always appears, even with zero versions yet -- it's the
  // tenant's baseline Price Book and the Setup wizard's own empty state
  // already handles "no draft, no published" gracefully.
  if (!byArea.has("default")) byArea.set("default", { area: "default", hasPublished: false, hasDraft: false });

  const areas = [...byArea.values()].sort((a, b) => (a.area === "default" ? -1 : b.area === "default" ? 1 : a.area.localeCompare(b.area)));
  return NextResponse.json({ areas });
}
