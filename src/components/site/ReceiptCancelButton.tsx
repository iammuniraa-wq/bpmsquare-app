"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "./siteUi";

/** A manager cancels a confirmed receipt with a reason; the site person then enters the delivery again. The route decides who may. */
export default function ReceiptCancelButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/site-receipts/${id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(j.error ?? "Could not cancel it"); return; }
    setOpen(false);
    router.refresh();
  }

  if (!open) return <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-md" onClick={() => setOpen(true)} data-guide="site.receipt.cancel">Cancel receipt</button>;
  return (
    <div className="bpm-tap" style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 220 }}>
      <textarea className="bpm-input" rows={2} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} aria-label="Reason" placeholder="Why is it cancelled?" />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="bpm-btn bpm-btn-primary bpm-btn-md" disabled={busy || reason.trim().length < 3} onClick={cancel}>Cancel the receipt</button>
        <button type="button" className="bpm-btn bpm-btn-quiet bpm-btn-md" onClick={() => { setOpen(false); setError(null); }}>Back</button>
      </div>
      {error && <Banner tone="bad">{error}</Banner>}
    </div>
  );
}
