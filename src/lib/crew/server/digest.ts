import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROUTES, tenantOrigin } from "@/lib/constants";
import { logEmail } from "@/lib/emailLog";
import { emailOutputFor, resolveOutbound } from "@/lib/emailOutputRules";
import { defaultMailer, displayName, memberEmails, type TenderMailer } from "@/lib/tender/notify";
import { agentEntry } from "../registry";
import type { AgentKey, Finding } from "../types";
import { listFindings } from "./store";
import type { CrewTenant } from "./tenant";

// The opt-in daily digest (docs/design/nova-crew-agents.md open question 1, owner decision 2026-11-04: allowed). The same content a person sees
// in the Review tab, to a workspace member who switched it on for THEMSELVES, internal members only, through resolveOutbound (a demo workspace
// is redirect-only), logged under the existing email_log kinds (tender / wfm): a new kind would need a database change for no gain. A nudge to a named colleague is a different thing and always needs the sender's approval.

const SHOWN = 8;

export type DigestMessage = { subject: string; text: string };

export function digestMessage(agentName: string, findings: readonly Pick<Finding, "title" | "severity">[], link: string): DigestMessage {
  const word = (s: string) => (s === "urgent" ? "Review soon" : s === "review" ? "Worth a look" : "For your information");
  const shown = findings.slice(0, SHOWN);
  const more = findings.length - shown.length;
  return {
    subject: `${agentName}: ${findings.length} ${findings.length === 1 ? "suggestion" : "suggestions"} to review`,
    text: [`${agentName} has ${findings.length} open ${findings.length === 1 ? "suggestion" : "suggestions"} for you.`, "", ...shown.map((f) => `- ${word(f.severity)}: ${f.title}`), ...(more > 0 ? [`- and ${more} more`] : []), "", link, "", "These are review suggestions, not decisions. You are getting this because you turned the digest on."].join("\n"),
  };
}

export async function sendDigests(admin: SupabaseClient, tenant: CrewTenant, agent: AgentKey, optIn: readonly string[], mailer: TenderMailer | null = defaultMailer()): Promise<{ sent: number; failed: number }> {
  const out = { sent: 0, failed: 0 };
  if (optIn.length === 0) return out;
  const entry = agentEntry(agent);
  if (!entry) return out;
  const { rows } = await listFindings(admin, tenant.id, { agent, statuses: ["open", "seen"], limit: 100 });
  const link = `${tenantOrigin(tenant.custom_domain)}${ROUTES.aiAutomationAgent(agent)}`;
  const emails = await memberEmails(admin, tenant.id, [...optIn]);
  for (const m of emails) {
    const mine = rows.filter((f) => f.recipient_ids.includes(m.user_id));
    if (mine.length === 0) continue;
    const msg = digestMessage(entry.name, mine, link);
    const routed = resolveOutbound(emailOutputFor({ is_demo: tenant.is_demo, config: tenant.config }), { to: [m.email], subject: msg.subject, text: msg.text });
    const log = (status: "sent" | "failed", error?: string) => logEmail(admin, { tenantId: tenant.id, kind: agent === "attendance" ? "wfm" : "tender", toEmail: routed.ok ? routed.email.to.join(", ") : m.email, subject: msg.subject, status, ...(error ? { error } : {}) });
    if (!routed.ok || !mailer) { out.failed++; await log("failed", routed.ok ? "Email sending isn't configured." : routed.error); continue; }
    const from = `${displayName(tenant.name)} <${(tenant.slug || "agents").toLowerCase().replace(/[^a-z0-9._-]/g, "") || "agents"}@${process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com"}>`;
    let err: string | null = null;
    try { err = (await mailer.send({ from, to: routed.email.to, subject: routed.email.subject, text: routed.email.text })).error ?? null; } catch (e) { err = (e as Error).message; }
    if (err) { out.failed++; await log("failed", err); } else { out.sent++; await log("sent"); }
  }
  return out;
}
