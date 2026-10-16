"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";
import { useCurrency } from "@/lib/tenant-context";
import { formatMoneyCompact } from "@/lib/currency";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import SectionCustomFields, { useSectionCustomFields } from "@/components/fields/SectionCustomFields";

const ACCOUNT_TYPES = [
  { value: "prospect",     label: "Prospect" },
  { value: "direct",       label: "Direct Customer" },
  { value: "oem",          label: "OEM / Dealer" },
  { value: "end_customer", label: "End Customer" },
];

export default function NewAccountPage() {
  const cur = useCurrency();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const cf = useSectionCustomFields("account");

  const [form, setForm] = useState({
    // Identity
    name: "", type: "prospect",
    // Address
    address_line1: "", address_line2: "",
    city: "", state: "", postal_code: "", country: "",
    // Communication
    phone: "", phone2: "", email: "", email2: "", website: "",
    // Business
    industry: "", employee_count: "", annual_revenue: "", gstin: "",
    // Notes + referral
    notes: "", referred_by_account_id: "",
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const cfInputs = (section: string) => <SectionCustomFields defs={cf.defs} values={cf.values} setValue={cf.setValue} section={section} />;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, custom_data: Object.keys(cf.values).length > 0 ? cf.values : undefined }),
      });
      const json = await res.json();
      if (res.ok) {
        router.push(ROUTES.account(json.id));
      } else {
        setError(json.error ?? "Failed to create account");
      }
    });
  }

  return (
    <ObjectFormPage
      backHref={ROUTES.accounts}
      backLabel="All accounts"
      title="New Account"
      subtitle="Add a customer, prospect, OEM or end customer"
      headerAction={<AdaptObjectDrawer objectType="account" objectLabel="Account" isAdmin={true} />}
      onSubmit={handleSubmit}
      saving={pending}
      saveLabel="Save"
      error={error}
    >
      <Card title="Identity" padding={18}>
        <Field label="Company name" required>
          <Input value={form.name} onChange={set("name")} required placeholder="e.g. Tata Steel Ltd" />
        </Field>
        <Field label="Account type" required>
          <Select value={form.type} onChange={set("type")}>
            {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        {cfInputs("Identity")}
      </Card>

      <Card title="Address" padding={18}>
        <Field label="Address line 1">
          <Input value={form.address_line1} onChange={set("address_line1")} placeholder="Street / building / plot" />
        </Field>
        <Field label="Address line 2">
          <Input value={form.address_line2} onChange={set("address_line2")} placeholder="Area / landmark" />
        </Field>
        <div className="fg2">
          <Field label="City">
            <Input value={form.city} onChange={set("city")} placeholder="e.g. Bengaluru" />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={set("state")} placeholder="e.g. Karnataka" />
          </Field>
          <Field label="Postal code">
            <Input value={form.postal_code} onChange={set("postal_code")} placeholder="560001" />
          </Field>
          <Field label="Country">
            <Input value={form.country} onChange={set("country")} placeholder="India" />
          </Field>
        </div>
        {cfInputs("Address")}
      </Card>

      <Card title="Communication" padding={18}>
        <div className="fg2">
          <Field label="Primary phone">
            <Input value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
          </Field>
          <Field label="Secondary phone">
            <Input value={form.phone2} onChange={set("phone2")} placeholder="+91 98765 43211" />
          </Field>
          <Field label="Primary email">
            <Input type="email" value={form.email} onChange={set("email")} placeholder="accounts@company.com" />
          </Field>
          <Field label="Secondary email">
            <Input type="email" value={form.email2} onChange={set("email2")} placeholder="info@company.com" />
          </Field>
        </div>
        <Field label="Website">
          <Input value={form.website} onChange={set("website")} placeholder="https://company.com" />
        </Field>
        {cfInputs("Communication")}
      </Card>

      <Card title="Business" padding={18}>
        <Field label="Industry">
          <Input value={form.industry} onChange={set("industry")} placeholder="e.g. Textile Manufacturing" />
        </Field>
        <div className="fg2">
          <Field label="Employees">
            <Input value={form.employee_count} onChange={set("employee_count")} placeholder="e.g. 250" />
          </Field>
          <Field label="Annual revenue">
            <Input value={form.annual_revenue} onChange={set("annual_revenue")} placeholder={`e.g. ${formatMoneyCompact(50_000_000, cur, 0)}`} />
          </Field>
        </div>
        <Field label="GSTIN">
          <Input value={form.gstin} onChange={set("gstin")} placeholder="27AABCV1234F1Z5" />
        </Field>
        {cfInputs("Business")}
      </Card>

      <Card title="Notes & Referral" padding={18}>
        <Field label="Notes">
          <Textarea value={form.notes} onChange={set("notes")} placeholder="Any notes about this account…" />
        </Field>
        <Field label="Referred by account ID" hint="Set when type is End Customer and an OEM referred them">
          <Input value={form.referred_by_account_id} onChange={set("referred_by_account_id")} placeholder="UUID of OEM account" />
        </Field>
        {cfInputs("Notes")}
      </Card>
    </ObjectFormPage>
  );
}
