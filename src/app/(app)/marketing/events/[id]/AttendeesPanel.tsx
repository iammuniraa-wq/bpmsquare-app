"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import StatusPill from "@/components/ui/StatusPill";
import { useFeel } from "@/components/FeelProvider";
import { c } from "@/lib/theme";
import { REG_LABEL, canMove, type RegistrationStatus } from "@/lib/marketing/events/rules";

// The attendee list and the check-in screen. Built to be used on a phone at the stand: big buttons, one row per
// person, a search that filters as you type. Only a name, a company and an owner are shown: never a phone or email.

export type Attendee = {
  id: string; name: string; company: string; status: RegistrationStatus; source: string; registeredAt: string; checkedInAt: string | null; ownerName: string | null;
};

const TONE = { registered: "blue", attended: "green", no_show: "amber", cancelled: "purple" } as const;
const when = (s: string) => new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function AttendeesPanel({ eventId, rows, total, canEdit, started, cancelled }: {
  eventId: string; rows: Attendee[]; total: number; canEdit: boolean; started: boolean; cancelled: boolean;
}) {
  const router = useRouter();
  const { confirm } = useFeel();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "stop"; text: string } | null>(null);
  const [who, setWho] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; company: string }[]>([]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.name} ${r.company}`.toLowerCase().includes(s)) : rows;
  }, [rows, q]);
  const waiting = rows.filter((r) => r.status === "registered").length;

  useEffect(() => {
    if (who.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/marketing-events/lookup?kind=contacts&q=${encodeURIComponent(who.trim())}`);
      const j = (await res.json().catch(() => ({}))) as { items?: { id: string; name: string; company: string }[] };
      setFound(j.items ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [who]);

  async function call(key: string, url: string, method: "POST" | "PATCH", body?: unknown, ok?: string) {
    setBusy(key); setMsg(null);
    const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const j = (await res.json().catch(() => ({}))) as { error?: string; marked?: number };
    setBusy(null);
    if (!res.ok) { setMsg({ tone: "stop", text: j.error ?? "That did not work." }); return false; }
    setMsg({ tone: "ok", text: ok ?? (typeof j.marked === "number" ? `${j.marked} marked as not coming.` : "Done.") });
    router.refresh();
    return true;
  }

  const move = (r: Attendee, to: RegistrationStatus, ok: string) => call(r.id, `/api/marketing-events/${eventId}/registrations/${r.id}`, "PATCH", { status: to }, ok);

  async function add(contactId: string, checkIn: boolean) {
    if (await call(contactId, `/api/marketing-events/${eventId}/registrations`, "POST", { contact_id: contactId, check_in: checkIn }, checkIn ? "Registered and checked in." : "Registered.")) { setWho(""); setFound([]); }
  }

  async function noShows() {
    if (!(await confirm({ title: "Mark everyone left as not coming?", body: `${waiting} ${waiting === 1 ? "person is" : "people are"} still only registered. They will be marked as not having come. Anyone who turns up later can still be checked in.`, confirmLabel: "Mark as not coming" }))) return;
    await call("noshows", `/api/marketing-events/${eventId}/no-shows`, "POST");
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {canEdit && !cancelled && (
        <Card padding={14} title="Add someone">
          <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
            <Input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Start typing a name…" aria-label="Find a person" autoComplete="off" />
            {found.length > 0 && (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }} aria-label="People">
                {found.map((p) => (
                  <li key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", border: `1px solid ${c.line}`, borderRadius: 8, padding: "6px 10px" }}>
                    <span style={{ fontSize: 13 }}><b>{p.name}</b>{p.company ? <span style={{ color: c.muted }}> · {p.company}</span> : null}</span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <Button size="sm" disabled={busy !== null} onClick={() => void add(p.id, false)}>Register</Button>
                      <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void add(p.id, true)}>Register and check in</Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <span style={{ fontSize: 12, color: c.hint }}>For a walk-in or a phone sign-up. Nothing is sent to them and no consent is recorded; that is the form&apos;s job.</span>
          </div>
        </Card>
      )}

      <Card padding={0} title={`Attendees (${total})`} action={
        canEdit && started && waiting > 0 ? <Button size="sm" disabled={busy !== null} onClick={() => void noShows()}>Mark everyone left as not coming</Button> : undefined
      }>
        <div style={{ padding: "0 16px 12px" }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or company…" aria-label="Search attendees" />
          {msg && <div role="status" style={{ marginTop: 8, fontSize: 12.5, borderRadius: 8, padding: "6px 10px", background: msg.tone === "ok" ? "var(--greenbg)" : "var(--err-bg)", color: msg.tone === "ok" ? "var(--greenink)" : "var(--err-ink)" }}>{msg.text}</div>}
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: "8px 16px 18px", fontSize: 13, color: c.muted }}>Nobody has registered yet. Link a registration form on the Details tab and open registration, or add someone above.</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: "8px 16px 18px", fontSize: 13, color: c.muted }}>Nobody matches &quot;{q}&quot;.</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {shown.map((r) => (
              <li key={r.id} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderTop: `1px solid ${c.line}` }}>
                <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
                  <div style={{ fontSize: 12.5, color: c.muted, overflowWrap: "anywhere" }}>
                    {[r.company, r.ownerName ? `owner ${r.ownerName}` : null, r.checkedInAt ? `in at ${when(r.checkedInAt)}` : `registered ${when(r.registeredAt)}`, r.source === "rep" ? "added by a colleague" : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <StatusPill label={REG_LABEL[r.status]} tone={TONE[r.status]} />
                {canEdit && !cancelled && (
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {canMove(r.status, "attended") && <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => void move(r, "attended", `${r.name} is checked in.`)}>Check in</Button>}
                    {canMove(r.status, "no_show") && <Button size="sm" disabled={busy !== null || !started} title={started ? undefined : "The event has not started"} onClick={() => void move(r, "no_show", `${r.name} marked as not coming.`)}>Did not come</Button>}
                    {canMove(r.status, "cancelled") && <Button size="sm" variant="quiet" disabled={busy !== null} onClick={() => void move(r, "cancelled", `${r.name}'s registration is cancelled.`)}>Cancel</Button>}
                    {canMove(r.status, "registered") && <Button size="sm" disabled={busy !== null} onClick={() => void move(r, "registered", `${r.name} is registered again.`)}>Register again</Button>}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {total > rows.length && <div style={{ padding: "8px 16px 14px", fontSize: 12, color: c.hint }}>Showing the latest {rows.length} of {total}. Search narrows within these.</div>}
      </Card>
    </div>
  );
}
