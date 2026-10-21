"use client";

import { useState } from "react";
import styles from "./publicForm.module.css";

// The one button of the confirm page. Pressing it is what turns "waiting for confirmation" into a yes.

export default function ConfirmButton({ contactId, token, brand }: { contactId: string; token: string; brand: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/marketing/confirm/${encodeURIComponent(contactId)}/${encodeURIComponent(token)}`, { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) { setError(j.error ?? "We could not save that. Please try again."); return; }
      setDone(true);
    } catch {
      setError("We could not save that. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) return <div className={styles.ok} role="status">Thank you. You will now hear from {brand}. You can change your mind at any time from any email we send.</div>;
  return (
    <>
      {error ? <div className={styles.err} role="alert">{error}</div> : null}
      <div className={styles.actions}>
        <button type="button" className={styles.btn} disabled={busy} onClick={() => void confirm()}>{busy ? "Saving…" : "Yes, confirm"}</button>
      </div>
    </>
  );
}
