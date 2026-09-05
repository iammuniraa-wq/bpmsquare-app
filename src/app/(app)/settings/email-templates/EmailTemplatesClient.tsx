"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import type { EmailTemplate, EmailTemplateCategory } from "@/lib/types";
import { EMAIL_TEMPLATE_VARS, DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates";

const CATEGORY_LABEL: Record<EmailTemplateCategory, string> = {
  quote: "Quotations",
  invoice: "Invoices",
  report: "Inspection reports",
  rfq: "Supplier RFQs",
};

// Only "quote" actually sends an email today -- the others are here so a
// tenant can prepare templates ahead of those features shipping.
const CATEGORY_WIRED: Record<EmailTemplateCategory, boolean> = {
  quote: true,
  invoice: true,
  report: false,
  rfq: true,
};

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "8px 10px", borderRadius: 7,
  border: `1px solid ${c.line}`, fontSize: 13,
  background: c.panel, color: c.ink, outline: "none", fontFamily: "inherit",
};
const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "block",
};

type DraftTemplate = { id: string; name: string; subject: string; body: string; is_default: boolean; category: EmailTemplateCategory; isNew?: boolean };

function TemplateCard({ template, onSaved, onDeleted }: {
  template: DraftTemplate;
  onSaved: (t: EmailTemplate) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const dirty = name !== template.name || subject !== template.subject || body !== template.body;

  async function save() {
    if (!name.trim() || !subject.trim() || !body.trim()) { setError("Name, subject and body are all required."); return; }
    setError("");
    setSaving(true);
    const res = template.isNew
      ? await fetch("/api/settings/email-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, subject, body, category: template.category, is_default: template.is_default }),
        })
      : await fetch(`/api/settings/email-templates/${template.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, subject, body }),
        });
    setSaving(false);
    if (res.ok) { onSaved(await res.json()); }
    else { const j = await res.json().catch(() => ({})); setError(j.error ?? "Failed to save"); }
  }

  async function makeDefault() {
    if (template.isNew) return; // must be saved first
    const res = await fetch(`/api/settings/email-templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: true }),
    });
    if (res.ok) onSaved(await res.json());
  }

  async function remove() {
    if (template.isNew) { onDeleted(template.id); return; }
    setDeleting(true);
    const res = await fetch(`/api/settings/email-templates/${template.id}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok || res.status === 204) onDeleted(template.id);
  }

  return (
    <div style={{ ...cardStyle, padding: "14px 16px", marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Template name</label>
          <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard, Follow-up" />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: c.muted, cursor: template.isNew ? "default" : "pointer", paddingBottom: 8, opacity: template.isNew ? 0.5 : 1 }}>
            <input type="radio" checked={template.is_default} onChange={makeDefault} disabled={template.isNew} style={{ cursor: template.isNew ? "default" : "pointer" }} />
            Default
          </label>
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <label style={lbl}>Subject</label>
        <input style={inp} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={lbl}>Body</label>
        <textarea style={{ ...inp, minHeight: 100, resize: "vertical", lineHeight: 1.5 }} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      {error && <div style={{ fontSize: 12, color: "var(--err-ink)", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button" onClick={save} disabled={saving || (!dirty && !template.isNew)}
          style={{ padding: "6px 16px", borderRadius: 7, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 12.5, cursor: "pointer", opacity: saving || (!dirty && !template.isNew) ? 0.5 : 1 }}
        >
          {saving ? "Saving…" : template.isNew ? "Create" : "Save"}
        </button>
        <button
          type="button" onClick={remove} disabled={deleting}
          style={{ padding: "6px 16px", borderRadius: 7, border: `1px solid var(--err-line)`, background: "transparent", color: "var(--err-ink)", fontSize: 12.5, cursor: "pointer" }}
        >
          {deleting ? "Removing…" : "Delete"}
        </button>
      </div>
    </div>
  );
}

export default function EmailTemplatesClient({ initial }: { initial: EmailTemplate[] }) {
  const [templates, setTemplates] = useState<EmailTemplate[]>(initial);
  const [drafts, setDrafts] = useState<DraftTemplate[]>([]);
  const [category, setCategory] = useState<EmailTemplateCategory>("quote");

  const categoryTemplates = templates.filter((t) => t.category === category);
  const categoryDrafts = drafts.filter((d) => d.category === category);
  const vars = EMAIL_TEMPLATE_VARS[category];

  function addDraft() {
    const fallback = DEFAULT_EMAIL_TEMPLATES[category];
    setDrafts((p) => [...p, {
      id: `draft-${Date.now()}`, name: "", subject: fallback.subject, body: fallback.body,
      is_default: templates.filter((t) => t.category === category).length === 0,
      category, isNew: true,
    }]);
  }

  function handleSaved(idOrDraftId: string, saved: EmailTemplate) {
    setDrafts((p) => p.filter((d) => d.id !== idOrDraftId));
    setTemplates((p) => {
      const withoutOldDefault = saved.is_default ? p.map((t) => t.category === saved.category ? { ...t, is_default: false } : t) : p;
      const idx = withoutOldDefault.findIndex((t) => t.id === saved.id);
      if (idx >= 0) { const next = [...withoutOldDefault]; next[idx] = saved; return next; }
      return [...withoutOldDefault, saved];
    });
  }

  function handleDeleted(id: string) {
    setDrafts((p) => p.filter((d) => d.id !== id));
    setTemplates((p) => p.filter((t) => t.id !== id));
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {(Object.keys(CATEGORY_LABEL) as EmailTemplateCategory[]).map((cat) => (
          <button
            key={cat} type="button" onClick={() => setCategory(cat)}
            style={{
              fontSize: 12.5, fontWeight: 600, padding: "6px 14px", borderRadius: 20, cursor: "pointer",
              border: `1px solid ${category === cat ? c.accent : c.line}`,
              background: category === cat ? c.accentbg : c.panel,
              color: category === cat ? c.accent : c.muted,
            }}
          >
            {CATEGORY_LABEL[cat]}{!CATEGORY_WIRED[cat] && <span style={{ opacity: 0.6 }}> (not live yet)</span>}
          </button>
        ))}
      </div>

      <div style={{ ...cardStyle, padding: "14px 16px", marginBottom: 16, background: c.panel2 }}>
        <div style={{ fontSize: 12, color: c.muted, marginBottom: 6 }}>
          Available placeholders for {CATEGORY_LABEL[category].toLowerCase()} — used as <code>{"{{name}}"}</code> in subject or body:
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {vars.map((v) => (
            <code key={v.key} title={v.label} style={{ fontSize: 11.5, background: c.panel, border: `1px solid ${c.line}`, borderRadius: 5, padding: "2px 7px", color: c.ink }}>
              {`{{${v.key}}}`}
            </code>
          ))}
        </div>
      </div>

      {categoryTemplates.length === 0 && categoryDrafts.length === 0 && (
        <div style={{ fontSize: 13, color: c.hint, padding: "20px 0", textAlign: "center" }}>
          No templates yet — sending will use a built-in default until you add one.
        </div>
      )}

      {categoryTemplates.map((t) => (
        <TemplateCard
          key={t.id}
          template={t}
          onSaved={(saved) => handleSaved(t.id, saved)}
          onDeleted={handleDeleted}
        />
      ))}
      {categoryDrafts.map((d) => (
        <TemplateCard
          key={d.id}
          template={d}
          onSaved={(saved) => handleSaved(d.id, saved)}
          onDeleted={handleDeleted}
        />
      ))}

      <button
        type="button" onClick={addDraft}
        style={{ padding: "8px 16px", borderRadius: 7, border: `1px solid ${c.line}`, background: c.panel, color: c.accent, fontWeight: 600, fontSize: 13, cursor: "pointer" }}
      >
        + Add template
      </button>
    </div>
  );
}
