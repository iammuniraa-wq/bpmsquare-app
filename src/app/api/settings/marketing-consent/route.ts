import { NextResponse, type NextRequest } from "next/server";
import { loadMarketingSettingsContext } from "@/lib/marketing/settingsServer";
import { consentDefaultsOf, marketingConfigOf, sanitizeConsentDefaults, sanitizeTopics, topicsOf } from "@/lib/marketing/config";
import { JURISDICTIONS, JURISDICTION_RULES } from "@/lib/marketing/jurisdictions";
import { isSchemaPending } from "@/lib/marketing/pending";

// Settings -> Marketing -> Consent and topics. Admin-only; 404 without the
// marketing_scoring program. Two things live here: the topics people can opt
// in to separately, and the rule that applies to someone with no entry in the
// consent ledger. The rule defaults to strict ("consent required") and only
// an admin choosing otherwise, per country, relaxes it.

export async function GET() {
  const g = await loadMarketingSettingsContext();
  if (!g.ok) return g.response;
  const { config } = g.ctx;
  return NextResponse.json({
    topics: topicsOf(config),
    consent_defaults: consentDefaultsOf(config),
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

  const marketing = {
    ...marketingConfigOf(config),
    topics,
    consent_defaults: sanitizeConsentDefaults((body as { consent_defaults?: unknown }).consent_defaults),
  };
  const { error } = await admin.from("tenants").update({ config: { ...config, marketing } }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ topics: marketing.topics, consent_defaults: marketing.consent_defaults });
}
