"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCurrency } from "@/lib/tenant-context";
import { moneyLabel } from "@/lib/currency";
import { ROUTES } from "@/lib/constants";
import { useSalesConfig } from "@/lib/useSalesConfig";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";

export default function NewProductForm({ suppliers }: {
  /** The tenant's active suppliers; null while 0132 is pending (the control is hidden). */
  suppliers: { id: string; name: string }[] | null;
}) {
  const cur = useCurrency();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "", sku: "", category: "", sub_category: "", uom: "", description: "",
    list_price: "", cost_price: "", tax_percent: "", supplier_id: "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  // Category values come from the tenant's tree (Settings -> Sales config);
  // the record stores the CODE, the dropdown shows the name, and sub-category
  // options depend on the chosen category. No tree configured -> free-text
  // entry, so a fresh tenant is never blocked.
  const { product_categories: catTree } = useSalesConfig();
  const subs = catTree.find((pc) => pc.code === form.category)?.subs ?? [];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(suppliers ? form : { ...form, supplier_id: undefined }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Could not create the product"); return; }
      router.push(ROUTES.product(json.id));
    });
  }

  return (
    <ObjectFormPage
      backHref={ROUTES.products}
      backLabel="All products"
      title="New Product"
      subtitle="Add an item or service you sell"
      onSubmit={handleSubmit}
      saving={pending}
      saveLabel="Save"
      error={error}
    >
      <Card title="Product details" padding={18}>
        <Field label="Name" required>
          <Input value={form.name} onChange={set("name")} required placeholder="e.g. Passenger Elevator 8P (630 kg)" autoFocus />
        </Field>
        <div className="fg2">
          <Field label="SKU">
            <Input value={form.sku} onChange={set("sku")} placeholder="ELV-P8-630" />
          </Field>
          <Field label="Unit of measure">
            <Input value={form.uom} onChange={set("uom")} placeholder="Nos / Hrs / Job / Yr" />
          </Field>
          <Field label="Category">
            {catTree.length > 0 ? (
              <Select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value, sub_category: "" }))}
              >
                <option value="">— None —</option>
                {catTree.map((pc) => <option key={pc.code} value={pc.code}>{pc.name}</option>)}
              </Select>
            ) : (
              <Input value={form.category} onChange={set("category")} placeholder="Elevators" />
            )}
          </Field>
          <Field label="Sub-category">
            {catTree.length > 0 ? (
              <Select value={form.sub_category} onChange={set("sub_category")} disabled={subs.length === 0}>
                <option value="">{subs.length ? "— None —" : "No sub-categories"}</option>
                {subs.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </Select>
            ) : (
              <Input value={form.sub_category} onChange={set("sub_category")} placeholder="Passenger" />
            )}
          </Field>
        </div>
        {suppliers && (
          <Field label="Preferred supplier" hint="The supplier you normally buy this from">
            <Select value={form.supplier_id} onChange={set("supplier_id")}>
              <option value="">— None —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Description" style={{ marginBottom: 0 }}>
          <Textarea rows={3} value={form.description} onChange={set("description")} placeholder="What this product includes" />
        </Field>
      </Card>

      <Card title="Pricing" padding={18}>
        <div className="fg2">
          <Field label={moneyLabel("List price", cur)}>
            <Input type="number" step="0.01" value={form.list_price} onChange={set("list_price")} placeholder="External selling price" />
          </Field>
          <Field label={moneyLabel("Cost price", cur)}>
            <Input type="number" step="0.01" value={form.cost_price} onChange={set("cost_price")} placeholder="Internal cost" />
          </Field>
          <Field label="Tax %" style={{ marginBottom: 0 }}>
            <Input type="number" step="0.01" value={form.tax_percent} onChange={set("tax_percent")} placeholder="18" />
          </Field>
        </div>
      </Card>
    </ObjectFormPage>
  );
}
