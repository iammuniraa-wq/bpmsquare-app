"use client";

import { useState } from "react";
import { useFeel } from "@/components/FeelProvider";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select, Textarea } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import SettingsList from "@/components/settings/SettingsList";
import { Toggle } from "@/components/settings/generalShared";
import type { EmailTemplate, TextFragment } from "@/lib/types";
import {
  applySavedEmail, blankTemplate, draftOfRow, emailRow, filterTemplates, isEmailKind, KIND_FILTERS, kindLabel, kindOptions,
  placeholders, planTemplateSave, shownRows, startingText, templateDeleteUrl, templateProblem, textRow, withKind, type KindFilter, type TemplateDraft, type TemplateKind, type TemplateRow,
} from "./quotationsLogic";
import { QUOTATION_TIPS } from "./tips";
import s from "./quotations.module.css";

/**
 * Templates: saved texts and emails in one table with a Kind column. A row opens its panel; the panel saves on its
 * own (these are records with their own routes, not part of the page's one Save).
 */
export default function TemplatesTab({ rows, accent, onRows }: { rows: TemplateRow[]; accent: string; onRows: (next: TemplateRow[]) => void }) {
  const { confirm } = useFeel();
  const [filter, setFilter] = useState<KindFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const filtered = filterTemplates(rows, filter);
  const shown = shownRows(filtered, showAll);

  const start = (d: TemplateDraft) => { setDraft(d); setError(""); };
  const startNew = () => {
    const kind: TemplateKind = filter === "email" ? "email_quote" : filter === "all" ? "line_item" : filter;
    start({ ...blankTemplate(kind), ...startingText(kind) });
  };

  async function save() {
    if (!draft) return;
    const problem = templateProblem(draft);
    if (problem) { setError(problem); return; }
    setSaving(true); setError("");
    const plan = planTemplateSave(draft);
    const res = await fetch(plan.url, { method: plan.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan.body) }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) { setError(res ? ((await res.json().catch(() => ({}))).error ?? "Could not save") : "Network error"); return; }
    const json = await res.json();
    const saved = isEmailKind(draft.kind) ? emailRow(json as EmailTemplate) : textRow(json as TextFragment);
    // A text template's kind can change on save, so its old row is replaced by key, not by position.
    onRows(applySavedEmail(rows.filter((r) => r.key !== saved.key), saved));
    setDraft(null);
  }

  async function remove() {
    const row = draft && rows.find((r) => r.id === draft.id && isEmailKind(r.kind) === isEmailKind(draft.kind));
    if (!row) return;
    const body = isEmailKind(row.kind) ? "Emails already sent from it are unaffected." : "Text already inserted into a quote from it stays as it is.";
    if (!(await confirm({ title: `Delete "${row.name}"?`, body, tone: "danger" }))) return;
    const res = await fetch(templateDeleteUrl(row), { method: "DELETE" }).catch(() => null);
    if (!res || !(res.ok || res.status === 204)) { setError("Could not delete"); return; }
    onRows(rows.filter((r) => r.key !== row.key));
    setDraft(null);
  }

  const isNew = draft?.id === null;
  const email = draft ? isEmailKind(draft.kind) : false;
  const wasDefault = !isNew && rows.some((r) => r.id === draft?.id && isEmailKind(r.kind) && r.isDefault);
  const vars = draft ? placeholders(draft.kind) : [];

  return (
    <div className={s.shell}>
      <div className={s.bar}>
        <span className={`bpm-label-row ${s.barLabel}`}><span className="bpm-t-label">Templates</span><InfoTip label="Templates">{QUOTATION_TIPS.templates}</InfoTip></span>
        <Button variant="primary" onClick={startNew}>+ New template</Button>
      </div>
      <div className={s.chips} role="group" aria-label="Kind">
        {KIND_FILTERS.map((k) => (
          <button key={k.id} type="button" className={s.chip} aria-pressed={filter === k.id} onClick={() => { setFilter(k.id); setShowAll(false); }}>{k.label}</button>
        ))}
      </div>
      <SettingsList
        label="Templates"
        headers={["Kind", "Default"]}
        rows={shown.rows.map((r) => ({
          key: r.key,
          title: r.name,
          cells: [kindLabel(r.kind), r.isDefault ? "Default" : ""],
        }))}
        onOpen={(key) => { const r = rows.find((x) => x.key === key); if (r) start(draftOfRow(r)); }}
        empty={filter === "email" ? "No emails yet. Sending uses a built-in text until you add one." : "No templates yet. Use + New template."}
      />
      {shown.hidden > 0 && <button type="button" className={s.linkBtn} onClick={() => setShowAll(true)}>Show all ({filtered.length})</button>}

      {draft && (
        <SidePanel
          title={isNew ? "New template" : draft.name || "Template"}
          onClose={() => setDraft(null)}
          footer={
            <>
              {!isNew && <Button variant="danger" onClick={() => { void remove(); }}>Delete</Button>}
              <Button variant="primary" loading={saving} onClick={() => { void save(); }}>Save</Button>
            </>
          }
        >
          <Field label="Name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Copper price clause" autoFocus /></Field>
          <Field label="Kind">
            <Select value={draft.kind} disabled={kindOptions(draft).length < 2} onChange={(e) => setDraft(withKind(draft, e.target.value as TemplateKind))}>
              {kindOptions(draft).map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </Select>
          </Field>
          {email && <Field label="Subject"><Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>}
          <Field label={email ? "Body" : "Text"}><Textarea className={s.textarea} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field>
          {email && !wasDefault && (
            <div className={s.switchRow}>
              <span className="bpm-label-row"><span className="bpm-t-label">Default for this kind</span><InfoTip label="Default for this kind">{QUOTATION_TIPS.defaultEmail}</InfoTip></span>
              <Toggle on={draft.isDefault} onChange={(v) => setDraft({ ...draft, isDefault: v })} accent={accent} label="Default for this kind" />
            </div>
          )}
          {vars.length > 0 && (
            <details className={s.more}>
              <summary>Placeholders</summary>
              <div className={`${s.moreBody} ${s.rowGap}`}>{vars.map((v) => <code key={v} className={s.code}>{v}</code>)}</div>
            </details>
          )}
          {error && <div role="alert" className={s.err}>{error}</div>}
        </SidePanel>
      )}
    </div>
  );
}
