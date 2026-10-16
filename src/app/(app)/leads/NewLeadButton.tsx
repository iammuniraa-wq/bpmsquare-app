"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";

type AccountLite = { id: string; name: string };

const SOURCES: { value: string; label: string }[] = [
  { value: "direct", label: "Direct" },
  { value: "oem_referral", label: "OEM Referral" },
  { value: "amc", label: "AMC" },
];

/** "+ New Lead": leads are small enough to be created in a dialog rather than on a page. */
export default function NewLeadButton({ accounts }: { accounts: AccountLite[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("direct");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedAccount = useMemo(() => accounts.find((a) => a.id === accountId) ?? null, [accounts, accountId]);
  const searchResults = useMemo(() => {
    if (!search.trim() || selectedAccount) return [];
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 8);
  }, [search, accounts, selectedAccount]);

  function reset() {
    setSearch(""); setAccountId(null); setTitle(""); setSource("direct"); setError("");
  }

  async function save() {
    if (!accountId) { setError("Pick an account."); return; }
    if (!title.trim()) { setError("Give this lead a title."); return; }
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, title, source }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create lead");
      setOpen(false);
      reset();
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create lead");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>+ New Lead</Button>

      {open && (
        <div
          onClick={() => { setOpen(false); reset(); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,32,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
        >
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New lead" style={{ width: 420, maxWidth: "90vw" }}>
            <Card padding={22} title="New lead">
              <div style={{ marginBottom: 16, position: "relative" }}>
                <Field label="Account" style={{ marginBottom: 0 }}>
                  {selectedAccount ? (
                    <div className="bpm-input" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>{selectedAccount.name}</span>
                      <Button variant="quiet" size="sm" iconOnly aria-label="Change account" onClick={() => setAccountId(null)}>×</Button>
                    </div>
                  ) : (
                    <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accounts by name…" autoFocus />
                  )}
                </Field>
                {searchResults.length > 0 && (
                  <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: c.panel, border: `1px solid ${c.line}`, borderRadius: 8, marginTop: 4, boxShadow: "0 8px 24px rgba(0,0,0,.1)", overflow: "hidden", maxHeight: 200, overflowY: "auto" }}>
                    {searchResults.map((a) => (
                      <div key={a.id} onClick={() => { setAccountId(a.id); setSearch(""); }} style={{ padding: "8px 12px", fontSize: 13, color: c.ink, cursor: "pointer", borderBottom: `1px solid ${c.line}` }}>
                        {a.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Field label="Title">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ring-frame motor burnt — rewind enquiry" />
              </Field>

              <Field label="Source">
                <Select value={source} onChange={(e) => setSource(e.target.value)}>
                  {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
              </Field>

              {error && <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)", marginBottom: 12 }}>{error}</div>}

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <Button variant="secondary" onClick={() => { setOpen(false); reset(); }}>Cancel</Button>
                <Button variant="primary" onClick={save} loading={saving}>{saving ? "Saving…" : "Save"}</Button>
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
