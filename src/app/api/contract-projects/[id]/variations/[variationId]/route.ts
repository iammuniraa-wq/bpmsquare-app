import { NextResponse, type NextRequest } from "next/server";
import { parseAction } from "@/lib/contractProjects/approval";
import { loadProject, needsUpdate, openProjectRequest } from "@/lib/contractProjects/server";
import { parseVariation } from "@/lib/contractProjects/variations";
import { decideVariation, editVariation, loadVariation, removeVariation, submitVariation, withdrawVariation } from "@/lib/contractProjects/variationsServer";

// PATCH  /api/contract-projects/[id]/variations/[variationId]
//          { action: "submit" }                     send a draft (or rejected) variation to the people who approve project budgets
//          { action: "withdraw" }                   the person who sent it takes it back; it returns to draft
//          { action: "approve" | "reject", comment? } an approver decides (reject needs a comment). The person who sent it cannot decide
//                                                   it unless the workspace allows self-approval. Approving adds the amount to the project's
//                                                   contract value and opens a budget revision for the cost when the project has an approved
//                                                   baseline and no open revision.
//          { title?, description?, amount?, cost_amount?, change_request_ref?, note? }  edit a draft or rejected variation
// DELETE /api/contract-projects/[id]/variations/[variationId]   remove a draft or rejected variation
// The variation is matched by id AND this project AND this workspace: an id of another project or workspace matches nothing (404).

type Ctx = { params: Promise<{ id: string; variationId: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id, variationId } = await params;
  const { admin, tenantId, canEdit } = gate.req;
  const found = await loadProject(admin, tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const variation = await loadVariation(admin, tenantId, id, variationId);
  if (!variation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const reply = (r: { ok: true } | { ok: false; status: number; error: string; extra?: Record<string, unknown> }, extra: Record<string, unknown> = {}) =>
    r.ok ? NextResponse.json({ ok: true, ...extra }) : NextResponse.json({ error: r.error, ...(r.extra ?? {}) }, { status: r.status });

  const action = typeof body.action === "string" ? body.action : null;
  if (action === "approve" || action === "reject") {
    const parsed = parseAction({ action, comment: body.comment });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const done = await decideVariation(gate.req, found.project, variation, action, parsed.comment);
    return reply(done, done.ok ? { outcome: done.outcome } : {});
  }

  if (!canEdit) return NextResponse.json({ error: "You can view contract projects but not change them" }, { status: 403 });
  if (action === "submit") {
    const done = await submitVariation(gate.req, found.project, variation);
    return reply(done, done.ok ? { request_id: done.request_id } : {});
  }
  if (action === "withdraw") return reply(await withdrawVariation(gate.req, found.project, variation));
  if (action !== null) return NextResponse.json({ error: "action must be submit, withdraw, approve or reject" }, { status: 400 });

  const parsed = parseVariation(body, "update");
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  if (Object.keys(parsed.value).length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  const saved = await editVariation(gate.req, found.project, variation, parsed.value);
  return reply(saved, saved.ok ? { variation: saved.variation } : {});
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id, variationId } = await params;
  const { admin, tenantId } = gate.req;
  const found = await loadProject(admin, tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const variation = await loadVariation(admin, tenantId, id, variationId);
  if (!variation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const done = await removeVariation(gate.req, found.project, variation);
  return done.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: done.error }, { status: done.status });
}
