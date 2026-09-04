import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmEmployee } from "@/lib/wfm/server";
import { pushConfigured, vapidPublicKey } from "@/lib/wfm/push";

// Push subscriptions for the signed-in employee's own device.
//
// requireWfmEmployee, not requireWfm: a subscription belongs to a person, and
// the employee id is taken from the SESSION -- never from the request body --
// so nobody can register a device against somebody else's name.

// GET — what the browser needs before it can subscribe.
export async function GET() {
  try {
    await requireWfmEmployee();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // The public key is public by design (it ships to every browser); the
  // private half never leaves the server.
  return NextResponse.json({ configured: pushConfigured(), public_key: vapidPublicKey() });
}

// POST {endpoint, keys:{p256dh, auth}} — remember this device.
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmEmployee();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, employee } = ctx;

  const body = await request.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "endpoint and keys are required" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  // Upsert on the endpoint: the same device re-subscribing (after a permission
  // reset, or a browser rotating its endpoint) must update its row rather than
  // leave a stale one behind that we would keep pushing to forever.
  const { error } = await admin
    .from("wfm_push_subscriptions")
    .upsert(
      {
        tenant_id: tenantId,
        employee_id: employee.id,
        endpoint,
        p256dh,
        auth,
        user_agent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
      },
      { onConflict: "endpoint" }
    );
  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json({ error: "Notifications aren't set up on this database yet." }, { status: 503 });
    }
    console.error("push subscribe failed:", error.message);
    return NextResponse.json({ error: "Could not save the subscription" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// DELETE ?endpoint= — this device no longer wants notifications.
export async function DELETE(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmEmployee();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const endpoint = request.nextUrl.searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ error: "endpoint is required" }, { status: 400 });

  const admin = createAdminSupabase();
  // Scoped to the caller's own employee id as well as the endpoint, so a
  // known endpoint string can't be used to unsubscribe someone else.
  await admin
    .from("wfm_push_subscriptions")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("employee_id", ctx.employee.id)
    .eq("endpoint", endpoint);
  return NextResponse.json({ ok: true });
}
