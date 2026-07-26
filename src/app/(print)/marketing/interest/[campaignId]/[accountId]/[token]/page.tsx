import { notFound } from "next/navigation";
import { verifyCampaignInterestToken } from "@/lib/campaignInterestLink";
import { getCampaignInterestInfo } from "@/lib/data";
import InterestConfirm from "./InterestConfirm";

// No login required -- reached via a signed link in a campaign email (see
// lib/campaignInterestLink.ts). The actual lead-creation happens on the
// confirm button's click (InterestConfirm -> POST), not this page load.
export default async function CampaignInterestPage({
  params,
}: {
  params: Promise<{ campaignId: string; accountId: string; token: string }>;
}) {
  const { campaignId, accountId, token } = await params;
  if (!verifyCampaignInterestToken(campaignId, accountId, token)) notFound();

  const info = await getCampaignInterestInfo(campaignId, accountId);
  if (!info) notFound();

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#f4f6f9", padding: 20, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "36px 32px", width: 440, maxWidth: "100%", boxShadow: "0 10px 40px rgba(0,0,0,.08)", textAlign: "center" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 10px", color: "#1c2733" }}>Interested in {info.campaignName}?</h1>
        <p style={{ fontSize: 13.5, color: "#5f6b7a", lineHeight: 1.6, margin: "0 0 24px" }}>
          Let {info.tenantName} know you'd like to hear more. A team member will follow up with {info.accountName} shortly.
        </p>
        <InterestConfirm campaignId={campaignId} accountId={accountId} token={token} />
      </div>
    </div>
  );
}
