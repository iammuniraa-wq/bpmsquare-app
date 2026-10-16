"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { InvoicePayment, InvoiceStatus } from "@/lib/types";
import { useCurrency } from "@/lib/tenant-context";
import { moneyFormatter, moneyLabel } from "@/lib/currency";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

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
  const cur = useCurrency();
  const inr = moneyFormatter(cur, { maximumFractionDigits: 0 });
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
    <Card title="Payment history">
      {payments.length === 0 ? (
        <div style={{ fontSize: 12.5, color: c.hint, marginBottom: canRecord ? 14 : 0 }}>No payments recorded yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: canRecord ? 14 : 0 }}>
          {payments.map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${c.line}`, fontSize: 12.5 }}>
              <div>
                <span style={{ fontWeight: 600, color: "var(--teal)" }}>{inr(p.amount)}</span>
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
            <Field label={moneyLabel("Amount", cur)} style={{ flex: "1 1 120px", marginBottom: 0 }}>
              <Input type="number" min="0" max={balanceDue} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(balanceDue)} />
            </Field>
            <Field label="Method" style={{ flex: "1 1 140px", marginBottom: 0 }}>
              <Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Bank transfer" />
            </Field>
            <Field label="Reference" style={{ flex: "1 1 140px", marginBottom: 0 }}>
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." />
            </Field>
            <Field label="Note (optional)" style={{ flex: "2 1 160px", marginBottom: 0 }}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" loading={pending}>Record payment</Button>
          </div>
          {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: "var(--err-ink)" }}>{error}</div>}
        </form>
      )}
      {!canRecord && (
        <div style={{ fontSize: 11.5, color: c.hint }}>Mark the invoice as sent before recording a payment.</div>
      )}
    </Card>
  );
}
