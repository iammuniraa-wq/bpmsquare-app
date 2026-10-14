import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { loadMailbox, fetchNewMail } from "@/lib/mail/mailbox";
import { ingestInbound } from "@/lib/rfq/inbound";
import { refFromSubject } from "@/lib/rfq/rules";
import { parseSubjectTag } from "@/lib/rfq/token";
import { rfqConfig, RFQ_LIMITS } from "@/lib/rfq/types";
import type { TenantConfig } from "@/lib/constants";

// GET /api/rfqs/cron/mailbox -- every 5 minutes (vercel.json). The
// "mailbox" mail channel's receiving half: for each tenant that has the rfq
// module AND sends RFQs from its own mailbox, read the inbox for new mail
// whose subject carries an RFQ reference, and file each reply on its RFQ.
//
// Scales by bounding, not by hoping: each mailbox reads at most N messages
// per run (oldest first; the rest next run), the whole run stops starting new
// mailboxes after a time budget, and the IMAP UID it reached is stored per
// mailbox (rfq_mailbox_state) so no run re-reads old mail. Tenants are taken
// least-recently-polled first, so a large fleet is covered round-robin.

export const maxDuration = 300;
const BUDGET_MS = 240_000;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const admin = createAdminSupabase();
  const { data: tenants, error } = await admin.from("tenants").select("id, slug, config").contains("features", { rfq: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const mailboxTenants = (tenants ?? [])
    .map((t) => ({ id: t.id as string, slug: t.slug as string, cfg: rfqConfig((t.config as TenantConfig | null)?.rfq) }))
    .filter((t) => t.cfg.mail_mode === "mailbox");

  const { data: states } = await admin.from("rfq_mailbox_state").select("*");
  const stateOf = new Map(((states ?? []) as { tenant_id: string; connector_id: string; uid_validity: string | null; last_uid: number; last_polled_at: string | null }[])
    .map((s) => [`${s.tenant_id}:${s.connector_id}`, s]));
  mailboxTenants.sort((a, b) => {
    const x = stateOf.get(`${a.id}:${a.cfg.mailbox_connector}`)?.last_polled_at ?? "";
    const y = stateOf.get(`${b.id}:${b.cfg.mailbox_connector}`)?.last_polled_at ?? "";
    return x.localeCompare(y);
  });

  const results: { tenant: string; read?: number; routed?: number; error?: string }[] = [];
  for (const t of mailboxTenants) {
    if (Date.now() - started > BUDGET_MS) break;
    const key = `${t.id}:${t.cfg.mailbox_connector}`;
    const prev = stateOf.get(key);
    const now = new Date().toISOString();
    try {
      const mb = await loadMailbox(admin, t.id, t.cfg.mailbox_connector);
      if (!mb) {
        results.push({ tenant: t.slug, error: "mailbox not connected" });
        continue;
      }
      const res = await fetchNewMail(mb, { uidValidity: prev?.uid_validity ? BigInt(prev.uid_validity) : null, lastUid: Number(prev?.last_uid ?? 0) }, {
        wanted: (subject) => !!parseSubjectTag(subject) || !!refFromSubject(subject),
        maxMessages: 25,
        maxAttachmentBytes: RFQ_LIMITS.maxAttachmentBytes,
        firstRunDays: 3,
      });
      let routed = 0;
      for (const m of res.messages) {
        const r = await ingestInbound(admin, {
          provider: `imap:${t.cfg.mailbox_connector}`,
          providerMessageId: m.messageId ?? `${res.uidValidity}:${m.uid}`,
          from: m.from, to: m.to, subject: m.subject, text: m.text, html: m.html,
          messageId: m.messageId, inReplyTo: m.inReplyTo, attachments: m.attachments,
        }, { tenantId: t.id });
        if (r.ok && !r.duplicate) routed++;
      }
      await admin.from("rfq_mailbox_state").upsert({
        tenant_id: t.id, connector_id: t.cfg.mailbox_connector, uid_validity: res.uidValidity.toString(), last_uid: res.lastUid, last_polled_at: now, last_error: null,
      }, { onConflict: "tenant_id,connector_id" });
      results.push({ tenant: t.slug, read: res.messages.length, routed });
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 500) ?? "poll failed";
      await admin.from("rfq_mailbox_state").upsert({
        tenant_id: t.id, connector_id: t.cfg.mailbox_connector, uid_validity: prev?.uid_validity ?? null, last_uid: Number(prev?.last_uid ?? 0), last_polled_at: now, last_error: msg,
      }, { onConflict: "tenant_id,connector_id" });
      results.push({ tenant: t.slug, error: msg });
    }
  }
  return NextResponse.json({ ok: true, mailboxes: mailboxTenants.length, results });
}
