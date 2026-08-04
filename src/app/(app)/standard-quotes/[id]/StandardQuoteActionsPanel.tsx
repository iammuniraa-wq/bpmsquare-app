"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { StandardQuote } from "@/lib/types";
import { ROUTES } from "@/lib/constants";

const toDateInput = (v: string | null) => (v ? v.slice(0, 10) : "");

export default function StandardQuoteActionsPanel({ quote }: { quote: StandardQuote }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [emailSent, setEmailSent] = useState("");
  const [editingDates, setEditingDates] = useState(false);
  const [dates, setDates] = useState({
    inquiry_date: toDateInput(quote.inquiry_date),
    sent_at: toDateInput(quote.sent_at),
    closed_at: toDateInput(quote.closed_at),
  });

  function saveDates() {
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
      if (res.ok) { setEditingDates(false); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save dates"); }
    });
  }

  function setStatus(status: "sent" | "accepted" | "rejected") {
    setError("");
    startTransition(async () => {
      const res = await fetch(`/api/standard-quotes/${quote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) router.refresh();
      else { const j = await res.json(); setError(j.error ?? "Failed to update status"); }
    });
  }

  function sendEmail() {
    setError("");
    setEmailSent("");
    startTransition(async () => {
      const res = await fetch(`/api/standard-quotes/${quote.id}/email`, { method: "POST" });
      const j = await res.json();
      if (res.ok) { setEmailSent(`Sent to ${j.sentTo}`); router.refresh(); }
      else setError(j.error ?? "Failed to send email");
    });
  }

  async function handleDelete() {
    if (!confirm(`Delete draft "${quote.ref}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/standard-quotes/${quote.id}`, { method: "DELETE" });
      if (res.ok) router.push(ROUTES.standardQuotes);
      else { const j = await res.json(); setError(j.error ?? "Failed to delete"); }
    });
  }

  const btn = (variant: "primary" | "ghost" | "danger"): React.CSSProperties => ({
    display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: 7, padding: variant === "primary" ? "8px 14px" : "7px 14px",
    fontSize: variant === "primary" ? 12.5 : 12, fontWeight: variant === "primary" ? 600 : 500,
    cursor: pending ? "wait" : "pointer", width: "100%",
    background: variant === "primary" ? c.accent : "none",
    color: variant === "primary" ? "#fff" : variant === "danger" ? "var(--red)" : c.muted,
    border: variant === "primary" ? "none" : `1px solid ${variant === "danger" ? "#f5c0c0" : c.line}`,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {error && (
        <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>
          {error}
        </div>
      )}
      {emailSent && (
        <div style={{ background: "var(--greenbg)", border: "1px solid var(--green)", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "var(--greenink)" }}>
          ✓ {emailSent}
        </div>
      )}

      <a href={`/api/standard-quotes/${quote.id}/pdf`} style={{ ...btn("ghost"), textDecoration: "none" }}>
        ⬇ Download PDF
      </a>

      {quote.status === "draft" && (
        <button type="button" disabled={pending} onClick={sendEmail} style={btn("primary")}>
          Email to customer
        </button>
      )}
      {quote.status === "draft" && (
        <button type="button" disabled={pending} onClick={() => setStatus("sent")} style={btn("ghost")}>
          Mark as sent
        </button>
      )}
      {quote.status === "sent" && (
        <>
          <button type="button" disabled={pending} onClick={sendEmail} style={btn("ghost")}>
            Resend email
          </button>
          <button type="button" disabled={pending} onClick={() => setStatus("accepted")} style={btn("primary")}>
            Mark accepted
          </button>
          <button type="button" disabled={pending} onClick={() => setStatus("rejected")} style={btn("danger")}>
            Mark rejected
          </button>
        </>
      )}
      {quote.status === "draft" && (
        <button type="button" disabled={pending} onClick={handleDelete} style={btn("danger")}>
          Delete draft
        </button>
      )}

      {editingDates ? (
        <div style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <DateField label="Inquiry date" value={dates.inquiry_date} onChange={(v) => setDates((d) => ({ ...d, inquiry_date: v }))} />
          <DateField label="Submitted to customer" value={dates.sent_at} onChange={(v) => setDates((d) => ({ ...d, sent_at: v }))} />
          <DateField label="Closed date" value={dates.closed_at} onChange={(v) => setDates((d) => ({ ...d, closed_at: v }))} />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={pending} onClick={saveDates} style={{ ...btn("primary"), width: "auto", padding: "7px 14px" }}>
              {pending ? "Saving…" : "Save dates"}
            </button>
            <button type="button" onClick={() => setEditingDates(false)} style={{ ...btn("ghost"), width: "auto" }}>
              Cancel
            </button>
          </div>
          <p style={{ fontSize: 10.5, color: c.hint, margin: 0 }}>
            These normally stamp themselves (on send, on close) — override them when it happened outside BPMSquare.
          </p>
        </div>
      ) : (
        <button type="button" onClick={() => setEditingDates(true)} style={btn("ghost")}>
          Edit dates
        </button>
      )}
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 }}>
        {label}
      </label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: 7, border: `1px solid ${c.line}`, fontSize: 12.5, background: c.panel, color: c.ink, outline: "none" }}
      />
    </div>
  );
}
