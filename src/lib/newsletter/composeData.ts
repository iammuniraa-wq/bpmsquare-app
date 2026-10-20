import "server-only";
import { createAdminSupabase } from "@/lib/supabase-server";
import { topicsOf } from "@/lib/marketing/config";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { languageDef } from "./types";
import { isUuid } from "./requests";
import { loadVersion, sendableLanguages, studioEnabled } from "./server";
import { pendingBlocks } from "./sanitize";

// What the campaign screens need to offer "My newsletters": the version, its languages (only
// those whose every line has been accepted can be ticked, and the others say why), the
// topics and where to open the design. Returns null for a workspace without the studio, so
// those screens are exactly what they were.

export type ComposeNewsletter = {
  versionId: string;
  newsletterId: string;
  name: string;
  version: number;
  topic: string | null;
  topics: { key: string; label: string }[];
  languages: { lang: string; name: string; ready: boolean; pending: number }[];
};

export async function loadComposeNewsletter(tenantId: string, versionId: string | null | undefined): Promise<ComposeNewsletter | null> {
  if (!isUuid(versionId)) return null;
  const admin = createAdminSupabase();
  const { data } = await admin.from("tenants").select("features, config").eq("id", tenantId).maybeSingle();
  if (!studioEnabled(data?.features as Partial<TenantFeatures> | undefined)) return null;
  const version = await loadVersion(admin, tenantId, versionId);
  if (!version) return null;
  const ready = new Set(sendableLanguages(version));
  return {
    versionId, newsletterId: version.newsletter_id, name: version.snapshot.name, version: version.version, topic: version.snapshot.topic,
    topics: topicsOf((data?.config ?? {}) as TenantConfig).map((t) => ({ key: t.key, label: t.label })),
    languages: version.snapshot.languages.map((l) => ({
      lang: l.lang, name: languageDef(l.lang)?.name ?? l.lang, ready: ready.has(l.lang), pending: pendingBlocks(l, version.snapshot.blocks).length,
    })),
  };
}
