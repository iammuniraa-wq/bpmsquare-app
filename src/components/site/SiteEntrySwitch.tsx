"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import InfoTip from "@/components/ui/InfoTip";
import { SITE_TIPS } from "@/lib/site/tips";

/** The per-project "Site entry" switch: may site people record receipts and expenses on this project. Shown to people who manage the project. */
export default function SiteEntrySwitch({ projectId, initial }: { projectId: string; initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip(next: boolean) {
    setBusy(true); setError(null);
    const res = await fetch(`/api/site/projects/${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ site_entry: next }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(j.error ?? "Could not change it"); return; }
    setOn(next);
    router.refresh();
  }

  return (
    <div className="bpm-tap" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13.5, cursor: "pointer" }}>
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void flip(e.target.checked)} style={{ width: 20, height: 20 }} />
        Site entry
      </label>
      <InfoTip label="Site entry">{SITE_TIPS.siteEntry}</InfoTip>
      {error && <span role="alert" style={{ fontSize: 12.5, color: "var(--redink)" }}>{error}</span>}
    </div>
  );
}
