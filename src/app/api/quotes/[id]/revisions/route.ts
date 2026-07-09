import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

// Returns all revisions (sibling quotes) that share the same base ref as this quote.
// Base ref is derived by stripping the trailing -R{n} suffix.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;

  const { data: self } = await supabase
    .from("quotes")
    .select("ref")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (!self) return NextResponse.json([], { status: 200 });

  const baseRef = String(self.ref).replace(/-R\d+$/, "");

  const { data } = await supabase
    .from("quotes")
    .select("id, ref, status, revision, created_at")
    .eq("tenant_id", tenantId)
    .like("ref", `${baseRef}%`)
    .order("revision", { ascending: true });

  return NextResponse.json(data ?? [], { status: 200 });
}
