"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { Select, Textarea } from "@/components/ui/Input";
import { useFeel } from "@/components/FeelProvider";
import { ROUTES } from "@/lib/constants";
import { linkHref } from "@/lib/inbox/links";
import { askForDrawingReply, splitQuoted } from "@/lib/inbox/rules";
import { INBOX_TIPS } from "@/lib/inbox/tips";
import { OBJECT_LABEL, type InboxAttachment, type InboxDetailView, type InboxEmail } from "@/lib/inbox/types";
import CreateFromEmail from "./CreateFromEmail";
import Fold from "./Fold";
import { QualityTag, StatusTag, senderName, sizeWord, whenWord } from "./bits";
import s from "./inbox.module.css";

const COLLAPSE_AFTER = 3;

/**
 * One customer email and its conversation. Everything that came in the mail is drawn as a React text child inside a
 * pre-wrapped block, so a tag, a script or a link in it is just characters; there is no raw-HTML path on this screen.
 * Files are opened through a short-lived signed link, one at a time, after the server has checked the channel.
 */
export default function ThreadClient({ detail, canEdit, companyName, linkFeatures, retentionDays, nowIso }: {
  detail: InboxDetailView;
  canEdit: boolean;
  companyName: string;
  linkFeatures: Record<string, boolean | undefined>;
  retentionDays: number;
  /** The server's clock when it drew the page, so "5 min ago" reads the same on the server and in the browser. */
  nowIso?: string;
}) {
  const now = nowIso ? new Date(nowIso) : undefined;
  const router = useRouter();
  const { toast } = useFeel();
  const { email, channel, thread, attachments } = detail;
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? thread : thread.slice(-COLLAPSE_AFTER);
  const hidden = thread.length - visible.length;

  async function patch(body: { status?: string; assigned_to?: string | null }, label: string) {
    setBusy(label);
    try {
      const res = await fetch(`/api/inbox/emails/${email.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast({ text: json.error ?? "Could not save that.", tone: "error" }); return; }
      router.refresh();
    } catch {
      toast({ text: "Could not reach the server. Try again.", tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function openFile(a: InboxAttachment) {
    try {
      const res = await fetch(`/api/inbox/attachments/${a.id}`);
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !json.url) { toast({ text: json.error ?? "That file could not be opened.", tone: "error" }); return; }
      if (a.ext === "png" || a.ext === "jpg") window.open(json.url, "_blank", "noopener,noreferrer");
      else window.location.assign(json.url);
    } catch {
      toast({ text: "Could not reach the server. Try again.", tone: "error" });
    }
  }

  const linked = email.linked_object_type && email.linked_object_id
    ? { href: linkHref(email.linked_object_type, email.linked_object_id, linkFeatures), label: `${OBJECT_LABEL[email.linked_object_type]} ${email.linked_object_label ?? ""}`.trim() }
    : null;
  const assignedName = email.assigned_to ? detail.members.find((m) => m.user_id === email.assigned_to) : null;

  return (
    <div className={s.layout}>
      <div className={s.stack}>
        <div className={s.toolbar}>
          <Link href={ROUTES.inbox} className={s.back} data-guide="inbox.back">← Inbox</Link>
          <StatusTag status={email.status} />
          {attachments.length > 0 && <a href="#inbox-files" className={s.filesJump}>{`${attachments.length} file${attachments.length === 1 ? "" : "s"}`}</a>}
          {canEdit && (
            <>
              {email.status !== "handled" ? (
                <Button variant="secondary" loading={busy === "handled"} disabled={!!busy} data-guide="inbox.handled" onClick={() => patch({ status: "handled" }, "handled")}>Mark handled</Button>
              ) : (
                <Button variant="secondary" loading={busy === "new"} disabled={!!busy} onClick={() => patch({ status: "new" }, "new")}>Reopen</Button>
              )}
              {email.status !== "spam" ? (
                <Button variant="secondary" loading={busy === "spam"} disabled={!!busy} data-guide="inbox.spam" onClick={() => patch({ status: "spam" }, "spam")}>Spam</Button>
              ) : (
                <Button variant="secondary" loading={busy === "unspam"} disabled={!!busy} onClick={() => patch({ status: "new" }, "unspam")}>Not spam</Button>
              )}
              <CreateFromEmail
                email={{ id: email.id, subject: email.subject, from_name: email.from_name, from_address: email.from_address, body_text: email.body_text }}
                options={detail.createOptions} match={detail.sender.match} suggestedAccount={detail.sender.suggestedName}
                estimatesAvailable={detail.estimatesAvailable} disabled={!!busy || !!email.purged_at || !!linked}
              />
            </>
          )}
        </div>

        {linked && (
          <div className={s.notice} role="status">
            This email became <Link href={linked.href}>{linked.label}</Link>. <InfoTip label="Linked record">{INBOX_TIPS.linked}</InfoTip>
          </div>
        )}
        {detail.needsBetterDrawing && (
          <div className={s.notice} role="status">None of the files can be measured from with confidence. Ask for a PDF or DXF.</div>
        )}

        {hidden > 0 && (
          <button type="button" className={s.chip} onClick={() => setShowAll(true)}>{`Show ${hidden} earlier message${hidden === 1 ? "" : "s"}`}</button>
        )}
        {visible.map((m) => <Message key={m.id} m={m} companyName={channel.reply_name || companyName} now={now} />)}

        {canEdit && email.direction === "in" && channel.active && (
          <ReplyBox
            emailId={email.id} customerName={detail.sender.name} companyName={channel.reply_name || companyName}
            suggestAsk={detail.needsBetterDrawing} onSent={() => router.refresh()}
          />
        )}
      </div>

      <aside className={s.stack}>
        <Fold id="from" title="Sender and address">
          <div className={s.kv}><span className={s.label}>From</span><span className={s.value}>{senderName(email)}{email.from_name && email.from_address ? ` <${email.from_address}>` : ""}</span></div>
          <div className={s.kv}><span className={s.label}>Address</span><span className={s.value}>{channel.name}{channel.active ? "" : " (paused)"}</span></div>
          <div className={s.kv}><span className={s.label}>Received</span><span className={s.value}>{whenWord(email.received_at, now)}</span></div>
          {canEdit ? (
            <div className={s.kv}>
              <span className={s.label}>Assigned to</span>
              <Select
                className={s.assign} aria-label="Assigned to" data-guide="inbox.assign" value={email.assigned_to ?? ""} disabled={!!busy}
                onChange={(e) => patch({ assigned_to: e.target.value || null }, "assign")}
              >
                <option value="">Nobody</option>
                {detail.members.map((p) => <option key={p.user_id} value={p.user_id}>{p.name || p.email || "Member"}</option>)}
              </Select>
            </div>
          ) : (
            <div className={s.kv}><span className={s.label}>Assigned to</span><span className={s.value}>{assignedName ? assignedName.name || assignedName.email : "Nobody"}</span></div>
          )}
          <div className={s.stubNote}>
            {email.purged_at ? "The text and files have been cleared." : `Kept for ${retentionDays} more day${retentionDays === 1 ? "" : "s"}.`}{" "}
            <InfoTip label="Retention">{INBOX_TIPS.retention}</InfoTip>
          </div>
        </Fold>

        <Fold id="files" anchor="inbox-files" title={<>Files <span className={s.chipCount}>{attachments.length}</span></>} defaultOpen={attachments.length > 0}>
          {attachments.length === 0 ? (
            <div className={s.stubNote}>{email.purged_at ? "Cleared." : "No files came with this email."}</div>
          ) : (
            <>
              <div className="bpm-label-row"><span className={s.label}>Quality</span><InfoTip label="File quality">{INBOX_TIPS.quality}</InfoTip></div>
              {attachments.map((a) => (
                <button key={a.id} type="button" className={s.file} data-guide="inbox.file" onClick={() => openFile(a)} aria-label={`Open ${a.file_name}`}>
                  <span className={s.fileName}>
                    <span>{a.file_name}</span>
                    <span className={s.fileNote}>{sizeWord(a.size_bytes)}{a.quality_note ? ` · ${a.quality_note}` : ""}</span>
                  </span>
                  <QualityTag quality={a.quality} />
                </button>
              ))}
            </>
          )}
        </Fold>
      </aside>
    </div>
  );
}

function Message({ m, companyName, now }: { m: InboxEmail; companyName: string; now?: Date }) {
  const out = m.direction === "out";
  const text = m.body_text ?? "";
  const { fresh, quoted } = splitQuoted(text);
  return (
    <article className={`${s.msg} ${out ? s.msgOut : ""}`}>
      <div className={s.msgHead}>
        <span className={s.msgFrom}>{out ? `${companyName} (reply)` : senderName(m)}</span>
        <span className={s.msgWhen}>{whenWord(m.received_at, now)}{out && m.send_status === "failed" ? " · not sent" : out && m.send_status === "redirected" ? " · redirected" : ""}</span>
      </div>
      {/* Mail that came in was sent to our own address, which says nothing; a reply shows who it went to. */}
      {out && m.to_addresses.length > 0 && <div className={s.msgTo}>{`To ${m.to_addresses.join(", ")}`}</div>}
      {m.purged_at || m.body_text === null ? (
        <div className={s.stub}>The text was cleared after its retention period.</div>
      ) : (
        <>
          <pre className={s.body}>{fresh || "(no text)"}</pre>
          {quoted && (
            <details className={s.quoted}>
              <summary>Earlier text</summary>
              <pre className={s.body}>{quoted}</pre>
            </details>
          )}
        </>
      )}
      {out && m.error && <div className={s.stub} role="alert">{m.error}</div>}
    </article>
  );
}

function ReplyBox({ emailId, customerName, companyName, suggestAsk, onSent }: {
  emailId: string; customerName: string | null; companyName: string; suggestAsk: boolean; onSent: () => void;
}) {
  const { toast } = useFeel();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setError("");
    if (!text.trim()) { setError("Write a reply first."); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/inbox/emails/${emailId}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text }) });
      const json = (await res.json().catch(() => ({}))) as { error?: string; redirected?: boolean; sent_to?: string };
      if (!res.ok) { setError(json.error ?? "Could not send the reply."); return; }
      toast({ text: json.redirected ? `Reply redirected to ${json.sent_to}.` : "Reply sent.", tone: "success" });
      setText("");
      onSent();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={s.reply} data-guide="inbox.reply" aria-label="Reply">
      <div className="bpm-label-row">
        <label htmlFor="inbox-reply" className="bpm-t-label">Reply</label>
        <InfoTip label="Reply">{INBOX_TIPS.reply}</InfoTip>
      </div>
      <Textarea id="inbox-reply" value={text} maxLength={20000} onChange={(e) => setText(e.target.value)} placeholder="Write your answer…" />
      {error && <div role="alert" className={`${s.notice} ${s.noticeErr}`}>{error}</div>}
      <div className={s.replyActions}>
        <Button variant="primary" loading={busy} disabled={busy} data-guide="inbox.send" onClick={send}>Send reply</Button>
        <Button
          variant={suggestAsk ? "primary" : "secondary"} disabled={busy} data-guide="inbox.ask_drawing"
          onClick={() => setText(askForDrawingReply({ customerName, companyName }))}
        >
          Ask for PDF or DXF
        </Button>
      </div>
    </section>
  );
}
