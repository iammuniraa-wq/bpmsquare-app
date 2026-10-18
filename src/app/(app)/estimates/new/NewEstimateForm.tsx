"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import CreateExtraFields from "@/components/fields/CreateExtraFields";
import InputsForm, { initialValues, toParams, type InputValues, type InputIssue } from "@/components/estimator/InputsForm";
import AccountPicker, { type AccountOption, type ContactOption } from "@/components/estimator/AccountPicker";
import type { TemplateInput } from "@/lib/estimator/types";

export type TemplateChoice = {
  id: string; name: string; description: string | null; trade: string | null; inputs: TemplateInput[];
};

const STANDARD_KEYS = ["ref", "name", "status", "currency", "margin_pct", "notes"];

export default function NewEstimateForm({
  templates, accounts, contacts, defaultAccountId,
}: {
  templates: TemplateChoice[];
  accounts: AccountOption[];
  contacts: ContactOption[];
  defaultAccountId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<InputIssue[]>([]);

  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState(defaultAccountId && accounts.some((a) => a.id === defaultAccountId) ? defaultAccountId : "");
  const [contactId, setContactId] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const template = templates.find((t) => t.id === templateId) ?? null;
  const [values, setValues] = useState<InputValues>(() => initialValues(templates[0]?.inputs ?? []));
  const [margin, setMargin] = useState("0");
  const [notes, setNotes] = useState("");
  const [customData, setCustomData] = useState<Record<string, unknown>>({});

  function pickTemplate(id: string) {
    setTemplateId(id);
    setValues(initialValues(templates.find((t) => t.id === id)?.inputs ?? []));
    setIssues([]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required."); return; }
    if (!template) { setError("Choose a template."); return; }
    setError("");
    setIssues([]);
    startTransition(async () => {
      const res = await fetch("/api/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), template_id: template.id,
          account_id: accountId || null, contact_id: contactId || null,
          params: toParams(template.inputs, values), margin_pct: margin === "" ? 0 : Number(margin),
          notes: notes.trim() || null, custom_data: customData,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) { router.push(ROUTES.estimate(json.id)); return; }
      setError(json.error ?? "Could not create the estimate.");
      if (Array.isArray(json.issues)) setIssues(json.issues as InputIssue[]);
    });
  }

  return (
    <ObjectFormPage
      backHref={ROUTES.estimates}
      backLabel="All estimates"
      title="New Estimate"
      subtitle="Choose a template, enter the inputs, and the bill of materials and cost build-up are worked out for you"
      onSubmit={submit}
      saving={pending}
      saveLabel="Calculate and save"
      error={error}
    >
      <Card title="Estimate details" padding={18}>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} placeholder="e.g. Villa, Riyadh, 2 floors" />
        </Field>
        <Field label="Template" required hint={template?.description ?? undefined}>
          <Select value={templateId} onChange={(e) => pickTemplate(e.target.value)} required>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <div className="fg2">
          <AccountPicker accounts={accounts} contacts={contacts} accountId={accountId} contactId={contactId} onAccount={setAccountId} onContact={setContactId} />
        </div>
      </Card>

      {template && (
        <InputsForm
          inputs={template.inputs}
          values={values}
          onChange={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
          issues={issues}
        />
      )}

      <Card title="Pricing and notes" padding={18}>
        <Field label="Margin %" hint="Added on top of cost. The price shown to the customer is cost plus this margin.">
          <Input type="number" inputMode="decimal" step="any" min={0} max={1000} value={margin} onChange={(e) => setMargin(e.target.value)} />
        </Field>
        <Field label="Notes" style={{ marginBottom: 0 }}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} placeholder="Assumptions, exclusions, who asked…" />
        </Field>
      </Card>

      <CreateExtraFields
        objectType="estimate"
        exclude={STANDARD_KEYS}
        values={customData}
        onChange={(key, value, kind) => { if (kind === "custom") setCustomData((d) => ({ ...d, [key]: value })); }}
      />
    </ObjectFormPage>
  );
}
