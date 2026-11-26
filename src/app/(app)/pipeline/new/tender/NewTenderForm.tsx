"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { OPPORTUNITY_SOURCES, OPPORTUNITY_SOURCE_LABEL } from "@/lib/sales/opportunity";
import { TENDER_PORTALS, TENDER_PORTAL_LABEL, suggestedTenderTitle } from "@/lib/tender/rules";
import { useCurrency } from "@/lib/tenant-context";
import { TENDER_TIPS } from "@/lib/tender/tips";
import ObjectFormPage from "@/components/page/ObjectFormPage";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";

/**
 * New tender: the account and the deal's title, then what a tender starts with (number, issuer, portal, bid end date, source), plus
 * an optional contact and expected value. The deal and its tender details are made together by POST /api/opportunities/tender;
 * everything else is filled in on the deal.
 */
export default function NewTenderForm({ accounts, contacts = [] }: { accounts: { id: string; name: string }[]; contacts?: { id: string; name: string; account_id: string }[] }) {
  const router = useRouter();
  const cur = useCurrency();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [form, setForm] = useState({ account_id: "", title: "", contact_id: "", amount: "", tender_no: "", issuer_name: "", portal: "", closing_at: "", source: "direct" });
  const [titleEdited, setTitleEdited] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const accountName = accounts.find((a) => a.id === form.account_id)?.name ?? "";
  const title = titleEdited ? form.title : suggestedTenderTitle({ issuer: form.issuer_name, accountName });
  const accountContacts = contacts.filter((x) => x.account_id === form.account_id);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.account_id) { setError("Pick the account"); return; }
    if (!title.trim()) { setError("Give the tender a title"); return; }
    if (form.amount.trim() && !(Number(form.amount) >= 0)) { setError("The expected value must be a number, zero or more"); return; }
    setError("");
    startTransition(async () => {
      // The browser's datetime-local value has no zone: read it as the person's own time and send the instant.
      const closing = form.closing_at ? new Date(form.closing_at) : null;
      if (closing && Number.isNaN(closing.getTime())) { setError("The bid end date is not a valid date and time"); return; }
      const res = await fetch("/api/opportunities/tender", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: form.account_id, source: form.source, title: title.trim(),
          contact_id: form.contact_id || undefined, amount: form.amount.trim() ? Number(form.amount) : undefined,
          tender: {
            tender_no: form.tender_no, issuer_name: form.issuer_name, portal: form.portal || null,
            closing_at: closing ? closing.toISOString() : null,
          },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not create the tender"); return; }
      router.push(ROUTES.pipelineDetail(j.id));
    });
  }

  return (
    <ObjectFormPage
      backHref={`${ROUTES.pipeline}?tab=tenders`}
      backLabel="Tenders"
      title="New tender"
      onSubmit={submit}
      saving={pending}
      saveLabel="Save"
      error={error}
      maxWidth={720}
    >
      <Card padding={18} title="New tender" info={TENDER_TIPS.newTender}>
        <div className="fg2">
          <Field label="Account" required guide="tender.field.account">
            <Select value={form.account_id} onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, account_id: v, contact_id: "" })); }} autoFocus>
              <option value="">— Select account —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Title" required info={TENDER_TIPS.title} guide="tender.field.title">
            <Input value={title} onChange={(e) => { setTitleEdited(true); setForm((f) => ({ ...f, title: e.target.value })); }} maxLength={200} placeholder="e.g. Saudi Aramco tender" />
          </Field>
          <Field label="Contact" info={TENDER_TIPS.contact} guide="tender.field.contact">
            <Select value={form.contact_id} onChange={set("contact_id")} disabled={!form.account_id}>
              <option value="">{!form.account_id ? "— Pick the account first —" : accountContacts.length ? "— Not set —" : "— No contacts on this account —"}</option>
              {accountContacts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label={`Expected value (${cur.code})`} info={TENDER_TIPS.expectedValue} guide="tender.field.amount">
            <Input type="number" inputMode="decimal" min={0} step="any" value={form.amount} onChange={set("amount")} placeholder="Optional" />
          </Field>
          <Field label="Tender number" info={TENDER_TIPS.tenderNo} guide="tender.field.tender_no">
            <Input value={form.tender_no} onChange={set("tender_no")} maxLength={60} placeholder="e.g. ARB-4400123" />
          </Field>
          <Field label="Issuer" info={TENDER_TIPS.issuer} guide="tender.field.issuer">
            <Input value={form.issuer_name} onChange={set("issuer_name")} maxLength={200} placeholder="e.g. Saudi Aramco" />
          </Field>
          <Field label="Portal" info={TENDER_TIPS.portal} guide="tender.field.portal">
            <Select value={form.portal} onChange={set("portal")}>
              <option value="">— Not set —</option>
              {TENDER_PORTALS.map((p) => <option key={p} value={p}>{TENDER_PORTAL_LABEL[p]}</option>)}
            </Select>
          </Field>
          <Field label="Bid end date" info={TENDER_TIPS.closing} guide="tender.field.closing">
            <Input type="datetime-local" value={form.closing_at} onChange={set("closing_at")} />
          </Field>
          <Field label="Source" info={TENDER_TIPS.source} guide="tender.field.source">
            <Select value={form.source} onChange={set("source")}>
              {OPPORTUNITY_SOURCES.map((s) => <option key={s} value={s}>{OPPORTUNITY_SOURCE_LABEL[s]}</option>)}
            </Select>
          </Field>
        </div>
      </Card>
    </ObjectFormPage>
  );
}
