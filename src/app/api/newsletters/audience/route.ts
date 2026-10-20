import { NextResponse, type NextRequest } from "next/server";
import { resolveMarketingRecipients } from "@/lib/data";
import { sanitizeSegmentFilters, sanitizeMatch } from "@/lib/marketingSegmentation";
import { newsletterFieldsForCreate } from "@/lib/newsletter/campaignFields";
import { groupSkipReasons } from "@/lib/newsletter/audienceWords";
import { planNewsletterAudience } from "@/lib/newsletter/send";
import { errorResponse, loadVersion, newsletterAccess } from "@/lib/newsletter/server";

// Before-send audience check for a newsletter campaign. POST { newsletter_version_id, languages,
// fallback_language, topic, ...the audience rule } -> who could be reached, who would be left out and
// why, and how many would get each language. It makes the SAME decisions as the send (opt-out, the
// person, canContact() for the topic, the language rule) through the same function, and sends and
// writes nothing. The rule comes from the body so it works before the draft is saved; the tenant
// comes only from the session, and the version is read for that tenant.
export async function POST(request: NextRequest) {
  try {
    const ctx = await newsletterAccess("view");
    const { tenantId, admin } = ctx;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body." }, { status: 422 });

    const fields = await newsletterFieldsForCreate(tenantId, body);
    if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: fields.status });
    const version = await loadVersion(admin, tenantId, fields.fields.newsletter_version_id as string);
    if (!version) return NextResponse.json({ error: "That newsletter version was not found." }, { status: 404 });

    const candidates = await resolveMarketingRecipients(tenantId, {
      account_types: Array.isArray(body.account_types) ? body.account_types : [],
      include_account_ids: Array.isArray(body.include_account_ids) ? body.include_account_ids : [],
      exclude_account_ids: Array.isArray(body.exclude_account_ids) ? body.exclude_account_ids : [],
      manual_emails: Array.isArray(body.manual_emails) ? body.manual_emails : [],
      filters: sanitizeSegmentFilters(body.filters),
      match: sanitizeMatch(body.match),
    });

    const plan = await planNewsletterAudience({
      admin, tenantId, version, candidates,
      campaign: {
        id: "preview", name: "", topic: fields.fields.topic, languages: fields.fields.languages,
        fallback_language: fields.fields.fallback_language, newsletter_version_id: version.id,
      },
    });
    return NextResponse.json({ ...plan, groups: groupSkipReasons(plan.skipped), languages: fields.fields.languages, fallback: fields.fields.fallback_language });
  } catch (e) {
    return errorResponse(e);
  }
}
