"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckIcon } from "@/components/Icons";
import Card from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";

// Preferred-supplier picker. A dedicated card rather than an ObjectSections
// field because the registry has no reference/lookup widget yet (same reason
// as InventorySupplierPanel). The server passes the tenant's suppliers; it
// does not render this at all while migration 0132 is pending.
export default function ProductSupplierPanel({ productId, supplierId, suppliers }: {
  productId: string;
  supplierId: string | null;
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [value, setValue] = useState(supplierId ?? "");

  function save(next: string) {
    const previous = value;
    setValue(next);
    setError("");
    setSaved(false);
    startTransition(async () => {
      const res = await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplier_id: next || null }),
      });
      if (res.ok) { setSaved(true); router.refresh(); return; }
      setValue(previous);
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Could not save the supplier");
    });
  }

  return (
    <Card
      title="Preferred supplier"
      padding={14}
      action={saved ? <span style={{ color: "var(--teal)", fontWeight: 500, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 3 }}><CheckIcon size={11} color="var(--teal)" /> Saved</span> : undefined}
    >
      <Select aria-label="Preferred supplier" value={value} onChange={(e) => save(e.target.value)} disabled={pending}>
        <option value="">— None —</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      {value && (
        <div style={{ marginTop: 8, fontSize: 12.5 }}>
          <Link href={ROUTES.supplier(value)} style={{ color: c.accent, textDecoration: "none" }}>Open supplier →</Link>
        </div>
      )}
      {error && (
        <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)", marginTop: 10 }}>
          {error}
        </div>
      )}
    </Card>
  );
}
