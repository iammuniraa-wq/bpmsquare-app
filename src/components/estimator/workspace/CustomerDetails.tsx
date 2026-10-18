"use client";

import { useState } from "react";
import Field from "@/components/ui/Field";
import { Textarea } from "@/components/ui/Input";
import CreateExtraFields from "@/components/fields/CreateExtraFields";
import AccountPicker from "@/components/estimator/AccountPicker";
import type { AccountOption, ContactOption } from "@/components/estimator/AccountPicker";
import type { EstimateDraft } from "./useEstimateDraft";

const STANDARD_KEYS = ["ref", "name", "status", "currency", "margin_pct", "notes"];

/** Collapsed under the inputs: the account and contact the quote will belong to, notes, and the workspace's own fields. */
export default function CustomerDetails({
  draft, accounts, contacts, disabled,
}: {
  draft: EstimateDraft;
  accounts: AccountOption[];
  contacts: ContactOption[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(!!draft.accountId);
  return (
    <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>Customer details</summary>
      <div style={{ marginTop: 12 }}>
        <p className="bpm-t-help" style={{ margin: "0 0 10px" }}>The quote belongs to an account. You can also choose it when you create the quote.</p>
        <AccountPicker accounts={accounts} contacts={contacts} accountId={draft.accountId} contactId={draft.contactId}
          onAccount={draft.setAccountId} onContact={draft.setContactId} disabled={disabled} />
        <Field label="Notes" style={{ marginBottom: 12 }}>
          <Textarea value={draft.notes} onChange={(e) => draft.setNotes(e.target.value)} maxLength={5000} rows={3} placeholder="Assumptions, exclusions, who asked…" disabled={disabled} />
        </Field>
        <CreateExtraFields
          objectType="estimate"
          exclude={STANDARD_KEYS}
          values={draft.customData}
          onChange={(key, value, kind) => { if (kind === "custom") draft.setCustomData((d) => ({ ...d, [key]: value })); }}
        />
      </div>
    </details>
  );
}
