"use client";

import { useState, useTransition } from "react";
import { useFeel } from "@/components/FeelProvider";
import { useRouter } from "next/navigation";
import type { TextFragment, FragmentCategory } from "@/lib/types";
import { c } from "@/lib/theme";
import Pill from "@/components/Pill";
import type { PillarKey } from "@/lib/theme";
import Button from "@/components/ui/Button";
import MoreMenu from "@/components/ui/MoreMenu";
import EmptyState from "@/components/ui/EmptyState";
import { SettingsHeaderActions } from "@/components/settings/SettingsHeaderActions";

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

function AddRow({ open, setOpen, onAdd }: { open: boolean; setOpen: (v: boolean) => void; onAdd: (f: TextFragment) => void }) {
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

  if (!open) return null;

  return (
    <form onSubmit={submit} style={{ background: "var(--panel2)", border: `1px solid ${c.line}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
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
      {err && <div style={{ fontSize: 12, color: "var(--err-ink)", marginBottom: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <Button type="submit" variant="primary" loading={pending}>{pending ? "Saving…" : "Save"}</Button>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
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

  const { confirm } = useFeel();
  async function del() {
    if (!(await confirm({ title: "Delete this template?", body: "Text already inserted into a quote from it stays as it is.", tone: "danger" }))) return;
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
          <Button size="sm" variant="primary" onClick={save} loading={pending}>Save</Button>
          <Button size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="row-grid" style={{ padding: "14px 0", borderTop: `1px solid ${c.line}`, display: "grid", gridTemplateColumns: "180px 1fr auto", gap: 16, alignItems: "start" }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: c.ink }}>{frag.label}</div>
      <div style={{ fontSize: 12.5, color: c.muted, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{frag.text}</div>
      <MoreMenu
        label={`Actions for ${frag.label}`}
        items={[
          { label: "Edit", onSelect: () => setEditing(true) },
          { label: "Delete", onSelect: () => { void del(); }, danger: true },
        ]}
      />
    </div>
  );
}

export default function TemplatesClient({ initialFragments }: { initialFragments: TextFragment[] }) {
  const router = useRouter();
  const [fragments, setFragments] = useState(initialFragments);
  const [adding, setAdding] = useState(false);

  const add = (f: TextFragment) => { setFragments((p) => [...p, f]); router.refresh(); };
  const update = (f: TextFragment) => setFragments((p) => p.map((x) => x.id === f.id ? f : x));
  const remove = (id: string) => setFragments((p) => p.filter((x) => x.id !== id));

  return (
    <>
      <SettingsHeaderActions>
        <Button variant="primary" onClick={() => setAdding(true)}>+ New template</Button>
      </SettingsHeaderActions>
      <AddRow open={adding} setOpen={setAdding} onAdd={add} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {CATEGORIES.map((cat) => {
          const catFrags = fragments.filter((f) => f.category === cat);
          return (
            <section key={cat} style={{ background: "var(--panel)", border: `1px solid ${c.line}`, borderRadius: 12, padding: 16 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <Pill label={CAT_LABEL[cat]} tone={CAT_TONE[cat]} />
                  <span style={{ fontSize: 12, color: c.hint }}>{catFrags.length} templates</span>
                </div>
                <p style={{ fontSize: 12, color: c.muted, margin: 0 }}>{CAT_DESC[cat]}</p>
              </div>
              {catFrags.length === 0 && (
                <EmptyState title="No templates yet" text="Use + New template to add one." />
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
