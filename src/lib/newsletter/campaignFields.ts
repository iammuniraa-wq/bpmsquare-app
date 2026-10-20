import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import { topicsOf } from "@/lib/marketing/config";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { isKnownLanguage, SOURCE_LANGUAGE } from "./types";
import { isUuid } from "./requests";
import { loadVersion, sendableLanguages, studioEnabled } from "./server";

// The newsletter columns of a campaign (0142) -- which version, which languages, the
// fallback and the consent topic -- validated in one place for create and update. A
// campaign that is not a newsletter campaign never reaches this code, so the existing
// campaign routes behave exactly as before for every other campaign.

type Fail = { ok: false; status: number; error: string };
export type NewsletterCampaignFields = {
  newsletter_version_id?: string;
  languages: string[];
  fallback_language: string;
  topic: string | null;
  subject?: string;
  body?: string;
};

type Body = { newsletter_version_id?: unknown; languages?: unknown; fallback_language?: unknown; topic?: unknown };

async function tenantRow(tenantId: string) {
  const { data } = await createAdminSupabase().from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
  return { features: (data?.features ?? {}) as Partial<TenantFeatures>, config: (data?.config ?? {}) as TenantConfig };
}

async function validate(tenantId: string, versionId: string, body: Body): Promise<{ ok: true; fields: NewsletterCampaignFields } | Fail> {
  const t = await tenantRow(tenantId);
  if (!studioEnabled(t.features)) return { ok: false, status: 404, error: "Not found" };
  const version = await loadVersion(createAdminSupabase(), tenantId, versionId);
  if (!version) return { ok: false, status: 404, error: "That newsletter version was not found." };

  const ready = new Set(sendableLanguages(version));
  const asked = Array.isArray(body.languages) ? body.languages.filter(isKnownLanguage) : [...ready];
  const languages = [...new Set(asked)];
  if (languages.length === 0) return { ok: false, status: 422, error: "Pick at least one language." };
  const notReady = languages.filter((l) => !ready.has(l));
  if (notReady.length) return { ok: false, status: 422, error: `${notReady.join(", ")} still has lines to check, so it can't be sent yet.` };

  const fallback = isKnownLanguage(body.fallback_language) && languages.includes(body.fallback_language)
    ? body.fallback_language : languages.includes(SOURCE_LANGUAGE) ? SOURCE_LANGUAGE : languages[0];

  const wanted = body.topic === undefined ? version.snapshot.topic : typeof body.topic === "string" && body.topic ? body.topic : null;
  if (wanted && !topicsOf(t.config).some((x) => x.key === wanted)) return { ok: false, status: 422, error: "That topic is not one of your workspace topics." };

  const snap = version.snapshot.languages.find((l) => l.lang === fallback);
  return {
    ok: true,
    fields: {
      newsletter_version_id: versionId, languages, fallback_language: fallback, topic: wanted,
      subject: snap?.subject || version.snapshot.name,
      body: `Newsletter: ${version.snapshot.name}`,
    },
  };
}

/** Create: the body names a version. */
export async function newsletterFieldsForCreate(tenantId: string, body: Body): Promise<{ ok: true; fields: NewsletterCampaignFields } | Fail> {
  if (!isUuid(body.newsletter_version_id)) return { ok: false, status: 422, error: "Pick a newsletter." };
  return validate(tenantId, body.newsletter_version_id, body);
}

/** Update: the campaign must already be a newsletter campaign; its version is never changed from here. */
export async function newsletterFieldsForUpdate(tenantId: string, campaignId: string, body: Body): Promise<{ ok: true; fields: Omit<NewsletterCampaignFields, "newsletter_version_id"> } | Fail> {
  const { data } = await createAdminSupabase().from("marketing_campaigns").select("newsletter_version_id").eq("id", campaignId).eq("tenant_id", tenantId).maybeSingle();
  const versionId = (data as { newsletter_version_id?: string | null } | null)?.newsletter_version_id;
  if (!versionId) return { ok: false, status: 422, error: "This campaign does not send a newsletter." };
  const r = await validate(tenantId, versionId, body);
  if (!r.ok) return r;
  const { newsletter_version_id: _omit, ...rest } = r.fields;
  void _omit;
  return { ok: true, fields: rest };
}
