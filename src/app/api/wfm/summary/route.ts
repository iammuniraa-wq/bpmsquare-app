import { NextResponse, type NextRequest } from "next/server";
import { requireWfmSupervisor } from "@/lib/wfm/server";
import { getMonthlySummary } from "@/lib/wfm/monthlySummary";

const MONTH_RE = /^\d{4}-\d{2}$/;

// GET /api/wfm/summary?month=YYYY-MM — the monthly CA summary (spec §5.6),
// every active employee. Site/employment-type filtering happens client-side
// against this same payload (the dataset is small -- a few hundred rows at
// most for the ~100-employee scale this module targets).
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId } = ctx;

  const month = request.nextUrl.searchParams.get("month");
  if (!month || !MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month (YYYY-MM) is required" }, { status: 400 });
  }

  const summaries = await getMonthlySummary(tenantId, month);
  return NextResponse.json({ month, employees: summaries });
}
