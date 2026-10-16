"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import type { Account } from "@/lib/types";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import SectionCustomFields, { useSectionCustomFields } from "@/components/fields/SectionCustomFields";

export default function NewContactForm({ accounts, defaultAccountId, isAdmin }: { accounts: Account[]; defaultAccountId?: string; isAdmin?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const cf = useSectionCustomFields("contact");
  const cfInputs = (section: string) => <SectionCustomFields defs={cf.defs} values={cf.values} setValue={cf.setValue} section={section} />;

  const [form, setForm] = useState({
    account_id: defaultAccountId || accounts[0]?.id || "",
    name: "", role: "", department: "",
    phone: "", phone2: "", phone3: "",
    email: "", email2: "",
    website: "", linkedin_url: "", birthday: "",
    address_line1: "", address_line2: "",
    city: "", state: "", postal_code: "", country: "",
    notes: "",
    _copyFromAccount: false,
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function copyAddressFromAccount() {
    const acct = accounts.find((a) => a.id === form.account_id);
    if (!acct) return;
    setForm((f) => ({
      ...f,
      address_line1: acct.address_line1 ?? "",
      address_line2: acct.address_line2 ?? "",
      city:          acct.city          ?? "",
      state:         acct.state         ?? "",
      postal_code:   acct.postal_code   ?? "",
      country:       acct.country       ?? "",
    }));
  }

  const backHref = defaultAccountId ? ROUTES.account(defaultAccountId) : ROUTES.contacts;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _copyFromAccount, ...payload } = form;
    startTransition(async () => {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, custom_data: Object.keys(cf.values).length > 0 ? cf.values : undefined }),
      });
      const json = await res.json();
      if (res.ok) {
        // Created from an account page (it passes ?account_id=) -- return
        // there so the new contact shows up under it, rather than dropping
        // the rep on the unfiltered contacts list.
        router.push(backHref);
      } else {
        setError(json.error ?? "Failed to create contact");
      }
    });
  }

  return (
    <ObjectFormPage
      backHref={ROUTES.contacts}
      backLabel="All contacts"
      cancelHref={backHref}
      title="New Contact"
      subtitle="Add a person linked to an account"
      headerAction={<AdaptObjectDrawer objectType="contact" objectLabel="Contact" isAdmin={isAdmin ?? true} />}
      onSubmit={handleSubmit}
      saving={pending}
      saveLabel="Save"
      error={error}
    >
      <Card title="Identity" padding={18}>
        <Field label="Full name" required>
          <Input value={form.name} onChange={set("name")} required placeholder="e.g. Rajesh Kumar" />
        </Field>
        <Field label="Account" required>
          <Select value={form.account_id} onChange={set("account_id")} required>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Field>
        <div className="fg2">
          <Field label="Role / designation">
            <Input value={form.role} onChange={set("role")} placeholder="e.g. Purchase Manager" />
          </Field>
          <Field label="Department">
            <Input value={form.department} onChange={set("department")} placeholder="e.g. Maintenance" />
          </Field>
          <Field label="Birthday">
            <Input type="date" value={form.birthday} onChange={set("birthday")} />
          </Field>
          <Field label="LinkedIn URL">
            <Input value={form.linkedin_url} onChange={set("linkedin_url")} placeholder="https://linkedin.com/in/..." />
          </Field>
        </div>
        {cfInputs("Identity")}
      </Card>

      <Card title="Phone numbers" padding={18}>
        <div className="fg3">
          <Field label="Primary phone">
            <Input value={form.phone} onChange={set("phone")} placeholder="+91 98765 43210" />
          </Field>
          <Field label="Secondary phone">
            <Input value={form.phone2} onChange={set("phone2")} placeholder="+91 98765 43211" />
          </Field>
          <Field label="Third phone">
            <Input value={form.phone3} onChange={set("phone3")} placeholder="+91 98765 43212" />
          </Field>
        </div>
        {cfInputs("Phone numbers")}
      </Card>

      <Card title="Email & web" padding={18}>
        <div className="fg2">
          <Field label="Primary email">
            <Input type="email" value={form.email} onChange={set("email")} placeholder="rajesh@company.com" />
          </Field>
          <Field label="Secondary email">
            <Input type="email" value={form.email2} onChange={set("email2")} placeholder="rajesh.personal@gmail.com" />
          </Field>
        </div>
        <Field label="Website">
          <Input value={form.website} onChange={set("website")} placeholder="https://linkedin.com/in/..." />
        </Field>
        {cfInputs("Email & web")}
      </Card>

      <Card
        title="Address"
        padding={18}
        action={<Button variant="quiet" size="sm" onClick={copyAddressFromAccount}>↙ Copy from account</Button>}
      >
        <div style={{ fontSize: 12, color: c.hint, marginBottom: 12 }}>Contact&apos;s personal or delivery address</div>
        <Field label="Address line 1">
          <Input value={form.address_line1} onChange={set("address_line1")} placeholder="Street / building / flat" />
        </Field>
        <Field label="Address line 2">
          <Input value={form.address_line2} onChange={set("address_line2")} placeholder="Area / landmark" />
        </Field>
        <div className="fg2">
          <Field label="City">
            <Input value={form.city} onChange={set("city")} placeholder="Bengaluru" />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={set("state")} placeholder="Karnataka" />
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

      <Card title="Notes" padding={18}>
        <Field label="Notes">
          <Textarea value={form.notes} onChange={set("notes")} placeholder="Any notes about this contact…" />
        </Field>
        {cfInputs("Notes")}
      </Card>
    </ObjectFormPage>
  );
}
