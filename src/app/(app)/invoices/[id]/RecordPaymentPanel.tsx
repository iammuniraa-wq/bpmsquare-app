"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import type { InvoicePayment, InvoiceStatus } from "@/lib/types";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function RecordPaymentPanel({
  invoiceId, status, balanceDue, payments,
}: {
  invoiceId: string;
  status: InvoiceStatus;
  balanceDue: number;
  payments: InvoicePayment[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const canRecord = !["draft", "cancelled"].includes(status);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { setError("Enter a positive amount"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/invoices/${invoiceId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amt, method: method || null, reference: reference || null, note: note || null }),
      });
      if (res.ok) { setAmount(""); setMethod(""); setReference(""); setNote(""); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to record payment"); }
    });
  }

  return (
    <section style={cardStyle}>
      <div style={{ fontSize: 11, fontWeight: 700, color: c.accent, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>
        Payment history
      </div>

      {payments.length === 0 ? (
        <div style={{ fontSize: 12.5, color: c.hint, marginBottom: canRecord ? 14 : 0 }}>No payments recorded yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: canRecord ? 14 : 0 }}>
          {payments.map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${c.line}`, fontSize: 12.5 }}>
              <div>
                <span style={{ fontWeight: 600, color: "#1d9e75" }}>{inr(p.amount)}</span>
                <span style={{ color: c.hint, marginLeft: 8 }}>{p.method ?? "—"}{p.reference ? ` · ${p.reference}` : ""}</span>
                {p.note && <span style={{ color: c.hint }}> — {p.note}</span>}
              </div>
              <div style={{ color: c.hint, fontSize: 11, whiteSpace: "nowrap" }}>{fmtDate(p.paid_on)}</div>
            </div>
          ))}
        </div>
      )}

      {canRecord && balanceDue > 0 && (
        <form onSubmit={submit}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "0 0 120px" }}>
              <label style={{ display: "block", fontSize: 11, color: c.hint, marginBottom: 4 }}>Amount (₹)</label>
              <input type="number" min="0" max={balanceDue} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder={String(balanceDue)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${c.line}`, fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: "0 0 140px" }}>
              <label style={{ display: "block", fontSize: 11, color: c.hint, marginBottom: 4 }}>Method</label>
              <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Bank transfer"
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${c.line}`, fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: "0 0 140px" }}>
              <label style={{ display: "block", fontSize: 11, color: c.hint, marginBottom: 4 }}>Reference</label>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no."
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${c.line}`, fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={{ display: "block", fontSize: 11, color: c.hint, marginBottom: 4 }}>Note (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${c.line}`, fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <button type="submit" disabled={pending}
              style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: pending ? "wait" : "pointer" }}>
              {pending ? "…" : "Record payment"}
            </button>
          </div>
          {error && <div style={{ marginTop: 8, fontSize: 12, color: "#dc2626" }}>{error}</div>}
        </form>
      )}
      {!canRecord && (
        <div style={{ fontSize: 11.5, color: c.hint }}>Mark the invoice as sent before recording a payment.</div>
      )}
    </section>
  );
}
