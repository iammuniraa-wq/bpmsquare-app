"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES, type OpportunityStageDef } from "@/lib/constants";
import { OPPORTUNITY_SOURCES, OPPORTUNITY_SOURCE_LABEL } from "@/lib/sales/opportunity";

const lbl: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5 };
const inp: React.CSSProperties = { width: "100%", padding: "9px 12px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8, background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box" };
const fw: React.CSSProperties = { marginBottom: 16 };

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
    <div style={{ maxWidth: 680 }}>
      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.pipeline} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>← Pipeline</Link>
      </div>
      <h1 style={{ fontSize: 19, fontWeight: 700, color: c.ink, margin: "0 0 4px" }}>New deal</h1>
      <p style={{ fontSize: 12.5, color: c.muted, margin: "0 0 16px" }}>A pursuit with a customer. Lines, pricing and quotes come next, on the deal itself.</p>

      <form onSubmit={submit} style={{ ...cardStyle, padding: 20 }}>
        <div style={fw}>
          <label style={lbl}>Title *</label>
          <input style={inp} value={form.title} onChange={set("title")} placeholder="e.g. Two passenger elevators for the new wing" autoFocus />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={fw}>
            <label style={lbl}>Account *</label>
            <select style={inp} value={form.account_id} onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value, contact_id: "" }))}>
              <option value="">— Select account —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div style={fw}>
            <label style={lbl}>Contact</label>
            <select style={inp} value={form.contact_id} onChange={set("contact_id")} disabled={!form.account_id}>
              <option value="">— None —</option>
              {accountContacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
            </select>
          </div>
          <div style={fw}>
            <label style={lbl}>Stage</label>
            <select style={inp} value={form.stage} onChange={set("stage")}>
              {stages.map((s) => <option key={s.value} value={s.value}>{s.label}{s.probability_hint != null ? ` · ${s.probability_hint}%` : ""}</option>)}
            </select>
          </div>
          <div style={fw}>
            <label style={lbl}>Expected close</label>
            <input style={inp} type="date" value={form.expected_close} onChange={set("expected_close")} />
          </div>
          <div style={fw}>
            <label style={lbl}>Owner</label>
            <select style={inp} value={form.owner_id} onChange={set("owner_id")}>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</option>)}
            </select>
          </div>
          <div style={fw}>
            <label style={lbl}>Source</label>
            <select style={inp} value={form.source} onChange={set("source")}>
              {OPPORTUNITY_SOURCES.map((s) => <option key={s} value={s}>{OPPORTUNITY_SOURCE_LABEL[s]}</option>)}
            </select>
          </div>
          <div style={fw}>
            <label style={lbl}>Competitor</label>
            <input style={inp} value={form.competitor} onChange={set("competitor")} placeholder="Who else is quoting" />
          </div>
        </div>
        <div style={fw}>
          <label style={lbl}>Description</label>
          <textarea style={{ ...inp, minHeight: 70, resize: "vertical" }} value={form.description} onChange={set("description")} placeholder="What the customer wants, and why now" />
        </div>
        {error && <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)", marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="submit" disabled={pending} style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: pending ? "wait" : "pointer" }}>{pending ? "Creating…" : "Create deal"}</button>
          <Link href={ROUTES.pipeline} style={{ padding: "10px 18px", borderRadius: 8, border: `1px solid ${c.line}`, color: c.muted, fontSize: 13, textDecoration: "none" }}>Cancel</Link>
        </div>
      </form>
    </div>
  );
}
