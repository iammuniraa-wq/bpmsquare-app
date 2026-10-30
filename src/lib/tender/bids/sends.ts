import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadActorNames } from "@/lib/actorNames";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { isMissingSchema } from "../server";
import type { TenderDealRequest } from "../dealAccess";
import { SEND_CHANNEL_LABEL, SEND_DOCUMENT_LABEL, type SendInput, type SendView } from "./rules";

// Server side of "Sent to client" (migration 0237, KAMCO feedback slice 5). Every query is tenant-scoped on the admin client and a
// missing table answers `pending`, never a crash. Writes happen only here, from routes that opened the deal for writing.

const COLS = "id, version_no, sent_at, sent_by, channel, document, to_text, note";
type Row = { id: string; version_no: number | null; sent_at: string; sent_by: string | null; channel: SendView["channel"]; document: SendView["document"]; to_text: string | null; note: string | null };

export const PENDING_SENDS = "Sent-to-client records need a database update (migration 0237). Ask your administrator to apply it.";

export async function listSends(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<{ rows: SendView[]; pending: boolean }> {
  const { data, error } = await admin.from("tender_bid_sends").select(COLS).eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("sent_at", { ascending: false }).limit(500);
  if (error) return { rows: [], pending: isMissingSchema(error) };
  const rows = (data ?? []) as Row[];
  const names = await loadActorNames(admin, tenantId, rows.map((r) => r.sent_by));
  return {
    pending: false,
    rows: rows.map((r) => ({
      id: r.id, version_no: r.version_no == null ? null : Number(r.version_no), sent_at: r.sent_at, sent_by_name: r.sent_by ? names.get(r.sent_by) ?? null : null,
      channel: r.channel, document: r.document, to_text: r.to_text, note: r.note,
    })),
  };
}

/** Records one send on the deal the request opened (workspace from the session, never from the body) and writes it to the change log. */
export async function recordSend(req: TenderDealRequest, input: SendInput): Promise<{ ok: true; id: string | null } | { ok: false; status: number; error: string }> {
  const { admin, supabase, tenantId, userId, opp } = req;
  const { data, error } = await admin.from("tender_bid_sends").insert({
    tenant_id: tenantId, opportunity_id: opp.id, version_no: input.version_no, sent_by: userId,
    channel: input.channel, document: input.document, to_text: input.to_text, note: input.note,
  }).select("id").maybeSingle();
  if (error) return isMissingSchema(error) ? { ok: false, status: 503, error: PENDING_SENDS } : { ok: false, status: 500, error: error.message };
  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "opportunity_tenders", objectId: opp.id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update",
    actorId: user?.id ?? userId, actorEmail: user?.email,
    changes: [{ field: "Sent to client", from: null, to: [SEND_DOCUMENT_LABEL[input.document], SEND_CHANNEL_LABEL[input.channel].toLowerCase(), input.to_text].filter(Boolean).join(" · ") }],
  });
  return { ok: true, id: data?.id ?? null };
}
