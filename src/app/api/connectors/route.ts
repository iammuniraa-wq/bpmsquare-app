import { NextResponse } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { listTenantConnectors } from "@/lib/connectors/server";
import { CONNECTOR_CATALOG } from "@/lib/connectors/registry";

export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const connected = await listTenantConnectors(supabase, tenantId);
  return NextResponse.json({ catalog: CONNECTOR_CATALOG, connected });
}
