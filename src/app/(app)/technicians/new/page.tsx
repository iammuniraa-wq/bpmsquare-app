"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES } from "@/lib/constants";

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const fw: React.CSSProperties = { marginBottom: 16 };

export default function NewTechnicianPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "", phone: "", email: "",
    skills: "", base_location: "", max_visits_per_day: "3",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/technicians", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (res.ok) {
        router.push(ROUTES.technician(json.id));
      } else {
        setError(json.error ?? "Failed to create technician");
      }
    });
  }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <Link href={ROUTES.technicians} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← All technicians
        </Link>
      </div>

      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>New Technician</h1>
        <p style={{ fontSize: 13, color: c.muted, marginTop: 4 }}>Add a field technician to your team</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, alignItems: "start" }}>

          <div style={cardStyle}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 16px" }}>Personal details</h3>

            <div style={fw}>
              <label style={lbl}>Full name *</label>
              <input style={inp} value={form.name} onChange={set("name")} required placeholder="e.g. Ramesh Kumar" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={fw}>
                <label style={lbl}>Phone</label>
                <input style={inp} value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
              </div>
              <div style={fw}>
                <label style={lbl}>Email</label>
                <input style={inp} type="email" value={form.email} onChange={set("email")} placeholder="tech@company.com" />
              </div>
            </div>

            <div style={fw}>
              <label style={lbl}>Skills / specialisations</label>
              <textarea
                style={{ ...inp, minHeight: 72, resize: "vertical" }}
                value={form.skills} onChange={set("skills")}
                placeholder="e.g. HT motor rewinds, VFD drives, transformer servicing…"
              />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            <div style={cardStyle}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 14px" }}>Field settings</h3>

              <div style={fw}>
                <label style={lbl}>Base location</label>
                <input style={inp} value={form.base_location} onChange={set("base_location")} placeholder="e.g. Hosapete workshop" />
              </div>

              <div style={fw}>
                <label style={lbl}>Max visits / day</label>
                <input
                  style={inp} type="number" min={1} max={10}
                  value={form.max_visits_per_day} onChange={set("max_visits_per_day")}
                />
              </div>
            </div>

            {error && (
              <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--err-ink)" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="submit" disabled={pending}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 8, border: "none",
                  background: c.accent, color: "#fff", fontWeight: 700, fontSize: 13,
                  cursor: pending ? "wait" : "pointer",
                }}
              >
                {pending ? "Creating…" : "Add Technician"}
              </button>
              <Link
                href={ROUTES.technicians}
                style={{
                  padding: "10px 18px", borderRadius: 8, border: `1px solid ${c.line}`,
                  color: c.muted, fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center",
                }}
              >
                Cancel
              </Link>
            </div>
          </div>

        </div>
      </form>
    </>
  );
}
