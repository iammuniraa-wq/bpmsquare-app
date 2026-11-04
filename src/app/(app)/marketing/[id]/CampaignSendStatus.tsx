"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { c } from "@/lib/theme";
import InfoTip from "@/components/ui/InfoTip";
import { POLL_MAX_MS, QUOTA_LINE, REST_TIP, pollDelay, progressText } from "@/lib/marketing/sendProgress";

type Progress = { status: string; done: number; total: number | null };

/**
 * What the campaign page says while an email is being sent, and after part of it failed.
 * While the status is "sending" it checks the campaign every few seconds (3 s, slowing to 10 s, for at most 20 minutes),
 * shows "Sending… 4 of 8", and refreshes the tiles and the recipients list together on each check, so nobody has to reload.
 * Afterwards, if some recipients failed, it offers "Send the rest": only the failed (and never-reached) people, never
 * anyone already sent, through the same send route and consent gate.
 */
export default function CampaignSendStatus({ campaignId, status, failed, quota, canSendRest }: {
  campaignId: string;
  status: string;
  failed: number;
  /** A failure was the email service's daily limit. */
  quota: boolean;
  /** Plain emails only: a newsletter is sent again from the studio. */
  canSendRest: boolean;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = useRef<number | null>(null);
  const watching = status === "sending" || retrying;

  useEffect(() => {
    if (!watching) return;
    const started = Date.now();
    let attempt = 0;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      if (Date.now() - started > POLL_MAX_MS) { setGaveUp(true); return; }
      try {
        const res = await fetch(`/api/marketing/campaigns/${campaignId}/progress${total.current === null ? "?total=1" : ""}`);
        if (res.ok) {
          const j = await res.json() as { status: string; done: number; total: number | null };
          if (j.total !== null) total.current = j.total;
          if (stopped) return;
          setProgress({ status: j.status, done: j.done, total: total.current });
          router.refresh();
          if (j.status !== "sending") return;
        }
      } catch { /* the next check tries again */ }
      attempt += 1;
      timer = setTimeout(tick, pollDelay(attempt));
    };
    timer = setTimeout(tick, 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [watching, campaignId, router]);

  async function sendRest() {
    setError(null); setRetrying(true); setGaveUp(false);
    try {
      const res = await fetch(`/api/marketing/campaigns/${campaignId}/send?retry=rest`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(j.error || "Could not send the rest");
    } catch {
      setError("Could not send the rest");
    } finally {
      setRetrying(false);
      router.refresh();
    }
  }

  const box: React.CSSProperties = { border: `1px solid ${c.line}`, borderRadius: 10, padding: "10px 12px", marginBottom: 12, background: c.panel };

  if (watching) {
    return (
      <div role="status" aria-live="polite" style={box}>
        <strong style={{ color: c.ink, fontSize: 13.5 }}>{progress ? progressText(progress.done, progress.total) : "Sending…"}</strong>
        {gaveUp && <div style={{ fontSize: 12.5, color: c.hint, marginTop: 4 }}>This is taking longer than expected. Reload the page to see where it is.</div>}
      </div>
    );
  }

  if (failed > 0 && canSendRest) {
    return (
      <div style={{ ...box, background: "var(--amberbg)" }}>
        <div style={{ fontSize: 13, color: "var(--amberink)" }}>{quota ? QUOTA_LINE : `${failed} ${failed === 1 ? "email" : "emails"} could not be sent.`}</div>
        <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Button variant="primary" onClick={() => void sendRest()} loading={retrying}>Send the rest</Button>
          <InfoTip label="Send the rest">{REST_TIP}</InfoTip>
        </div>
        {error && <div role="alert" style={{ marginTop: 6, fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
      </div>
    );
  }
  return null;
}
