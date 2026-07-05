import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { data, error } = await supabase
    .from("text_fragments")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("category")
    .order("label");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  let supabase, tenantId, role;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { label, category, text } = body;
  if (!label || !category || !text) {
    return NextResponse.json({ error: "label, category and text are required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("text_fragments")
    .insert({ tenant_id: tenantId, label, category, text })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
