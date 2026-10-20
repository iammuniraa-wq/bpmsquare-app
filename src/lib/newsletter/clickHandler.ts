import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";
import { isSchemaPending } from "@/lib/marketing/pending";
import { verifyClickToken, verifyOpenToken } from "./linkTokens";
import { safeUrl } from "./sanitize";
import type { StoredVersion } from "./server";

// The two public tracking endpoints, as functions the routes call and the tests
// drive directly.
//
// The click link carries an INDEX, never a URL. The order of events matters and
// is part of the security argument:
//   1. verify the HMAC token over campaign, recipient and index -- nothing at all
//      is read from the database before that passes;
//   2. the recipient row (found by its id AND campaign id) names the tenant the
//      link was issued for; every later query chains that tenant;
//   3. the target is links[index] of the version THIS campaign points at, and it
//      is run through safeUrl() again before the redirect. There is no code path
//      that redirects to anything from the request.
// Logging a click never blocks the redirect: a recipient who clicked reaches the
// page even if the table is missing or the write fails.

export type ClickInput = { campaignId: string; recipientId: string; index: string; token: string; userAgent?: string | null };
export type ClickOutcome = { ok: true; url: string } | { ok: false };

/** Coarse on purpose: "Chrome", "Apple Mail". No version, no device, no IP. */
export function userAgentFamily(ua: string | null | undefined): string {
  const s = (ua ?? "").toLowerCase();
  if (!s) return "unknown";
  if (s.includes("outlook")) return "Outlook";
  if (s.includes("edg/")) return "Edge";
  if (s.includes("firefox")) return "Firefox";
  if (s.includes("chrome") || s.includes("crios")) return "Chrome";
  if (s.includes("safari")) return "Safari";
  return "other";
}

type RecipientRow = { id: string; tenant_id: string; campaign_id: string; account_id: string | null; contact_id: string | null; lang: string | null };
type CampaignRow = { id: string; newsletter_version_id: string | null; topic: string | null };

async function resolveRecipient(admin: SupabaseClient, campaignId: string, recipientId: string) {
  const { data: r } = await admin
    .from("marketing_campaign_recipients").select("id, tenant_id, campaign_id, account_id, contact_id, lang")
    .eq("id", recipientId).eq("campaign_id", campaignId).maybeSingle();
  if (!r) return null;
  const recipient = r as RecipientRow;
  const { data: c } = await admin
    .from("marketing_campaigns").select("id, newsletter_version_id, topic")
    .eq("id", campaignId).eq("tenant_id", recipient.tenant_id).maybeSingle();
  if (!c) return null;
  return { recipient, campaign: c as CampaignRow };
}

export async function handleClick(input: ClickInput, admin: SupabaseClient = createAdminSupabase()): Promise<ClickOutcome> {
  const index = Number(input.index);
  if (!Number.isInteger(index) || index < 0 || index > 500) return { ok: false };
  if (!verifyClickToken(input.campaignId, input.recipientId, index, input.token)) return { ok: false };

  const found = await resolveRecipient(admin, input.campaignId, input.recipientId);
  if (!found?.campaign.newsletter_version_id) return { ok: false };
  const { recipient, campaign } = found;
  const tenantId = recipient.tenant_id;

  const { data: v } = await admin
    .from("newsletter_versions").select("id, newsletter_id, links")
    .eq("id", campaign.newsletter_version_id).eq("tenant_id", tenantId).maybeSingle();
  if (!v) return { ok: false };
  const version = v as Pick<StoredVersion, "id" | "newsletter_id" | "links">;
  const link = Array.isArray(version.links) ? version.links[index] : undefined;
  const url = safeUrl(link?.url);
  if (!link || !url) return { ok: false };

  try {
    // A mail scanner that opens every link would otherwise count as a click: one row per
    // recipient and link per minute is enough.
    const since = new Date(Date.now() - 60_000).toISOString();
    const recent = await admin
      .from("marketing_link_clicks").select("id")
      .eq("tenant_id", tenantId).eq("recipient_id", recipient.id).eq("link_index", index).gte("clicked_at", since).limit(1);
    if (!(recent.data ?? []).length) {
      const { error } = await admin.from("marketing_link_clicks").insert({
        tenant_id: tenantId, campaign_id: campaign.id, recipient_id: recipient.id, contact_id: recipient.contact_id,
        link_index: index, topic_id: link.topic_id ?? null, lang: recipient.lang, user_agent_family: userAgentFamily(input.userAgent),
        clicked_at: new Date().toISOString(),
      });
      if (error && !isSchemaPending(error)) console.error(`[newsletter] click not recorded: ${error.message}`);
      await emitEvent(tenantId, {
        name: EVENTS.EMAIL_CLICKED, object_type: "marketing_campaign", object_id: campaign.id, source: "public_link",
        contact_id: recipient.contact_id, account_id: recipient.account_id, campaign_id: campaign.id,
        newsletter_id: version.newsletter_id, newsletter_version_id: version.id, lang: recipient.lang, topic: campaign.topic,
        key: `${recipient.id}:${index}:${new Date().toISOString().slice(0, 16)}`,
        payload: { link_index: index, label: link.label ?? null, block_type: link.block_type ?? null, ...(link.product_id ? { product_id: link.product_id } : {}) },
      }, admin);
    }
  } catch (e) {
    console.error("[newsletter] click logging failed", e);
  }
  return { ok: true, url };
}

export type OpenInput = { campaignId: string; recipientId: string; token: string; userAgent?: string | null };

/** The opens pixel. Records nothing unless the workspace turned opens on; the image is returned either way. */
export async function handleOpen(input: OpenInput, admin: SupabaseClient = createAdminSupabase()): Promise<void> {
  if (!verifyOpenToken(input.campaignId, input.recipientId, input.token)) return;
  try {
    const found = await resolveRecipient(admin, input.campaignId, input.recipientId);
    if (!found?.campaign.newsletter_version_id) return;
    const { recipient, campaign } = found;
    const { data: t } = await admin.from("tenants").select("config").eq("id", recipient.tenant_id).maybeSingle();
    if ((t?.config as { marketing?: { track_opens?: boolean } } | null)?.marketing?.track_opens !== true) return;
    const { data: v } = await admin.from("newsletter_versions").select("id, newsletter_id").eq("id", campaign.newsletter_version_id).eq("tenant_id", recipient.tenant_id).maybeSingle();
    await emitEvent(recipient.tenant_id, {
      name: EVENTS.EMAIL_OPENED, object_type: "marketing_campaign", object_id: campaign.id, source: "public_link",
      contact_id: recipient.contact_id, account_id: recipient.account_id, campaign_id: campaign.id,
      newsletter_id: (v as { newsletter_id?: string } | null)?.newsletter_id ?? null, newsletter_version_id: campaign.newsletter_version_id,
      lang: recipient.lang, topic: campaign.topic, key: `${recipient.id}:open`, payload: { client_family: userAgentFamily(input.userAgent) },
    }, admin);
  } catch (e) {
    console.error("[newsletter] open not recorded", e);
  }
}
