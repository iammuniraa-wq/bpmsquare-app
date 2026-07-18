"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { Invoice } from "@/lib/types";
import { Pencil } from "@/components/Icons";
import { ROUTES } from "@/lib/constants";

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

export default function InvoiceEditPanel({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    due_date: invoice.due_date ?? "",
    notes: invoice.notes ?? "",
    terms: invoice.terms ?? "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) { setOpen(false); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save"); }
    });
  }

  function setStatus(status: "sent" | "cancelled") {
    if (status === "cancelled" && !confirm("Cancel this invoice?")) return;
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) router.refresh();
      else { const j = await res.json(); setError(j.error ?? "Failed to update status"); }
    });
  }

  async function handleDelete() {
    if (!confirm(`Delete draft "${invoice.ref}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/invoices/${invoice.id}`, { method: "DELETE" });
      if (res.ok) router.push(ROUTES.invoices);
      else { const j = await res.json(); setError(j.error ?? "Failed to delete"); }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "#dc2626" }}>
          {error}
        </div>
      )}

      {invoice.status === "draft" && (
        <button type="button" disabled={pending} onClick={() => setStatus("sent")} style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          background: c.accent, color: "#fff", borderRadius: 7,
          padding: "8px 14px", fontSize: 12.5, fontWeight: 600,
          border: "none", cursor: pending ? "wait" : "pointer", width: "100%",
        }}>
          Mark as sent
        </button>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            background: c.accentbg, color: c.accent, borderRadius: 7,
            padding: "8px 14px", fontSize: 12.5, fontWeight: 600,
            border: `1px solid ${c.accent}40`, cursor: "pointer", width: "100%",
          }}
        >
          <Pencil size={13} color={c.accent} /> Edit details
        </button>
      ) : (
        <form onSubmit={handleSave} style={{ background: c.panel, border: `1px solid ${c.line}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 14 }}>
            Edit details
          </div>
          <div style={fw}>
            <label style={lbl}>Due date</label>
            <input style={inp} type="date" value={form.due_date} onChange={set("due_date")} />
          </div>
          <div style={fw}>
            <label style={lbl}>Notes</label>
            <textarea style={{ ...inp, minHeight: 50, resize: "vertical" }} value={form.notes} onChange={set("notes")} />
          </div>
          <div style={fw}>
            <label style={lbl}>Terms</label>
            <textarea style={{ ...inp, minHeight: 50, resize: "vertical" }} value={form.terms} onChange={set("terms")} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={pending} style={{
              flex: 1, padding: "8px 0", borderRadius: 7, border: "none",
              background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
            }}>
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setOpen(false)} style={{
              padding: "8px 12px", borderRadius: 7, border: `1px solid ${c.line}`,
              background: "none", color: c.muted, fontWeight: 500, fontSize: 13, cursor: "pointer",
            }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {invoice.status === "draft" && (
        <button type="button" disabled={pending} onClick={handleDelete} style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "none", color: "#a32d2d", borderRadius: 7,
          padding: "7px 14px", fontSize: 12, fontWeight: 500,
          border: "1px solid #f5c0c0", cursor: pending ? "wait" : "pointer", width: "100%",
        }}>
          Delete draft
        </button>
      )}
      {!["draft", "cancelled", "paid"].includes(invoice.status) && (
        <button type="button" disabled={pending} onClick={() => setStatus("cancelled")} style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "none", color: "#a32d2d", borderRadius: 7,
          padding: "7px 14px", fontSize: 12, fontWeight: 500,
          border: "1px solid #f5c0c0", cursor: pending ? "wait" : "pointer", width: "100%",
        }}>
          Cancel invoice
        </button>
      )}
    </div>
  );
}
