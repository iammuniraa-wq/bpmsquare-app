import "server-only";
import { addMembers, loadRoom, notifyMentions, peopleByIds, postMessage, tenantMemberIds, type RoomRequest } from "@/lib/tender/roomServer";
import { mentionLabels, cleanText } from "@/lib/tender/room";
import { dealLink, loadNotifyTenant, memberEmails, sendTenderMail } from "@/lib/tender/notify";
import { tenderIsLive } from "@/lib/tender/rules";
import { openTenderDealRequest } from "@/lib/tender/dealAccess";
import { tenantHasFeature } from "@/lib/tenant";
import type { Proposal } from "../types";

// The executor of `tender.nudge` (docs/design/nova-crew-agents.md section 3.5). It runs on the APPROVER's own session: the same door as
// every other tender write (flags gcc_tender + pipeline, edit on the Pipeline workcenter, a deal of THIS workspace), then a Deal Room
// mention through postMessage when the room exists and an e-mail through sendTenderMail (resolveOutbound, logged `tender`). Recipients are
// re-checked against the workspace's members at press time. Nothing here reaches anyone but members of the workspace.

export const NUDGE_MAX_CHARS = 1500;

export type NudgeOutcome =
  | { ok: true; result: { room: boolean; email: boolean; to: number } }
  | { ok: false; status: number; error: string; expire?: boolean };

export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = cleanText(raw).slice(0, NUDGE_MAX_CHARS);
  return t.length >= 2 ? t : null;
}

export async function executeNudge(p: Proposal, message: string): Promise<NudgeOutcome> {
  const opened = await openTenderDealRequest(p.target_id, true);
  if (!opened.ok) return { ok: false, status: opened.status, error: opened.error };
  const req = opened.req;
  if (!tenderIsLive({ outcome: req.opp.outcome, stage: req.opp.stage }, { decision: req.tender.decision })) {
    return { ok: false, status: 409, error: "This tender is no longer open, so the note was not sent.", expire: true };
  }
  const wanted = Array.isArray((p.payload as { recipient_ids?: unknown }).recipient_ids) ? ((p.payload as { recipient_ids: string[] }).recipient_ids) : [];
  const recipients = (await tenantMemberIds(req.admin, req.tenantId, wanted)).filter((id) => id !== req.userId);
  if (recipients.length === 0) return { ok: false, status: 422, error: "No one to send this to: the people it was addressed to are no longer in this workspace.", expire: true };

  const label = String((p.payload as { label?: unknown }).label ?? req.opp.ref ?? req.opp.title ?? "Tender");
  const tenant = await loadNotifyTenant(req.admin, req.tenantId);
  let room = false;
  let email = false;

  // Deal Room mention, only when the room exists and the module is on (never creates a room).
  if (await tenantHasFeature(req.supabase, req.tenantId, "deal_room")) {
    const found = await loadRoom(req.admin, req.tenantId, req.opp.id);
    if (found.room) {
      await addMembers(req.admin, req.tenantId, found.room.id, recipients, req.userId);
      const people = await peopleByIds(req.admin, req.tenantId, recipients);
      const labels = mentionLabels(people);
      const mentions = recipients.map((id) => labels.get(id)).filter(Boolean).map((l) => `@${l}`).join(" ");
      const posted = await postMessage(req as RoomRequest, found.room, { ok: true, kind: "message", text: `${mentions} ${message}`.trim().slice(0, 3900), parentId: null, ownerId: null, due: null }, []);
      if (posted.ok) {
        room = true;
        await notifyMentions(req as RoomRequest, { kind: "message", text: message, mentioned: posted.mentioned, ownerId: null }, null);
      }
    }
  }

  if (tenant) {
    const to = await memberEmails(req.admin, req.tenantId, recipients);
    if (to.length > 0) {
      email = await sendTenderMail(req.admin, tenant, {
        to: to.map((t) => t.email), subject: `${label}: a note from your colleague`, text: `${message}\n\n${dealLink(tenant, req.opp.id)}`,
        dealId: req.opp.id, dealLabel: label, actorId: req.userId,
      });
    }
  }
  if (!room && !email) return { ok: false, status: 502, error: "The note could not be delivered (no Deal Room and the e-mail did not go)." };
  return { ok: true, result: { room, email, to: recipients.length } };
}
