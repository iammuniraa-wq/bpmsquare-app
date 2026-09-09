import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const APPLIES_TO = ["all", "full_time", "contractor"];
const MAX_ROWS = 1000;

type InputRow = { date?: string; name?: string; applies_to?: string };

// POST /api/wfm/holidays/bulk-upload -- a whole year's holiday calendar in
// one file instead of one row at a time via POST /api/wfm/holidays. See
// roster/bulk-upload's own header for why this isn't wired into Data
// Workbench (owner request 2026-09-09).
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
  const rows = (body as { rows?: InputRow[] } | null)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No rows to upload" }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Upload at most ${MAX_ROWS} rows at once` }, { status: 400 });
  }

  const skipped: { row: number; reason: string }[] = [];
  // Keyed by date|applies_to, matching the table's own unique constraint --
  // a repeated pair in the same file would otherwise hit Postgres's "ON
  // CONFLICT DO UPDATE command cannot affect row a second time". The later
  // row wins, same as the roster upload's own dedup rule.
  const byKey = new Map<string, { row: number; data: Record<string, unknown> }>();

  rows.forEach((r, i) => {
    const rowNum = i + 2; // header occupies row 1
    const date = (r.date ?? "").trim();
    const name = (r.name ?? "").trim();
    const appliesTo = r.applies_to && APPLIES_TO.includes(r.applies_to.trim().toLowerCase())
      ? r.applies_to.trim().toLowerCase() : "all";
    if (!DATE_RE.test(date)) { skipped.push({ row: rowNum, reason: `Invalid date "${r.date}" (use YYYY-MM-DD)` }); return; }
    if (!name) { skipped.push({ row: rowNum, reason: "Missing name" }); return; }

    const key = `${date}|${appliesTo}`;
    if (byKey.has(key)) {
      skipped.push({ row: byKey.get(key)!.row, reason: `Duplicate row for ${date} -- row ${rowNum} used instead` });
    }
    byKey.set(key, { row: rowNum, data: { tenant_id: tenantId, date, name, applies_to: appliesTo } });
  });

  const toInsert = [...byKey.values()].map((v) => v.data);
  if (toInsert.length === 0) {
    return NextResponse.json({ applied: 0, skipped });
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("wfm_holidays")
    .upsert(toInsert, { onConflict: "tenant_id,date,applies_to" })
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ applied: data?.length ?? 0, skipped });
}
