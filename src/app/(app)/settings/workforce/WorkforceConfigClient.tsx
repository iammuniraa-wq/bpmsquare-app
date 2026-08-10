"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import type { WfmConfig } from "@/lib/constants";

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const help: React.CSSProperties = { fontSize: 11.5, color: c.hint, marginTop: 4, lineHeight: 1.4 };
const inp: React.CSSProperties = {
  width: "100%", padding: "8px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const btnPrimary: React.CSSProperties = {
  padding: "9px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 8,
  border: "none", background: "var(--tenant-accent, #378ADD)", color: "#fff", cursor: "pointer",
};
const field: React.CSSProperties = { flex: "1 1 220px", minWidth: 200 };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Karachi", "Asia/Dhaka", "Asia/Colombo",
  "Asia/Kathmandu", "Asia/Singapore", "Europe/London", "America/New_York", "UTC",
];

export default function WorkforceConfigClient({ initial }: { initial: WfmConfig }) {
  const [cfg, setCfg] = useState<WfmConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function toggleWeekOff(day: number) {
    setCfg((prev) => ({
      ...prev,
      week_off_days: prev.week_off_days.includes(day)
        ? prev.week_off_days.filter((d) => d !== day)
        : [...prev.week_off_days, day].sort(),
    }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/settings/workforce", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to save"); return; }
      setCfg(json);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={{ ...cardStyle, marginBottom: 18 }}>
      {error && <div style={{ color: "#ef4444", fontSize: 12.5, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={field}>
          <label style={lbl}>Timezone</label>
          <select style={inp} value={cfg.timezone} onChange={(e) => setCfg({ ...cfg, timezone: e.target.value })}>
            {!TIMEZONES.includes(cfg.timezone) && <option value={cfg.timezone}>{cfg.timezone}</option>}
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
          <div style={help}>All lateness, shift-day and absence calculations run in this timezone.</div>
        </div>

        <div style={field}>
          <label style={lbl}>Working hours</label>
          <select
            style={inp}
            value={cfg.deduct_breaks ? "deduct" : "gross"}
            onChange={(e) => setCfg({ ...cfg, deduct_breaks: e.target.value === "deduct" })}
          >
            <option value="deduct">Check-out − check-in − breaks (deduct breaks)</option>
            <option value="gross">Check-out − check-in (breaks not deducted)</option>
          </select>
          <div style={help}>Breaks are always recorded; this only controls whether they subtract from the daily total.</div>
        </div>

        <div style={field}>
          <label style={lbl}>Late marks per half-day deduction</label>
          <input
            style={inp}
            type="number"
            min={1}
            value={cfg.late_marks_per_half_day}
            onChange={(e) => setCfg({ ...cfg, late_marks_per_half_day: Math.max(1, parseInt(e.target.value) || 1) })}
          />
          <div style={help}>Every N late marks in a calendar month counts as one half-day in the summary — no pay math.</div>
        </div>

        <div style={field}>
          <label style={lbl}>Leave carry-forward</label>
          <select
            style={inp}
            value={cfg.leave_carry_forward ? "yes" : "no"}
            onChange={(e) => setCfg({ ...cfg, leave_carry_forward: e.target.value === "yes" })}
          >
            <option value="no">Unused leave lapses at year end</option>
            <option value="yes">Unused leave carries forward</option>
          </select>
        </div>

        <div style={field}>
          <label style={lbl}>Selfie retention (days)</label>
          <input
            style={inp}
            type="number"
            min={1}
            value={cfg.selfie_retention_days}
            onChange={(e) => setCfg({ ...cfg, selfie_retention_days: Math.max(1, parseInt(e.target.value) || 1) })}
          />
          <div style={help}>Punch selfies are purged after this many days. Enrollment photos are kept until deactivation.</div>
        </div>

        <div style={field}>
          <label style={lbl}>Face verification</label>
          <select
            style={inp}
            value={cfg.face_verification_mode}
            onChange={(e) => setCfg({ ...cfg, face_verification_mode: e.target.value as WfmConfig["face_verification_mode"] })}
          >
            <option value="off">Off</option>
            <option value="flag_only">Flag only (never blocks a punch)</option>
          </select>
        </div>

        <div style={field}>
          <label style={lbl}>Geofence enforcement</label>
          <select
            style={inp}
            value={cfg.geofence_mode}
            onChange={(e) => setCfg({ ...cfg, geofence_mode: e.target.value as WfmConfig["geofence_mode"] })}
          >
            <option value="flag">Flag only — punch succeeds, marked outside geofence</option>
            <option value="block">Block — punch is rejected if outside every site</option>
            <option value="off">Off — no site match attempted at all</option>
          </select>
          <div style={help}>Applies to every check-in/check-out. Sites and their radius are managed in the Sites tab.</div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={lbl}>Email notifications</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          {([
            { key: "late_arrival", label: "Late arrival", hint: "Notify supervisor when someone checks in past shift start + grace" },
            { key: "correction_pending", label: "Correction request submitted", hint: "Notify supervisor when an employee files one" },
            { key: "leave_pending", label: "Leave request submitted", hint: "Notify supervisor when an employee files one" },
            { key: "recheck_flagged", label: "Recheck flagged", hint: "Notify the employee when a supervisor flags their punch" },
          ] as const).map(({ key, label, hint }) => (
            <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: c.ink, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={cfg.notifications[key]}
                onChange={(e) => setCfg({ ...cfg, notifications: { ...cfg.notifications, [key]: e.target.checked } })}
                style={{ marginTop: 2 }}
              />
              <span>
                {label}
                <div style={{ fontSize: 11, color: c.hint, fontWeight: 400 }}>{hint}</div>
              </span>
            </label>
          ))}
        </div>
        <div style={help}>Requires email sending to be configured for this workspace — see Settings → General.</div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={lbl}>Weekly off days</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {WEEKDAYS.map((d, i) => {
            const active = cfg.week_off_days.includes(i);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleWeekOff(i)}
                style={{
                  padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: "pointer",
                  border: `1px solid ${active ? "var(--tenant-accent, #378ADD)" : c.line}`,
                  background: active ? "var(--tenant-accent, #378ADD)" : c.panel,
                  color: active ? "#fff" : c.ink,
                }}
              >
                {d}
              </button>
            );
          })}
        </div>
        <div style={help}>No lateness or absence is marked on these days (or on configured holidays).</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span style={{ fontSize: 12, color: "#10b981" }}>Saved</span>}
      </div>
    </section>
  );
}
