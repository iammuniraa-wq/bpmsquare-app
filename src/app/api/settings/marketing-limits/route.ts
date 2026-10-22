import { NextResponse, type NextRequest } from "next/server";
import { loadMarketingSettingsContext } from "@/lib/marketing/settingsServer";
import { applyLimits, limitsSettingsOf, limitsTimezoneOf, sanitizeLimits } from "@/lib/marketing/limits";
import { diffForLog, logChange } from "@/lib/changeLog";

// Settings -> Marketing -> Consent -> Limits. Admin-only, and a 404 for any workspace without the
// marketing_scoring program (loadMarketingSettingsContext). The tenant is the one that call returns; nothing in
// the body names one. The values are validated here and refused when out of range, never clamped. They are read by
// the journey runner (journeys/safety.ts) and the WhatsApp send (whatsapp/rules.ts), which keep their own defaults
// for anything unset.

function payload(config: Parameters<typeof limitsSettingsOf>[0], features: { journeys?: boolean; whatsapp_marketing?: boolean }) {
  return {
    settings: limitsSettingsOf(config),
    ...limitsTimezoneOf(config),
    modules: { journeys: features.journeys === true, whatsapp: features.whatsapp_marketing === true },
  };
}

export async function GET() {
  const g = await loadMarketingSettingsContext();
  if (!g.ok) return g.response;
  return NextResponse.json(payload(g.ctx.config, g.ctx.features));
}

export async function PUT(request: NextRequest) {
  const g = await loadMarketingSettingsContext();
  if (!g.ok) return g.response;
  const { admin, session, tenantId, userId, config, features } = g.ctx;

  const body = await request.json().catch(() => null);
  const before = limitsSettingsOf(config);
  const checked = sanitizeLimits(body, before);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const next = applyLimits(config, checked.value);
  const { error } = await admin.from("tenants").update({ config: next }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const changes = diffForLog("marketing_settings", before as unknown as Record<string, unknown>, checked.value as unknown as Record<string, unknown>);
  if (changes.length > 0) {
    await logChange(session, { tenantId, objectType: "marketing_settings", objectId: tenantId, objectLabel: "Marketing limits", action: "update", actorId: userId, changes });
  }
  return NextResponse.json(payload(next, features));
}
