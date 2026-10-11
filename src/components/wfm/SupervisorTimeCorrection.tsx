"use client";

import { useEffect, useState } from "react";
import { c, statusInk } from "@/lib/theme";
import Pill from "@/components/Pill";
import { OT_KINDS, PUNCH_KIND_LABEL, type PresenceKind } from "@/lib/wfm/types";
import { ADDABLE_KINDS, MIN_REASON_LENGTH, MAX_REASON_LENGTH } from "@/lib/wfm/timeCorrection";

/**
 * A supervisor changes an employee's time for one day, and says why.
 *
 * Lists that day's live punches. Each non-overtime punch can be changed, and a
 * missing one can be added. The explanation is mandatory: the employee reads
 * it, and it is what an audit asks for. See api/wfm/employees/[id]/time-correction
 * for the rules this screen mirrors but does not enforce -- the server is the
 * authority, this only avoids offering what it will refuse.
 */

type DayEvent = { id: string; kind: PresenceKind; ts: string; source: string };

type Mode = { type: "change"; event: DayEvent } | { type: "add" };

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO instant -> the value a datetime-local input wants, in the browser's own zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 };
const inp: React.CSSProperties = { width: "100%", padding: "9px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box" };
const btn: React.CSSProperties = { padding: "8px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer" };
const btnPrimary: React.CSSProperties = { ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff" };

export default function SupervisorTimeCorrection({
  employeeId, employeeName, date, onClose, onDone,
}: {
  employeeId: string;
  employeeName: string;
  /** YYYY-MM-DD */
  date: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [events, setEvents] = useState<DayEvent[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<Mode | null>(null);
  const [when, setWhen] = useState("");
  const [addKind, setAddKind] = useState<(typeof ADDABLE_KINDS)[number]>("check_out");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/wfm/presence?employee_id=${employeeId}&date=${date}`)
      .then(async (res) => {
        const json = await res.json();
        if (!live) return;
        if (!res.ok) { setLoadError(json.error ?? "Could not load that day"); return; }
        setEvents(json.events ?? []);
      })
      .catch(() => { if (live) setLoadError("Could not reach the server"); });
    return () => { live = false; };
  }, [employeeId, date]);

  function startChange(event: DayEvent) {
    setMode({ type: "change", event });
    setWhen(toLocalInput(event.ts));
    setReason("");
    setError("");
  }

  function startAdd() {
    setMode({ type: "add" });
    setWhen(`${date}T09:00`);
    setReason("");
    setError("");
  }

  async function submit() {
    if (!mode) return;
    if (!when) { setError("Give the corrected date and time."); return; }
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setError(`Give a reason (at least ${MIN_REASON_LENGTH} characters) -- the employee will see it.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/wfm/employees/${employeeId}/time-correction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode.type,
          ...(mode.type === "change" ? { target_event_id: mode.event.id } : { kind: addKind }),
          // Same convention as the employee's own correction form: the typed
          // time is read in the browser's zone.
          proposed_ts: new Date(when).toISOString(),
          reason: reason.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Could not save the change"); return; }
      onDone();
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  const sourcePill = (source: string) =>
    source === "web_selfie" ? null
      : <Pill label={source === "correction" ? "Corrected" : source === "kiosk_face" ? "Kiosk" : "Supervisor"} tone={source === "kiosk_face" ? "blue" : "purple"} />;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Correct time for ${employeeName}`}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 80 }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div style={{ background: c.panel, color: c.ink, borderRadius: 14, padding: 22, width: "min(94vw, 520px)", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 18px 50px rgba(0,0,0,0.3)" }}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>Correct time</div>
        <div style={{ fontSize: 12.5, color: c.muted, marginTop: 2, marginBottom: 14 }}>
          {employeeName} · {new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
        </div>

        {loadError && <div style={{ color: statusInk.bad, fontSize: 13, marginBottom: 10 }}>{loadError}</div>}
        {!events && !loadError && <div style={{ color: c.hint, fontSize: 13 }}>Loading…</div>}

        {events && !mode && (
          <>
            {events.length === 0 && <div style={{ color: c.hint, fontSize: 13, marginBottom: 10 }}>No punches recorded this day.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {events.map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", border: `1px solid ${c.line}`, borderRadius: 9 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{PUNCH_KIND_LABEL[e.kind] ?? e.kind}</span>
                    <span style={{ color: c.muted, fontSize: 13, marginLeft: 8 }}>{fmtTime(e.ts)}</span>
                  </div>
                  {sourcePill(e.source)}
                  {OT_KINDS.includes(e.kind)
                    ? <span style={{ fontSize: 11, color: c.hint }}>via OT approval</span>
                    : <button style={btn} onClick={() => startChange(e)}>Change</button>}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, gap: 8 }}>
              <button style={btn} onClick={startAdd}>+ Add a missing punch</button>
              <button style={btn} onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {mode && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {mode.type === "change"
                ? <>Change {PUNCH_KIND_LABEL[mode.event.kind]} <span style={{ color: c.muted, fontWeight: 400 }}>(now {fmtTime(mode.event.ts)})</span></>
                : "Add a missing punch"}
            </div>

            {mode.type === "add" && (
              <div>
                <label style={lbl}>Punch</label>
                <select style={inp} value={addKind} onChange={(e) => setAddKind(e.target.value as (typeof ADDABLE_KINDS)[number])}>
                  {ADDABLE_KINDS.map((k) => <option key={k} value={k}>{PUNCH_KIND_LABEL[k]}</option>)}
                </select>
              </div>
            )}

            <div>
              <label style={lbl}>{mode.type === "change" ? "Correct time" : "Time"}</label>
              <input style={inp} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              <div style={{ fontSize: 11, color: c.hint, marginTop: 3 }}>Read in this browser&apos;s time zone.</div>
            </div>

            <div>
              <label style={lbl}>Why are you changing it? <span style={{ color: statusInk.bad }}>*</span></label>
              <textarea
                style={{ ...inp, minHeight: 84, resize: "vertical", fontFamily: "inherit" }}
                value={reason}
                maxLength={MAX_REASON_LENGTH}
                placeholder="e.g. Employee forgot to punch out; confirmed at the gate register."
                onChange={(e) => setReason(e.target.value)}
              />
              <div style={{ fontSize: 11, color: c.hint, marginTop: 3 }}>
                The employee will see this, and it is recorded against your name.
              </div>
            </div>

            {error && <div style={{ color: statusInk.bad, fontSize: 13 }}>{error}</div>}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button style={btn} disabled={busy} onClick={() => { setMode(null); setError(""); }}>Back</button>
              <button style={btnPrimary} disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : "Save change"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
