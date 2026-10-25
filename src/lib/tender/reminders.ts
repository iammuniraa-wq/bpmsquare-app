import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_WFM_CONFIG, ROUTES, tenantOrigin, type TenantConfig } from "@/lib/constants";
import { emailOutputFor, resolveOutbound } from "@/lib/emailOutputRules";
import { logEmail } from "@/lib/emailLog";
import { parseSent, reminderDecision, reminderMessage, tenderIsLive } from "./rules";
import { isMissingSchema } from "./server";

// Closing-date reminders for tender deals (docs/design/gcc-tender-deals.md section 3). Run daily by
// /api/tenders/cron/reminders. For every workspace with the platform-admin flag `gcc_tender`, a live tender 7, 3 and 1
// days before it closes, and on the day, emails its owner and team ONCE per threshold (opportunity_tenders.reminders_sent).
//
// Safe to run twice at once: the threshold is claimed with a compare-and-set on updated_at BEFORE the email goes out, so a
// second run finds the row changed and sends nothing; if the send then fails the claim is handed back so tomorrow retries.
// Every message goes through resolveOutbound (a demo workspace is redirect-only) and is logged in email_log (kind tender).

export type ReminderMailer = {
  send(p: { from: string; to: string[]; subject: string; text: string }): Promise<{ error?: string | null }>;
};

function defaultMailer(): ReminderMailer | null {
  if (!process.env.RESEND_API_KEY) return null;
  const resend = new Resend(process.env.RESEND_API_KEY);
  return {
    async send(p) {
      const r = await resend.emails.send({ from: p.from, to: p.to, subject: p.subject, text: p.text });
      return { error: r.error?.message ?? null };
    },
  };
}

export type ReminderSummary = {
  tenants: number;
  considered: number;
  sent: number;
  skipped: number;
  failed: number;
  pending_migration?: boolean;
  errors: string[];
};

type TenantRow = { id: string; slug: string; name: string; is_demo: boolean | null; config: TenantConfig | null; custom_domain: string | null };
type TenderDbRow = { opportunity_id: string; tender_no: string | null; issuer_name: string | null; closing_at: string | null; decision: string | null; reminders_sent: unknown; updated_at: string };
type DealRow = { id: string; ref: string | null; title: string; outcome: string; stage: string; owner_id: string | null; team: { user_id?: string }[] | null };

const displayName = (s: string) => s.replace(/[<>",\r\n]/g, "").trim().slice(0, 60) || "BPMSquare";

export async function sendTenderReminders(admin: SupabaseClient, deps: { now?: Date; mailer?: ReminderMailer | null } = {}): Promise<ReminderSummary> {
  const now = deps.now ?? new Date();
  const mailer = deps.mailer === undefined ? defaultMailer() : deps.mailer;
  const out: ReminderSummary = { tenants: 0, considered: 0, sent: 0, skipped: 0, failed: 0, errors: [] };

  const { data: tenants, error } = await admin
    .from("tenants").select("id, slug, name, is_demo, config, custom_domain")
    .contains("features", { gcc_tender: true, pipeline: true });
  if (error) { out.errors.push(error.message); return out; }

  for (const t of (tenants ?? []) as TenantRow[]) {
    out.tenants++;
    try {
      const tz = t.config?.wfm?.timezone || DEFAULT_WFM_CONFIG.timezone;
      // Only tenders that have not already closed more than a day ago can be due; the rest never need loading.
      const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();
      const { data: rows, error: tErr } = await admin
        .from("opportunity_tenders").select("opportunity_id, tender_no, issuer_name, closing_at, decision, reminders_sent, updated_at").eq("tenant_id", t.id).not("closing_at", "is", null).gte("closing_at", since);
      if (tErr) {
        if (isMissingSchema(tErr)) { out.pending_migration = true; continue; }
        out.errors.push(`${t.slug}: ${tErr.message}`);
        continue;
      }
      const tenders = (rows ?? []) as TenderDbRow[];
      if (tenders.length === 0) continue;

      const { data: deals } = await admin
        .from("opportunities").select("id, ref, title, outcome, stage, owner_id, team")
        .eq("tenant_id", t.id).in("id", tenders.map((r) => r.opportunity_id));
      const dealById = new Map(((deals ?? []) as DealRow[]).map((d) => [d.id, d]));

      for (const tender of tenders) {
        const deal = dealById.get(tender.opportunity_id);
        if (!deal || !tenderIsLive(deal, tender)) continue;
        const sent = parseSent(tender.reminders_sent);
        const decision = reminderDecision({ closingAt: tender.closing_at, now, timezone: tz, sent });
        if (!decision.send) continue;
        out.considered++;

        const userIds = [...new Set([deal.owner_id, ...(deal.team ?? []).map((m) => m?.user_id)].filter((x): x is string => typeof x === "string" && !!x))];
        const emails = await memberEmails(admin, t.id, userIds);
        if (emails.length === 0) { out.skipped++; continue; }

        // Claim first (compare-and-set on updated_at), send second.
        const marked = [...new Set([...sent, ...decision.mark])].sort((a, b) => b - a);
        const claim = await admin.from("opportunity_tenders")
          .update({ reminders_sent: marked, updated_at: now.toISOString() })
          .eq("opportunity_id", tender.opportunity_id).eq("tenant_id", t.id).eq("updated_at", tender.updated_at)
          .select("opportunity_id");
        if (claim.error || (claim.data ?? []).length === 0) { out.skipped++; continue; }
        const release = () => admin.from("opportunity_tenders").update({ reminders_sent: sent, updated_at: tender.updated_at }).eq("opportunity_id", tender.opportunity_id).eq("tenant_id", t.id);

        const msg = reminderMessage({
          title: deal.title, tenderNo: tender.tender_no, issuer: tender.issuer_name, closingAt: tender.closing_at as string,
          days: decision.days, timezone: tz, link: `${tenantOrigin(t.custom_domain)}${ROUTES.pipelineDetail(deal.id)}`,
        });
        const routed = resolveOutbound(emailOutputFor({ is_demo: t.is_demo, config: t.config }), { to: emails, subject: msg.subject, text: msg.text });
        const label = `${deal.ref ?? ""} ${deal.title}`.trim();
        const fail = async (why: string) => {
          await release();
          out.failed++;
          await logEmail(admin, { tenantId: t.id, kind: "tender", toEmail: emails.join(", "), subject: msg.subject, status: "failed", error: why, relatedObjectType: "opportunities", relatedObjectId: deal.id, relatedObjectLabel: label });
        };
        if (!routed.ok) { await fail(routed.error); continue; }
        if (!mailer) { await fail("Email sending isn't configured (missing RESEND_API_KEY)."); continue; }

        const from = `${displayName(t.name)} <${(t.slug || "tenders").toLowerCase().replace(/[^a-z0-9._-]/g, "") || "tenders"}@${process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com"}>`;
        let sendError: string | null = null;
        try {
          sendError = (await mailer.send({ from, to: routed.email.to, subject: routed.email.subject, text: routed.email.text })).error ?? null;
        } catch (e) {
          sendError = (e as Error).message;
        }
        if (sendError) { await fail(sendError); continue; }
        out.sent++;
        await logEmail(admin, { tenantId: t.id, kind: "tender", toEmail: routed.email.to.join(", "), subject: routed.email.subject, status: "sent", relatedObjectType: "opportunities", relatedObjectId: deal.id, relatedObjectLabel: label });
      }
    } catch (e) {
      out.errors.push(`${t.slug}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** The login e-mail of each id that is a member of THIS workspace (an id of another workspace matches nothing). */
async function memberEmails(admin: SupabaseClient, tenantId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data: members } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).in("user_id", userIds);
  const ok = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);
  const emails: string[] = [];
  for (const id of ok) {
    const { data } = await admin.auth.admin.getUserById(id);
    const e = data?.user?.email;
    if (e) emails.push(e);
  }
  return [...new Set(emails)];
}
