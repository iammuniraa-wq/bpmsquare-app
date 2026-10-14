import type { Metadata } from "next";
import { createAdminSupabase } from "@/lib/supabase-server";
import { resolveReply, ownResponses, ownHeader } from "@/lib/rfq/publicReply";
import ReplyForm from "./ReplyForm";

// The supplier's no-login reply page, reached from the signed link in an RFQ
// email or a WhatsApp share. Everything shown comes from the supplier
// projection (lib/rfq/compose.ts SupplierView) -- no customer, no quote, no
// other supplier, no price but their own.

export const metadata: Metadata = { title: "Request for quotation", robots: { index: false, follow: false } };

const shell: React.CSSProperties = {
  minHeight: "100vh", background: "#f3f5f8", padding: "28px 16px 60px",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#1c2733",
};

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div style={{ ...shell, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: "32px 28px", width: 440, maxWidth: "100%", boxShadow: "0 10px 40px rgba(0,0,0,.07)", textAlign: "center" }}>
        <h1 style={{ fontSize: 18, margin: "0 0 10px" }}>{title}</h1>
        <p style={{ fontSize: 14, color: "#5f6b7a", lineHeight: 1.6, margin: 0 }}>{text}</p>
      </div>
    </div>
  );
}

export default async function RfqReplyPage({ params }: { params: Promise<{ sid: string; token: string }> }) {
  const { sid, token } = await params;
  const ctx = await resolveReply(createAdminSupabase(), sid, token);
  if (!ctx.ok) {
    if (ctx.reason === "expired") return <Message title="This link has expired" text="The reply window for this request has closed. Please contact the buyer if you'd still like to quote." />;
    if (ctx.reason === "closed") return <Message title="This request was withdrawn" text="The buyer has cancelled this request for quotation. No reply is needed." />;
    return <Message title="Link not valid" text="This link isn't valid any more. Please use the most recent email from the buyer, or ask them to send it again." />;
  }
  return (
    <div style={shell}>
      <ReplyForm
        sid={sid}
        token={token}
        view={ctx.view}
        logoUrl={ctx.tenant.logo_url}
        open={ctx.open}
        initialResponses={ownResponses(ctx)}
        initialHeader={ownHeader(ctx)}
        currencyHint={ctx.bundle.rfq.currency ?? ctx.tenant.config?.currency ?? null}
      />
    </div>
  );
}
