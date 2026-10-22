import { NextResponse, type NextRequest } from "next/server";
import { requireMarketingAccess } from "@/lib/marketingAccess";
import { resolveMarketingRecipients } from "@/lib/data";
import { groupSkipReasons } from "@/lib/newsletter/audienceWords";
import { createNewsletterCampaign, discardDraftCampaign, prepareNewsletterSend } from "@/lib/newsletter/quickSend";
import { planNewsletterAudience } from "@/lib/newsletter/send";
import { sendNewsletterBranch } from "@/lib/newsletter/sendRoute";
import { errorResponse, newsletterAccess } from "@/lib/newsletter/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/newsletters/[id]/send { audience: { group_id? | account_types?, manual_emails? }, check?: true }
//
// The "Send..." panel. check:true is a dry run: who could be reached, who would be left out and why, and how many
// would get each language; nothing is sent or written (beyond keeping a version if the newsletter changed). Without
// it the newsletter is sent: a version is kept, the campaign row is created from the newsletter's own name, topic
// and languages, and that row goes through sendNewsletterBranch() -- the same consent gate, suppression, language
// rule and demo-workspace redirect as every campaign. Who may send is the union of what used to be asked in two
// places: edit rights on Newsletters (to keep a version) and on Campaigns (to send one).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await newsletterAccess("edit");
    const marketing = await requireMarketingAccess(["marketing"], "edit");
    if ("error" in marketing) return marketing.error;
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { audience?: Record<string, unknown>; check?: unknown } | null;
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body." }, { status: 422 });

    const prepared = await prepareNewsletterSend(ctx, id, body.audience ?? {});
    if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: prepared.status });

    if (body.check === true) {
      const candidates = await resolveMarketingRecipients(ctx.tenantId, prepared.rule);
      const plan = await planNewsletterAudience({
        admin: ctx.admin, tenantId: ctx.tenantId, version: prepared.version, candidates,
        campaign: {
          id: "preview", name: "", topic: prepared.fields.topic, languages: prepared.fields.languages,
          fallback_language: prepared.fields.fallback_language, newsletter_version_id: prepared.version.id,
        },
      });
      return NextResponse.json({ ...plan, groups: groupSkipReasons(plan.skipped), languages: prepared.fields.languages, topic: prepared.fields.topic });
    }

    const made = await createNewsletterCampaign(ctx, prepared);
    if (!made.ok) return NextResponse.json({ error: made.error }, { status: made.status });

    const res = await sendNewsletterBranch({
      supabase: ctx.supabase, tenantId: ctx.tenantId,
      campaign: made.campaign as unknown as Parameters<typeof sendNewsletterBranch>[0]["campaign"],
    });
    if (!res.ok) {
      await discardDraftCampaign(ctx, made.campaign.id);
      return res;
    }
    const sent = await res.json();
    return NextResponse.json({ ...sent, campaign_id: made.campaign.id });
  } catch (e) {
    return errorResponse(e);
  }
}
