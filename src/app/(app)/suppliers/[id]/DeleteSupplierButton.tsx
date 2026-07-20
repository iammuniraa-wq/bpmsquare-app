"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { Supplier } from "@/lib/types";
import { ROUTES } from "@/lib/constants";

// Editing a supplier's own field values happens inline in the Details card
// (ObjectSections) — see AccountHeader for the same rule. Delete has no
// ObjectSections equivalent, so it stays as its own small control.
export default function DeleteSupplierButton({ supplier }: { supplier: Supplier }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm(`Delete "${supplier.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/suppliers/${supplier.id}`, { method: "DELETE" });
      if (res.ok) router.push(ROUTES.suppliers);
      else { const j = await res.json().catch(() => ({})); alert(j.error ?? "Failed to delete"); }
    });
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={pending}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "none", color: "#a32d2d", borderRadius: 7,
        padding: "7px 14px", fontSize: 12, fontWeight: 500,
        border: "1px solid #f5c0c0", cursor: pending ? "default" : "pointer", width: "100%",
        opacity: pending ? 0.6 : 1,
      }}
    >
      {pending ? "Deleting…" : "Delete supplier"}
    </button>
  );
}
