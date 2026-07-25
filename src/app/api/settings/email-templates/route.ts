import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import type { EmailTemplateCategory } from "@/lib/types";

const CATEGORIES: EmailTemplateCategory[] = ["quote", "invoice", "report"];

export async function GET(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const category = request.nextUrl.searchParams.get("category");

  let query = supabase.from("email_templates").select("*").eq("tenant_id", tenantId);
  if (category) query = query.eq("category", category);

  const { data, error } = await query.order("category").order("created_at");
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

  const reqBody = await request.json();
  const { name, category, subject, body } = reqBody;
  if (!name || !subject || !body) {
    return NextResponse.json({ error: "name, subject and body are required" }, { status: 400 });
  }
  if (category && !CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  const resolvedCategory: EmailTemplateCategory = category ?? "quote";
  const isDefault = !!reqBody.is_default;

  // Only one default per category -- unset any existing default first.
  if (isDefault) {
    await supabase.from("email_templates").update({ is_default: false })
      .eq("tenant_id", tenantId).eq("category", resolvedCategory).eq("is_default", true);
  }

  const { data, error } = await supabase
    .from("email_templates")
    .insert({ tenant_id: tenantId, category: resolvedCategory, name, subject, body, is_default: isDefault })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
