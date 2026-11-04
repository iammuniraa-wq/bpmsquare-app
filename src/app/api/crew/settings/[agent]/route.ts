import { NextResponse, type NextRequest } from "next/server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { sanitizeConfig } from "@/lib/crew/core/settings";
import { openCrew } from "@/lib/crew/server/access";
import { loadSettings, saveSettings } from "@/lib/crew/server/store";
import { tenantMemberIds } from "@/lib/tender/roomServer";

// PUT /api/crew/settings/[agent]   agent = an agent key, or "workspace" for the Pause all agents switch.
//   { enabled?, paused?, config? }  -- workspace admin only. The editable subset of config is whitelisted (sanitizeConfig); the monthly
//   allowance and the shadow-period visibility are NOT settable here (platform admin only, /api/admin/crew/[tenantId]).
// Tender Watch cannot be switched on until the workspace has a time zone (its schedule is read in the workspace clock).
// Every change is written to Change History (object crew_settings).

export async function PUT(request: NextRequest, { params }: { params: Promise<{ agent: string }> }) {
  const { agent } = await params;
  const isWorkspace = agent === "workspace";
  const door = await openCrew(isWorkspace ? null : agent, { adminOnly: true });
  if (!door.ok) return door.res;
  const { ctx, entry } = door;
  const body = (await request.json().catch(() => null)) as { enabled?: unknown; paused?: unknown; config?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const key = isWorkspace ? "_workspace" : entry!.key;
  const patch: { enabled?: boolean; paused?: boolean; config?: ReturnType<typeof sanitizeConfig>["config"] } = {};
  if (typeof body.paused === "boolean") patch.paused = body.paused;
  if (!isWorkspace) {
    if (typeof body.enabled === "boolean") {
      if (body.enabled && entry!.key === "tender_watch" && !ctx.tenant.hasTimezone) return NextResponse.json({ error: "Set your time zone first (Settings, Workforce). Tender Watch runs on your own clock." }, { status: 409 });
      patch.enabled = body.enabled;
    }
    if (body.config !== undefined) {
      const cur = (await loadSettings(ctx.admin, ctx.tenantId)).get(key).config;
      const { config, problems } = sanitizeConfig(entry!.key, body.config, cur);
      if (problems.length) return NextResponse.json({ error: problems[0] }, { status: 400 });
      if (config.recipient_ids?.length) config.recipient_ids = await tenantMemberIds(ctx.admin, ctx.tenantId, config.recipient_ids);
      patch.config = config;
    }
  }
  if (patch.enabled === undefined && patch.paused === undefined && patch.config === undefined) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  const saved = await saveSettings(ctx.admin, ctx.tenantId, key, ctx.userId, patch);
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.pending ? 503 : 500 });

  const flat = (s: typeof saved.before) => ({ enabled: s.enabled, paused: s.paused, config: JSON.stringify(s.config) });
  const changes = diffForLog("crew_settings", flat(saved.before), flat(saved.after));
  if (changes.length > 0) {
    await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "crew_settings", objectId: ctx.tenantId, objectLabel: isWorkspace ? "AI automation: all agents" : `AI automation: ${entry!.name}`, action: "update", actorId: ctx.userId, actorEmail: ctx.userEmail, changes });
  }
  return NextResponse.json({ ok: true, settings: saved.after });
}
