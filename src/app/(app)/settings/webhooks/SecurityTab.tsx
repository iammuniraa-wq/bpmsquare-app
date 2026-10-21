"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { useFeel } from "@/components/FeelProvider";
import s from "./webhooks.module.css";
import { updateWebhook, type Webhook } from "./api";
import { Notice, describeError } from "../middleware/ui";
import { FIXED_HEADERS } from "./logic";
import { WEBHOOK_TIPS } from "./tips";

/**
 * Security: the signing secret is write-only. It reads "Set"; Regenerate replaces it. If the server shows the new one
 * for that single response it stays on screen with Copy until the panel closes, because it cannot be read back.
 */
export default function SecurityTab({ webhook, revealed, onRevealed, onChanged }: {
  webhook: Webhook; revealed: string | null; onRevealed: (secret: string | null) => void; onChanged: (w: Webhook) => void;
}) {
  const { confirm } = useFeel();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const regenerate = async () => {
    if (!(await confirm({ title: "Generate a new signing secret?", body: "The old secret stops verifying the moment this is done. Update the receiving end too.", confirmLabel: "Generate", tone: "danger" }))) return;
    setBusy(true); setError(null); setCopied(false);
    try {
      const r = await updateWebhook(webhook.id, { regenerate_secret: true });
      onChanged(r.webhook);
      onRevealed(r.revealedSecret);
    } catch (e) { setError(describeError(e)); } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!revealed) return;
    try { await navigator.clipboard.writeText(revealed); setCopied(true); } catch { setError("Could not copy. Select the secret and copy it by hand."); }
  };

  return (
    <>
      <section className={s.block} aria-label="Signing secret">
        <div className="bpm-label-row">
          <h3 className="bpm-t-label">Signing secret</h3><InfoTip label="Signing secret">{WEBHOOK_TIPS.secret}</InfoTip>
        </div>
        {revealed ? (
          <Notice tone="warn" live>
            <div className={s.secretBox}>
              <code>{revealed}</code>
              <Button size="sm" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</Button>
            </div>
            Copy it now. It is not shown again.
          </Notice>
        ) : (
          <div className={s.row}><span className={s.pill}>Set</span></div>
        )}
        <div className={s.row}>
          <Button onClick={() => void regenerate()} loading={busy}>Regenerate</Button>
          <InfoTip label="Regenerate">{WEBHOOK_TIPS.regenerate}</InfoTip>
        </div>
        {error && <div className={s.issue} role="alert">{error}</div>}
      </section>

      <section className={s.block} aria-label="Headers sent">
        <div className="bpm-label-row">
          <h3 className="bpm-t-label">Headers we send</h3><InfoTip label="Headers we send">{WEBHOOK_TIPS.headersSent}</InfoTip>
        </div>
        <ul className={s.usedList}>
          {FIXED_HEADERS.map((h) => <li key={h}><span className={`${s.chip} ${s.mono}`}>{h}</span></li>)}
        </ul>
      </section>
    </>
  );
}
