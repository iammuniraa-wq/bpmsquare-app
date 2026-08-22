import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { insertWithMasterRef } from "@/lib/masterRef";
import { diffForLog, logChange } from "@/lib/changeLog";

export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const { name, sku, category, sub_category, uom, description } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const record = {
    tenant_id: tenantId,
    name: name.trim(),
    sku: sku || null,
    category: category || null,
    sub_category: sub_category || null,
    uom: uom || null,
    description: description || null,
    list_price: num(body.list_price),
    cost_price: num(body.cost_price),
    tax_percent: num(body.tax_percent),
    status: "active",
  };

  const { data, error } = await insertWithMasterRef(supabase, "products", tenantId, record, "*");
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "products", objectId: data.id, objectLabel: data.name,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("products", {}, record as unknown as Record<string, unknown>),
  });

  return NextResponse.json(data, { status: 201 });
}
