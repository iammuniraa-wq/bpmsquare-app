import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { authenticateKiosk } from "@/lib/wfm/kiosk";
import { getWfmConfig } from "@/lib/wfm/server";
import { faceConfigured } from "@/lib/wfm/face";

// POST /api/wfm/kiosk/session — the tablet's one-time setup validation and
// its reconnect check. Bearer device token is the whole credential (the
// kiosk has no user session; middleware lets /api/wfm/kiosk/* through and
// authenticateKiosk() is the real gate). Returns just enough to label the
// idle screen.
export async function POST(request: NextRequest) {
  const admin = createAdminSupabase();
  const device = await authenticateKiosk(request, admin);
  if (!device) return NextResponse.json({ error: "Invalid kiosk code" }, { status: 401 });

  const config = await getWfmConfig(admin, device.tenant_id);
  if (config.face_punch === "off") {
    return NextResponse.json({ error: "Face punch is switched off for this workspace" }, { status: 403 });
  }

  const [{ data: site }, { data: tenant }] = await Promise.all([
    admin.from("wfm_sites").select("name").eq("id", device.site_id).eq("tenant_id", device.tenant_id).maybeSingle(),
    admin.from("tenants").select("name").eq("id", device.tenant_id).maybeSingle(),
  ]);

  return NextResponse.json({
    ok: true,
    device_name: device.name,
    site_name: site?.name ?? null,
    tenant_name: tenant?.name ?? null,
    face_ready: faceConfigured(),
  });
}
