"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";

// The follow-up: starts a journey you already built, for the people who came or the people who did not. It builds no
// automation of its own; the journey keeps its consent, quiet-hours and daily-limit rules.

export default function FollowUpPanel({ eventId, journey, forLabel, count, started, canEdit }: {
  eventId: string; journey: { id: string; name: string; status: string } | null; forLabel: string; count: number; started: number; canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "stop"; text: string } | null>(null);

  async function start() {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/marketing-events/${eventId}/follow-up`, { method: "POST" });
    const j = (await res.json().catch(() => ({}))) as { enrolled?: number; already?: number; skipped?: number; error?: string };
    setBusy(false);
    if (!res.ok) { setMsg({ tone: "stop", text: j.error ?? "Could not start the follow-up." }); return; }
    const parts = [`${j.enrolled ?? 0} started`, j.already ? `${j.already} already in it` : null, j.skipped ? `${j.skipped} skipped (no person to contact)` : null].filter(Boolean);
    setMsg({ tone: "ok", text: `${parts.join(", ")}.` });
    router.refresh();
  }

  const live = journey?.status === "live";
  const waiting = Math.max(0, count - started);
  return (
    <Card padding={16} title="Follow-up">
      {!journey ? (
        <p style={{ margin: 0, fontSize: 13, color: c.muted }}>No journey is chosen. Pick one on the Details tab, under Follow-up, to start it for {forLabel.toLowerCase()}.</p>
      ) : (
        <div style={{ display: "grid", gap: 10, maxWidth: 560 }}>
          <div style={{ fontSize: 13.5 }}>
            Journey <Link href={ROUTES.marketingJourney(journey.id)} style={{ fontWeight: 600, color: c.ink }}>{journey.name}</Link>{" "}
            <span style={{ color: c.muted }}>({live ? "running" : journey.status})</span>, for <b>{forLabel.toLowerCase()}</b>.
          </div>
          <div style={{ fontSize: 13, color: c.muted }}>{count} {count === 1 ? "person" : "people"} qualify now; {started} already started. {waiting > 0 ? `${waiting} can be started.` : "Nobody is waiting."}</div>
          <div>
            <Button variant="primary" disabled={!canEdit || busy || !live || waiting === 0} loading={busy} onClick={() => void start()}>Start the follow-up for {waiting} {waiting === 1 ? "person" : "people"}</Button>
          </div>
          {!live && <div style={{ fontSize: 12.5, color: "var(--amberink)" }}>Turn the journey on first. It is not running, so nothing could happen.</div>}
          {msg && <div role="status" style={{ fontSize: 12.5, borderRadius: 8, padding: "6px 10px", background: msg.tone === "ok" ? "var(--greenbg)" : "var(--err-bg)", color: msg.tone === "ok" ? "var(--greenink)" : "var(--err-ink)" }}>{msg.text}</div>}
          <p style={{ margin: 0, fontSize: 12, color: c.hint }}>This puts the people into the journey. The journey decides what happens: it checks consent again before every message, waits out quiet hours, and a person who already went through that journey is not put through it twice. It runs within five minutes.</p>
        </div>
      )}
    </Card>
  );
}
