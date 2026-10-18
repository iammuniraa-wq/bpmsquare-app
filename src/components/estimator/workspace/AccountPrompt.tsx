"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import AccountPicker from "@/components/estimator/AccountPicker";
import type { AccountOption, ContactOption } from "@/components/estimator/AccountPicker";

/**
 * A quote belongs to an account, and nothing here invents one. When Create quote
 * is pressed with none chosen, the person picks an existing account or, with a
 * clear click, creates one from the customer's name.
 */
export default function AccountPrompt({
  accounts, contacts, accountId, contactId, customer, onAccount, onContact, onCreated, onContinue, onCancel,
}: {
  accounts: AccountOption[];
  contacts: ContactOption[];
  accountId: string;
  contactId: string;
  customer: string;
  onAccount: (id: string) => void;
  onContact: (id: string) => void;
  onCreated: (account: AccountOption) => void;
  onContinue: (accountId: string) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = customer.trim();
  const short = name.length > 28 ? `${name.slice(0, 27)}…` : name;

  async function createAccount() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, type: "prospect" }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Could not create the account."); return; }
      onCreated({ id: json.id, name: json.name });
      onContinue(json.id as string);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label="Choose the account for the quote" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, background: "var(--panel2)" }}>
      <div className="bpm-t-label" style={{ marginBottom: 4 }}>Which account is this quote for?</div>
      <p className="bpm-t-help" style={{ margin: "0 0 10px" }}>
        A quote belongs to an account (your record of the customer). Choose one{name ? `, or create a new account called "${name}"` : ""}. Nothing is created until you press a button.
      </p>
      <AccountPicker accounts={accounts} contacts={contacts} accountId={accountId} contactId={contactId} onAccount={onAccount} onContact={onContact} />
      {error && <div role="alert" style={{ color: "var(--err-ink)", fontSize: 13, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button variant="primary" size="sm" disabled={!accountId || busy} onClick={() => onContinue(accountId)}>Use this account and create the quote</Button>
        <Button variant="secondary" size="sm" loading={busy} disabled={!name || busy} onClick={createAccount}>
          {name ? `Create account "${short}" and continue` : "Name the customer to create an account"}
        </Button>
        <Button variant="quiet" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
