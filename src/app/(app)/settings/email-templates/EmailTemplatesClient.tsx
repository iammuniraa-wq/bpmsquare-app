"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import type { EmailTemplate, EmailTemplateCategory } from "@/lib/types";
import { EMAIL_TEMPLATE_VARS, DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates";
import { useFeel } from "@/components/FeelProvider";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill from "@/components/ui/StatusPill";
import { RecordList, RecordRow } from "@/components/settings/RecordRows";
import { SettingsHeaderActions } from "@/components/settings/SettingsHeaderActions";
import { typeLabel } from "@/lib/typeScale";

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
const lbl: React.CSSProperties = { ...typeLabel, marginBottom: 4, display: "block" };

type DraftTemplate = { id: string; name: string; subject: string; body: string; is_default: boolean; category: EmailTemplateCategory; isNew?: boolean };

function TemplateCard({ template, onSaved, onCancel, bare }: {
  template: DraftTemplate;
  onSaved: (t: EmailTemplate) => void;
  onCancel: () => void;
  /** Inside a list row, which draws its own surface. */
  bare?: boolean;
}) {
  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [saving, setSaving] = useState(false);
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

  return (
    <div style={bare ? { padding: "14px 16px", background: c.panel2, borderTop: `1px solid ${c.line}` } : { ...cardStyle, padding: "14px 16px", marginBottom: 10 }}>
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
        <Button variant="primary" onClick={save} loading={saving} disabled={!dirty && !template.isNew}>
          {saving ? "Saving…" : template.isNew ? "Create" : "Save"}
        </Button>
        <Button onClick={onCancel}>{template.isNew ? "Discard" : "Cancel"}</Button>
      </div>
    </div>
  );
}

export default function EmailTemplatesClient({ initial }: { initial: EmailTemplate[] }) {
  const [templates, setTemplates] = useState<EmailTemplate[]>(initial);
  const [drafts, setDrafts] = useState<DraftTemplate[]>([]);
  const [category, setCategory] = useState<EmailTemplateCategory>("quote");
  const [editingId, setEditingId] = useState<string | null>(null);
  const { confirm } = useFeel();

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
    setEditingId(null);
    setDrafts((p) => p.filter((d) => d.id !== idOrDraftId));
    setTemplates((p) => {
      const withoutOldDefault = saved.is_default ? p.map((t) => t.category === saved.category ? { ...t, is_default: false } : t) : p;
      const idx = withoutOldDefault.findIndex((t) => t.id === saved.id);
      if (idx >= 0) { const next = [...withoutOldDefault]; next[idx] = saved; return next; }
      return [...withoutOldDefault, saved];
    });
  }

  async function makeDefault(t: EmailTemplate) {
    const res = await fetch(`/api/settings/email-templates/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: true }),
    });
    if (res.ok) handleSaved(t.id, await res.json());
  }

  async function deleteTemplate(t: EmailTemplate) {
    if (!(await confirm({ title: `Delete "${t.name}"?`, body: "Emails already sent from it are unaffected.", tone: "danger" }))) return;
    const res = await fetch(`/api/settings/email-templates/${t.id}`, { method: "DELETE" });
    if (res.ok || res.status === 204) handleDeleted(t.id);
  }

  function handleDeleted(id: string) {
    setDrafts((p) => p.filter((d) => d.id !== id));
    setTemplates((p) => p.filter((t) => t.id !== id));
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <SettingsHeaderActions>
        <Button variant="primary" onClick={addDraft}>+ New template</Button>
      </SettingsHeaderActions>

      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
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
        <div className="bpm-t-help" style={{ marginBottom: 6 }}>
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

      {categoryDrafts.map((d) => (
        <TemplateCard
          key={d.id}
          template={d}
          onSaved={(saved) => handleSaved(d.id, saved)}
          onCancel={() => handleDeleted(d.id)}
        />
      ))}

      <RecordList
        empty={
          <EmptyState
            title="No templates yet"
            text="Sending will use a built-in default until you add one."
            action={<Button variant="primary" onClick={addDraft}>+ New template</Button>}
          />
        }
      >
        {categoryTemplates.map((t) => (
          <RecordRow
            key={t.id}
            title={t.name}
            subtitle={t.subject}
            status={t.is_default ? <StatusPill label="Default" tone="green" /> : undefined}
            menu={[
              { label: "Edit", onSelect: () => setEditingId(t.id) },
              { label: "Make default", onSelect: () => { void makeDefault(t); }, hidden: t.is_default },
              { label: "Delete", onSelect: () => { void deleteTemplate(t); }, danger: true },
            ]}
          >
            {editingId === t.id && (
              <TemplateCard
                bare
                template={t}
                onSaved={(saved) => handleSaved(t.id, saved)}
                onCancel={() => setEditingId(null)}
              />
            )}
          </RecordRow>
        ))}
      </RecordList>
    </div>
  );
}
