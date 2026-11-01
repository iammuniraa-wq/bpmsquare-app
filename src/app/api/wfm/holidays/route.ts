import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm, requireWfmSupervisor, getWfmConfig } from "@/lib/wfm/server";
import { HOLIDAY_CHECK_PENDING, resolveHolidayAudience } from "@/lib/wfm/holidayAudience";


// Capped per route, not via vercel.json. That config carried
// "src/app/api/wfm/**": { maxDuration: 60 } from 2026-10-03 and it never
// took effect -- on 2026-10-07 these routes still ran the full 300s during a
// Supabase connectivity blip, while /api/wfm/summary, the one route with this
// export, stopped at 60. The glob matches directories, not source files. A
// hung request holds a Fluid instance other requests are sharing, so this
// bounds the blast radius as much as the bill.
export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/wfm/holidays — the tenant holiday calendar, optionally ?year=YYYY.
// Any WFM-linked login can read it (not just supervisors) -- a holiday
// calendar isn't sensitive, and employees need it for "next holiday" on
// their own Workforce home.
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfm();
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
  // The label travels with the row so a screen without the workspace's type list (My Workforce) can name the audience.
  const types = (await getWfmConfig(supabase, tenantId)).employment_types;
  return NextResponse.json((data ?? []).map((h) => ({
    ...h,
    applies_to_label: h.applies_to === "all" ? "Everyone" : (types.find((t) => t.code === h.applies_to)?.label ?? h.applies_to),
  })));
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
  const { date, name, applies_to } = (body ?? {}) as { date?: string; name?: string; applies_to?: string | string[] };
  if (!date || !DATE_RE.test(date) || !name?.trim()) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) and name are required" }, { status: 400 });
  }
  const admin = createAdminSupabase();
  const audience = resolveHolidayAudience(applies_to, (await getWfmConfig(admin, tenantId)).employment_types, true);
  if ("error" in audience) return NextResponse.json({ error: audience.error }, { status: 400 });

  // One row per audience (the unique key is tenant, date, applies_to), each removable on its own.
  const { data, error } = await admin
    .from("wfm_holidays")
    .insert(audience.codes.map((code) => ({ tenant_id: tenantId, date, name: name.trim(), applies_to: code })))
    .select("id, date, name, applies_to");
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json({ error: "A holiday for that date and audience already exists" }, { status: 409 });
    }
    // The table's old CHECK only allows all/full_time/contractor until migration 0244 is run.
    if (code === "23514") return NextResponse.json({ error: HOLIDAY_CHECK_PENDING }, { status: 400 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data && data.length === 1 ? data[0] : data);
}
