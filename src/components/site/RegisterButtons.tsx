"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import InfoTip from "@/components/ui/InfoTip";
import { SITE_TIPS } from "@/lib/site/tips";

/** For a cost approver: download the Excel register of approved expenses, then mark them as sent to the ERP once it is uploaded. */
export default function RegisterButtons({ projectId, ids }: { projectId: string; ids: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function mark() {
    setBusy(true); setNote(null);
    const res = await fetch("/api/site-expenses/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    setNote(res.ok ? `${j.marked} marked as sent.` : j.error ?? "Could not mark them.");
    if (res.ok) router.refresh();
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <a href={`/api/site-expenses/register?project_id=${projectId}`} className="bpm-btn bpm-btn-secondary bpm-btn-sm">Register for finance</a>
      {ids.length > 0 && <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-sm" disabled={busy} onClick={mark}>Mark {ids.length} as sent</button>}
      <InfoTip label="Register for finance">{SITE_TIPS.register}</InfoTip>
      {note && <span role="status" style={{ fontSize: 12.5 }}>{note}</span>}
    </span>
  );
}
