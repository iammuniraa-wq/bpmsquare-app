import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { canSeeFinding } from "@/lib/crew/core/visibility";
import { openCrew, viewerOf } from "@/lib/crew/server/access";
import { setFindingState } from "@/lib/crew/server/persist";
import { loadFinding, loadSettings } from "@/lib/crew/server/store";
import { dayKey } from "@/lib/tender/rules";

// PATCH /api/crew/findings/[id]  { status: "seen" | "dismissed" | "not_an_issue", note? }
// A person's choice on a finding they may see. Dismiss = "not now" (it can come back tomorrow if it persists); Not an issue silences the same
// situation for 30 days unless it gets worse (the key fact is in the fingerprint). Writes go through the service role: members have no write
// policy on these tables. The id is checked against THIS workspace and against what this viewer may see.

const CHOICES = ["seen", "dismissed", "not_an_issue"] as const;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const door = await openCrew();
  if (!door.ok) return door.res;
  const { ctx } = door;
  const body = (await request.json().catch(() => null)) as { status?: unknown; note?: unknown } | null;
  const status = CHOICES.find((c) => c === body?.status);
  if (!status) return NextResponse.json({ error: "status must be seen, dismissed or not_an_issue" }, { status: 400 });

  const f = await loadFinding(ctx.admin, ctx.tenantId, id);
  if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const settings = await loadSettings(ctx.admin, ctx.tenantId);
  if (!ctx.agents.some((a) => a.key === f.agent_key) || !canSeeFinding(viewerOf(ctx), f, settings.get(f.agent_key).config.visibility)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const today = dayKey(new Date(), ctx.tenant.timezone);
  const ok = await setFindingState(ctx.admin, ctx.tenantId, id, ctx.userId, status, today, typeof body?.note === "string" ? body.note : null);
  if (!ok) return NextResponse.json({ error: "This suggestion was already handled" }, { status: 409 });
  if (status !== "seen") {
    await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "crew_finding", objectId: id, objectLabel: f.title.slice(0, 120), action: "update", actorId: ctx.userId, actorEmail: ctx.userEmail, changes: [{ field: "Suggestion", from: "open", to: status === "dismissed" ? "dismissed" : "not an issue" }] });
  }
  return NextResponse.json({ ok: true });
}
