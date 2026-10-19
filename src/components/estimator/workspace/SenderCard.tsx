"use client";

import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import type { SenderInfo } from "@/lib/estimator/ai";
import type { AccountOption, ContactOption } from "@/components/estimator/AccountPicker";
import { matchSender, senderAccountName } from "./senderMatch";

/**
 * Appears after an email is read: who it came from, and whether BPMSquare already
 * has them. Found: use them. Not found: create the account and the contact from
 * the email, on a click. Nothing is created until a button is pressed.
 */
export default function SenderCard({
  sender, accounts, contacts, disabled, onUse, onAccountCreated, onContactCreated,
}: {
  sender: SenderInfo;
  accounts: AccountOption[];
  contacts: ContactOption[];
  disabled: boolean;
  onUse: (accountId: string, contactId: string) => void;
  onAccountCreated: (account: AccountOption) => void;
  onContactCreated: (contact: ContactOption) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const { account, contact } = useMemo(() => matchSender(sender, accounts, contacts), [sender, accounts, contacts]);
  const accountName = senderAccountName(sender);
  if (dismissed || !accountName) return null;

  async function post(url: string, body: Record<string, unknown>): Promise<{ id: string; name: string }> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Could not create it.");
    return { id: json.id as string, name: (json.name as string) ?? "" };
  }

  async function createContactIn(accountId: string): Promise<string> {
    const person = sender.contact_name;
    if (!person) return "";
    const c = await post("/api/contacts", { account_id: accountId, name: person, email: sender.email, phone: sender.phone });
    onContactCreated({ id: c.id, name: c.name || person, account_id: accountId });
    return c.id;
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await fn(); } catch (e) { setError((e as Error).message || "Network error. Try again."); } finally { setBusy(false); }
  }

  const createBoth = () => run(async () => {
    const a = await post("/api/accounts", { name: accountName, type: "prospect" });
    onAccountCreated({ id: a.id, name: a.name || accountName });
    onUse(a.id, await createContactIn(a.id));
  });
  const addContact = () => run(async () => {
    if (!account) return;
    onUse(account.id, await createContactIn(account.id));
  });

  const facts = [sender.contact_name, sender.company, sender.email, sender.phone].filter(Boolean).join(" · ");
  const status = account
    ? contact
      ? `Already in BPMSquare: the account "${account.name}" and the contact "${contact.name}".`
      : `The account "${account.name}" is already in BPMSquare${sender.contact_name ? `, but "${sender.contact_name}" is not one of its contacts yet` : ""}.`
    : "Not in BPMSquare yet. Nothing is created until you press a button.";
  const both = !!sender.contact_name && sender.contact_name !== accountName;

  return (
    <div role="group" aria-label="Who this email is from" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, background: "var(--panel2)" }}>
      <div className="bpm-t-label" style={{ marginBottom: 4 }}>From this email</div>
      <p style={{ margin: "0 0 4px", fontSize: 14 }}>{facts}</p>
      <p className="bpm-t-help" style={{ margin: "0 0 10px" }}>{status}</p>
      {error && <div role="alert" style={{ color: "var(--err-ink)", fontSize: 13, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {account ? (
          <>
            <Button variant="primary" size="sm" disabled={disabled || busy} onClick={() => onUse(account.id, contact?.id ?? "")}>
              {contact ? "Use them" : "Use this account"}
            </Button>
            {!contact && sender.contact_name && (
              <Button variant="secondary" size="sm" loading={busy} disabled={disabled || busy} onClick={addContact}>
                Add {sender.contact_name} as a contact
              </Button>
            )}
          </>
        ) : (
          <Button variant="primary" size="sm" loading={busy} disabled={disabled || busy} onClick={createBoth}>
            {both ? "Create the account and the contact" : "Create the account"}
          </Button>
        )}
        <Button variant="quiet" size="sm" disabled={busy} onClick={() => setDismissed(true)}>Not now</Button>
      </div>
    </div>
  );
}
