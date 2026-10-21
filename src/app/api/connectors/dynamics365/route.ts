import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { CONNECTOR_ID, loadD365, publicState } from "@/lib/connectors/d365/server";
import { saveConnection, type SaveBody } from "@/lib/connectors/d365/save";

// Dynamics 365 connector setup (admin only).
// GET    -- the setup and WHICH secrets are stored, never their values
// PUT    { config, secrets?: { client_secret?, certificate?, private_key?, password? } }
//        a blank or missing secret means "unchanged", never "clear"
// DELETE -- disconnect; records already synced and their links stay

async function adminCtx() {
  const a = await requireTenantUser();
  if (a.role !== "admin") throw { status: 403, message: "Forbidden" };
  return a;
}

function err(e: unknown) {
  const x = e as { status?: number; message?: string };
  return NextResponse.json({ error: x.message ?? "Unexpected error" }, { status: x.status ?? 500 });
}

export async function GET() {
  try {
    const { tenantId } = await adminCtx();
    return NextResponse.json(publicState(await loadD365(createAdminSupabase(), tenantId)));
  } catch (e) {
    return err(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { tenantId, userId } = await adminCtx();
    const body = (await req.json().catch(() => null)) as SaveBody | null;
    return NextResponse.json(await saveConnection(createAdminSupabase(), tenantId, userId, body));
  } catch (e) {
    return err(e);
  }
}

export async function DELETE() {
  try {
    const { tenantId } = await adminCtx();
    await createAdminSupabase().from("tenant_connectors").delete().eq("tenant_id", tenantId).eq("connector_id", CONNECTOR_ID);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
