"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import StatusPill from "@/components/ui/StatusPill";
import { Input } from "@/components/ui/Input";
import { c } from "@/lib/theme";
import { EMAIL_STATUS_COPY } from "@/lib/marketing/emailHealth";
import type { ContactHealth } from "@/lib/marketing/contactHealth";

const EVENT_WORDS: Record<string, string> = {
  "email.delivered": "Delivered", "email.bounced": "Bounced", "email.complained": "Marked as spam", "email.sent": "Sent",
};
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

type Mode = null | "fix" | "confirm";

export default function EmailHealthCard({ contactId, email, health: initial, canEdit }: {
  contactId: string; email: string | null; health: ContactHealth; canEdit: boolean;
}) {
  const router = useRouter();
  const [health, setHealth] = useState(initial);
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  if (!health.available) {
    return (
      <Card title="Email health">
        <p className="bpm-t-help" style={{ margin: 0 }}>Waiting for a database update. This card will fill in once it has been applied.</p>
      </Card>
    );
  }

  const copy = EMAIL_STATUS_COPY[health.status];
  const blockedStatus = health.status === "bounced" || health.status === "complained";

  async function run(body: Record<string, string>) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/email-health`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setNote({ tone: "err", text: json.error ?? "That did not work. Try again." }); return; }
      setHealth(json.health as ContactHealth);
      setNote({ tone: "ok", text: json.message as string });
      setMode(null); setNewEmail(""); setReason("");
      router.refresh();
    } catch {
      setNote({ tone: "err", text: "Could not reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Email health">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <StatusPill label={copy.label} tone={copy.tone} />
        {health.at && <span className="bpm-t-help">since {fmt(health.at)}</span>}
        {health.blocked && <StatusPill label="No email will be sent" tone="red" />}
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 13.5, color: c.ink }}>{health.reason ?? copy.plain}</p>
      <p className="bpm-t-help" style={{ margin: "6px 0 0" }}>{health.status === "unknown" || health.status === "valid" ? copy.todo : `What to do: ${copy.todo}`}</p>
      {health.lastEvent && (
        <p className="bpm-t-help" style={{ margin: "6px 0 0" }}>
          Last email event: {EVENT_WORDS[health.lastEvent.name] ?? "Activity"} on {fmt(health.lastEvent.at)}.
        </p>
      )}
      {!email && <p className="bpm-t-help" style={{ margin: "6px 0 0" }}>This contact has no email address yet.</p>}

      {canEdit && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${c.line}` }}>
          <div>
            <Button size="sm" onClick={() => run({ action: "check" })} loading={busy && mode === null} disabled={!email || busy}>Check this address</Button>
            <div className="bpm-t-help" style={{ marginTop: 4 }}>Looks at the spelling and whether the domain can receive mail. Nothing is sent.</div>
          </div>

          <div>
            <Button size="sm" onClick={() => { setMode(mode === "fix" ? null : "fix"); setNote(null); }} disabled={busy}>Fix the address</Button>
            <div className="bpm-t-help" style={{ marginTop: 4 }}>Type the right address. The old problem is cleared and the new address is checked.</div>
            {mode === "fix" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <Input type="email" aria-label="New email address" placeholder="name@company.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} style={{ flex: "1 1 200px", minWidth: 0 }} />
                <Button size="sm" variant="primary" loading={busy} disabled={!newEmail.trim() || busy} onClick={() => run({ action: "fix", email: newEmail })}>Save address</Button>
              </div>
            )}
          </div>

          {!blockedStatus && (
            <div>
              <Button size="sm" onClick={() => { setMode(mode === "confirm" ? null : "confirm"); setNote(null); }} disabled={busy}>Mark as checked</Button>
              <div className="bpm-t-help" style={{ marginTop: 4 }}>Use this when you confirmed the address another way, like a phone call.</div>
              {mode === "confirm" && (
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <Input aria-label="How you confirmed it" placeholder="Confirmed by phone on 20 Oct" maxLength={160} value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: "1 1 200px", minWidth: 0 }} />
                  <Button size="sm" variant="primary" loading={busy} disabled={reason.trim().length < 3 || busy} onClick={() => run({ action: "confirm", reason })}>Mark as checked</Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {note && (
        <div role={note.tone === "err" ? "alert" : "status"} className="bpm-t-help" style={{ marginTop: 12, color: note.tone === "err" ? "var(--err-ink)" : c.muted }}>
          {note.text}
        </div>
      )}
    </Card>
  );
}
