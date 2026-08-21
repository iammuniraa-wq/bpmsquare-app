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

const PUNCH_TYPE_ITEMS = [
  { key: "ot", label: "Overtime (OT in / OT out)", hint: "Employees punch overtime as its own session after checking out; each one needs supervisor approval before it counts toward pay" },
  { key: "mobile_work", label: "Mobile work", hint: "Working away from a site — counts as ordinary working time, just labelled differently" },
  { key: "business_trip", label: "Business trip", hint: "Travel time recorded as working time" },
] as const;

const NOTIFICATION_ITEMS = [
  { key: "late_arrival", label: "Late arrival", hint: "Notify supervisor when someone checks in past shift start + grace" },
  { key: "correction_pending", label: "Correction request submitted", hint: "Notify supervisor when an employee files one" },
  { key: "leave_pending", label: "Leave request submitted", hint: "Notify supervisor when an employee files one" },
  { key: "recheck_flagged", label: "Flagged for review", hint: "Notify the employee when a supervisor flags their punch" },
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

  function updateEmploymentType(i: number, patch: Partial<{ code: string; label: string }>) {
    setCfg((prev) => ({
      ...prev,
      employment_types: prev.employment_types.map((t, j) => (j === i ? { ...t, ...patch } : t)),
    }));
  }
  function addEmploymentType() {
    setCfg((prev) => ({ ...prev, employment_types: [...prev.employment_types, { code: "", label: "" }] }));
  }
  function removeEmploymentType(i: number) {
    setCfg((prev) => ({ ...prev, employment_types: prev.employment_types.filter((_, j) => j !== i) }));
  }

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
            <label style={lbl}>Employee self-service</label>
            <select
              style={inp}
              value={cfg.employee_self_service === false ? "off" : "on"}
              onChange={(e) => setCfg({ ...cfg, employee_self_service: e.target.value === "on" })}
            >
              <option value="on">On — employees punch and enroll from their own login</option>
              <option value="off">Off — supervisor-managed; attendance only at the kiosk</option>
            </select>
            <div style={help}>
              When off, employees don&apos;t punch from their phone or set up their own face — they punch at the office kiosk and a supervisor enrolls them from the Employees screen. Leave and corrections stay available.
            </div>
          </div>

          <div>
            <label style={lbl}>Employee login</label>
            <select
              style={inp}
              value={cfg.login_mode === "code" ? "code" : "email"}
              onChange={(e) => setCfg({ ...cfg, login_mode: e.target.value as WfmConfig["login_mode"] })}
            >
              <option value="email">Email address</option>
              <option value="code">User ID (no personal email needed)</option>
            </select>
            <div style={help}>
              How employees sign in to the self-service portal. With User ID, each employee gets a generated ID (e.g. firstname.lastname) and a password — no personal email. Create each employee&apos;s login from the Employees screen. Admins always sign in by email.
            </div>
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
            <label style={lbl}>Face punch (kiosk)</label>
            <select
              style={inp}
              value={cfg.face_punch}
              onChange={(e) => setCfg({ ...cfg, face_punch: e.target.value as WfmConfig["face_punch"] })}
            >
              <option value="off">Off</option>
              <option value="kiosk">On — kiosk tablet identifies enrolled faces</option>
            </select>
            <div style={help}>Employees enroll their own face from their login (My Workforce), or a supervisor enrolls them from Employees. A registered door tablet then recognizes them to punch.</div>
          </div>

          <div>
            <label style={lbl}>Face sign-in (portal)</label>
            <select
              style={inp}
              value={cfg.face_login ? "on" : "off"}
              onChange={(e) => setCfg({ ...cfg, face_login: e.target.value === "on" })}
            >
              <option value="off">Off</option>
              <option value="on">On — employees can sign in by face</option>
            </select>
            <div style={help}>
              Lets employees sign in to the app by face, as an alternative to ID/email + password. Needs Face punch on (so a face is enrolled). Note: without liveness detection a photo of the employee could sign in — enable deliberately.
            </div>
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

          <div>
            <label style={lbl}>Location required to punch</label>
            <select
              style={inp}
              value={cfg.require_location || cfg.geofence_mode === "block" ? "yes" : "no"}
              disabled={cfg.geofence_mode === "block"}
              onChange={(e) => setCfg({ ...cfg, require_location: e.target.value === "yes" })}
            >
              <option value="no">No — a punch without location is still accepted</option>
              <option value="yes">Yes — check in / check out is rejected without it</option>
            </select>
            <div style={help}>
              {cfg.geofence_mode === "block"
                ? "Always on while geofence enforcement is set to Block — otherwise denying location would be a way around the geofence."
                : "Applies to check in and check out only. Breaks and overtime are never blocked, since those often happen indoors where no fix is available."}
            </div>
          </div>

          <div>
            <label style={lbl}>Selfie required to punch</label>
            <select
              style={inp}
              value={cfg.selfie_mode}
              onChange={(e) => setCfg({ ...cfg, selfie_mode: e.target.value as WfmConfig["selfie_mode"] })}
            >
              <option value="shift">Shift punches — check in / out, mobile work and trip starts</option>
              <option value="all">Every punch — including breaks and overtime</option>
              <option value="off">Off — no selfie is taken on any punch</option>
            </select>
            <div style={help}>
              A denied camera ends the punch; it is never recorded without the photo. Turning this off
              stops selfies being captured or stored at all.
            </div>
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

      <Section
        title="Employment types"
        dek="The list every employee is classified against. The monthly Excel export gets one sheet per type, so adding a type here (e.g. Intern) gives those people their own payroll section."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cfg.employment_types.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                style={{ ...inp, width: 180, flex: "0 0 auto" }}
                value={t.label}
                placeholder="Label (e.g. Intern)"
                onChange={(e) => updateEmploymentType(i, { label: e.target.value })}
              />
              <input
                style={{ ...inp, width: 170, flex: "0 0 auto", fontFamily: "monospace", fontSize: 12 }}
                value={t.code}
                placeholder="code_like_this"
                onChange={(e) => updateEmploymentType(i, { code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
              />
              <button
                type="button"
                onClick={() => removeEmploymentType(i)}
                disabled={cfg.employment_types.length <= 1}
                title={cfg.employment_types.length <= 1 ? "At least one type is required" : "Remove"}
                style={{
                  border: "none", background: "none", color: c.hint, fontSize: 14,
                  cursor: cfg.employment_types.length <= 1 ? "not-allowed" : "pointer", padding: 4,
                  opacity: cfg.employment_types.length <= 1 ? 0.4 : 1,
                }}
              >✕</button>
            </div>
          ))}
          <div>
            <button
              type="button"
              onClick={addEmploymentType}
              style={{
                padding: "7px 12px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                border: `1px dashed ${c.line}`, background: "transparent", color: c.muted,
              }}
            >+ Add employment type</button>
          </div>
          <div style={help}>
            The <strong>code</strong> is what gets stored on each employee — changing a code
            that is already in use leaves those employees classified under the old value, so
            edit the label instead once people are assigned.
          </div>
        </div>
      </Section>

      <Section
        title="Punch types"
        dek="Which options appear in the punch-type dropdown. Check in, check out and breaks are always available."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {PUNCH_TYPE_ITEMS.map(({ key, label, hint }, i) => (
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
                checked={cfg.punch_types[key]}
                onChange={(v) => setCfg({ ...cfg, punch_types: { ...cfg.punch_types, [key]: v } })}
              />
            </div>
          ))}
        </div>

        {cfg.punch_types.ot && (
          <div style={{ marginTop: 18, paddingTop: 18, borderTop: `1px solid ${c.line}`, maxWidth: 320 }}>
            <label style={lbl}>Overtime rate per hour</label>
            <input
              style={inp}
              type="number"
              min={0}
              step="0.01"
              value={cfg.ot_rate_per_hour}
              onChange={(e) => setCfg({ ...cfg, ot_rate_per_hour: Number(e.target.value) || 0 })}
            />
            <div style={help}>
              Flat rate for the whole workspace. Approved overtime is paid on actual
              minutes worked — nothing is rounded up to a full hour. Leave at 0 to track
              overtime hours without costing them.
            </div>
          </div>
        )}
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
