import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { isPlatformAdmin, adminUpdateTenant } from "@/lib/tenant";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json();

  const allowed = ["name", "slug", "accent_color", "logo_url", "status", "plan", "features", "company_info"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }

  const { error } = await adminUpdateTenant(id, patch as Parameters<typeof adminUpdateTenant>[1]);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Bust the tenant cache so feature/status changes take effect immediately
  revalidateTag("tenant");

  return NextResponse.json({ ok: true });
}
