"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import type { WfmConfig } from "@/lib/constants";

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6,
};
const help: React.CSSProperties = { fontSize: 11.5, color: c.hint, marginTop: 5, lineHeight: 1.45 };
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const btnPrimary: React.CSSProperties = {
  padding: "10px 20px", fontSize: 13, fontWeight: 600, borderRadius: 8,
  border: "none", background: "var(--tenant-accent, #378ADD)", color: "#fff", cursor: "pointer",
};
const sectionTitle: React.CSSProperties = { fontSize: 14.5, fontWeight: 700, color: c.ink, margin: 0 };
const sectionDek: React.CSSProperties = { fontSize: 12, color: c.hint, marginTop: 3 };
const grid = (min: number): React.CSSProperties => ({
  display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: "18px 20px",
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Karachi", "Asia/Dhaka", "Asia/Colombo",
  "Asia/Kathmandu", "Asia/Singapore", "Europe/London", "America/New_York", "UTC",
];

const NOTIFICATION_ITEMS = [
  { key: "late_arrival", label: "Late arrival", hint: "Notify supervisor when someone checks in past shift start + grace" },
  { key: "correction_pending", label: "Correction request submitted", hint: "Notify supervisor when an employee files one" },
  { key: "leave_pending", label: "Leave request submitted", hint: "Notify supervisor when an employee files one" },
  { key: "recheck_flagged", label: "Recheck flagged", hint: "Notify the employee when a supervisor flags their punch" },
] as const;

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        flexShrink: 0, width: 38, height: 22, borderRadius: 999, border: "none", cursor: "pointer",
        background: checked ? "var(--tenant-accent, #378ADD)" : c.line,
        position: "relative", transition: "background .15s ease", padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute", top: 2, left: checked ? 18 : 2,
          width: 18, height: 18, borderRadius: "50%", background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.25)", transition: "left .15s ease",
        }}
      />
    </button>
  );
}

function Section({ title, dek, children }: { title: string; dek?: string; children: React.ReactNode }) {
  return (
    <section style={cardStyle}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={sectionTitle}>{title}</h2>
        {dek && <div style={sectionDek}>{dek}</div>}
      </div>
      {children}
    </section>
  );
}

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
    <div style={{ display: "flex", flexDirection: "column", gap: 18, marginBottom: 18 }}>
      {error && (
        <div style={{ ...cardStyle, color: "#ef4444", fontSize: 12.5, padding: "12px 16px" }}>{error}</div>
      )}

      <Section title="Attendance rules">
        <div style={grid(230)}>
          <div>
            <label style={lbl}>Timezone</label>
            <select style={inp} value={cfg.timezone} onChange={(e) => setCfg({ ...cfg, timezone: e.target.value })}>
              {!TIMEZONES.includes(cfg.timezone) && <option value={cfg.timezone}>{cfg.timezone}</option>}
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
            <div style={help}>All lateness, shift-day and absence calculations run in this timezone.</div>
          </div>

          <div>
            <label style={lbl}>Working hours</label>
            <select
              style={inp}
              value={cfg.deduct_breaks ? "deduct" : "gross"}
              onChange={(e) => setCfg({ ...cfg, deduct_breaks: e.target.value === "deduct" })}
            >
              <option value="deduct">Check-out − check-in − breaks</option>
              <option value="gross">Check-out − check-in (breaks not deducted)</option>
            </select>
            <div style={help}>Breaks are always recorded; this only controls whether they subtract from the daily total.</div>
          </div>

          <div>
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

          <div>
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
        </div>
      </Section>

      <Section title="Verification &amp; location">
        <div style={grid(230)}>
          <div>
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

          <div>
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

          <div>
            <label style={lbl}>Geofence enforcement</label>
            <select
              style={inp}
              value={cfg.geofence_mode}
              onChange={(e) => setCfg({ ...cfg, geofence_mode: e.target.value as WfmConfig["geofence_mode"] })}
            >
              <option value="flag">Flag only — punch succeeds, marked outside</option>
              <option value="block">Block — rejected if outside every site</option>
              <option value="off">Off — no site match attempted</option>
            </select>
            <div style={help}>Sites and their radius are managed in the Sites tab.</div>
          </div>
        </div>
      </Section>

      <Section title="Weekly off days" dek="No lateness or absence is marked on these days, or on configured holidays.">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {WEEKDAYS.map((d, i) => {
            const active = cfg.week_off_days.includes(i);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleWeekOff(i)}
                style={{
                  width: 44, padding: "8px 0", fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: "pointer",
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
      </Section>

      <Section title="Email notifications" dek="Requires email sending to be configured for this workspace — see Settings → General.">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {NOTIFICATION_ITEMS.map(({ key, label, hint }, i) => (
            <div
              key={key}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
                padding: "12px 4px", borderTop: i > 0 ? `1px solid ${c.line}` : "none",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: c.ink, fontWeight: 500 }}>{label}</div>
                <div style={{ fontSize: 11.5, color: c.hint, marginTop: 2 }}>{hint}</div>
              </div>
              <Toggle
                checked={cfg.notifications[key]}
                onChange={(v) => setCfg({ ...cfg, notifications: { ...cfg.notifications, [key]: v } })}
              />
            </div>
          ))}
        </div>
      </Section>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span style={{ fontSize: 12.5, color: "#10b981", fontWeight: 500 }}>Saved</span>}
      </div>
    </div>
  );
}
