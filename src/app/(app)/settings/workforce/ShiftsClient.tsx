"use client";

import { useCallback, useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import type { WfmShift } from "@/lib/wfm/types";

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "8px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, verticalAlign: "middle",
};
const btn: React.CSSProperties = {
  padding: "8px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8,
  border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer",
};
const btnPrimary: React.CSSProperties = {
  ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff",
};

const hhmm = (t: string) => t.slice(0, 5);

export default function ShiftsClient({ canEdit }: { canEdit: boolean }) {
  const [shifts, setShifts] = useState<WfmShift[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [shiftForm, setShiftForm] = useState({
    name: "", start_time: "09:00", end_time: "18:00", grace_minutes: "10",
    is_night_shift: false, night_allowance_amount: "0",
  });

  const load = useCallback(async () => {
    const res = await fetch("/api/wfm/shifts");
    if (res.ok) setShifts(await res.json());
    else setError((await res.json()).error ?? "Failed to load");
  }, []);

  useEffect(() => { load(); }, [load]);

  async function post(url: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Request failed"); return false; }
      await load();
      return true;
    } catch {
      setError("Network error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addShift() {
    if (!shiftForm.name.trim()) { setError("Shift needs a name"); return; }
    const ok = await post("/api/wfm/shifts", {
      name: shiftForm.name,
      start_time: shiftForm.start_time,
      end_time: shiftForm.end_time,
      grace_minutes: parseInt(shiftForm.grace_minutes) || 0,
      is_night_shift: shiftForm.is_night_shift,
      night_allowance_amount: parseFloat(shiftForm.night_allowance_amount) || 0,
    });
    if (ok) {
      setShiftForm({ name: "", start_time: "09:00", end_time: "18:00", grace_minutes: "10", is_night_shift: false, night_allowance_amount: "0" });
    }
  }

  return (
    <>
      {error && (
        <div style={{ ...cardStyle, marginBottom: 14, color: "#ef4444", fontSize: 12.5 }}>{error}</div>
      )}

      <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "12px 12px 10px", borderBottom: `1px solid ${c.line}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Shifts</div>
          <div style={{ fontSize: 12, color: c.muted, marginTop: 3, maxWidth: 780 }}>
            Working hours people are expected to keep. <strong>Grace</strong> is how late someone can
            check in before it counts as a late mark. A shift whose end time is earlier than its start
            time runs past midnight — tick <strong>crosses midnight</strong> so those night hours are
            counted on the day the shift started, not split across two days.
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Timing</th>
              <th style={th}>Grace</th>
              <th style={th}>Night shift</th>
              <th style={th}>Night allowance</th>
              <th style={th}>Status</th>
              {canEdit && <th style={th}></th>}
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id}>
                <td style={{ ...td, fontWeight: 600, color: c.ink }}>{s.name}</td>
                <td style={td}>
                  {hhmm(s.start_time)} – {hhmm(s.end_time)}
                  {s.crosses_midnight && <span style={{ color: c.hint, marginLeft: 6, fontSize: 11 }}>next day</span>}
                </td>
                <td style={td}>{s.grace_minutes} min</td>
                <td style={td}>{s.is_night_shift ? <Pill label="Night" tone="purple" /> : "—"}</td>
                <td style={td}>{s.is_night_shift ? `₹${s.night_allowance_amount}/shift` : "—"}</td>
                <td style={td}><Pill label={s.active ? "Active" : "Inactive"} tone={s.active ? "green" : "red"} /></td>
                {canEdit && (
                  <td style={td}>
                    <button
                      style={btn}
                      disabled={busy}
                      onClick={() => post(`/api/wfm/shifts/${s.id}`, { active: !s.active }, "PATCH")}
                    >
                      {s.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {shifts.length === 0 && (
              <tr>
                <td style={{ ...td, color: c.hint }} colSpan={7}>
                  No shifts yet. Without one, nobody can be marked late or absent — attendance is
                  recorded but never measured against expected hours.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {canEdit && (
          <div style={{ display: "flex", gap: 10, padding: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 150px" }}>
              <label style={lbl}>Name</label>
              <input style={inp} value={shiftForm.name} onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })} placeholder="General shift" />
            </div>
            <div style={{ flex: "0 1 110px" }}>
              <label style={lbl}>Start</label>
              <input style={inp} type="time" value={shiftForm.start_time} onChange={(e) => setShiftForm({ ...shiftForm, start_time: e.target.value })} />
            </div>
            <div style={{ flex: "0 1 110px" }}>
              <label style={lbl}>End</label>
              <input style={inp} type="time" value={shiftForm.end_time} onChange={(e) => setShiftForm({ ...shiftForm, end_time: e.target.value })} />
            </div>
            <div style={{ flex: "0 1 90px" }}>
              <label style={lbl}>Grace (min)</label>
              <input style={inp} value={shiftForm.grace_minutes} onChange={(e) => setShiftForm({ ...shiftForm, grace_minutes: e.target.value })} />
            </div>
            <div style={{ flex: "0 1 120px" }}>
              <label style={lbl}>Night shift</label>
              <select
                style={inp}
                value={shiftForm.is_night_shift ? "yes" : "no"}
                onChange={(e) => setShiftForm({ ...shiftForm, is_night_shift: e.target.value === "yes" })}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
            {shiftForm.is_night_shift && (
              <div style={{ flex: "0 1 130px" }}>
                <label style={lbl}>Allowance (₹)</label>
                <input style={inp} value={shiftForm.night_allowance_amount} onChange={(e) => setShiftForm({ ...shiftForm, night_allowance_amount: e.target.value })} />
              </div>
            )}
            <button style={btnPrimary} disabled={busy} onClick={addShift}>Add shift</button>
          </div>
        )}
      </section>
    </>
  );
}
