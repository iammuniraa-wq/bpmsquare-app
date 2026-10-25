import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { listTenantConnectors } from "@/lib/connectors/server";
import { CONNECTOR_CATALOG, visibleConnectors } from "@/lib/connectors/registry";
import type { TenantFeatures } from "@/lib/constants";

// Connectors whose stored configuration (addresses, endpoint maps) is for admins only: a member still sees the tile and
// whether it is connected, but not what it is pointed at.
const ADMIN_ONLY_CONFIG = new Set(["epromis"]);

export async function GET() {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const connected = await listTenantConnectors(supabase, tenantId);
  const { data } = await createAdminSupabase().from("tenants").select("features").eq("id", tenantId).maybeSingle();
  const features = (data?.features ?? {}) as Partial<TenantFeatures>;
  // A connector that lives only on the Integration middleware page is not a tile for a workspace without that module,
  // and one that belongs to a sold module (ePROMIS: the tender module) is not a tile without it.
  const catalog = visibleConnectors(features.integration_middleware === true, CONNECTOR_CATALOG, features as Record<string, boolean | undefined>);
  return NextResponse.json({
    catalog,
    connected: connected
      .filter((c) => catalog.some((d) => d.id === c.connector_id))
      .map((c) => (role !== "admin" && ADMIN_ONLY_CONFIG.has(c.connector_id) ? { ...c, config: {} } : c)),
  });
}
