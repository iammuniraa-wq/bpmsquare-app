"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";

/** New contract project by hand: a name, optionally the customer and the contract value. The budget is built on the project. */
export default function NewContractProjectForm({ accounts }: { accounts: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", account_id: "", contract_value: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Give the project a name"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/contract-projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, account_id: form.account_id || null, contract_value: form.contract_value === "" ? 0 : Number(form.contract_value) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not create the project"); return; }
      router.push(ROUTES.contractProject(j.id));
    });
  }

  return (
    <ObjectFormPage backHref={ROUTES.contractProjects} backLabel="Contract Projects" title="New contract project" onSubmit={submit} saving={pending} saveLabel="Save" error={error} maxWidth={720}>
      <Card padding={18} title="New contract project" info={PROJECT_TIPS.create}>
        <div className="fg2">
          <Field label="Name" required guide="cp.field.name"><Input value={form.name} onChange={set("name")} maxLength={200} autoFocus /></Field>
          <Field label="Customer" guide="cp.field.account">
            <Select value={form.account_id} onChange={set("account_id")}>
              <option value="">— None —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Contract value" info={PROJECT_TIPS.contractValue} guide="cp.field.contract_value">
            <Input type="number" min="0" step="0.01" inputMode="decimal" value={form.contract_value} onChange={set("contract_value")} />
          </Field>
        </div>
      </Card>
    </ObjectFormPage>
  );
}
