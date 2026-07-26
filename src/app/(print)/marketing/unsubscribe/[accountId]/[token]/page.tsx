import { notFound } from "next/navigation";
import { verifyUnsubscribeToken } from "@/lib/marketingUnsubscribe";
import { getUnsubscribeAccountInfo } from "@/lib/data";
import UnsubscribeConfirm from "./UnsubscribeConfirm";

// No login required -- reached via a signed link in a marketing email (see
// lib/marketingUnsubscribe.ts). The actual state change happens on the
// confirm button's click (UnsubscribeConfirm -> POST), not this page load.
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ accountId: string; token: string }>;
}) {
  const { accountId, token } = await params;
  if (!verifyUnsubscribeToken(accountId, token)) notFound();

  const info = await getUnsubscribeAccountInfo(accountId);
  if (!info) notFound();

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#f4f6f9", padding: 20, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "36px 32px", width: 420, maxWidth: "100%", boxShadow: "0 10px 40px rgba(0,0,0,.08)", textAlign: "center" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 10px", color: "#1c2733" }}>Unsubscribe from marketing emails</h1>
        <p style={{ fontSize: 13.5, color: "#5f6b7a", lineHeight: 1.6, margin: "0 0 24px" }}>
          {info.accountName} will stop receiving marketing emails from {info.tenantName}. This doesn't affect quotes, invoices, or other account communication.
        </p>
        <UnsubscribeConfirm accountId={accountId} token={token} />
      </div>
    </div>
  );
}
