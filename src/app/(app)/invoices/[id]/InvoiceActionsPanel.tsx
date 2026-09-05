"use client";

import { useTransition, useState } from "react";
import { useFeel } from "@/components/FeelProvider";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { Invoice } from "@/lib/types";
import { ROUTES } from "@/lib/constants";
import EmailInvoicePanel from "./EmailInvoicePanel";

// Status transitions + delete. Field editing (due_date/notes/terms) moved to
// ObjectSections -- this stays a separate component because these are real
// lifecycle actions (status change, irreversible delete), not field values.
export default function InvoiceActionsPanel({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);

  const { confirm } = useFeel();
  async function setStatus(status: "sent" | "cancelled") {
    if (status === "cancelled" && !(await confirm({ title: "Cancel this invoice?", body: "It stays on record as cancelled — nothing is deleted.", confirmLabel: "Cancel invoice", cancelLabel: "Keep it", tone: "danger" }))) return;
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
    if (!(await confirm({ title: `Delete draft ${invoice.ref}?`, body: "This cannot be undone.", tone: "danger" }))) return;
    startTransition(async () => {
      const res = await fetch(`/api/invoices/${invoice.id}`, { method: "DELETE" });
      if (res.ok) router.push(ROUTES.invoices);
      else { const j = await res.json(); setError(j.error ?? "Failed to delete"); }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {error && (
        <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>
          {error}
        </div>
      )}

      {invoice.status !== "cancelled" && !emailOpen && (
        <button type="button" disabled={pending} onClick={() => setEmailOpen(true)} style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          background: invoice.status === "draft" ? c.accent : "none", color: invoice.status === "draft" ? "#fff" : c.accent,
          borderRadius: 7, padding: "8px 14px", fontSize: 12.5, fontWeight: 600,
          border: invoice.status === "draft" ? "none" : `1px solid ${c.accent}60`, cursor: "pointer", width: "100%",
        }}>
          Email invoice
        </button>
      )}
      {emailOpen && <EmailInvoicePanel invoiceId={invoice.id} invoiceRef={invoice.ref} onClose={() => setEmailOpen(false)} />}

      {invoice.status === "draft" && (
        <button type="button" disabled={pending} onClick={() => setStatus("sent")} style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "none", color: c.accent, borderRadius: 7,
          padding: "7px 14px", fontSize: 12.5, fontWeight: 600,
          border: `1px solid ${c.accent}60`, cursor: pending ? "wait" : "pointer", width: "100%",
        }}>
          Mark as sent (without emailing)
        </button>
      )}

      {invoice.status === "draft" && (
        <button type="button" disabled={pending} onClick={handleDelete} style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "none", color: "var(--red)", borderRadius: 7,
          padding: "7px 14px", fontSize: 12, fontWeight: 500,
          border: "1px solid #f5c0c0", cursor: pending ? "wait" : "pointer", width: "100%",
        }}>
          Delete draft
        </button>
      )}
      {!["draft", "cancelled", "paid"].includes(invoice.status) && (
        <button type="button" disabled={pending} onClick={() => setStatus("cancelled")} style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "none", color: "var(--red)", borderRadius: 7,
          padding: "7px 14px", fontSize: 12, fontWeight: 500,
          border: "1px solid #f5c0c0", cursor: pending ? "wait" : "pointer", width: "100%",
        }}>
          Cancel invoice
        </button>
      )}
    </div>
  );
}
