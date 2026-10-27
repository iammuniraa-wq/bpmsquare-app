import { NextResponse, NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { stageGuard } from "@/lib/tender/approval";
import { standingDecision } from "@/lib/tender/approvalServer";
import { isMissingSchema } from "@/lib/tender/server";
import { openTenderDealRequest, PENDING_BIDS } from "@/lib/tender/dealAccess";
import { parseSubmit, submitProblem } from "@/lib/tender/bids/rules";
import { currentSnapshot, latestVersionNo, listBidVersions } from "@/lib/tender/bids/server";
import { buildCurrentCost, saveCostSnapshot, type SaveCostResult } from "@/lib/tender/bids/costServer";

// GET  /api/opportunities/[id]/tender/bids  -- the versions of a tender deal's bid, newest first, without their lines.
// POST /api/opportunities/[id]/tender/bids  { revision_reason?, note? } -- "Submit bid": snapshot the deal's lines as the next
//   version (no cap; a reason is required from version 2) and move the deal to Submitted through the deal's own stage rules.
//
// A version is never edited or deleted: this file inserts and reads, nothing else, and the table has no write policy and an
// update trigger. The snapshot never carries a cost or a markup (bids/rules.ts builds it from a whitelist). The internal cost of the
// bid is kept apart, in a table nobody but the server reads (bids/costServer.ts, migration 0230), so a project made from the winning
// bid can start from what the bid cost; if that table is not there yet the bid still goes in and the answer says so.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, tenantId } = gate.req;
  const { versions, pending } = await listBidVersions(admin, tenantId, id);
  return NextResponse.json({ versions, pending });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId, userId, opp } = gate.req;
  const body = await request.json().catch(() => ({}));

  const latest = await latestVersionNo(admin, tenantId, id);
  if (latest.pending) return NextResponse.json({ error: PENDING_BIDS }, { status: 503 });
  const versionNo = latest.no + 1;

  const snap = await currentSnapshot(admin, tenantId, id);
  const problem = submitProblem({ stage: opp.stage, outcome: opp.outcome, lineCount: snap.line_count });
  if (problem) return NextResponse.json({ error: problem }, { status: 409 });
  const parsed = parseSubmit(body, versionNo);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: 422 });

  // The move to Submitted goes through the deal's own PATCH (its stage guards included). Ask the same rule first, so a refusal
  // cannot leave a version behind for a bid that did not go in.
  const standing = await standingDecision(admin, tenantId, id);
  const stageProblem = standing.available ? stageGuard({ from: opp.stage, to: "submitted", effective: standing.effective }) : null;
  if (stageProblem) return NextResponse.json({ error: stageProblem }, { status: 409 });

  const cost = await buildCurrentCost(admin, tenantId, id, snap);
  const { data, error } = await admin.from("tender_bid_versions").insert({
    tenant_id: tenantId, opportunity_id: id, version_no: versionNo, submitted_by: userId, currency: opp.currency ?? null,
    total: snap.total, line_count: snap.line_count, lines: snap.lines, note: parsed.value.note, revision_reason: parsed.value.revision_reason,
  }).select("id").maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return NextResponse.json({ error: PENDING_BIDS }, { status: 503 });
    if (error.code === "23505") return NextResponse.json({ error: "Another bid version was just submitted. Reload and review it before submitting again", code: "version_taken" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const costSnapshot: SaveCostResult = await saveCostSnapshot(admin, tenantId, id, versionNo, cost);

  let stageMoved = false;
  let stageError: string | null = null;
  const { PATCH } = await import("@/app/api/opportunities/[id]/route");
  const res = await PATCH(
    new NextRequest(new URL(`/api/opportunities/${id}`, "http://internal.invalid"), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage: "submitted", outcome: "open" }) }),
    { params: Promise.resolve({ id }) },
  );
  if (res.ok) stageMoved = true;
  else stageError = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The deal could not be moved to Submitted";

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "opportunity_tenders", objectId: id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update",
    actorId: user?.id ?? userId, actorEmail: user?.email,
    changes: [
      { field: "bid submitted", from: latest.no > 0 ? `version ${latest.no}` : null, to: `version ${versionNo} · ${opp.currency ?? ""} ${snap.total}`.replace("  ", " ") },
      ...(parsed.value.revision_reason ? [{ field: "bid revision reason", from: null, to: parsed.value.revision_reason }] : []),
    ],
  });

  return NextResponse.json({ ok: true, id: data?.id ?? null, version_no: versionNo, total: snap.total, line_count: snap.line_count, stage_moved: stageMoved, stage_error: stageError, cost_snapshot: costSnapshot }, { status: 201 });
}
