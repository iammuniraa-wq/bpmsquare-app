"use client";

import { useTransition } from "react";
import { useFeel } from "@/components/FeelProvider";
import { useRouter } from "next/navigation";
import type { Product } from "@/lib/types";
import { ROUTES } from "@/lib/constants";

export default function DeleteProductButton({ product }: { product: Product }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const { confirm, toast, undoable } = useFeel();
  async function handleDelete() {
    if (!(await confirm({ title: `Delete "${product.name}"?`, body: "Existing quote lines keep their copied details. You'll have a few seconds to undo.", tone: "danger" }))) return;
    startTransition(() => {
      undoable({
        text: `"${product.name}" deleted`,
        action: async () => {
          const res = await fetch(`/api/products/${product.id}`, { method: "DELETE", keepalive: true });
          if (!res.ok) { const j = await res.json().catch(() => ({})); toast({ text: j.error ?? "Could not delete this product", tone: "error" }); }
        },
      });
      router.push(ROUTES.products);
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
      {pending ? "Deleting…" : "Delete product"}
    </button>
  );
}
