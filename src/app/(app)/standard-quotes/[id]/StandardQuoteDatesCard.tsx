"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

const toDateInput = (v: string | null) => (v ? v.slice(0, 10) : "");
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, marginTop: 5 }}>
      <span style={{ color: c.hint, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", color: c.muted }}>{value}</span>
    </div>
  );
}

/** The quote's dates, with the override editor the old actions panel carried. */
export default function StandardQuoteDatesCard({ quote }: {
  quote: { id: string; inquiry_date: string | null; sent_at: string | null; closed_at: string | null; created_at: string; updated_at: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [dates, setDates] = useState({
    inquiry_date: toDateInput(quote.inquiry_date),
    sent_at: toDateInput(quote.sent_at),
    closed_at: toDateInput(quote.closed_at),
  });

  function save() {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/standard-quotes/${quote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inquiry_date: dates.inquiry_date || null,
          sent_at: dates.sent_at || null,
          closed_at: dates.closed_at || null,
        }),
      });
      if (res.ok) { setEditing(false); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save dates"); }
    });
  }

  return (
    <Card
      title="Dates"
      padding={14}
      action={!editing ? <Button variant="quiet" size="sm" onClick={() => setEditing(true)}>Edit</Button> : undefined}
    >
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Field label="Inquiry date" style={{ marginBottom: 8 }}>
            <Input type="date" value={dates.inquiry_date} onChange={(e) => setDates((d) => ({ ...d, inquiry_date: e.target.value }))} />
          </Field>
          <Field label="Submitted to customer" style={{ marginBottom: 8 }}>
            <Input type="date" value={dates.sent_at} onChange={(e) => setDates((d) => ({ ...d, sent_at: e.target.value }))} />
          </Field>
          <Field label="Closed date" style={{ marginBottom: 8 }}>
            <Input type="date" value={dates.closed_at} onChange={(e) => setDates((d) => ({ ...d, closed_at: e.target.value }))} />
          </Field>
          {error && <div role="alert" style={{ fontSize: 12, color: "var(--err-ink)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="primary" size="sm" loading={pending} onClick={save}>{pending ? "Saving…" : "Save dates"}</Button>
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setEditing(false)}>Cancel</Button>
          </div>
          <p style={{ fontSize: 10.5, color: c.hint, margin: "6px 0 0" }}>
            These normally stamp themselves (on send, on close) — override them when it happened outside BPMSquare.
          </p>
        </div>
      ) : (
        <>
          <Row label="Inquiry" value={fmtDate(quote.inquiry_date)} />
          <Row label="Created" value={fmtDate(quote.created_at)} />
          <Row label="Submitted" value={fmtDate(quote.sent_at)} />
          <Row label="Changed on" value={fmtDate(quote.updated_at)} />
          <Row label="Closed" value={fmtDate(quote.closed_at)} />
        </>
      )}
    </Card>
  );
}
