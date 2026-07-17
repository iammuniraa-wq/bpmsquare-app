"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { Asset } from "@/lib/types";
import { Pencil, CheckIcon } from "@/components/Icons";

const KINDS: { value: Asset["kind"]; label: string }[] = [
  { value: "motor",       label: "Motor" },
  { value: "transformer", label: "Transformer" },
  { value: "pump",        label: "Pump" },
  { value: "generator",   label: "Generator" },
  { value: "panel",       label: "Panel / Switchgear" },
];

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
const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 };

type Props = {
  asset: Asset;
  /** Controlled mode: render just the form, no internal trigger button (e.g. when a
   *  parent renders its own "Edit asset" toggle elsewhere, such as the page header). */
  forceOpen?: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
};

export default function AssetEditPanel({ asset, forceOpen, onSaved, onCancel }: Props) {
  const router = useRouter();
  const [openState, setOpen] = useState(false);
  const open = forceOpen ?? openState;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    name:  asset.name,
    kind:  asset.kind,
    make:  asset.make  ?? "",
    model: asset.model ?? "",
    serial: (asset as Record<string, unknown>).serial as string ?? "",
    rating: asset.rating ?? "",
    notes:  (asset as Record<string, unknown>).notes as string ?? "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setSaved(true);
        setOpen(false);
        router.refresh();
        onSaved?.();
      } else {
        const j = await res.json();
        setError(j.error ?? "Failed to save");
      }
    });
  }

  if (!open) {
    if (forceOpen === false) return null; // parent owns the trigger button entirely
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setSaved(false); }}
        style={{
          fontSize: 12, fontWeight: 600, color: c.muted,
          background: "none", border: `1px solid ${c.line}`,
          borderRadius: 6, padding: "5px 12px", cursor: "pointer",
        }}
      >
        {saved ? <><CheckIcon size={12} /> Saved</> : <><Pencil size={12} /> Edit asset</>}
      </button>
    );
  }

  return (
    <form onSubmit={handleSave} style={{
      marginTop: 16, paddingTop: 14, borderTop: `1px solid ${c.line}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12 }}>
        Edit asset
      </div>

      <div style={fw}>
        <label style={lbl}>Name *</label>
        <input style={inp} value={form.name} onChange={set("name")} required />
      </div>

      <div style={grid2}>
        <div>
          <label style={lbl}>Kind</label>
          <select style={{ ...inp, cursor: "pointer" }} value={form.kind} onChange={set("kind")}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Make / Brand</label>
          <input style={inp} value={form.make} onChange={set("make")} placeholder="e.g. Crompton" />
        </div>
      </div>

      <div style={grid2}>
        <div>
          <label style={lbl}>Model</label>
          <input style={inp} value={form.model} onChange={set("model")} placeholder="e.g. NGEF-75" />
        </div>
        <div>
          <label style={lbl}>Serial no.</label>
          <input style={inp} value={form.serial} onChange={set("serial")} placeholder="e.g. CG-75-2291" />
        </div>
      </div>

      <div style={fw}>
        <label style={lbl}>Rating / specs</label>
        <input style={inp} value={form.rating} onChange={set("rating")} placeholder="e.g. 75 kW · 415V · 3-Ph · 1480 rpm" />
      </div>

      <div style={fw}>
        <label style={lbl}>Notes</label>
        <textarea style={{ ...inp, minHeight: 64, resize: "vertical" }} value={form.notes} onChange={set("notes")} placeholder="Any additional notes…" />
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
        <button type="button" onClick={() => { setOpen(false); onCancel?.(); }} style={{
          padding: "7px 12px", borderRadius: 7, border: `1px solid ${c.line}`,
          background: "none", color: c.muted, fontWeight: 500, fontSize: 13, cursor: "pointer",
        }}>
          Cancel
        </button>
      </div>
    </form>
  );
}
