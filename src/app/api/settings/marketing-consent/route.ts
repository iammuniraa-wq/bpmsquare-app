import { NextResponse, type NextRequest } from "next/server";
import { loadMarketingSettingsContext } from "@/lib/marketing/settingsServer";
import { consentDefaultsOf, marketingConfigOf, sanitizeConsentDefaults, sanitizeTopics, topicsOf, workspaceJurisdictionOf } from "@/lib/marketing/config";
import { JURISDICTIONS, JURISDICTION_RULES, isJurisdictionCode } from "@/lib/marketing/jurisdictions";
import { isSchemaPending } from "@/lib/marketing/pending";
import { diffForLog, logChange } from "@/lib/changeLog";

// Settings -> Marketing -> Consent. Admin-only; 404 without the
// marketing_scoring program. Three things live here: the topics people can opt
// in to separately, the rule that applies to someone with no entry in the
// consent ledger (strict by default; only an admin choosing otherwise, per
// country, relaxes it) and whether newsletter opens are counted.

export async function GET() {
  const g = await loadMarketingSettingsContext();
  if (!g.ok) return g.response;
  const { config, features } = g.ctx;
  return NextResponse.json({
    topics: topicsOf(config),
    consent_defaults: consentDefaultsOf(config),
    workspace_jurisdiction: workspaceJurisdictionOf(config),
    track_opens: marketingConfigOf(config).track_opens === true,
    newsletter_studio: features.newsletter_studio === true,
    jurisdictions: JURISDICTIONS.map((code) => ({
      code, label: JURISDICTION_RULES[code].label, existing_customer_allowed: JURISDICTION_RULES[code].existingCustomerAllowed, plain: JURISDICTION_RULES[code].plain,
    })),
  });
}

export async function PUT(request: NextRequest) {
  const g = await loadMarketingSettingsContext();
  if (!g.ok) return g.response;
  const { admin, tenantId, config } = g.ctx;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const topics = sanitizeTopics((body as { topics?: unknown }).topics);
  if (topics.length === 0) return NextResponse.json({ error: "Keep at least one topic" }, { status: 400 });

  // A topic that people have already answered cannot be dropped: the ledger
  // refers to its key, and the history has to stay readable.
  const removed = topicsOf(config).map((t) => t.key).filter((k) => !topics.some((t) => t.key === k));
  if (removed.length > 0) {
    const { data, error } = await admin.from("consent_state").select("topic").eq("tenant_id", tenantId).in("topic", removed).limit(1);
    if (error && !isSchemaPending(error)) return NextResponse.json({ error: error.message }, { status: 500 });
    if ((data ?? []).length > 0) {
      return NextResponse.json({ error: "A topic people have already answered can't be removed. Rename it instead." }, { status: 409 });
    }
  }

  // Where the workspace is based: absent from the body = unchanged, so an older page cannot wipe it.
  const sentJurisdiction = (body as { workspace_jurisdiction?: unknown }).workspace_jurisdiction;
  const jurisdiction = isJurisdictionCode(sentJurisdiction) ? sentJurisdiction : workspaceJurisdictionOf(config);
  // Counting opens moved here from the Brand kit page: absent = unchanged, so an older page cannot switch it off.
  const sentOpens = (body as { track_opens?: unknown }).track_opens;
  const before = marketingConfigOf(config);
  const marketing = {
    ...before,
    topics,
    consent_defaults: sanitizeConsentDefaults((body as { consent_defaults?: unknown }).consent_defaults),
    consent: { ...before.consent, jurisdiction },
    track_opens: typeof sentOpens === "boolean" ? sentOpens : before.track_opens === true,
  };
  const { error } = await admin.from("tenants").update({ config: { ...config, marketing } }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const changes = diffForLog(
    "marketing_settings",
    { topics: topicsOf(config), consent_defaults: consentDefaultsOf(config), workspace_jurisdiction: workspaceJurisdictionOf(config), track_opens: before.track_opens === true },
    { topics: marketing.topics, consent_defaults: marketing.consent_defaults, workspace_jurisdiction: jurisdiction, track_opens: marketing.track_opens },
  );
  if (changes.length > 0) {
    await logChange(g.ctx.session, { tenantId, objectType: "marketing_settings", objectId: tenantId, objectLabel: "Marketing consent", action: "update", actorId: g.ctx.userId, changes });
  }
  return NextResponse.json({ topics: marketing.topics, consent_defaults: marketing.consent_defaults, workspace_jurisdiction: jurisdiction, track_opens: marketing.track_opens });
}
