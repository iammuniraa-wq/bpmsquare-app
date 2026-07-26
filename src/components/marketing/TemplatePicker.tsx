"use client";

import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { MARKETING_TEMPLATES, escapeCustomMessage, type MarketingTemplateId } from "@/lib/marketingTemplates";

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: c.muted,
  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
};
const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 8,
  padding: "8px 12px", fontSize: 13, color: c.ink, background: c.panel, outline: "none",
};

/** Template picker grid (blank state) + live preview & custom-message input
 * (once a template is chosen). Shared by the compose page and the draft
 * campaign detail page. */
export default function TemplatePicker({
  selectedId, onSelect,
  subject, onSubjectChange,
  customMessage, onCustomMessageChange,
}: {
  selectedId: MarketingTemplateId | null;
  onSelect: (id: MarketingTemplateId | null) => void;
  subject: string;
  onSubjectChange: (v: string) => void;
  customMessage: string;
  onCustomMessageChange: (v: string) => void;
}) {
  const template = MARKETING_TEMPLATES.find((t) => t.id === selectedId) ?? null;

  if (!template) {
    return (
      <section style={cardStyle}>
        <div style={lbl}>Start from a template</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
          {MARKETING_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 6,
                padding: "18px 12px", borderRadius: 10, border: `1px solid ${c.line}`, background: c.panel2,
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: 28 }}>{t.emoji}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{t.name}</span>
              <span style={{ fontSize: 11, color: c.hint, lineHeight: 1.4 }}>{t.description}</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  // The stored body/subject keep the real {{tokens}} for per-recipient
  // substitution at send time (see the send route) -- only this on-screen
  // preview swaps in example values so it doesn't just show literal braces.
  const withExampleValues = (s: string) => s.replace(/\{\{account_name\}\}/g, "Krishna Textiles").replace(/\{\{company_name\}\}/g, "Your Company");
  const previewHtml = `<div style="padding:24px;background:#f4f6f9;">${withExampleValues(template.buildBodyHtml(escapeCustomMessage(customMessage)))}</div>`;
  const previewSubject = withExampleValues(subject || template.defaultSubject);

  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>{template.emoji}</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>{template.name}</span>
        </div>
        <button onClick={() => onSelect(null)} style={{ fontSize: 12, color: c.accent, background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
          ← Choose a different template
        </button>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={lbl}>Subject</label>
        <input style={inp} value={subject} onChange={(e) => onSubjectChange(e.target.value)} placeholder={template.defaultSubject} />
        <div style={{ fontSize: 11, color: c.hint, marginTop: 4 }}>Use {"{{account_name}}"} and {"{{company_name}}"} — replaced per recipient.</div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={lbl}>Your message (optional)</label>
        <textarea
          value={customMessage}
          onChange={(e) => onCustomMessageChange(e.target.value)}
          placeholder="Add a personal note — it'll appear in a highlighted box within the template."
          style={{ ...inp, minHeight: 80, resize: "vertical", lineHeight: 1.5 }}
        />
      </div>

      <div>
        <label style={lbl}>Live preview</label>
        <div style={{ fontSize: 12, color: c.muted, marginBottom: 6 }}>Subject: <strong style={{ color: c.ink }}>{previewSubject}</strong></div>
        <iframe
          title="Email preview"
          srcDoc={previewHtml}
          style={{ width: "100%", height: 420, border: `1px solid ${c.line}`, borderRadius: 8, background: "#fff" }}
        />
      </div>
    </section>
  );
}
