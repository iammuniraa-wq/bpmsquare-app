import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROOM, digestDue, digestMessage, digestSince, snippet, type DigestRoom } from "./room";
import { defaultMailer, dealLink, memberEmails, sendTenderMail, type NotifyTenant, type TenderMailer } from "./notify";
import { isMissingSchema } from "./server";
import { nameMapOf, peopleByIds, type MemberRow } from "./roomServer";

import { readAllPages } from "@/lib/pagedRead";
// The Deal Room e-mail digest (docs/design/gcc-tender-deals.md section 4, internal only). Run every 15 minutes by
// /api/tenders/cron/room-digest. For every workspace with gcc_tender + deal_room + pipeline, each member who has unread
// messages from OTHER people in the rooms they follow gets ONE e-mail that lists them (a few lines per room, a link to the
// room), and at most one every 15 minutes (room.ts digestDue).
//
// Safe to run twice at once: the member's last_digest_at is claimed with a compare-and-set BEFORE the mail goes, so a second
// run finds it changed and sends nothing; if the send fails the claim is handed back. Every mail goes through resolveOutbound
// (a demo workspace is redirect-only) and is logged in email_log (kind tender). Messages that were removed are never quoted.

export type DigestSummary = { tenants: number; members: number; sent: number; skipped: number; failed: number; pending_migration?: boolean; errors: string[] };

type MsgRow = { id: string; room_id: string; author_id: string; body: string; mentions: string[] | null; created_at: string };

export async function sendRoomDigests(admin: SupabaseClient, deps: { now?: Date; mailer?: TenderMailer | null } = {}): Promise<DigestSummary> {
  const now = deps.now ?? new Date();
  const mailer = deps.mailer === undefined ? defaultMailer() : deps.mailer;
  const out: DigestSummary = { tenants: 0, members: 0, sent: 0, skipped: 0, failed: 0, errors: [] };

  const { data: tenants, error } = await admin.from("tenants").select("id, slug, name, is_demo, config, custom_domain")
    .contains("features", { gcc_tender: true, deal_room: true, pipeline: true });
  if (error) { out.errors.push(error.message); return out; }

  for (const t of (tenants ?? []) as NotifyTenant[]) {
    out.tenants++;
    try {
      const { data: memberRows, error: mErr } = await readAllPages((lo, hi) => admin.from("deal_room_members")
        .select("id, room_id, user_id, added_by, added_at, last_seen_at, last_read_at, last_digest_at").eq("tenant_id", t.id).order("id", { ascending: true }).range(lo, hi));
      if (mErr) {
        if (isMissingSchema(mErr)) out.pending_migration = true; else out.errors.push(`${t.slug}: ${mErr.message}`);
        continue;
      }
      const members = (memberRows ?? []) as MemberRow[];
      if (members.length === 0) continue;
      const roomIds = [...new Set(members.map((m) => m.room_id))];

      const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
      const [{ data: rooms }, { data: msgs }] = await Promise.all([
        admin.from("deal_rooms").select("id, opportunity_id").eq("tenant_id", t.id).in("id", roomIds),
        readAllPages((lo, hi) => admin.from("deal_room_messages").select("id, room_id, author_id, body, mentions, created_at").eq("tenant_id", t.id).in("room_id", roomIds)
          .is("deleted_at", null).neq("kind", "decision").gt("created_at", weekAgo).order("created_at", { ascending: true }).order("id", { ascending: true }).range(lo, hi)),
      ]);
      const dealOfRoom = new Map(((rooms ?? []) as { id: string; opportunity_id: string }[]).map((x) => [x.id, x.opportunity_id]));
      const byRoom = new Map<string, MsgRow[]>();
      for (const m of (msgs ?? []) as MsgRow[]) byRoom.set(m.room_id, [...(byRoom.get(m.room_id) ?? []), m]);
      if (byRoom.size === 0) continue;

      const { data: deals } = await admin.from("opportunities").select("id, ref, title").eq("tenant_id", t.id).in("id", [...dealOfRoom.values()]);
      const dealById = new Map(((deals ?? []) as { id: string; ref: string | null; title: string }[]).map((d) => [d.id, d]));
      const people = await peopleByIds(admin, t.id, [...new Set((msgs as MsgRow[] | null ?? []).map((m) => m.author_id))]);
      const names = nameMapOf(people);

      const byUser = new Map<string, MemberRow[]>();
      for (const m of members) byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), m]);

      for (const [userId, rows] of byUser) {
        // The gap is the member's, not the room's: the latest digest across every room they follow.
        const latest = rows.map((r) => r.last_digest_at).filter((x): x is string => !!x).sort().at(-1) ?? null;
        if (!digestDue({ lastDigestAt: latest, now })) continue;

        const parts: (DigestRoom & { row: MemberRow })[] = [];
        for (const row of rows) {
          const since = Date.parse(digestSince(row));
          const fresh = (byRoom.get(row.room_id) ?? []).filter((m) => m.author_id !== userId && Date.parse(m.created_at) > since);
          const deal = dealById.get(dealOfRoom.get(row.room_id) ?? "");
          if (fresh.length === 0 || !deal) continue;
          parts.push({
            row, title: `${deal.ref ?? ""} ${deal.title}`.trim(), link: dealLink(t, deal.id, "/room"), count: fresh.length,
            mentioned: fresh.some((m) => (m.mentions ?? []).includes(userId)),
            lines: fresh.slice(-ROOM.digestLines).map((m) => `${names.get(m.author_id) ?? "Colleague"}: ${snippet(m.body)}`),
          });
        }
        if (parts.length === 0) continue;
        out.members++;

        const [who] = await memberEmails(admin, t.id, [userId]);
        if (!who) { out.skipped++; continue; }

        // Claim first (compare-and-set on last_digest_at), send second.
        const claimed: MemberRow[] = [];
        const release = async () => {
          for (const c of claimed) await admin.from("deal_room_members").update({ last_digest_at: c.last_digest_at }).eq("id", c.id).eq("tenant_id", t.id);
        };
        let lost = false;
        for (const p of parts) {
          let q = admin.from("deal_room_members").update({ last_digest_at: now.toISOString() }).eq("id", p.row.id).eq("tenant_id", t.id);
          q = p.row.last_digest_at ? q.eq("last_digest_at", p.row.last_digest_at) : q.is("last_digest_at", null);
          const res = await q.select("id");
          if (res.error || (res.data ?? []).length === 0) { lost = true; break; }
          claimed.push(p.row);
        }
        if (lost) { await release(); out.skipped++; continue; }

        const ordered = [...parts].sort((a, b) => Number(b.mentioned) - Number(a.mentioned) || b.count - a.count);
        const msg = digestMessage(ordered);
        const first = dealById.get(dealOfRoom.get(ordered[0].row.room_id) ?? "");
        const sent = await sendTenderMail(admin, t, {
          to: [who.email], subject: msg.subject, text: msg.text, dealId: first?.id ?? "", dealLabel: ordered[0].title, actorId: null, actorEmail: null,
        }, mailer);
        if (sent) out.sent++;
        else { await release(); out.failed++; }
      }
    } catch (e) {
      out.errors.push(`${t.slug}: ${(e as Error).message}`);
    }
  }
  return out;
}
