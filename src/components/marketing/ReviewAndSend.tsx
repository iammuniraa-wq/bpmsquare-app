"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import SidePanel from "@/components/ui/SidePanel";
import { c } from "@/lib/theme";
import AudienceCount from "./AudienceCount";
import { useAudiencePreview, type AudienceRule } from "./useAudiencePreview";

export type SendOutcome = { sent: number; failed: number; skipped: number };

/**
 * "Review and send": replaces the generic "Send this campaign now?" question with the real numbers. Who will
 * receive it, who is left out and why (each with the link that fixes it), then Send to N. The count is the send's
 * own decisions, so what is promised here is what goes out. Mail goes out at once and cannot be recalled.
 */
export default function ReviewAndSend({ name, subject, rule, onSend, onClose, onDone }: {
  name: string;
  subject: string;
  rule: AudienceRule;
  /** Saves the draft and sends it; resolves with the outcome or an error text. */
  onSend: () => Promise<{ ok: true; outcome: SendOutcome } | { ok: false; error: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { preview, checking, error: countError } = useAudiencePreview(rule);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SendOutcome | null>(null);

  async function send() {
    setSending(true); setError(null);
    const r = await onSend();
    setSending(false);
    if (!r.ok) { setError(r.error); return; }
    setDone(r.outcome);
  }

  const n = preview?.will_receive ?? 0;
  return (
    <SidePanel
      title="Review and send"
      subtitle={`${name || "Campaign"}${subject ? ` · ${subject}` : ""}`}
      label="Review and send"
      onClose={done ? onDone : onClose}
      footer={done ? (
        <Button variant="primary" onClick={onDone}>See who it went to</Button>
      ) : (
        <Button variant="primary" loading={sending} disabled={sending || checking || !preview || n === 0} onClick={() => void send()}>
          {n > 0 ? `Send to ${n}` : "Send"}
        </Button>
      )}
    >
      {done ? (
        <div role="status">
          <div style={{ fontSize: 26, fontWeight: 700, color: c.ink }}>{done.sent} sent</div>
          <div style={{ fontSize: 13, color: c.muted }}>
            {[done.skipped ? `${done.skipped} left out` : "", done.failed ? `${done.failed} failed` : ""].filter(Boolean).join(" · ") || "Everyone in the audience was emailed."}
          </div>
        </div>
      ) : (
        <>
          {countError ? <div role="alert" style={{ fontSize: 13, color: "var(--err-ink)" }}>{countError}</div> : <AudienceCount preview={preview} checking={checking} />}
          {preview && n === 0 && (
            <div role="alert" style={{ marginTop: 10, fontSize: 13, color: "var(--err-ink)" }}>Nobody can be emailed yet. Fix a reason above, or change the audience.</div>
          )}
          {error && <div role="alert" style={{ marginTop: 10, fontSize: 13, color: "var(--err-ink)" }}>{error}</div>}
        </>
      )}
    </SidePanel>
  );
}
