import Link from "next/link";
import { requireFeature } from "@/lib/tenant";
import { listMarketingCampaigns } from "@/lib/data";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import PageHeader from "@/components/PageHeader";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import type { MarketingCampaignStatus } from "@/lib/types";

const STATUS_TONE: Record<MarketingCampaignStatus, PillarKey> = {
  draft: "blue", sending: "amber", sent: "green", failed: "red",
};
const STATUS_LABEL: Record<MarketingCampaignStatus, string> = {
  draft: "Draft", sending: "Sending…", sent: "Sent", failed: "Failed",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5,
};
const td: React.CSSProperties = {
  padding: "10px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5, verticalAlign: "middle",
};

export default async function MarketingPage() {
  await requireFeature("marketing");
  const campaigns = await listMarketingCampaigns();

  return (
    <>
      <PageHeader
        title="Marketing campaigns"
        subtitle={`${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`}
        action={
          <Link href={ROUTES.marketingNew} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c.accent, color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
            + New campaign
          </Link>
        }
      />

      {campaigns.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px", color: c.muted }}>
          No campaigns yet. Send your first festival greeting or promo to your accounts.
        </div>
      ) : (
        <div style={cardStyle}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Subject</th>
                <th style={th}>Status</th>
                <th style={th}>Sent</th>
                <th style={th}>Failed</th>
                <th style={th}>Skipped</th>
                <th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((camp) => (
                <tr key={camp.id} style={{ cursor: "pointer" }}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    <Link href={ROUTES.marketingCampaign(camp.id)} style={{ color: c.ink, textDecoration: "none" }}>{camp.name}</Link>
                  </td>
                  <td style={{ ...td, color: c.muted, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{camp.subject || "—"}</td>
                  <td style={td}><Pill label={STATUS_LABEL[camp.status]} tone={STATUS_TONE[camp.status]} /></td>
                  <td style={td}>{camp.sent_count}</td>
                  <td style={td}>{camp.failed_count}</td>
                  <td style={td}>{camp.skipped_count}</td>
                  <td style={{ ...td, color: c.muted }}>{fmtDate(camp.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
