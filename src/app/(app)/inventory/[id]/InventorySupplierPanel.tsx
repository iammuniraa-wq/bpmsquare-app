"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { InventoryItem } from "@/lib/types";
import { ROUTES } from "@/lib/constants";
import { CheckIcon } from "@/components/Icons";

const sel: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 7,
  background: c.panel, color: c.ink, outline: "none", fontFamily: "inherit",
};

// Preferred-supplier picker. Stays a dedicated component because there's no
// "reference/lookup" widget type yet for ObjectSections to resolve a live
// suppliers list -- see FIELD_REGISTRY_ROLLOUT.md. Every other flat field
// moved to ObjectSections. Delete stays here too, same reasoning as
// DeleteSupplierButton -- no ObjectSections equivalent for a destructive action.
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

  async function handleDelete() {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/inventory/${item.id}`, { method: "DELETE" });
      if (res.ok) router.push(ROUTES.inventory);
      else { const j = await res.json(); setError(j.error ?? "Failed to delete"); }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ background: c.panel, border: `1px solid ${c.line}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          Preferred supplier
          {saved && <span style={{ color: "#1d9e75", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 3, textTransform: "none" }}><CheckIcon size={11} color="#1d9e75" /> Saved</span>}
        </div>
        <select
          style={sel}
          value={supplierId}
          onChange={(e) => { setSupplierId(e.target.value); save(e.target.value); }}
          disabled={pending}
        >
          <option value="">— None —</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "#dc2626", marginTop: 10 }}>
            {error}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "none", color: "#a32d2d", borderRadius: 7,
          padding: "7px 14px", fontSize: 12, fontWeight: 500,
          border: "1px solid #f5c0c0", cursor: pending ? "default" : "pointer", width: "100%",
        }}
      >
        Delete item
      </button>
    </div>
  );
}
