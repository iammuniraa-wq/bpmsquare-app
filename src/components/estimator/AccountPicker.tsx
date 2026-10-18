"use client";

import { useMemo, useState } from "react";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";

export type AccountOption = { id: string; name: string };
export type ContactOption = { id: string; name: string; account_id: string | null };

/**
 * Account (type to narrow the list) and the contacts of that account. Both
 * lists come from the page's own tenant-scoped query; the API verifies the
 * ids again on save.
 */
export default function AccountPicker({
  accounts, contacts, accountId, contactId, onAccount, onContact, disabled = false,
}: {
  accounts: AccountOption[];
  contacts: ContactOption[];
  accountId: string;
  contactId: string;
  onAccount: (id: string) => void;
  onContact: (id: string) => void;
  disabled?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const list = term ? accounts.filter((a) => a.name.toLowerCase().includes(term)) : accounts;
    const picked = accounts.find((a) => a.id === accountId);
    const cut = list.slice(0, 200);
    return picked && !cut.some((a) => a.id === picked.id) ? [picked, ...cut] : cut;
  }, [accounts, filter, accountId]);
  const accountContacts = contacts.filter((ct) => ct.account_id === accountId);

  return (
    <>
      <Field label="Account" hint={accounts.length > 8 ? "Type to narrow the list." : undefined}>
        {accounts.length > 8 && (
          <Input
            type="search" value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="Search accounts…" aria-label="Search accounts" disabled={disabled}
            style={{ marginBottom: 6 }}
          />
        )}
        <Select value={accountId} onChange={(e) => { onAccount(e.target.value); onContact(""); }} disabled={disabled}>
          <option value="">— No account yet —</option>
          {shown.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </Field>
      <Field label="Contact">
        <Select value={contactId} onChange={(e) => onContact(e.target.value)} disabled={disabled || !accountId}>
          <option value="">{accountId ? "— No contact —" : "Choose an account first"}</option>
          {accountContacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
        </Select>
      </Field>
    </>
  );
}
