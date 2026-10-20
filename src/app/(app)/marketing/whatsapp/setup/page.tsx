import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES, tenantOrigin } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { pendingMessage } from "@/lib/marketing/moduleAccess";
import { loadIdentity, viewOf } from "@/lib/marketing/whatsapp/identity";
import { PROVIDERS } from "@/lib/marketing/whatsapp/provider";
import { WHATSAPP_SPEC, recentMessages } from "@/lib/marketing/whatsapp/server";
import { whatsappPage } from "../pageData";
import SetupClient from "./SetupClient";

const when = (s: string) => new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<string, string> = { queued: "Queued", sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed", dry_run: "Logged only", received: "Received" };

export default async function WhatsappSetupPage() {
  const ctx = await whatsappPage();
  const isAdmin = ctx.role === "admin";
  const [{ row, missing }, messages] = await Promise.all([isAdmin ? loadIdentity(ctx.admin, ctx.tenantId) : Promise.resolve({ row: null, missing: false }), recentMessages(ctx)]);
  if (missing || messages.missing) {
    return (
      <>
        <PageHeader title="WhatsApp number and messages" />
        <Card padding={0}><EmptyState title="WhatsApp is waiting for a database update" text={pendingMessage(WHATSAPP_SPEC)} /></Card>
      </>
    );
  }
  const origin = ctx.tenant.customDomain || ctx.tenant.isDemo ? tenantOrigin(ctx.tenant.customDomain) : "";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <PageHeader title="WhatsApp number and messages" subtitle="Where messages are sent from, and what went out and came back" action={<Link href={ROUTES.marketingWhatsapp} style={{ color: c.accent, fontWeight: 600, fontSize: 13, textDecoration: "none" }}>← Templates</Link>} />
      {isAdmin ? (
        <SetupClient
          identity={row ? viewOf(row) : null}
          providers={Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, fields: p.credentialFields }))}
          origin={origin}
          canEdit={ctx.can.edit}
          isDemo={ctx.tenant.isDemo}
        />
      ) : (
        <Card padding={16}><div style={{ fontSize: 13, color: c.muted }}>Only an admin can see or change the WhatsApp number.</div></Card>
      )}
      <Card title="Recent messages" padding={0}>
        {messages.rows.length === 0 ? (
          <EmptyState title="No messages yet" text="Messages sent from a template or a journey, and replies, show up here." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ textAlign: "left", color: c.hint, fontSize: 11, textTransform: "uppercase" }}>
                <th style={{ padding: "8px 16px" }}>When</th><th>Person</th><th>Message</th><th>Status</th>
              </tr></thead>
              <tbody>
                {messages.rows.map((m) => (
                  <tr key={m.id} style={{ borderTop: `1px solid ${c.line}`, verticalAlign: "top" }}>
                    <td style={{ padding: "8px 16px", whiteSpace: "nowrap", color: c.muted }}>{when(m.created_at)}</td>
                    <td style={{ padding: "8px 8px 8px 0", fontWeight: 600 }}>{m.contactName}</td>
                    <td style={{ padding: "8px 8px 8px 0", maxWidth: 420, overflowWrap: "anywhere" }}>
                      <span style={{ color: c.hint }}>{m.direction === "in" ? "Replied: " : m.templateName ? `${m.templateName}: ` : ""}</span>{m.body}
                      {m.error && <div style={{ color: c.muted, fontSize: 12 }}>{m.error}</div>}
                    </td>
                    <td style={{ padding: "8px 16px 8px 0", whiteSpace: "nowrap", color: c.muted }}>{STATUS[m.status] ?? m.status}{m.redirected ? " (to test number)" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
