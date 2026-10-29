import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { insertWithMasterRef } from "@/lib/masterRef";
import { diffForLog, logChange } from "@/lib/changeLog";

import { readAllPages } from "@/lib/pagedRead";
// GET /api/suppliers[?group=<supplier group id>] -- every supplier of the workspace; with `group`, only the members of that supplier group
// (a client's approved vendor list). A group of another workspace, or one that does not exist, has no members: an empty list.
export async function GET(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const group = request.nextUrl.searchParams.get("group");
  let memberIds: string[] | null = null;
  if (group) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(group)) return NextResponse.json([]);
    const { data: g } = await supabase.from("supplier_groups").select("id").eq("id", group).eq("tenant_id", tenantId).maybeSingle();
    if (!g) return NextResponse.json([]);
    const { data: m } = await readAllPages((lo, hi) => supabase.from("supplier_group_members").select("supplier_id").eq("tenant_id", tenantId).eq("group_id", group).order("supplier_id", { ascending: true }).range(lo, hi));
    memberIds = ((m ?? []) as { supplier_id: string }[]).map((x) => x.supplier_id);
    if (memberIds.length === 0) return NextResponse.json([]);
  }

  let query = supabase
    .from("suppliers")
    .select("*")
    .eq("tenant_id", tenantId);
  if (memberIds) query = query.in("id", memberIds);
  const { data, error } = await query.order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const { name, type, city, phone, email, gstin, notes } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { data, error } = await insertWithMasterRef(supabase, "suppliers", tenantId, {
      tenant_id: tenantId,
      name: name.trim(),
      type: type ?? "vendor",
      city: city || null,
      phone: phone || null,
      email: email || null,
      gstin: gstin || null,
      notes: notes || null,
      status: "active",
    }, "*");

  if (error || !data) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "suppliers", objectId: data.id, objectLabel: data.name,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("suppliers", {}, { name: name.trim(), type: type ?? "vendor", city, phone, email, gstin, notes }),
  });

  return NextResponse.json(data, { status: 201 });
}
