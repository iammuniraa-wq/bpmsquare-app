import { NextResponse, type NextRequest } from "next/server";
import { openCrew } from "@/lib/crew/server/access";
import { decideProposal } from "@/lib/crew/server/gate";

// POST /api/crew/proposals/[id]/decide  { action: "approve" | "reject", message?, note? }
// The approval gate's press (design section 3.5). "approve" sends the (possibly edited) note: Edit and send is the default button, there is no
// one-tap approval for text that reaches a colleague. The person must be one of the proposal's approvers and must hold the action's permission
// NOW; the proposal is claimed by compare-and-set so a second press sends nothing.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const door = await openCrew();
  if (!door.ok) return door.res;
  const { ctx } = door;
  const body = (await request.json().catch(() => null)) as { action?: unknown; message?: unknown; note?: unknown } | null;
  if (body?.action !== "approve" && body?.action !== "reject") return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
  const r = await decideProposal({
    admin: ctx.admin, supabase: ctx.supabase, tenantId: ctx.tenantId, userId: ctx.userId, userEmail: ctx.userEmail,
    proposalId: id, action: body.action, message: body.message, note: typeof body.note === "string" ? body.note : null,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
