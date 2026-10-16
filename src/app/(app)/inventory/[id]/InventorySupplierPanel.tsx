"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { InventoryItem } from "@/lib/types";
import { CheckIcon } from "@/components/Icons";
import Card from "@/components/ui/Card";
import { Select } from "@/components/ui/Input";

// Preferred-supplier picker. Stays a dedicated component because there's no
// "reference/lookup" widget type yet for ObjectSections to resolve a live
// suppliers list -- see FIELD_REGISTRY_ROLLOUT.md. Every other flat field
// moved to ObjectSections. Delete now lives in the record's "..." menu.
export default function InventorySupplierPanel({ item }: { item: InventoryItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [supplierId, setSupplierId] = useState(item.supplier_id ?? "");
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    fetch("/api/suppliers")
      .then((r) => r.json())
      .then((rows) => setSuppliers(rows.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }))))
      .catch(() => {});
  }, []);

  function save(value: string) {
    setError("");
    setSaved(false);
    startTransition(async () => {
      const res = await fetch(`/api/inventory/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplier_id: value || null }),
      });
      if (res.ok) { setSaved(true); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save"); }
    });
  }

  return (
    <Card
      title="Preferred supplier"
      padding={14}
      action={saved ? <span style={{ color: "var(--teal)", fontWeight: 500, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 3 }}><CheckIcon size={11} color="var(--teal)" /> Saved</span> : undefined}
    >
      <Select
        aria-label="Preferred supplier"
        value={supplierId}
        onChange={(e) => { setSupplierId(e.target.value); save(e.target.value); }}
        disabled={pending}
      >
        <option value="">— None —</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      {error && (
        <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)", marginTop: 10 }}>
          {error}
        </div>
      )}
    </Card>
  );
}
