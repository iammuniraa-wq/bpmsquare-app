import Link from "next/link";
import { getTenant } from "@/lib/tenant";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { decrypt } from "@/lib/encryption";
import { ROUTES } from "@/lib/constants";
import { inboxAccess, isMissingRelation, loadEmailForViewer } from "@/lib/inbox/server";
import { INBOX_TIPS } from "@/lib/inbox/tips";
import type { LinkObjectType } from "@/lib/inbox/types";
import InfoTip from "@/components/ui/InfoTip";
import Fold from "./Fold";
import RecordFileButton from "./RecordFileButton";
import { sizeWord, whenWord } from "./bits";
import s from "./inbox.module.css";

type SourceRow = {
  source_email_id: string | null; channel_name: string | null; from_address: string | null; from_name: string | null;
  subject: string | null; summary: string | null; received_at: string | null;
};
type FileRow = { id: string; file_name: string; mime_type: string | null; size_bytes: number };

/**
 * "From email": on a Quote, Project, Case, Lead or Estimate that was made from an email, who wrote and a short summary
 * of what they asked, the files that came with it, and a way back to the email while it still exists. All read from
 * what was stored on the record at conversion (record_sources, record_files), so it outlives the email's own retention.
 * Renders nothing for a workspace without the Inbox, a record that was not made from an email, or while the tables are
 * pending. Every query is tenant-scoped; every value is drawn as text.
 */
export default async function SourceEmailSlot({ objectType, objectId }: { objectType: LinkObjectType; objectId: string }) {
  const tenant = await getTenant();
  if (!tenant?.features?.inbox) return null;
  let tenantId: string;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch {
    return null;
  }
  const admin = createAdminSupabase();
  const src = await admin.from("record_sources")
    .select("source_email_id, channel_name, from_address, from_name, subject, summary, received_at")
    .eq("tenant_id", tenantId).eq("object_type", objectType).eq("object_id", objectId).order("created_at", { ascending: true }).limit(5);
  if (src.error) { if (!isMissingRelation(src.error)) console.error("[inbox] source slot", src.error.message); return null; }
  const sources = (src.data ?? []) as SourceRow[];
  if (sources.length === 0) return null;

  // Quote files live under the quote's own Attachments; every other record's copies are listed here.
  const filesQ = objectType === "standard_quotes" ? { data: [] as FileRow[] } : await admin.from("record_files")
    .select("id, file_name, mime_type, size_bytes").eq("tenant_id", tenantId).eq("object_type", objectType).eq("object_id", objectId).order("created_at");
  const files = ((filesQ.data ?? []) as FileRow[]);

  // A way back to the email only for someone on its channel's team, and only while it still has its text.
  let canOpen = new Set<string>();
  try {
    const ctx = await inboxAccess(false);
    const found = await Promise.all(sources.map(async (r) => (r.source_email_id ? { id: r.source_email_id, ok: !!(await loadEmailForViewer(ctx, r.source_email_id)) } : null)));
    canOpen = new Set(found.filter((f): f is { id: string; ok: boolean } => !!f && f.ok).map((f) => f.id));
  } catch { /* not on the Inbox: no link */ }

  return (
    <div style={{ margin: "12px 0", minWidth: 0 }} data-guide="inbox.source">
    <Fold id={`source-${objectType}`} title="From email" defaultOpen={false}>
      {sources.map((r, i) => {
        let summary: string | null = null;
        try { summary = decrypt(r.summary); } catch { summary = null; }
        const who = r.from_name ? `${r.from_name}${r.from_address ? ` <${r.from_address}>` : ""}` : r.from_address ?? "Unknown sender";
        return (
          <div key={r.source_email_id ?? i} className={s.stack}>
            <div className={s.kv}><span className={s.label}>From</span><span className={s.value}>{who}</span></div>
            <div className={s.kv}><span className={s.label}>Subject</span><span className={s.value}>{r.subject || "(no subject)"}</span></div>
            <div className={s.kv}><span className={s.label}>Address and date</span><span className={s.value}>{[r.channel_name, r.received_at ? whenWord(r.received_at) : null].filter(Boolean).join(" · ")}</span></div>
            {summary && <div className={s.kv}><span className={s.label}>What they asked</span><span className={s.value} style={{ whiteSpace: "pre-wrap" }}>{summary}</span></div>}
            {r.source_email_id && canOpen.has(r.source_email_id)
              ? <Link href={ROUTES.inboxMessage(r.source_email_id)}>Open the email</Link>
              : <span className={s.stubNote}>The original email has been cleared or is not on your team.</span>}
          </div>
        );
      })}
      {files.length > 0 && (
        <div className={s.stack}>
          <span className={s.label}>Files from the email</span>
          {files.map((f) => (
            <RecordFileButton key={f.id} id={f.id} name={f.file_name} note={sizeWord(Number(f.size_bytes))} image={f.mime_type === "image/png" || f.mime_type === "image/jpeg"} />
          ))}
        </div>
      )}
      <div className="bpm-label-row"><span className={s.stubNote}>Kept on this record.</span><InfoTip label="From email">{INBOX_TIPS.linked}</InfoTip></div>
    </Fold>
    </div>
  );
}
