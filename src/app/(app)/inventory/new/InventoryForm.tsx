"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES, UOM_OPTIONS } from "@/lib/constants";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";
import { useCurrency } from "@/lib/tenant-context";
import { moneyLabel } from "@/lib/currency";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";

export default function InventoryForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const cur = useCurrency();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    sku: "", name: "", description: "", category: "", uom: "Nos",
    supplier_id: "", reorder_level: "", unit_cost: "", notes: "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (res.ok) router.push(ROUTES.inventoryItem(json.id));
      else setError(json.error ?? "Failed to create item");
    });
  }

  return (
    <ObjectFormPage
      backHref={ROUTES.inventory}
      backLabel="All inventory"
      title="New Inventory Item"
      subtitle="Add a stock item to track quantity on hand"
      headerAction={<AdaptObjectDrawer objectType="inventory" objectLabel="Inventory Item" isAdmin={true} />}
      onSubmit={handleSubmit}
      saving={pending}
      saveLabel="Save"
      error={error}
    >
      <Card title="Item details" padding={18}>
        <div className="fg2">
          <Field label="Name" required>
            <Input value={form.name} onChange={set("name")} required placeholder="e.g. Copper winding wire 1.2mm" />
          </Field>
          <Field label="SKU">
            <Input value={form.sku} onChange={set("sku")} placeholder="e.g. WW-1.2MM" />
          </Field>
        </div>
        <Field label="Description">
          <Textarea value={form.description} onChange={set("description")} />
        </Field>
        <div className="fg2">
          <Field label="Category">
            <Input value={form.category} onChange={set("category")} placeholder="e.g. Winding materials" />
          </Field>
          <Field label="UOM">
            <Select value={form.uom} onChange={set("uom")}>
              {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Preferred supplier">
          <Select value={form.supplier_id} onChange={set("supplier_id")}>
            <option value="">— None —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <div className="fg2">
          <Field label="Reorder level">
            <Input type="number" min="0" step="1" value={form.reorder_level} onChange={set("reorder_level")} placeholder="Alert when stock falls to/below this" />
          </Field>
          <Field label={moneyLabel("Unit cost", cur)}>
            <Input type="number" min="0" step="0.01" value={form.unit_cost} onChange={set("unit_cost")} />
          </Field>
        </div>
        <Field label="Notes" style={{ marginBottom: 0 }}>
          <Textarea value={form.notes} onChange={set("notes")} />
        </Field>
      </Card>
    </ObjectFormPage>
  );
}
