"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";

const SUPPLIER_TYPES = [
  { value: "vendor",        label: "Vendor — sells parts / materials" },
  { value: "subcontractor", label: "Subcontractor — provides labour / specialist work" },
  { value: "both",          label: "Both vendor and subcontractor" },
];

export default function NewSupplierPage() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "", type: "vendor", city: "", phone: "", email: "", gstin: "", notes: "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name is required"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (res.ok) router.push(ROUTES.supplier(json.id));
      else setError(json.error ?? "Failed to create supplier");
    });
  }

  return (
    <ObjectFormPage
      backHref={ROUTES.suppliers}
      backLabel="All suppliers"
      title="New Supplier"
      subtitle="Add a vendor or subcontractor"
      onSubmit={handleSubmit}
      saving={pending}
      saveLabel="Save"
      error={error}
    >
      <Card title="Supplier details" padding={18}>
        <Field label="Name" required>
          <Input value={form.name} onChange={set("name")} required placeholder="e.g. Bharat Electrical Stores" />
        </Field>
        <Field label="Type" required>
          <Select value={form.type} onChange={set("type")}>
            {SUPPLIER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <div className="fg2">
          <Field label="Phone">
            <Input value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
          </Field>
          <Field label="City">
            <Input value={form.city} onChange={set("city")} placeholder="e.g. Mumbai" />
          </Field>
        </div>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={set("email")} placeholder="contact@supplier.com" />
        </Field>
        <Field label="GSTIN">
          <Input value={form.gstin} onChange={set("gstin")} placeholder="27AXXXX0000X1ZX" />
        </Field>
        <Field label="Notes" style={{ marginBottom: 0 }}>
          <Textarea value={form.notes} onChange={set("notes")} placeholder="Payment terms, lead times, contact preferences…" />
        </Field>
      </Card>
    </ObjectFormPage>
  );
}
