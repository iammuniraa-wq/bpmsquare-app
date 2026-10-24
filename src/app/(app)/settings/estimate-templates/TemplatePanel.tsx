"use client";

import { useState } from "react";
import SidePanel from "@/components/ui/SidePanel";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import StatusPill from "@/components/ui/StatusPill";
import TemplateIcon from "@/components/estimator/TemplateIcon";
import { iconKeyFor } from "@/lib/estimator/templateCard";
import { TEMPLATE_ICONS } from "@/lib/estimator/requests";
import type { TemplateSummary } from "@/lib/estimator/server";

const ICON_LABEL: Record<(typeof TEMPLATE_ICONS)[number], string> = {
  fence: "Fence", building: "Building", tiles: "Tiles", cabin: "Cabin", grid: "General",
};

/**
 * One template's catalogue details, in the side panel (bottom sheet on a phone): the plain
 * line and the words the AI reads, the card icon, and whether customers may ever see it. A
 * starter template is read-only here and offers "Copy to customise"; a template of your own
 * saves these fields in place (they never change its version or any estimate's figures).
 */
export default function TemplatePanel({
  template: t, busy, onClose, onCopy, onSaved, onEdit,
}: {
  template: TemplateSummary;
  busy: boolean;
  onClose: () => void;
  onCopy: () => void;
  onSaved: () => void;
  onEdit: () => void;
}) {
  const locked = t.locked;
  const [description, setDescription] = useState(t.description ?? "");
  const [keywords, setKeywords] = useState(t.keywords.join(", "));
  const [icon, setIcon] = useState<string>(iconKeyFor(t));
  const [visible, setVisible] = useState(t.customer_visible);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/estimate-templates/${t.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description, icon, customer_visible: visible,
          keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Could not save."); return; }
      onSaved();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SidePanel
      title={t.name}
      subtitle={locked ? "Starter template, read-only" : `Version ${t.version}`}
      onClose={onClose}
      footer={locked ? (
        <Button variant="primary" loading={busy} onClick={onCopy}>Copy to customise</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={onEdit}>Open the editor</Button>
          <Button variant="primary" loading={saving} onClick={save}>Save</Button>
        </>
      )}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "var(--accent)", display: "inline-flex" }}><TemplateIcon name={iconKeyFor({ icon, geometry: t.geometry })} size={34} /></span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {locked && <StatusPill label="Starter" tone="blue" />}
          <StatusPill label={t.is_active ? "Active" : "Inactive"} tone={t.is_active ? "green" : "red"} />
        </div>
      </div>

      {locked ? (
        <>
          <Field label="What it is" style={{ marginBottom: 0 }}><div className="bpm-t-body">{t.description ?? "No description."}</div></Field>
          <Field label="Words an email would use" info="The AI reads these when it picks a template for a pasted email. Copy the template to change them." style={{ marginBottom: 0 }}>
            <div className="bpm-t-body">{t.keywords.length > 0 ? t.keywords.join(", ") : "None"}</div>
          </Field>
          <div className="bpm-t-help">A starter can't be edited. Copy to customise makes your own version.</div>
        </>
      ) : (
        <>
          <Field label="What it is" info="One plain sentence; it is the line under the name on the New estimate card.">
            <Textarea rows={3} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Words an email would use" info="Separate with commas. The AI reads these (with the name and the input labels) when it picks a template for a pasted email.">
            <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="fence, gate, perimeter" />
          </Field>
          <Field label="Card icon">
            <Select value={icon} onChange={(e) => setIcon(e.target.value)}>
              {TEMPLATE_ICONS.map((k) => <option key={k} value={k}>{ICON_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Customers may request this" info="Reserved for the customer request page, which comes later and will list only these templates. It has no effect yet.">
            <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44 }}>
              <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
              <span className="bpm-t-body">{visible ? "Yes" : "No"}</span>
            </label>
          </Field>
        </>
      )}
      {error && <div role="alert" style={{ color: "var(--err-ink)", fontSize: 13 }}>{error}</div>}
    </SidePanel>
  );
}
