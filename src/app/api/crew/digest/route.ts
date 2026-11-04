import { NextResponse, type NextRequest } from "next/server";
import { withDigest } from "@/lib/crew/core/settings";
import { canSeeFinding } from "@/lib/crew/core/visibility";
import { openCrew, viewerOf } from "@/lib/crew/server/access";
import { loadSettings, saveSettings } from "@/lib/crew/server/store";

// PUT /api/crew/digest  { agent, on }
// A person switches the daily digest e-mail on or off for THEMSELVES (owner decision 2026-11-04: per recipient opt-in only, internal members
// only, sent through resolveOutbound). Only someone who may see the agent's findings can opt in; nobody can opt in another person.

export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { agent?: unknown; on?: unknown } | null;
  const agent = typeof body?.agent === "string" ? body.agent : null;
  const door = await openCrew(agent);
  if (!door.ok) return door.res;
  const { ctx, entry } = door;
  if (!entry || typeof body?.on !== "boolean") return NextResponse.json({ error: "agent and on are required" }, { status: 400 });
  const settings = await loadSettings(ctx.admin, ctx.tenantId);
  if (settings.pending) return NextResponse.json({ error: "AI automation needs a database update (migration 0245)." }, { status: 503 });
  const cur = settings.get(entry.key);
  if (!canSeeFinding(viewerOf(ctx), { agent_key: entry.key, recipient_ids: [ctx.userId] }, cur.config.visibility)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const saved = await saveSettings(ctx.admin, ctx.tenantId, entry.key, ctx.userId, { config: withDigest(cur.config, ctx.userId, body.on) });
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });
  return NextResponse.json({ ok: true, on: body.on });
}
