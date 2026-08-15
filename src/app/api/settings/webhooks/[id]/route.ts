import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

async function requireAdmin() {
  const auth = await requireTenantUser();
  if (auth.role !== "admin") throw { status: 403, message: "Forbidden" };
  return auth;
}

// PATCH: toggle active / rename / repoint URL. Re-enabling a webhook that
// auto-paused on failures also resets its failure counter, so it gets a clean
// run of retries rather than tripping the pause threshold immediately.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let tenantId: string;
  try {
    ({ tenantId } = await requireAdmin());
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.url === "string") {
    if (!/^https:\/\/.+/i.test(body.url.trim())) return NextResponse.json({ error: "`url` must be an https:// URL." }, { status: 422 });
    patch.url = body.url.trim();
  }
  if (typeof body.active === "boolean") {
    patch.active = body.active;
    if (body.active) { patch.failure_count = 0; patch.last_error = null; }
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 422 });

  const { data, error } = await createAdminSupabase()
    .from("webhooks")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id, name, url, object_types, active, failure_count")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  return NextResponse.json({ webhook: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let tenantId: string;
  try {
    ({ tenantId } = await requireAdmin());
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }

  const { id } = await params;
  const { data, error } = await createAdminSupabase()
    .from("webhooks")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  return NextResponse.json({ id: data.id, deleted: true });
}
