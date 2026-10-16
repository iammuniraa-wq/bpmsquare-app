"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES, type OpportunityStageDef } from "@/lib/constants";
import { OPPORTUNITY_SOURCES, OPPORTUNITY_SOURCE_LABEL } from "@/lib/sales/opportunity";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";

export default function NewOpportunityForm({ accounts, contacts, members, stages, currentUserId }: {
  accounts: { id: string; name: string }[];
  contacts: { id: string; name: string; account_id: string }[];
  members: { user_id: string; name: string | null; email: string | null }[];
  stages: OpportunityStageDef[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "", account_id: "", contact_id: "", stage: stages.find((s) => s.is_initial)?.value ?? stages[0]?.value ?? "",
    expected_close: "", owner_id: currentUserId, source: "direct", competitor: "", description: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const accountContacts = contacts.filter((ct) => ct.account_id === form.account_id);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.account_id) { setError("Pick the account"); return; }
    if (!form.title.trim()) { setError("Give the deal a title"); return; }
    setError("");
    startTransition(async () => {
      const res = await fetch("/api/opportunities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not create the deal"); return; }
      router.push(ROUTES.pipelineDetail(j.id));
    });
  }

  return (
    <ObjectFormPage
      backHref={ROUTES.pipeline}
      backLabel="Pipeline"
      title="New Deal"
      subtitle="A pursuit with a customer. Lines, pricing and quotes come next, on the deal itself."
      onSubmit={submit}
      saving={pending}
      saveLabel="Save"
      error={error}
      maxWidth={720}
    >
      <Card padding={18}>
        <Field label="Title" required>
          <Input value={form.title} onChange={set("title")} placeholder="e.g. Two passenger elevators for the new wing" autoFocus />
        </Field>
        <div className="fg2">
          <Field label="Account" required>
            <Select value={form.account_id} onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value, contact_id: "" }))}>
              <option value="">— Select account —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Contact">
            <Select value={form.contact_id} onChange={set("contact_id")} disabled={!form.account_id}>
              <option value="">— None —</option>
              {accountContacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
            </Select>
          </Field>
          <Field label="Stage">
            <Select value={form.stage} onChange={set("stage")}>
              {stages.map((s) => <option key={s.value} value={s.value}>{s.label}{s.probability_hint != null ? ` · ${s.probability_hint}%` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Expected close">
            <Input type="date" value={form.expected_close} onChange={set("expected_close")} />
          </Field>
          <Field label="Owner">
            <Select value={form.owner_id} onChange={set("owner_id")}>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</option>)}
            </Select>
          </Field>
          <Field label="Source">
            <Select value={form.source} onChange={set("source")}>
              {OPPORTUNITY_SOURCES.map((s) => <option key={s} value={s}>{OPPORTUNITY_SOURCE_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label="Competitor">
            <Input value={form.competitor} onChange={set("competitor")} placeholder="Who else is quoting" />
          </Field>
        </div>
        <Field label="Description" style={{ marginBottom: 0 }}>
          <Textarea value={form.description} onChange={set("description")} placeholder="What the customer wants, and why now" />
        </Field>
      </Card>
    </ObjectFormPage>
  );
}
