import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm } from "@/lib/wfm/server";
import { generateKioskToken, hashKioskToken } from "@/lib/wfm/kiosk";

// Kiosk device management — TENANT ADMIN only (not just any supervisor):
// registering a device hands out a standing credential that can punch for
// every enrolled employee, which is an admin-grade grant. This route runs
// inside the normal app session (it is NOT on the middleware bypass list —
// only the tablet's own session/identify/punch endpoints are).

async function requireWfmAdmin() {
  const ctx = await requireWfm();
  if (ctx.role !== "admin") {
    const err = new Error("Admin only") as Error & { status: number };
    err.status = 403;
    throw err;
  }
  return ctx;
}

export async function GET() {
  try {
    const ctx = await requireWfmAdmin();
    const admin = createAdminSupabase();
    const { data } = await admin
      .from("wfm_kiosk_devices")
      .select("id, name, site_id, active, last_seen_at, created_at, wfm_sites(name)")
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: false });
    return NextResponse.json(
      (data ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        site_id: d.site_id,
        site_name: (Array.isArray(d.wfm_sites) ? d.wfm_sites[0] : d.wfm_sites)?.name ?? null,
        active: d.active,
        last_seen_at: d.last_seen_at,
        created_at: d.created_at,
      }))
    );
  } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}

// POST {name, site_id} — register a tablet. The plaintext token appears in
// THIS response only; we store its hash. Losing it means registering a
// fresh device and deactivating the old one — by design, same as API keys.
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireWfmAdmin();
    const admin = createAdminSupabase();
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const siteId = typeof body?.site_id === "string" ? body.site_id : "";
    if (!name || !siteId) {
      return NextResponse.json({ error: "name and site_id are required" }, { status: 400 });
    }

    const { data: site } = await admin
      .from("wfm_sites")
      .select("id")
      .eq("id", siteId)
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle();
    if (!site) return NextResponse.json({ error: "Unknown site" }, { status: 400 });

    const token = generateKioskToken();
    const { data, error } = await admin
      .from("wfm_kiosk_devices")
      .insert({ tenant_id: ctx.tenantId, site_id: siteId, name, token_hash: hashKioskToken(token) })
      .select("id")
      .single();
    if (error || !data) {
      console.error("kiosk device insert failed:", error?.message);
      return NextResponse.json({ error: "Could not register the device" }, { status: 500 });
    }
    return NextResponse.json({ id: data.id, token });
  } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}

// PATCH {id} — issue a NEW code for an existing kiosk, keeping its name,
// site and history. The old code stops working the instant this returns.
//
// This is the answer to the two situations that actually happen:
//   - the tablet was wiped / factory reset, so it lost its stored code, and
//     the original plaintext is unrecoverable by design;
//   - the code leaked (typed into the wrong device, forwarded in a chat).
//
// Without it, both forced a brand-new device row and left the old one
// hanging around, so the Kiosks list slowly filled with dead entries and
// nobody could tell which row was the tablet on the wall.
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireWfmAdmin();
    const admin = createAdminSupabase();
    const body = await request.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const token = generateKioskToken();
    // Tenant-scoped, so a device id from another tenant simply matches
    // nothing rather than having its credential rotated.
    const { data, error } = await admin
      .from("wfm_kiosk_devices")
      .update({ token_hash: hashKioskToken(token), active: true })
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId)
      .select("id, name")
      .maybeSingle();
    if (error) {
      console.error("kiosk device rotate failed:", error.message);
      return NextResponse.json({ error: "Could not issue a new code" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ id: data.id, name: data.name, token });
  } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}

// DELETE ?id= — deactivate (kept as an audit row; the token stops working
// immediately because authenticateKiosk filters on active).
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireWfmAdmin();
    const admin = createAdminSupabase();
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    await admin
      .from("wfm_kiosk_devices")
      .update({ active: false })
      .eq("id", id)
      .eq("tenant_id", ctx.tenantId);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
