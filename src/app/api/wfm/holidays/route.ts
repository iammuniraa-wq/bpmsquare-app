import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const APPLIES_TO = ["all", "full_time", "contractor"];

// GET /api/wfm/holidays — the tenant holiday calendar, optionally ?year=YYYY.
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId } = ctx;
  const year = request.nextUrl.searchParams.get("year");

  let query = supabase.from("wfm_holidays").select("id, date, name, applies_to").eq("tenant_id", tenantId).order("date");
  if (year && /^\d{4}$/.test(year)) query = query.gte("date", `${year}-01-01`).lte("date", `${year}-12-31`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/wfm/holidays — add a holiday.
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId } = ctx;

  const body = await request.json().catch(() => null);
  const { date, name, applies_to } = (body ?? {}) as { date?: string; name?: string; applies_to?: string };
  if (!date || !DATE_RE.test(date) || !name?.trim()) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) and name are required" }, { status: 400 });
  }
  const appliesTo = applies_to && APPLIES_TO.includes(applies_to) ? applies_to : "all";

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("wfm_holidays")
    .insert({ tenant_id: tenantId, date, name: name.trim(), applies_to: appliesTo })
    .select("id, date, name, applies_to")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "A holiday for that date and audience already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
