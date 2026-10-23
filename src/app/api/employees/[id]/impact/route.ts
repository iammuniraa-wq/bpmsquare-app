import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { loadEmployeeImpact } from "@/lib/wfm/employeeImpact";
import { employeesAdminGuard } from "../../_guard";

// GET /api/employees/[id]/impact -- what deleting this employee would destroy.
// Read-only; the DELETE handler recomputes the same counts server-side.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await employeesAdminGuard());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data: employee } = await supabase.from("employees").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!employee) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    return NextResponse.json(await loadEmployeeImpact(createAdminSupabase(), tenantId, id));
  } catch (e) {
    console.error("employee impact failed:", (e as Error).message);
    return NextResponse.json({ error: "Could not check this employee's records" }, { status: 500 });
  }
}
