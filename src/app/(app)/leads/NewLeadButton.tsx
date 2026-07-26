"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";

type AccountLite = { id: string; name: string };

const SOURCES: { value: string; label: string }[] = [
  { value: "direct", label: "Direct" },
  { value: "oem_referral", label: "OEM Referral" },
  { value: "amc", label: "AMC" },
];

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 8,
  padding: "8px 12px", fontSize: 13, color: c.ink, background: c.panel, outline: "none",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: c.muted,
  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
};

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
      <button
        onClick={() => setOpen(true)}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c.accent, color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}
      >
        + New lead
      </button>

      {open && (
        <div
          onClick={() => { setOpen(false); reset(); }}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,32,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: c.panel, borderRadius: 12, padding: 22, width: 420, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: c.ink, marginBottom: 16 }}>New lead</div>

            <div style={{ marginBottom: 12, position: "relative" }}>
              <label style={lbl}>Account</label>
              {selectedAccount ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", ...inp }}>
                  <span>{selectedAccount.name}</span>
                  <button onClick={() => setAccountId(null)} style={{ background: "none", border: "none", color: c.hint, cursor: "pointer", fontSize: 13 }}>×</button>
                </div>
              ) : (
                <input style={inp} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accounts by name…" autoFocus />
              )}
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

            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Title</label>
              <input style={inp} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ring-frame motor burnt — rewind enquiry" />
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={lbl}>Source</label>
              <select style={inp} value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            {error && <div style={{ fontSize: 12.5, color: "#dc2626", marginBottom: 12 }}>{error}</div>}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => { setOpen(false); reset(); }} style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${c.line}`, background: "#fff", color: c.muted, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: saving ? "not-allowed" : "pointer" }}>
                {saving ? "Saving…" : "Create lead"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
