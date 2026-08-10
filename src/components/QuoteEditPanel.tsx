"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import type { Quote } from "@/lib/types";
import { ROUTES, DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import { Pencil } from "@/components/Icons";

// Draft/open quotes go to the full Edit page (the same page used to create a
// quote, pre-filled). "Create new version" is offered alongside it at every
// phase, not just once a quote is closed -- a new version restarts the
// pipeline on a copy while this one stays exactly as it was. A quote that's
// already been superseded by a newer version is fully read-only: no edit, no
// versioning from here, just a pointer to whichever version replaced it.
export default function QuoteEditPanel({ quote, quoteStatuses = DEFAULT_QUOTE_STATUSES }: { quote: Quote; quoteStatuses?: QuoteStatusDef[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const currentDef = quoteStatuses.find((s) => s.value === quote.status);
  const isEditable = !currentDef?.is_closed;
  const isSuperseded = !!quote.superseded_by;

  async function createVersion() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/quotes/${quote.id}/revise`, { method: "POST" });
      if (res.ok) { const j = await res.json(); router.push(ROUTES.quotation(j.id)); }
      else { const text = await res.text(); let msg = "Failed to create version"; try { msg = JSON.parse(text).error ?? msg; } catch { msg = text.slice(0, 200) || msg; } setError(msg); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setSaving(false);
    }
  }

  if (isSuperseded) {
    return (
      <Link
        href={ROUTES.quotation(quote.superseded_by as string)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, background: c.panel2, color: c.muted,
          border: `1px solid ${c.line}`, borderRadius: 7, padding: "6px 12px",
          fontSize: 12.5, fontWeight: 600, textDecoration: "none",
        }}
      >
        Read-only — view latest version →
      </Link>
    );
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {isEditable && (
        <Link
          href={ROUTES.quotationEdit(quote.id)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5, background: c.accent, color: "#fff",
            border: "none", borderRadius: 7, padding: "6px 14px",
            fontSize: 12.5, fontWeight: 600, cursor: "pointer", textDecoration: "none",
          }}
        >
          <Pencil size={13} color="#fff" /> Edit quote
        </Link>
      )}
      <button
        type="button"
        onClick={createVersion}
        disabled={saving}
        title="Create an editable copy as a new version. This version becomes read-only once it exists."
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, background: c.panel2, color: c.muted,
          border: `1px solid ${c.line}`, borderRadius: 7, padding: "6px 12px",
          fontSize: 12.5, fontWeight: 600, cursor: "pointer",
        }}
      >
        <Pencil size={13} color={c.muted} /> {saving ? "Creating…" : "Create new version"}
      </button>
      {error && <span style={{ fontSize: 12, color: "var(--err-ink)" }}>{error}</span>}
    </div>
  );
}
