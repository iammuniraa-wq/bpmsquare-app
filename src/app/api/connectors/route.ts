import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { listTenantConnectors } from "@/lib/connectors/server";
import { CONNECTOR_CATALOG, visibleConnectors } from "@/lib/connectors/registry";
import { flagOn } from "@/lib/middleware/ops";

export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const connected = await listTenantConnectors(supabase, tenantId);
  // A connector that lives only on the Integration middleware page is not a tile for a workspace without that module.
  const catalog = visibleConnectors(await flagOn(createAdminSupabase(), tenantId), CONNECTOR_CATALOG);
  return NextResponse.json({ catalog, connected: connected.filter((c) => catalog.some((d) => d.id === c.connector_id)) });
}
