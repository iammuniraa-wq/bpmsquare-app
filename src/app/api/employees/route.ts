import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { diffForLog, logChange } from "@/lib/changeLog";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cleanDate = (v: unknown) => (typeof v === "string" && DATE_RE.test(v) ? v : null);
const cleanText = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Read is open to any tenant member -- Employees is now an ordinary Master
  // data workcenter (a company directory), gated by Business Role view
  // grants like every other workcenter, not by admin role. Mutations below
  // stay admin-only.
  if (!(await tenantHasFeature(supabase, tenantId, "business_roles"))) {
    return NextResponse.json({ error: "Business Roles isn't enabled for your workspace" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("employees")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("last_name")
    .order("first_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
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
  if (!(await tenantHasFeature(supabase, tenantId, "business_roles"))) {
    return NextResponse.json({ error: "Business Roles isn't enabled for your workspace" }, { status: 403 });
  }

  const body = await request.json();
  const firstName = cleanText(body.first_name);
  if (!firstName) return NextResponse.json({ error: "First name is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("employees")
    .insert({
      tenant_id: tenantId,
      first_name: firstName,
      last_name: cleanText(body.last_name) ?? "",
      employee_code: cleanText(body.employee_code, 50),
      email: cleanText(body.email),
      phone: cleanText(body.phone, 50),
      department: cleanText(body.department),
      designation: cleanText(body.designation),
      valid_from: cleanDate(body.valid_from),
      valid_to: cleanDate(body.valid_to),
      status: body.status === "inactive" ? "inactive" : "active",
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "An employee with this code already exists" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "employees", objectId: data.id,
    objectLabel: `${data.first_name} ${data.last_name}`.trim(),
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("employees", {}, { first_name: data.first_name, last_name: data.last_name, employee_code: data.employee_code, department: data.department }),
  });

  return NextResponse.json(data, { status: 201 });
}
