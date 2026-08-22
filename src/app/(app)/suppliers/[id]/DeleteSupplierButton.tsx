"use client";

import { useTransition } from "react";
import { useFeel } from "@/components/FeelProvider";
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

  const { confirm, toast, undoable } = useFeel();
  async function handleDelete() {
    if (!(await confirm({ title: `Delete "${supplier.name}"?`, body: "You'll have a few seconds to undo.", tone: "danger" }))) return;
    // Deferred delete: navigate away now, actually delete when the undo
    // window closes. Undo cancels it before anything is destroyed.
    startTransition(() => {
      undoable({
        text: `"${supplier.name}" deleted`,
        action: async () => {
          const res = await fetch(`/api/suppliers/${supplier.id}`, { method: "DELETE", keepalive: true });
          if (!res.ok) { const j = await res.json().catch(() => ({})); toast({ text: j.error ?? "Could not delete this supplier", tone: "error" }); }
        },
      });
      router.push(ROUTES.suppliers);
    });
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={pending}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "none", color: "var(--red)", borderRadius: 7,
        padding: "7px 14px", fontSize: 12, fontWeight: 500,
        border: "1px solid #f5c0c0", cursor: pending ? "default" : "pointer", width: "100%",
        opacity: pending ? 0.6 : 1,
      }}
    >
      {pending ? "Deleting…" : "Delete supplier"}
    </button>
  );
}
