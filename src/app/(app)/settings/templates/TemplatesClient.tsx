"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TextFragment, FragmentCategory } from "@/lib/types";
import { c } from "@/lib/theme";
import Pill from "@/components/Pill";
import type { PillarKey } from "@/lib/theme";

const CAT_LABEL: Record<FragmentCategory, string> = {
  line_item: "Line item descriptions", notes: "Note templates", terms: "Terms & conditions", sow: "Scope of work",
};
const CAT_TONE: Record<FragmentCategory, PillarKey> = {
  line_item: "blue", notes: "teal", terms: "amber", sow: "purple",
};
const CAT_DESC: Record<FragmentCategory, string> = {
  line_item: "Pre-written scope descriptions for quotation line items",
  notes:     "Reusable notes — copper clauses, warranty, transport, special conditions",
  terms:     "Standard T&C presets — payment terms, AMC, emergency callout",
  sow:       "Scope of work templates — link to SOW entries on quotations",
};
const CATEGORIES: FragmentCategory[] = ["line_item", "notes", "terms", "sow"];

const inputSt: React.CSSProperties = {
  border: `1px solid ${c.line}`, borderRadius: 7,
  padding: "7px 9px", fontSize: 12.5, width: "100%", boxSizing: "border-box", color: c.ink,
};

function AddRow({ onAdd }: { onAdd: (f: TextFragment) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ label: "", category: "line_item" as FragmentCategory, text: "" });
  const [err, setErr] = useState("");

  function set(k: string, v: string) { setForm((p) => ({ ...p, [k]: v })); }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label || !form.text) { setErr("Label and text are required"); return; }
    setErr("");
    startTransition(async () => {
      const res = await fetch("/api/settings/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) { setErr(json.error ?? "Failed"); return; }
      onAdd(json);
      setForm({ label: "", category: "line_item", text: "" });
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, background: c.accent, color: "#fff", border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
        + New template
      </button>
    );
  }

  return (
    <form onSubmit={submit} style={{ background: "#f8fafc", border: `1px solid ${c.line}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: c.ink }}>New text template</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 10, marginBottom: 10 }}>
        <div>
          <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 3 }}>Label *</label>
          <input style={inputSt} value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="e.g. Copper price clause" />
        </div>
        <div>
          <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 3 }}>Category</label>
          <select style={{ ...inputSt, height: 34 }} value={form.category} onChange={(e) => set("category", e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: c.muted, display: "block", marginBottom: 3 }}>Text *</label>
        <textarea
          style={{ ...inputSt, height: 90, resize: "vertical", lineHeight: 1.6 }}
          value={form.text}
          onChange={(e) => set("text", e.target.value)}
          placeholder="Enter the template text…"
        />
      </div>
      {err && <div style={{ fontSize: 12, color: "#dc2626", marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={pending} style={{ padding: "7px 20px", borderRadius: 7, background: c.accent, color: "#fff", border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={{ padding: "7px 16px", borderRadius: 7, background: "#f1f5f9", color: c.muted, border: "none", fontSize: 13, cursor: "pointer" }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function FragmentRow({ frag, onUpdate, onDelete }: { frag: TextFragment; onUpdate: (f: TextFragment) => void; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({ label: frag.label, text: frag.text });

  function set(k: string, v: string) { setForm((p) => ({ ...p, [k]: v })); }

  function save() {
    startTransition(async () => {
      const res = await fetch(`/api/settings/templates/${frag.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (res.ok) { onUpdate(json); setEditing(false); }
    });
  }

  function del() {
    if (!window.confirm("Delete this template?")) return;
    startTransition(async () => {
      await fetch(`/api/settings/templates/${frag.id}`, { method: "DELETE" });
      onDelete(frag.id);
    });
  }

  if (editing) {
    return (
      <div style={{ padding: "12px 0", borderTop: `1px solid ${c.line}` }}>
        <input style={{ ...inputSt, marginBottom: 8 }} value={form.label} onChange={(e) => set("label", e.target.value)} />
        <textarea style={{ ...inputSt, height: 80, resize: "vertical", marginBottom: 8, lineHeight: 1.6 }} value={form.text} onChange={(e) => set("text", e.target.value)} />
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={save} disabled={pending} style={{ fontSize: 12, padding: "5px 14px", borderRadius: 6, background: c.accent, color: "#fff", border: "none", cursor: "pointer" }}>
            {pending ? "…" : "Save"}
          </button>
          <button onClick={() => setEditing(false)} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6, background: "#f1f5f9", color: c.muted, border: "none", cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "14px 0", borderTop: `1px solid ${c.line}`, display: "grid", gridTemplateColumns: "180px 1fr 80px", gap: 16, alignItems: "start" }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: c.ink }}>{frag.label}</div>
      <div style={{ fontSize: 12.5, color: c.muted, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{frag.text}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <button onClick={() => setEditing(true)} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 6, background: c.accentbg, color: c.accent, border: "none", cursor: "pointer" }}>Edit</button>
        <button onClick={del} disabled={pending} style={{ fontSize: 11, padding: "3px 9px", borderRadius: 6, background: "#fef2f2", color: "#dc2626", border: "none", cursor: "pointer" }}>Delete</button>
      </div>
    </div>
  );
}

export default function TemplatesClient({ initialFragments }: { initialFragments: TextFragment[] }) {
  const router = useRouter();
  const [fragments, setFragments] = useState(initialFragments);

  const add = (f: TextFragment) => { setFragments((p) => [...p, f]); router.refresh(); };
  const update = (f: TextFragment) => setFragments((p) => p.map((x) => x.id === f.id ? f : x));
  const remove = (id: string) => setFragments((p) => p.filter((x) => x.id !== id));

  return (
    <>
      <AddRow onAdd={add} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {CATEGORIES.map((cat) => {
          const catFrags = fragments.filter((f) => f.category === cat);
          return (
            <section key={cat} style={{ background: "#fff", border: `1px solid ${c.line}`, borderRadius: 12, padding: 16 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <Pill label={CAT_LABEL[cat]} tone={CAT_TONE[cat]} />
                  <span style={{ fontSize: 12, color: c.hint }}>{catFrags.length} templates</span>
                </div>
                <p style={{ fontSize: 12, color: c.muted, margin: 0 }}>{CAT_DESC[cat]}</p>
              </div>
              {catFrags.length === 0 && (
                <div style={{ fontSize: 12.5, color: c.hint, padding: "8px 0" }}>No templates yet.</div>
              )}
              {catFrags.map((frag) => (
                <FragmentRow key={frag.id} frag={frag} onUpdate={update} onDelete={remove} />
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
