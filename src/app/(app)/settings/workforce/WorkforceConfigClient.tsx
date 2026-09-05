"use client";

import { useMemo, useState } from "react";
import { c } from "@/lib/theme";
import SettingsSection from "@/components/settings/SettingsSection";
import { SettingsField, SettingsRow, settingsInput as inp } from "@/components/settings/SettingsField";
import type { WfmConfig } from "@/lib/constants";

// Workforce holds more configuration than any other module and gains more with
// each capability, so it is laid out for that: collapsed sections whose headers
// state what they currently hold, help text behind the "?" on each setting, and
// a save bar that stays in reach. See src/components/settings/.

const btnPrimary: React.CSSProperties = {
  padding: "10px 20px", fontSize: 13, fontWeight: 600, borderRadius: 8,
  border: "none", background: "var(--tenant-accent, #378ADD)", color: "#fff", cursor: "pointer",
};
const help: React.CSSProperties = { fontSize: 11.5, color: c.hint, marginTop: 8, lineHeight: 1.5 };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TIMEZONES = [
  "Asia/Kolkata", "Asia/Dubai", "Asia/Karachi", "Asia/Dhaka", "Asia/Colombo",
  "Asia/Kathmandu", "Asia/Singapore", "Europe/London", "America/New_York", "UTC",
];

const PUNCH_TYPE_ITEMS = [
  { key: "ot", label: "Overtime", hint: "Employees punch overtime as its own session after checking out; each one needs supervisor approval before it counts toward pay." },
  { key: "mobile_work", label: "Mobile work", hint: "Working away from a site — counts as ordinary working time, just labelled differently." },
  { key: "business_trip", label: "Business trip", hint: "Travel time recorded as working time." },
] as const;

const NOTIFICATION_ITEMS = [
  { key: "late_arrival", label: "Late arrival", hint: "Notify the supervisor when someone checks in past shift start + grace." },
  { key: "correction_pending", label: "Correction request submitted", hint: "Notify the supervisor when an employee files one." },
  { key: "leave_pending", label: "Leave request submitted", hint: "Notify the supervisor when an employee files one." },
  { key: "recheck_flagged", label: "Flagged for review", hint: "Notify the employee when a supervisor flags their punch." },
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

export default function WorkforceConfigClient({ initial, projectsOn = false }: { initial: WfmConfig; projectsOn?: boolean }) {
  const [cfg, setCfg] = useState<WfmConfig>(initial);
  // What is actually stored right now, so the save bar can tell whether there
  // is anything to save rather than always inviting a pointless write.
  const [savedCfg, setSavedCfg] = useState<WfmConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const dirty = useMemo(() => JSON.stringify(cfg) !== JSON.stringify(savedCfg), [cfg, savedCfg]);

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

  const costing = cfg.costing ?? { default_bill_rate: 0, default_cost_rate: 0, rates_by_employment_type: {}, due_days: 30, auto_draft_monthly: false };
  function setCosting(patch: Partial<WfmConfig["costing"]>) {
    setCfg((prev) => ({ ...prev, costing: { ...costing, ...patch } }));
  }
  function setTypeRate(code: string, key: "bill" | "cost", raw: string) {
    const v = raw.trim() === "" ? undefined : Math.max(0, Number(raw) || 0);
    const current = { ...(costing.rates_by_employment_type[code] ?? {}) };
    if (v === undefined || v === 0) delete current[key]; else current[key] = v;
    const next = { ...costing.rates_by_employment_type };
    if (Object.keys(current).length === 0) delete next[code]; else next[code] = current;
    setCosting({ rates_by_employment_type: next });
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
      setSavedCfg(json);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  // Each header answers "what is this set to" without being opened -- the
  // reason someone visits a settings page far more often than to change it.
  const enabledPunchTypes = PUNCH_TYPE_ITEMS.filter((p) => cfg.punch_types[p.key]).map((p) => p.label);
  const notifOn = NOTIFICATION_ITEMS.filter((n) => cfg.notifications[n.key]).length;
  const weekOffLabel = cfg.week_off_days.length
    ? cfg.week_off_days.map((d) => WEEKDAYS[d]).join(", ")
    : "None — every day is a working day";

  const summaries = {
    attendance: [
      cfg.timezone,
      cfg.deduct_breaks ? "breaks deducted" : "breaks not deducted",
      `self-service ${cfg.employee_self_service === false ? "off" : "on"}`,
    ].join(" · "),
    verification: [
      `Face punch ${cfg.face_punch === "kiosk" ? "on" : "off"}`,
      `geofence ${cfg.geofence_mode}`,
      `selfie ${cfg.selfie_mode === "off" ? "off" : cfg.selfie_mode === "all" ? "every punch" : "shift punches"}`,
    ].join(" · "),
    weekOff: weekOffLabel,
    employment: `${cfg.employment_types.length} type${cfg.employment_types.length === 1 ? "" : "s"} · ${cfg.employment_types.map((t) => t.label || t.code).filter(Boolean).join(", ")}`,
    punchTypes: enabledPunchTypes.length
      ? `${enabledPunchTypes.join(", ")} on${cfg.punch_types.ot && cfg.ot_rate_per_hour ? ` · OT at ${cfg.ot_rate_per_hour}/hr` : ""}`
      : "Check in, check out and breaks only",
    reminder: cfg.long_day_alert?.enabled
      ? `On — after ${cfg.long_day_alert.after_hours ?? 9} hours worked`
      : "Off",
    notifications: `${notifOn} of ${NOTIFICATION_ITEMS.length} on`,
    billing: costing.default_bill_rate > 0 || Object.values(costing.rates_by_employment_type).some((r) => (r.bill ?? 0) > 0)
      ? [
          costing.default_bill_rate > 0 ? `${costing.default_bill_rate}/hr default` : "no default rate",
          `due in ${costing.due_days} days`,
          costing.auto_draft_monthly ? "month-end drafts on" : "manual",
        ].join(" · ")
      : "Not set up — project hours can't be invoiced yet",
  };

  return (
    <div className="set-page" style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
      {error && (
        <div style={{
          color: "#ef4444", fontSize: 12.5, padding: "12px 16px",
          background: "var(--card-bg)", border: "1px solid var(--line)",
          borderRadius: "var(--card-radius)",
        }}>{error}</div>
      )}

      <SettingsSection id="wfm-attendance" title="Attendance rules" summary={summaries.attendance} defaultOpen>
        <div className="set-grid">
          <SettingsField label="Timezone" help="All lateness, shift-day and absence calculations run in this timezone.">
            <select style={inp} value={cfg.timezone} onChange={(e) => setCfg({ ...cfg, timezone: e.target.value })}>
              {!TIMEZONES.includes(cfg.timezone) && <option value={cfg.timezone}>{cfg.timezone}</option>}
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </SettingsField>

          <SettingsField
            label="Employee self-service"
            help="When off, employees don't punch from their phone or set up their own face — they punch at the office kiosk and a supervisor enrolls them from the Employees screen. Leave and corrections stay available."
          >
            <select
              style={inp}
              value={cfg.employee_self_service === false ? "off" : "on"}
              onChange={(e) => setCfg({ ...cfg, employee_self_service: e.target.value === "on" })}
            >
              <option value="on">On — employees punch from their own login</option>
              <option value="off">Off — supervisor-managed, kiosk only</option>
            </select>
          </SettingsField>

          <SettingsField
            label="Employee login"
            help="How employees sign in to the self-service portal. With User ID, each employee gets a generated ID (e.g. firstname.lastname) and a password — no personal email. Create each employee's login from the Employees screen. Admins always sign in by email."
          >
            <select
              style={inp}
              value={cfg.login_mode === "code" ? "code" : "email"}
              onChange={(e) => setCfg({ ...cfg, login_mode: e.target.value as WfmConfig["login_mode"] })}
            >
              <option value="email">Email address</option>
              <option value="code">User ID (no personal email needed)</option>
            </select>
          </SettingsField>

          <SettingsField
            label="Working hours"
            help="Breaks are always recorded; this only controls whether they subtract from the daily total."
          >
            <select
              style={inp}
              value={cfg.deduct_breaks ? "deduct" : "gross"}
              onChange={(e) => setCfg({ ...cfg, deduct_breaks: e.target.value === "deduct" })}
            >
              <option value="deduct">Check-out − check-in − breaks</option>
              <option value="gross">Check-out − check-in (breaks not deducted)</option>
            </select>
          </SettingsField>

          <SettingsField
            label="Late marks per half-day"
            help="Every N late marks in a calendar month counts as one half-day in the summary — no pay math."
          >
            <input
              style={inp}
              type="number"
              min={1}
              value={cfg.late_marks_per_half_day}
              onChange={(e) => setCfg({ ...cfg, late_marks_per_half_day: Math.max(1, parseInt(e.target.value) || 1) })}
            />
          </SettingsField>

          <SettingsField label="Leave carry-forward">
            <select
              style={inp}
              value={cfg.leave_carry_forward ? "yes" : "no"}
              onChange={(e) => setCfg({ ...cfg, leave_carry_forward: e.target.value === "yes" })}
            >
              <option value="no">Unused leave lapses at year end</option>
              <option value="yes">Unused leave carries forward</option>
            </select>
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection id="wfm-verification" title="Verification & location" summary={summaries.verification}>
        <div className="set-grid">
          <SettingsField
            label="Selfie retention (days)"
            help="Punch selfies are purged after this many days. Enrollment photos are kept until deactivation."
          >
            <input
              style={inp}
              type="number"
              min={1}
              value={cfg.selfie_retention_days}
              onChange={(e) => setCfg({ ...cfg, selfie_retention_days: Math.max(1, parseInt(e.target.value) || 1) })}
            />
          </SettingsField>

          <SettingsField
            label="Face punch (kiosk)"
            help="Employees enroll their own face from their login (My Workforce), or a supervisor enrolls them from Employees. A registered door tablet then recognizes them to punch."
          >
            <select
              style={inp}
              value={cfg.face_punch}
              onChange={(e) => setCfg({ ...cfg, face_punch: e.target.value as WfmConfig["face_punch"] })}
            >
              <option value="off">Off</option>
              <option value="kiosk">On — kiosk tablet identifies enrolled faces</option>
            </select>
          </SettingsField>

          <SettingsField
            label="Face sign-in (portal)"
            help="Lets employees sign in to the app by face, as an alternative to ID/email + password. Needs Face punch on (so a face is enrolled). Note: without liveness detection a photo of the employee could sign in — enable deliberately."
          >
            <select
              style={inp}
              value={cfg.face_login ? "on" : "off"}
              onChange={(e) => setCfg({ ...cfg, face_login: e.target.value === "on" })}
            >
              <option value="off">Off</option>
              <option value="on">On — employees can sign in by face</option>
            </select>
          </SettingsField>

          <SettingsField
            label="Passkey sign-in"
            help="The employee's own phone biometric unlocks sign-in (real Face ID / fingerprint). We store only a public key — no biometric data reaches the server, and photos can't spoof it. Employees add it from Profile → Account Settings after their first sign-in."
          >
            <select
              style={inp}
              value={cfg.passkey_login ? "on" : "off"}
              onChange={(e) => setCfg({ ...cfg, passkey_login: e.target.value === "on" })}
            >
              <option value="off">Off</option>
              <option value="on">On — employees add a passkey themselves</option>
            </select>
          </SettingsField>

          <SettingsField label="Face verification">
            <select
              style={inp}
              value={cfg.face_verification_mode}
              onChange={(e) => setCfg({ ...cfg, face_verification_mode: e.target.value as WfmConfig["face_verification_mode"] })}
            >
              <option value="off">Off</option>
              <option value="flag_only">Flag only (never blocks a punch)</option>
            </select>
          </SettingsField>

          <SettingsField label="Geofence enforcement" help="Sites and their radius are managed in the Sites tab.">
            <select
              style={inp}
              value={cfg.geofence_mode}
              onChange={(e) => setCfg({ ...cfg, geofence_mode: e.target.value as WfmConfig["geofence_mode"] })}
            >
              <option value="flag">Flag only — punch succeeds, marked outside</option>
              <option value="block">Block — rejected if outside every site</option>
              <option value="off">Off — no site match attempted</option>
            </select>
          </SettingsField>

          <SettingsField
            label="Location required to punch"
            help={
              cfg.geofence_mode === "block"
                ? "Always on while geofence enforcement is set to Block — otherwise denying location would be a way around the geofence."
                : "Applies to check in and check out only. Breaks and overtime are never blocked, since those often happen indoors where no fix is available."
            }
          >
            <select
              style={inp}
              value={cfg.require_location || cfg.geofence_mode === "block" ? "yes" : "no"}
              disabled={cfg.geofence_mode === "block"}
              onChange={(e) => setCfg({ ...cfg, require_location: e.target.value === "yes" })}
            >
              <option value="no">No — a punch without location is still accepted</option>
              <option value="yes">Yes — check in / out is rejected without it</option>
            </select>
          </SettingsField>

          <SettingsField
            label="Selfie required to punch"
            help="A denied camera ends the punch; it is never recorded without the photo. Turning this off stops selfies being captured or stored at all."
          >
            <select
              style={inp}
              value={cfg.selfie_mode}
              onChange={(e) => setCfg({ ...cfg, selfie_mode: e.target.value as WfmConfig["selfie_mode"] })}
            >
              <option value="shift">Shift punches — check in / out, breaks, trips</option>
              <option value="all">Every punch — including overtime</option>
              <option value="off">Off — no selfie on any punch</option>
            </select>
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection id="wfm-weekoff" title="Weekly off days" summary={summaries.weekOff}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {WEEKDAYS.map((d, i) => {
            const active = cfg.week_off_days.includes(i);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleWeekOff(i)}
                aria-pressed={active}
                style={{
                  minWidth: 46, padding: "10px 0", fontSize: 12.5, fontWeight: 600,
                  borderRadius: 8, cursor: "pointer",
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
        <div style={help}>No lateness or absence is marked on these days, or on configured holidays.</div>
      </SettingsSection>

      <SettingsSection id="wfm-employment" title="Employment types" summary={summaries.employment}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cfg.employment_types.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                style={{ ...inp, width: 180, flex: "1 1 150px" }}
                value={t.label}
                placeholder="Label (e.g. Intern)"
                onChange={(e) => updateEmploymentType(i, { label: e.target.value })}
              />
              <input
                style={{ ...inp, width: 170, flex: "1 1 140px", fontFamily: "monospace", fontSize: 12 }}
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
                  cursor: cfg.employment_types.length <= 1 ? "not-allowed" : "pointer", padding: 8,
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
                padding: "9px 12px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                border: `1px dashed ${c.line}`, background: "transparent", color: c.muted,
              }}
            >+ Add employment type</button>
          </div>
          <div style={help}>
            The monthly Excel export gets one sheet per type, so adding a type here gives those
            people their own payroll section. The <strong>code</strong> is what gets stored on each
            employee — changing a code that is already in use leaves those employees classified
            under the old value, so edit the label instead once people are assigned.
          </div>
        </div>
      </SettingsSection>

      <SettingsSection id="wfm-punchtypes" title="Punch types" summary={summaries.punchTypes}>
        <div style={{ fontSize: 12, color: c.hint, marginBottom: 4 }}>
          Which options appear in the punch-type dropdown. Check in, check out and breaks are
          always available.
        </div>
        {PUNCH_TYPE_ITEMS.map(({ key, label, hint }) => (
          <SettingsRow key={key} label={label} help={hint}>
            <Toggle
              checked={cfg.punch_types[key]}
              onChange={(v) => setCfg({ ...cfg, punch_types: { ...cfg.punch_types, [key]: v } })}
            />
          </SettingsRow>
        ))}

        {cfg.punch_types.ot && (
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${c.line}`, maxWidth: 320 }}>
            <SettingsField
              label="Overtime rate per hour"
              help="Flat rate for the whole workspace. Approved overtime is paid on actual minutes worked — nothing is rounded up to a full hour. Leave at 0 to track overtime hours without costing them."
            >
              <input
                style={inp}
                type="number"
                min={0}
                step="0.01"
                value={cfg.ot_rate_per_hour}
                onChange={(e) => setCfg({ ...cfg, ot_rate_per_hour: Number(e.target.value) || 0 })}
              />
            </SettingsField>
          </div>
        )}
      </SettingsSection>

      <SettingsSection id="wfm-reminder" title="Punch-out reminder" summary={summaries.reminder}>
        <SettingsRow
          label="Remind employees to punch out"
          help="Sent to the employee's own phone, not to a supervisor. They must open My Workforce on their phone once and allow notifications."
          first
        >
          <Toggle
            checked={cfg.long_day_alert?.enabled === true}
            onChange={(v) =>
              setCfg({
                ...cfg,
                long_day_alert: { enabled: v, after_hours: cfg.long_day_alert?.after_hours ?? 9 },
              })
            }
          />
        </SettingsRow>

        {cfg.long_day_alert?.enabled && (
          <SettingsRow
            label="After this many hours worked"
            help="Worked time, net of breaks — the same figure the timesheet shows."
          >
            <input
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={cfg.long_day_alert?.after_hours ?? 9}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  long_day_alert: { enabled: true, after_hours: Number(e.target.value) || 9 },
                })
              }
              style={{ ...inp, width: 100 }}
            />
          </SettingsRow>
        )}
      </SettingsSection>

      {projectsOn && (
        <SettingsSection id="wfm-billing" title="Project billing" summary={summaries.billing}>
          <div style={{ fontSize: 12, color: c.hint, marginBottom: 10, lineHeight: 1.5 }}>
            What an hour on a project is charged, and what it costs you. The most specific rate wins:
            a rate set on the project itself, else the person&apos;s employment type, else the default here.
            Cost rates stay internal — they show margin on the preview and never print on an invoice.
          </div>
          <div className="set-grid">
            <SettingsField label="Default bill rate per hour" help="Charged when neither the project nor the employment type sets a rate. Leave at 0 until you are ready to bill.">
              <input style={inp} type="number" min={0} step="0.01" value={costing.default_bill_rate}
                onChange={(e) => setCosting({ default_bill_rate: Math.max(0, Number(e.target.value) || 0) })} />
            </SettingsField>
            <SettingsField label="Default cost rate per hour" help="What an hour costs the business, for margin. Internal only.">
              <input style={inp} type="number" min={0} step="0.01" value={costing.default_cost_rate}
                onChange={(e) => setCosting({ default_cost_rate: Math.max(0, Number(e.target.value) || 0) })} />
            </SettingsField>
            <SettingsField label="Invoice due after (days)" help="Sets the due date on a draft raised from project hours.">
              <input style={inp} type="number" min={0} max={365} value={costing.due_days}
                onChange={(e) => setCosting({ due_days: Math.min(365, Math.max(0, parseInt(e.target.value) || 0)) })} />
            </SettingsField>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: c.ink, marginBottom: 6 }}>By employment type</div>
            <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 8 }}>Blank = use the default above.</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", minWidth: 360 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", fontSize: 11, color: c.hint, fontWeight: 600, padding: "4px 8px 4px 0" }}>Type</th>
                    <th style={{ textAlign: "left", fontSize: 11, color: c.hint, fontWeight: 600, padding: "4px 8px" }}>Bill / hr</th>
                    <th style={{ textAlign: "left", fontSize: 11, color: c.hint, fontWeight: 600, padding: "4px 8px" }}>Cost / hr</th>
                  </tr>
                </thead>
                <tbody>
                  {cfg.employment_types.filter((t) => t.code).map((t) => {
                    const r = costing.rates_by_employment_type[t.code] ?? {};
                    return (
                      <tr key={t.code}>
                        <td style={{ fontSize: 12.5, color: c.ink, padding: "4px 8px 4px 0", whiteSpace: "nowrap" }}>{t.label || t.code}</td>
                        <td style={{ padding: "4px 8px" }}>
                          <input style={{ ...inp, width: 120 }} type="number" min={0} step="0.01" placeholder={String(costing.default_bill_rate || "")}
                            value={r.bill ?? ""} onChange={(e) => setTypeRate(t.code, "bill", e.target.value)} />
                        </td>
                        <td style={{ padding: "4px 8px" }}>
                          <input style={{ ...inp, width: 120 }} type="number" min={0} step="0.01" placeholder={String(costing.default_cost_rate || "")}
                            value={r.cost ?? ""} onChange={(e) => setTypeRate(t.code, "cost", e.target.value)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${c.line}` }}>
            <SettingsRow
              label="Draft invoices automatically at month end"
              help="On the 1st, every active project linked to an account gets a draft invoice for last month's hours, one line per sub-project. Drafts only — you still review and send each one. A period already invoiced is never billed twice."
              first
            >
              <Toggle checked={costing.auto_draft_monthly} onChange={(v) => setCosting({ auto_draft_monthly: v })} />
            </SettingsRow>
          </div>
        </SettingsSection>
      )}

      <SettingsSection id="wfm-notifications" title="Email notifications" summary={summaries.notifications}>
        <div style={{ fontSize: 12, color: c.hint, marginBottom: 4 }}>
          Requires email sending to be configured for this workspace — see Settings → General.
        </div>
        {NOTIFICATION_ITEMS.map(({ key, label, hint }) => (
          <SettingsRow key={key} label={label} help={hint}>
            <Toggle
              checked={cfg.notifications[key]}
              onChange={(v) => setCfg({ ...cfg, notifications: { ...cfg.notifications, [key]: v } })}
            />
          </SettingsRow>
        ))}
      </SettingsSection>

      {/* Follows the page: with sections collapsed, the control someone just
          changed can be anywhere, and Save must not be a scroll away from it. */}
      <div
        className="set-savebar"
        style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          padding: "12px 14px", marginTop: 2,
          background: "var(--card-bg)", border: "1px solid var(--line)",
          borderRadius: "var(--card-radius)", boxShadow: "var(--card-shadow)",
        }}
      >
        <button
          style={{ ...btnPrimary, opacity: saving || !dirty ? 0.55 : 1, cursor: saving || !dirty ? "default" : "pointer" }}
          disabled={saving || !dirty}
          onClick={save}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span style={{ fontSize: 12.5, color: "#10b981", fontWeight: 500 }}>Saved</span>}
        {!saved && (
          <span style={{ fontSize: 12, color: c.hint }}>
            {dirty ? "Unsaved changes" : "Everything here is saved"}
          </span>
        )}
      </div>
    </div>
  );
}
