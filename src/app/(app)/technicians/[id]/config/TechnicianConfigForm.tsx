"use client";

import { useState, useId } from "react";
import { useRouter } from "next/navigation";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import type { Technician, TechnicianLeave, LeaveReason } from "@/lib/types";

// ── types ─────────────────────────────────────────────────────────────────────

type CertRow = { id: string; name: string; expiry: string };
type LeaveRow = { id: string; from_date: string; to_date: string; reason: LeaveReason; notes: string };

// ── constants ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: Array<{ value: Technician["status"]; label: string; tone: PillarKey }> = [
  { value: "active",   label: "Active",   tone: "green" },
  { value: "on_leave", label: "On leave", tone: "amber" },
  { value: "inactive", label: "Inactive", tone: "red"   },
];

const LEAVE_REASON_OPTIONS: Array<{ value: LeaveReason; label: string }> = [
  { value: "vacation", label: "Vacation"   },
  { value: "sick",     label: "Sick leave" },
  { value: "training", label: "Training"   },
  { value: "other",    label: "Other"      },
];

// ── style primitives ──────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  border: `1px solid ${c.line}`, borderRadius: 8,
  padding: "8px 12px", fontSize: 13.5, color: c.ink,
  background: c.panel, fontFamily: "inherit", outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 12, fontWeight: 600,
  color: c.muted, marginBottom: 5, textTransform: "uppercase", letterSpacing: ".04em",
};

function Field({
  label, children, hint,
}: {
  label: string; children: React.ReactNode; hint?: string;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11, color: c.hint, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: c.muted,
      textTransform: "uppercase", letterSpacing: ".06em",
      paddingBottom: 10, marginBottom: 14,
      borderBottom: `1px solid ${c.line}`,
    }}>
      {children}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function TechnicianConfigForm({
  technician: initial,
  leaves: initialLeaves,
}: {
  technician: Technician;
  leaves: TechnicianLeave[];
}) {
  const router = useRouter();
  const uid    = useId();

  // ── Personal info ──────────────────────────────────────────────────────────
  const [name,         setName        ] = useState(initial.name);
  const [phone,        setPhone       ] = useState(initial.phone ?? "");
  const [email,        setEmail       ] = useState(initial.email ?? "");
  const [baseLocation, setBaseLocation] = useState(initial.base_location ?? "");
  const [status,       setStatus      ] = useState<Technician["status"]>(initial.status);
  const [maxVisits,    setMaxVisits   ] = useState(initial.max_visits_per_day);

  // ── Skills ─────────────────────────────────────────────────────────────────
  // Stored as comma-separated string; parsed into chips for display
  const [skillsRaw, setSkillsRaw] = useState(initial.skills ?? "");
  const skillChips = skillsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // ── Certifications ─────────────────────────────────────────────────────────
  const [certs, setCerts] = useState<CertRow[]>(() =>
    initial.certifications.map((name, i) => ({
      id:     `cert-${i}`,
      name,
      expiry: initial.cert_expiry[name] ?? "",
    }))
  );

  const addCert = () =>
    setCerts((prev) => [...prev, { id: `cert-new-${Date.now()}`, name: "", expiry: "" }]);

  const removeCert = (id: string) =>
    setCerts((prev) => prev.filter((c) => c.id !== id));

  const updateCert = (id: string, field: "name" | "expiry", val: string) =>
    setCerts((prev) => prev.map((c) => c.id === id ? { ...c, [field]: val } : c));

  // ── Leave schedule ─────────────────────────────────────────────────────────
  const [leaves, setLeaves] = useState<LeaveRow[]>(() =>
    initialLeaves.map((l) => ({
      id:        l.id,
      from_date: l.from_date,
      to_date:   l.to_date,
      reason:    l.reason,
      notes:     l.notes ?? "",
    }))
  );

  const addLeave = () =>
    setLeaves((prev) => [...prev, {
      id: `leave-new-${Date.now()}`,
      from_date: "", to_date: "",
      reason: "vacation", notes: "",
    }]);

  const removeLeave = (id: string) =>
    setLeaves((prev) => prev.filter((l) => l.id !== id));

  const updateLeave = (id: string, field: keyof LeaveRow, val: string) =>
    setLeaves((prev) => prev.map((l) => l.id === id ? { ...l, [field]: val } : l));

  // ── Save ───────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = () => {
    if (!name.trim()) { showToast("Name is required"); return; }
    setSaving(true);
    // When Supabase is wired, call the update API here.
    setTimeout(() => {
      setSaving(false);
      showToast("Profile saved ✓");
    }, 600);
  };

  // ── Cert expiry warning colours ────────────────────────────────────────────
  const certWarning = (expiry: string): PillarKey | null => {
    if (!expiry) return null;
    const d = new Date(expiry);
    if (d < new Date()) return "red";
    if (d < new Date(Date.now() + 90 * 86400000)) return "amber";
    return "green";
  };

  return (
    <>
      <div className="hub-grid" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 14, alignItems: "start" }}>

        {/* ── LEFT — Personal + Skills + Certs ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Personal info */}
          <div style={{ ...cardStyle }}>
            <SectionTitle>Personal information</SectionTitle>

            <Field label="Full name">
              <input
                value={name} onChange={(e) => setName(e.target.value)}
                style={inputStyle} placeholder="e.g. Ramesh Kumar"
              />
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Phone">
                <input
                  value={phone} onChange={(e) => setPhone(e.target.value)}
                  style={inputStyle} placeholder="+91 94482 11223"
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle} placeholder="name@company.com"
                />
              </Field>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Base location">
                <input
                  value={baseLocation} onChange={(e) => setBaseLocation(e.target.value)}
                  style={inputStyle} placeholder="e.g. Hosapete"
                />
              </Field>
              <Field label="Max visits / day" hint="Capacity used for scheduling and dispatch">
                <input
                  type="number" min={1} max={10}
                  value={maxVisits}
                  onChange={(e) => setMaxVisits(Math.max(1, Number(e.target.value)))}
                  style={{ ...inputStyle, width: "80px" }}
                />
              </Field>
            </div>
          </div>

          {/* Status */}
          <div style={{ ...cardStyle }}>
            <SectionTitle>Status</SectionTitle>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {STATUS_OPTIONS.map((opt) => {
                const selected = status === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setStatus(opt.value)}
                    style={{
                      padding: "8px 20px", borderRadius: 8, border: "none",
                      cursor: "pointer", fontWeight: 600, fontSize: 13,
                      background: selected ? pillar[opt.tone].base : c.panel2,
                      color:      selected ? "#fff" : c.muted,
                      outline: selected ? `2px solid ${pillar[opt.tone].base}` : "none",
                      outlineOffset: 2,
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {status === "inactive" && (
              <div style={{
                marginTop: 12, fontSize: 12, color: pillar.red.fg,
                background: pillar.red.bg, borderRadius: 6, padding: "8px 12px",
              }}>
                Inactive technicians are hidden from dispatch and scheduling.
              </div>
            )}
          </div>

          {/* Skills */}
          <div style={{ ...cardStyle }}>
            <SectionTitle>Skills</SectionTitle>
            <Field
              label="Skills (comma-separated)"
              hint="Each item becomes a skill chip — e.g. HT motor rewinding, stator repair, varnish treatment"
            >
              <textarea
                value={skillsRaw}
                onChange={(e) => setSkillsRaw(e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }}
                placeholder="HT motor rewinding, stator repair, varnish treatment, test bed operation"
              />
            </Field>

            {skillChips.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: c.hint, marginBottom: 8 }}>Preview</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {skillChips.map((sk, i) => (
                    <div key={i} style={{
                      fontSize: 12.5, padding: "4px 10px", borderRadius: 6,
                      background: c.panel2, color: c.ink, border: `1px solid ${c.line}`,
                    }}>
                      ◈ {sk}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Certifications */}
          <div style={{ ...cardStyle }}>
            <SectionTitle>Certifications</SectionTitle>

            {certs.length === 0 && (
              <div style={{ fontSize: 13, color: c.hint, marginBottom: 12 }}>No certifications recorded.</div>
            )}

            {certs.map((cert) => {
              const tone = certWarning(cert.expiry);
              return (
                <div key={cert.id} style={{
                  display: "grid", gridTemplateColumns: "1fr 160px auto",
                  gap: 10, alignItems: "center",
                  paddingBottom: 10, marginBottom: 10,
                  borderBottom: `1px solid ${c.line}`,
                }}>
                  <div>
                    <div style={{ fontSize: 11, color: c.hint, marginBottom: 4 }}>Certification name</div>
                    <input
                      value={cert.name}
                      onChange={(e) => updateCert(cert.id, "name", e.target.value)}
                      style={inputStyle}
                      placeholder="e.g. HV License (IS 5571)"
                    />
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: c.hint }}>Expiry date</span>
                      {tone && cert.expiry && (
                        <span style={{ fontSize: 10, fontWeight: 600,
                          color: pillar[tone].fg, background: pillar[tone].bg,
                          padding: "1px 6px", borderRadius: 4 }}>
                          {tone === "red" ? "Expired" : tone === "amber" ? "Soon" : "Valid"}
                        </span>
                      )}
                    </div>
                    <input
                      type="date"
                      value={cert.expiry}
                      onChange={(e) => updateCert(cert.id, "expiry", e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <button
                    onClick={() => removeCert(cert.id)}
                    style={{
                      marginTop: 20,
                      padding: "7px 10px", borderRadius: 7, border: "none",
                      cursor: "pointer", background: pillar.red.bg, color: pillar.red.fg,
                      fontSize: 14, fontWeight: 700,
                    }}
                    title="Remove certification"
                  >✕</button>
                </div>
              );
            })}

            <button
              onClick={addCert}
              style={{
                padding: "7px 14px", borderRadius: 8, border: `1px dashed ${c.line}`,
                cursor: "pointer", background: c.panel2, color: c.muted,
                fontSize: 12.5, fontWeight: 600, width: "100%",
              }}
            >
              + Add certification
            </button>
          </div>
        </div>

        {/* ── RIGHT — Leave schedule + summary ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Summary card */}
          <div style={{ ...cardStyle, background: "#0e1a28", border: "none" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#8fa8c0", letterSpacing: ".04em", textTransform: "uppercase", marginBottom: 12 }}>
              Profile summary
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{name || "—"}</div>
            <div style={{ fontSize: 12, color: "#8fa8c0", marginBottom: 8 }}>{baseLocation || "Location not set"}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {status === "active"   && <span style={{ fontSize: 11, background: pillar.green.bg, color: pillar.green.fg, padding: "3px 8px", borderRadius: 5, fontWeight: 600 }}>Active</span>}
              {status === "on_leave" && <span style={{ fontSize: 11, background: pillar.amber.bg, color: pillar.amber.fg, padding: "3px 8px", borderRadius: 5, fontWeight: 600 }}>On leave</span>}
              {status === "inactive" && <span style={{ fontSize: 11, background: pillar.red.bg,   color: pillar.red.fg,   padding: "3px 8px", borderRadius: 5, fontWeight: 600 }}>Inactive</span>}
              <span style={{ fontSize: 11, color: "#8fa8c0" }}>Max {maxVisits} visits/day</span>
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #1e3048", fontSize: 11, color: "#8fa8c0" }}>
              <div>{certs.filter((c) => c.name).length} certifications</div>
              <div>{skillChips.length} skills</div>
              <div>{leaves.length} leave entries</div>
            </div>
          </div>

          {/* Leave schedule */}
          <div style={{ ...cardStyle }}>
            <SectionTitle>Leave schedule</SectionTitle>

            {leaves.length === 0 && (
              <div style={{ fontSize: 13, color: c.hint, marginBottom: 12 }}>No leave entries.</div>
            )}

            {leaves.map((lv, idx) => (
              <div key={lv.id} style={{
                paddingBottom: 14, marginBottom: 14,
                borderBottom: idx < leaves.length - 1 ? `1px solid ${c.line}` : "none",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>
                    Leave #{idx + 1}
                  </div>
                  <button
                    onClick={() => removeLeave(lv.id)}
                    style={{
                      padding: "3px 8px", borderRadius: 5, border: "none",
                      cursor: "pointer", background: pillar.red.bg, color: pillar.red.fg,
                      fontSize: 12, fontWeight: 600,
                    }}
                  >✕</button>
                </div>

                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: c.hint, marginBottom: 4 }}>Reason</div>
                  <select
                    value={lv.reason}
                    onChange={(e) => updateLeave(lv.id, "reason", e.target.value)}
                    style={{ ...inputStyle }}
                  >
                    {LEAVE_REASON_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: c.hint, marginBottom: 4 }}>From</div>
                    <input type="date" value={lv.from_date}
                      onChange={(e) => updateLeave(lv.id, "from_date", e.target.value)}
                      style={inputStyle} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: c.hint, marginBottom: 4 }}>To</div>
                    <input type="date" value={lv.to_date}
                      onChange={(e) => updateLeave(lv.id, "to_date", e.target.value)}
                      style={inputStyle} />
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: c.hint, marginBottom: 4 }}>Notes</div>
                  <textarea
                    value={lv.notes}
                    onChange={(e) => updateLeave(lv.id, "notes", e.target.value)}
                    rows={2}
                    style={{ ...inputStyle, resize: "vertical" }}
                    placeholder="Optional notes…"
                  />
                </div>
              </div>
            ))}

            <button
              onClick={addLeave}
              style={{
                padding: "7px 14px", borderRadius: 8, border: `1px dashed ${c.line}`,
                cursor: "pointer", background: c.panel2, color: c.muted,
                fontSize: 12.5, fontWeight: 600, width: "100%",
              }}
            >
              + Add leave entry
            </button>
          </div>

          {/* Save / cancel */}
          <div style={{ ...cardStyle, display: "flex", gap: 10 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                flex: 1, padding: "10px 0", borderRadius: 9, border: "none",
                cursor: saving ? "wait" : "pointer", fontWeight: 700, fontSize: 14,
                background: c.accent, color: "#fff", opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              onClick={() => router.back()}
              style={{
                padding: "10px 16px", borderRadius: 9, border: `1px solid ${c.line}`,
                cursor: "pointer", fontWeight: 600, fontSize: 13,
                background: c.panel2, color: c.muted,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
          background: "#1c2733", color: "#fff", fontSize: 13, fontWeight: 500,
          padding: "10px 20px", borderRadius: 9, zIndex: 600,
          boxShadow: "0 4px 16px rgba(0,0,0,.25)", whiteSpace: "nowrap",
        }}>
          {toast}
        </div>
      )}
    </>
  );
}
