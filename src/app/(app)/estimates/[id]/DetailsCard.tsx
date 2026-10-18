"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { useRecordEdit } from "@/components/page/RecordEditContext";
import AccountPicker, { type AccountOption, type ContactOption } from "@/components/estimator/AccountPicker";

type Props = {
  id: string;
  name: string;
  notes: string | null;
  status: string;
  accountId: string | null;
  accountName: string | null;
  contactId: string | null;
  contactName: string | null;
  templateName: string | null;
  templateVersion: number | null;
  templateOutdated: boolean;
  currency: string | null;
  marginPct: number;
  createdLabel: string;
  canEdit: boolean;
  /** The estimate has a quote: its account and numbers are fixed. */
  locked: boolean;
  /** Only supplied when the editor can be used. */
  accounts: AccountOption[];
  contacts: ContactOption[];
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, padding: "7px 0", borderTop: `1px solid ${c.line}` }}>
      <span style={{ color: c.hint, flexShrink: 0 }}>{label}</span>
      <span style={{ color: c.ink, textAlign: "right", wordBreak: "break-word", minWidth: 0 }}>{children}</span>
    </div>
  );
}

export default function DetailsCard(p: Props) {
  const router = useRouter();
  const recordEdit = useRecordEdit();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [name, setName] = useState(p.name);
  const [notes, setNotes] = useState(p.notes ?? "");
  const [accountId, setAccountId] = useState(p.accountId ?? "");
  const [contactId, setContactId] = useState(p.contactId ?? "");
  const [status, setStatus] = useState(p.status);

  function begin() {
    setName(p.name); setNotes(p.notes ?? ""); setAccountId(p.accountId ?? ""); setContactId(p.contactId ?? ""); setError("");
    setEditing(true);
  }

  useEffect(() => {
    if (recordEdit?.pending && p.canEdit) { begin(); recordEdit.consume(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordEdit?.pending]);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/estimates/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error ?? "Could not save."); return false; }
    return true;
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Name can't be empty."); return; }
    setError("");
    startTransition(async () => {
      const body: Record<string, unknown> = { name: name.trim(), notes: notes.trim() || null };
      if (!p.locked) { body.account_id = accountId || null; body.contact_id = contactId || null; }
      if (await patch(body)) { setEditing(false); router.refresh(); }
    });
  }

  function changeStatus(next: string) {
    const prev = status;
    setStatus(next);
    setError("");
    startTransition(async () => {
      if (await patch({ status: next })) router.refresh();
      else setStatus(prev);
    });
  }

  const statusChoices = p.status === "quoted"
    ? [["quoted", "Quoted (set by the quote)"], ["won", "Won"], ["lost", "Lost"]]
    : [["draft", "Draft"], ["won", "Won"], ["lost", "Lost"]];

  return (
    <Card
      title="Details"
      padding={18}
      action={p.canEdit && !editing ? <Button variant="quiet" size="sm" onClick={begin}>Edit</Button> : undefined}
    >
      {editing ? (
        <form onSubmit={save}>
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
          </Field>
          {p.locked ? (
            <div className="bpm-t-help" style={{ marginBottom: 16 }}>The account is fixed because this estimate already has a quote.</div>
          ) : (
            <div className="fg2">
              <AccountPicker accounts={p.accounts} contacts={p.contacts} accountId={accountId} contactId={contactId} onAccount={setAccountId} onContact={setContactId} />
            </div>
          )}
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} rows={4} />
          </Field>
          {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)", marginBottom: 10 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" variant="primary" loading={pending}>Save</Button>
          </div>
        </form>
      ) : (
        <>
          <Row label="Account">
            {p.accountId ? <Link href={ROUTES.account(p.accountId)} style={{ color: c.accent, textDecoration: "none" }}>{p.accountName ?? "Account"}</Link> : "—"}
          </Row>
          <Row label="Contact">{p.contactName ?? "—"}</Row>
          <Row label="Template">
            {p.templateName ? `${p.templateName}${p.templateVersion ? ` (v${p.templateVersion})` : ""}` : "Template deleted"}
          </Row>
          <Row label="Margin">{p.marginPct}%</Row>
          <Row label="Currency">{p.currency ?? "—"}</Row>
          <Row label="Created">{p.createdLabel}</Row>
          <Row label="Status">
            {p.canEdit ? (
              <Select value={status} onChange={(e) => changeStatus(e.target.value)} disabled={pending} aria-label="Status" style={{ width: "auto", minWidth: 160 }}>
                {statusChoices.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            ) : status}
          </Row>
          {p.templateOutdated && (
            <div className="bpm-t-help" style={{ marginTop: 10 }}>
              The template has changed since this estimate was calculated. Use Recalculate with the current template at the top of the page.
            </div>
          )}
          {p.notes && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${c.line}` }}>
              <div className="bpm-t-label" style={{ marginBottom: 4 }}>Notes</div>
              <div style={{ fontSize: 13, color: c.ink, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{p.notes}</div>
            </div>
          )}
          {error && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)", marginTop: 10 }}>{error}</div>}
        </>
      )}
    </Card>
  );
}
