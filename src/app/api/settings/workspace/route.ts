import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export async function PATCH(request: NextRequest) {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const patch: { name?: string; accent_color?: string } = {};

  if ("name" in body) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    patch.name = body.name.trim();
  }

  if ("accent_color" in body) {
    if (typeof body.accent_color !== "string" || !HEX_COLOR.test(body.accent_color)) {
      return NextResponse.json({ error: "accent_color must be a hex colour like #378ADD" }, { status: 400 });
    }
    patch.accent_color = body.accent_color;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const { error } = await admin.from("tenants").update(patch).eq("id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(patch);
}
