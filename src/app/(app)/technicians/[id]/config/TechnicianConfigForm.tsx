"use client";

import { useState } from "react";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import type { Technician, TechnicianLeave, LeaveReason } from "@/lib/types";
import { useFeel } from "@/components/FeelProvider";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";

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

// ── main component ────────────────────────────────────────────────────────────

export default function TechnicianConfigForm({
  technician: initial,
  leaves: initialLeaves,
}: {
  technician: Technician;
  leaves: TechnicianLeave[];
}) {
  const { toast } = useFeel();

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
  const [saving, setSaving] = useState(false);

  const handleSave = () => {
    if (!name.trim()) { toast({ text: "Name is required", tone: "error" }); return; }
    setSaving(true);
    // When Supabase is wired, call the update API here.
    setTimeout(() => {
      setSaving(false);
      toast({ text: "Profile saved ✓", tone: "success" });
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
    <ObjectFormPage
      backHref={ROUTES.technician(initial.id)}
      backLabel={initial.name}
      title="Edit profile"
      subtitle={`Technician · ${initial.name}`}
      onSubmit={(e) => { e.preventDefault(); handleSave(); }}
      saving={saving}
      saveLabel="Save changes"
    >
      <Card title="Personal information" padding={18}>
        <Field label="Full name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ramesh Kumar" />
        </Field>
        <div className="fg2">
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 94482 11223" />
          </Field>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </Field>
          <Field label="Base location">
            <Input value={baseLocation} onChange={(e) => setBaseLocation(e.target.value)} placeholder="e.g. Hosapete" />
          </Field>
          <Field label="Max visits / day" hint="Capacity used for scheduling and dispatch">
            <Input
              type="number" min={1} max={10}
              value={maxVisits}
              onChange={(e) => setMaxVisits(Math.max(1, Number(e.target.value)))}
              style={{ width: 90 }}
            />
          </Field>
        </div>
      </Card>

      <Card title="Status" padding={18}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {STATUS_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={status === opt.value ? "primary" : "secondary"}
              onClick={() => setStatus(opt.value)}
              aria-pressed={status === opt.value}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        {status === "inactive" && (
          <div style={{
            marginTop: 12, fontSize: 12, color: pillar.red.fg,
            background: pillar.red.bg, borderRadius: 6, padding: "8px 12px",
          }}>
            Inactive technicians are hidden from dispatch and scheduling.
          </div>
        )}
      </Card>

      <Card title="Skills" padding={18}>
        <Field
          label="Skills (comma-separated)"
          hint="Each item becomes a skill chip — e.g. HT motor rewinding, stator repair, varnish treatment"
        >
          <Textarea
            value={skillsRaw}
            onChange={(e) => setSkillsRaw(e.target.value)}
            rows={3}
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
      </Card>

      <Card title="Certifications" padding={18}>
        {certs.length === 0 && (
          <div style={{ fontSize: 13, color: c.hint, marginBottom: 12 }}>No certifications recorded.</div>
        )}

        {certs.map((cert) => {
          const tone = certWarning(cert.expiry);
          return (
            <div key={cert.id} style={{
              display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap",
              paddingBottom: 10, marginBottom: 10,
              borderBottom: `1px solid ${c.line}`,
            }}>
              <Field label="Certification name" style={{ flex: "2 1 220px", marginBottom: 0 }}>
                <Input
                  value={cert.name}
                  onChange={(e) => updateCert(cert.id, "name", e.target.value)}
                  placeholder="e.g. HV License (IS 5571)"
                />
              </Field>
              <Field label="Expiry date" style={{ flex: "1 1 160px", marginBottom: 0 }}>
                <Input
                  type="date"
                  value={cert.expiry}
                  onChange={(e) => updateCert(cert.id, "expiry", e.target.value)}
                />
              </Field>
              {tone && cert.expiry && (
                <span style={{ fontSize: 10.5, fontWeight: 600, color: pillar[tone].fg, background: pillar[tone].bg, padding: "2px 7px", borderRadius: 4, marginBottom: 8 }}>
                  {tone === "red" ? "Expired" : tone === "amber" ? "Soon" : "Valid"}
                </span>
              )}
              <Button variant="quiet" iconOnly aria-label="Remove certification" onClick={() => removeCert(cert.id)}>✕</Button>
            </div>
          );
        })}

        <Button variant="secondary" size="sm" onClick={addCert}>+ Add certification</Button>
      </Card>

      <Card title="Leave schedule" padding={18}>
        {leaves.length === 0 && (
          <div style={{ fontSize: 13, color: c.hint, marginBottom: 12 }}>No leave entries.</div>
        )}

        {leaves.map((lv, idx) => (
          <div key={lv.id} style={{
            paddingBottom: 14, marginBottom: 14,
            borderBottom: `1px solid ${c.line}`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: c.ink }}>
                Leave #{idx + 1}
              </div>
              <Button variant="quiet" size="sm" iconOnly aria-label={`Remove leave ${idx + 1}`} onClick={() => removeLeave(lv.id)}>✕</Button>
            </div>

            <div className="fg3">
              <Field label="Reason" style={{ marginBottom: 0 }}>
                <Select value={lv.reason} onChange={(e) => updateLeave(lv.id, "reason", e.target.value)}>
                  {LEAVE_REASON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="From" style={{ marginBottom: 0 }}>
                <Input type="date" value={lv.from_date} onChange={(e) => updateLeave(lv.id, "from_date", e.target.value)} />
              </Field>
              <Field label="To" style={{ marginBottom: 0 }}>
                <Input type="date" value={lv.to_date} onChange={(e) => updateLeave(lv.id, "to_date", e.target.value)} />
              </Field>
            </div>

            <Field label="Notes" style={{ marginTop: 10, marginBottom: 0 }}>
              <Textarea
                value={lv.notes}
                onChange={(e) => updateLeave(lv.id, "notes", e.target.value)}
                rows={2}
                placeholder="Optional notes…"
              />
            </Field>
          </div>
        ))}

        <Button variant="secondary" size="sm" onClick={addLeave}>+ Add leave entry</Button>
      </Card>
    </ObjectFormPage>
  );
}
