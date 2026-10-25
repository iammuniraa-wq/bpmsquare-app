import { NextResponse, NextRequest } from "next/server";
import { openTenderDealRequest, PENDING_BIDS } from "@/lib/tender/dealAccess";
import { diffBids } from "@/lib/tender/bids/rules";
import { listBidVersions, loadBidVersion } from "@/lib/tender/bids/server";

// GET /api/opportunities/[id]/tender/bids/compare?from=1&to=2 -- what changed between two submitted versions: lines added, removed
// and changed (qty, rate, unit, wording), and the total's change in amount and percent. Read-only.

const versionParam = (v: string | null) => (v && /^\d{1,6}$/.test(v) && Number(v) >= 1 ? Number(v) : null);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, tenantId } = gate.req;
  const sp = request.nextUrl.searchParams;
  const from = versionParam(sp.get("from"));
  const to = versionParam(sp.get("to"));
  if (from === null || to === null) return NextResponse.json({ error: "from and to must be version numbers" }, { status: 400 });
  if (from === to) return NextResponse.json({ error: "Pick two different versions" }, { status: 422 });

  const [a, b] = await Promise.all([loadBidVersion(admin, tenantId, id, from), loadBidVersion(admin, tenantId, id, to)]);
  if (!a || !b) {
    const { pending } = await listBidVersions(admin, tenantId, id);
    return NextResponse.json({ error: pending ? PENDING_BIDS : "Version not found" }, { status: pending ? 503 : 404 });
  }
  return NextResponse.json({ from, to, currency: b.currency ?? a.currency, diff: diffBids(a, b) });
}
