import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { CONNECTOR_ID } from "@/lib/connectors/d365/server";

// GET -- the last 40 sync/push runs and how many records each entity has
// linked so far (admin).
export async function GET() {
  let tenantId: string;
  try {
    const a = await requireTenantUser();
    if (a.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    tenantId = a.tenantId;
  } catch (e) {
    const x = e as { status?: number; message?: string };
    return NextResponse.json({ error: x.message ?? "Unauthorized" }, { status: x.status ?? 401 });
  }
  const admin = createAdminSupabase();
  const { data: runs, error } = await admin.from("connector_sync_runs").select("*").eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID)
    .order("started_at", { ascending: false }).limit(40);
  if (error) return NextResponse.json({ runs: [], linked: {}, pending_migration: true });
  const linked: Record<string, number> = {};
  for (const entity of ["customers", "contacts", "vendors", "products", "projects", "fence_projects"]) {
    const { count } = await admin.from("connector_links").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID).eq("entity", entity);
    linked[entity] = count ?? 0;
  }
  return NextResponse.json({ runs: runs ?? [], linked });
}
