"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { Pencil, CheckIcon } from "@/components/Icons";

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 7,
  background: c.panel, color: c.ink, outline: "none", fontFamily: "inherit",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
};
const fw: React.CSSProperties = { marginBottom: 12 };

type Props = {
  caseId: string;
  equipmentLabel: string;
  complaint: string;
  notes: string | null;
};

export default function CaseCoreEditPanel({ caseId, equipmentLabel, complaint, notes }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    equipment_label: equipmentLabel,
    complaint,
    notes: notes ?? "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.equipment_label.trim() || !form.complaint.trim()) {
      setError("Equipment and complaint are required"); return;
    }
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) { setSaved(true); setOpen(false); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save"); }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setSaved(false); }}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          background: c.panel2, color: c.muted, borderRadius: 7,
          padding: "6px 12px", fontSize: 12.5, fontWeight: 500,
          border: `1px solid ${c.line}`, cursor: "pointer",
        }}
      >
        {saved ? <><CheckIcon size={13} color={c.muted} /> Saved</> : <><Pencil size={13} color={c.muted} /> Edit case details</>}
      </button>
    );
  }

  return (
    <form onSubmit={handleSave} style={{
      background: c.panel, border: `1px solid ${c.line}`, borderRadius: 12, padding: 16, marginBottom: 12,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
        Edit case details
      </div>
      <div style={fw}>
        <label style={lbl}>Equipment *</label>
        <input style={inp} value={form.equipment_label} onChange={set("equipment_label")} placeholder="e.g. Crompton 75 kW 3-Ph IM · CG-75-2291" />
      </div>
      <div style={fw}>
        <label style={lbl}>Complaint *</label>
        <textarea style={{ ...inp, minHeight: 72, resize: "vertical" }} value={form.complaint} onChange={set("complaint")} placeholder="Customer-reported symptom…" />
      </div>
      <div style={fw}>
        <label style={lbl}>Internal notes</label>
        <textarea style={{ ...inp, minHeight: 64, resize: "vertical" }} value={form.notes} onChange={set("notes")} placeholder="Condition on arrival, accessories received…" />
      </div>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "#dc2626", marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={pending} style={{
          padding: "7px 16px", borderRadius: 7, border: "none",
          background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
        }}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={{
          padding: "7px 12px", borderRadius: 7, border: `1px solid ${c.line}`,
          background: "none", color: c.muted, fontWeight: 500, fontSize: 13, cursor: "pointer",
        }}>
          Cancel
        </button>
      </div>
    </form>
  );
}
