import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_INPUT_ROWS = 2000;
const MAX_SPAN_DAYS = 366;
const MAX_EXPANDED_ROWS = 5000;

type InputRow = {
  employee?: string; date_from?: string; date_to?: string; shift?: string; site?: string;
  day_off?: string; note?: string;
};

function truthy(v: string | undefined): boolean {
  if (!v) return false;
  return ["yes", "y", "true", "1"].includes(v.trim().toLowerCase());
}

/** Inclusive YYYY-MM-DD range, capped so one row can't accidentally ask for
 *  a decade of dates. Noon UTC sidesteps DST drift shifting the date itself. */
function dateRange(from: string, to: string): string[] | null {
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (end < start) return null;
  const out: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
    if (out.length > MAX_SPAN_DAYS) return null;
  }
  return out;
}

// POST /api/wfm/roster/bulk-upload -- one row per employee, covering a
// single day OR a date range (a week, a month, however long) -- each row is
// free to carry its own shift/site/day-off/note, unlike POST /api/wfm/roster,
// which applies ONE set of values across many employees x dates (right for
// "put this group on nights all week", wrong for "here is next month's
// actual roster, everyone different"). A range is expanded into one
// wfm_roster_assignments row per date, same as the manual From/To tool on
// this page already does -- the table itself is still daily-grain, a range
// is purely an input convenience. Rows arrive already parsed client-side
// (src/lib/import/parse.ts's parseImportFile -- the same engine Data
// Workbench uses for reading .xlsx/.csv) -- this route, and the Roster
// screen's own upload button, are deliberately NOT wired into the Data
// Workbench registry (owner request 2026-09-09: keep this on the Roster page
// itself, not a generic importer).
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, userId } = ctx;

  const body = await request.json().catch(() => null);
  const rows = (body as { rows?: InputRow[] } | null)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows to upload" }, { status: 400 });
  }
  if (rows.length > MAX_INPUT_ROWS) {
    return NextResponse.json({ error: `Upload at most ${MAX_INPUT_ROWS} rows at once -- split the file up` }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const [{ data: employees }, { data: shifts }, { data: sites }] = await Promise.all([
    admin.from("employees").select("id, employee_code, first_name, last_name").eq("tenant_id", tenantId),
    admin.from("wfm_shifts").select("id, name").eq("tenant_id", tenantId),
    admin.from("wfm_sites").select("id, name").eq("tenant_id", tenantId),
  ]);

  const byCode = new Map(
    (employees ?? []).filter((e) => e.employee_code).map((e) => [String(e.employee_code).trim().toLowerCase(), e.id as string])
  );
  const byName = new Map(
    (employees ?? []).map((e) => [`${e.first_name} ${e.last_name}`.trim().toLowerCase(), e.id as string])
  );
  const shiftByName = new Map((shifts ?? []).map((s) => [String(s.name).trim().toLowerCase(), s.id as string]));
  const siteByName = new Map((sites ?? []).map((s) => [String(s.name).trim().toLowerCase(), s.id as string]));

  const skipped: { row: number; reason: string }[] = [];
  // Keyed by employee_id|date so a repeated pair -- whether from two rows or
  // from two OVERLAPPING ranges in the same file -- can't reach the upsert
  // twice; Postgres rejects an upsert batch that touches the same conflict
  // key more than once. The later row in the file wins throughout.
  const byKey = new Map<string, { row: number; data: Record<string, unknown> }>();
  let expandedCount = 0;
  let capped = false;

  rows.forEach((r, i) => {
    const rowNum = i + 2; // header occupies row 1
    if (capped) return;

    const employeeKey = (r.employee ?? "").trim().toLowerCase();
    if (!employeeKey) { skipped.push({ row: rowNum, reason: "Missing employee" }); return; }
    const employeeId = byCode.get(employeeKey) ?? byName.get(employeeKey);
    if (!employeeId) { skipped.push({ row: rowNum, reason: `Unknown employee "${r.employee}"` }); return; }

    const dateFrom = (r.date_from ?? "").trim();
    const dateTo = (r.date_to ?? "").trim() || dateFrom;
    if (!DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
      skipped.push({ row: rowNum, reason: `Invalid date "${r.date_from || r.date_to}" (use YYYY-MM-DD)` });
      return;
    }
    const dates = dateRange(dateFrom, dateTo);
    if (!dates) {
      skipped.push({ row: rowNum, reason: dateTo < dateFrom ? "Date To is before Date From" : `Date range longer than ${MAX_SPAN_DAYS} days` });
      return;
    }

    const isDayOff = truthy(r.day_off);
    let shiftId: string | null = null;
    if (!isDayOff && r.shift?.trim()) {
      const found = shiftByName.get(r.shift.trim().toLowerCase());
      if (!found) { skipped.push({ row: rowNum, reason: `Unknown shift "${r.shift}"` }); return; }
      shiftId = found;
    }
    let siteId: string | null = null;
    if (r.site?.trim()) {
      const found = siteByName.get(r.site.trim().toLowerCase());
      if (!found) { skipped.push({ row: rowNum, reason: `Unknown site "${r.site}"` }); return; }
      siteId = found;
    }
    if (!isDayOff && !shiftId && !siteId && !r.note?.trim()) {
      skipped.push({ row: rowNum, reason: "Nothing to apply (no shift, site, day off, or note)" });
      return;
    }

    for (const date of dates) {
      if (expandedCount >= MAX_EXPANDED_ROWS) { capped = true; break; }
      expandedCount++;
      const key = `${employeeId}|${date}`;
      if (byKey.has(key)) {
        skipped.push({ row: byKey.get(key)!.row, reason: `Duplicate for ${r.employee} on ${date} -- row ${rowNum} used instead` });
      }
      byKey.set(key, {
        row: rowNum,
        data: {
          tenant_id: tenantId, employee_id: employeeId, date,
          shift_id: shiftId, site_id: siteId, is_day_off: isDayOff,
          note: r.note?.trim() || null, created_by: userId,
        },
      });
    }
  });

  if (capped) {
    return NextResponse.json(
      { error: `That file expands to more than ${MAX_EXPANDED_ROWS} employee x date rows -- split it into smaller batches` },
      { status: 400 }
    );
  }

  const toInsert = [...byKey.values()].map((v) => v.data);
  if (toInsert.length === 0) {
    return NextResponse.json({ applied: 0, skipped });
  }

  const { data, error } = await admin
    .from("wfm_roster_assignments")
    .upsert(toInsert, { onConflict: "tenant_id,employee_id,date" })
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ applied: data?.length ?? 0, skipped });
}
