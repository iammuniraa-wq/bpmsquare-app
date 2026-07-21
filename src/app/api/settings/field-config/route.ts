import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig } from "@/lib/fieldConfig";

export async function GET(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { searchParams } = new URL(request.url);
  const objectType = searchParams.get("object");
  if (!objectType) return NextResponse.json({ error: "object is required" }, { status: 400 });

  const result = await getEffectiveFieldConfig(supabase, tenantId, objectType);
  return NextResponse.json(result);
}
