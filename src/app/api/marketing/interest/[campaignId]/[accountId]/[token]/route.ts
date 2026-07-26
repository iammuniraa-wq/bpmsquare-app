import { NextResponse } from "next/server";
import { verifyCampaignInterestToken } from "@/lib/campaignInterestLink";
import { createCampaignInterestLead } from "@/lib/data";

// The actual lead-creation -- deliberately a POST triggered by a button
// click on the interest page, not the page's own GET load, since some mail
// clients/security scanners prefetch links inside emails and would
// otherwise create a lead for someone who never clicked anything.
export async function POST(_request: Request, { params }: { params: Promise<{ campaignId: string; accountId: string; token: string }> }) {
  const { campaignId, accountId, token } = await params;
  if (!verifyCampaignInterestToken(campaignId, accountId, token)) {
    return NextResponse.json({ error: "This link is invalid." }, { status: 404 });
  }
  const ok = await createCampaignInterestLead(campaignId, accountId);
  if (!ok) return NextResponse.json({ error: "Failed to record your interest" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
