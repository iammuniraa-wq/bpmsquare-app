"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import type { CompanyInfo } from "@/lib/tenant";
import type {
  Account, Contact, StandardQuote, StandardQuoteLine,
  StandardQuoteTemplate, StandardQuoteTemplateBlock, StandardQuoteTemplateBlockType,
} from "@/lib/types";
import { STANDARD_QUOTE_REQUIRED_BLOCKS } from "@/lib/types";
import StandardQuotePrintDocument from "@/components/StandardQuotePrintDocument";

const BLOCK_LABELS: Record<StandardQuoteTemplateBlockType, string> = {
  letterhead: "Letterhead (logo + company)",
  quote_meta: "Quote number & date",
  bill_to: "Quote for (account/contact)",
  intro_text: "Intro text",
  line_items: "Line items table",
  totals: "Total",
  notes: "Notes",
  terms: "Terms & conditions",
  signature: "Signature block",
  footer_text: "Footer text",
};
const HAS_CONTENT: Partial<Record<StandardQuoteTemplateBlockType, string>> = {
  intro_text: "Shown above the line items — e.g. a short cover note.",
  footer_text: "Shown near the bottom, above the company footer — e.g. legal boilerplate.",
};

// Fabricated, non-persisted data so admins can see how a template actually
// renders without needing a real quote -- this is preview-only, never sent
// anywhere.
const MOCK_ACCOUNT = {
  id: "preview", name: "Sample Customer Pvt Ltd", city: "Mumbai",
  phone: "+91 98765 43210", email: "purchase@samplecustomer.example",
} as Account;
const MOCK_CONTACT = { id: "preview", account_id: "preview", name: "Priya Sharma" } as Contact;
const MOCK_LINES: StandardQuoteLine[] = [
  { id: "1", tenant_id: "", standard_quote_id: "preview", sl_no: "1", description: "On-site installation & commissioning", uom: "Nos", qty: 1, rate: 25000, discount_pct: 0, amount: 25000 },
  { id: "2", tenant_id: "", standard_quote_id: "preview", sl_no: "2", description: "Annual maintenance visit", uom: "Nos", qty: 4, rate: 5000, discount_pct: 10, amount: 18000 },
];
function mockQuote(): StandardQuote {
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);
  return {
    id: "preview", tenant_id: "", ref: "SQ-2026-0001", account_id: "preview", contact_id: "preview",
    status: "draft", valid_until: validUntil.toISOString().slice(0, 10),
    terms: "50% advance, balance on delivery. Prices valid for 30 days.",
    notes: "Please confirm site access before the installation date.",
    subtotal: 43000, total: 43000, created_by: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), sent_at: null, template_id: null,
  };
}

export default function TemplateBuilderClient({
  template, companyInfo, logoUrl,
}: {
  template: StandardQuoteTemplate;
  companyInfo: CompanyInfo;
  logoUrl: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState(template.name);
  const [accentColor, setAccentColor] = useState(template.accent_color ?? "#378ADD");
  const [logoPosition, setLogoPosition] = useState(template.logo_position);
  const [isDefault, setIsDefault] = useState(template.is_default);
  const [blocks, setBlocks] = useState<StandardQuoteTemplateBlock[]>(template.blocks);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [dropAt, setDropAt] = useState<number | null>(null);
  const dragIdx = useRef<number | null>(null);

  function onDragStart(e: React.DragEvent, idx: number) {
    dragIdx.current = idx;
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    e.dataTransfer.setDragImage(cv, 0, 0);
    e.dataTransfer.effectAllowed = "move";
  }
  function onDragOver(e: React.DragEvent<HTMLDivElement>, idx: number) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropAt(e.clientY < rect.top + rect.height / 2 ? idx : idx + 1);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const from = dragIdx.current;
    const to = dropAt;
    dragIdx.current = null;
    setDropAt(null);
    if (from === null || to === null || from === to || from + 1 === to) return;
    setBlocks((bs) => {
      const next = [...bs];
      const [moved] = next.splice(from, 1);
      next.splice(from < to ? to - 1 : to, 0, moved);
      return next;
    });
  }
  function onDragEnd() { dragIdx.current = null; setDropAt(null); }

  function toggleVisible(idx: number) {
    setBlocks((bs) => bs.map((b, i) => (i === idx ? { ...b, visible: !b.visible } : b)));
  }
  function setContent(idx: number, content: string) {
    setBlocks((bs) => bs.map((b, i) => (i === idx ? { ...b, content } : b)));
  }

  function save() {
    if (!name.trim()) { setError("Name is required"); return; }
    setError("");
    setSaved(false);
    startTransition(async () => {
      const res = await fetch(`/api/standard-quote-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, accent_color: accentColor, logo_position: logoPosition, is_default: isDefault, blocks }),
      });
      if (res.ok) { setSaved(true); router.refresh(); }
      else { const j = await res.json(); setError(j.error ?? "Failed to save template"); }
    });
  }

  const previewTemplate: StandardQuoteTemplate = { ...template, accent_color: accentColor, logo_position: logoPosition, blocks };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {error && (
          <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--err-ink)" }}>
            {error}
          </div>
        )}
        {saved && (
          <div style={{ background: "var(--greenbg)", border: "1px solid var(--green)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, color: "var(--greenink)" }}>
            ✓ Saved
          </div>
        )}

        <section style={cardStyle}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 14px" }}>Template settings</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={fieldLabel}>Name</label>
              <input style={fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label style={fieldLabel}>Accent color</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} style={{ width: 40, height: 34, border: `1px solid ${c.line}`, borderRadius: 6, background: "none", cursor: "pointer" }} />
                <input style={{ ...fieldInput, fontFamily: "monospace" }} value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={fieldLabel}>Logo position</label>
              <select style={fieldInput} value={logoPosition} onChange={(e) => setLogoPosition(e.target.value as StandardQuoteTemplate["logo_position"])}>
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: c.ink, cursor: "pointer" }}>
                <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                Default template for new quotes
              </label>
            </div>
          </div>
        </section>

        <section style={cardStyle}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "0 0 6px" }}>Layout blocks</h3>
          <p style={{ fontSize: 12, color: c.muted, margin: "0 0 14px" }}>
            Drag to reorder. Required blocks always show; the rest you can hide, and two accept custom text.
          </p>
          <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            {blocks.map((block, idx) => {
              const required = STANDARD_QUOTE_REQUIRED_BLOCKS.includes(block.type);
              const editable = block.type in HAS_CONTENT;
              const isOpen = expanded === block.id;
              return (
                <div key={block.id}>
                  {dropAt === idx && <div style={{ height: 2, background: c.accent, margin: "0 4px" }} />}
                  <div
                    draggable
                    onDragStart={(e) => onDragStart(e, idx)}
                    onDragOver={(e) => onDragOver(e, idx)}
                    onDragEnd={onDragEnd}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", border: `1px solid ${c.line}`, borderRadius: 8, marginBottom: 6, background: c.panel, cursor: "grab" }}
                  >
                    <span style={{ color: c.hint, fontSize: 14, userSelect: "none" }}>⠿</span>
                    <span style={{ flex: 1, fontSize: 13, color: c.ink }}>{BLOCK_LABELS[block.type]}</span>
                    {required ? (
                      <span style={{ fontSize: 11, color: c.hint, fontStyle: "italic" }}>always shown</span>
                    ) : (
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: c.muted, cursor: "pointer" }}>
                        <input type="checkbox" checked={block.visible} onChange={() => toggleVisible(idx)} />
                        Visible
                      </label>
                    )}
                    {editable && (
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : block.id)}
                        style={{ fontSize: 11.5, fontWeight: 600, color: c.accent, background: "none", border: "none", cursor: "pointer" }}
                      >
                        {isOpen ? "Close" : "Edit text"}
                      </button>
                    )}
                  </div>
                  {editable && isOpen && (
                    <div style={{ marginBottom: 8, marginLeft: 24 }}>
                      <textarea
                        style={{ ...fieldInput, minHeight: 70, resize: "vertical" }}
                        value={block.content ?? ""}
                        onChange={(e) => setContent(idx, e.target.value)}
                        placeholder={HAS_CONTENT[block.type]}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {dropAt === blocks.length && <div style={{ height: 2, background: c.accent, margin: "0 4px" }} />}
          </div>
        </section>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button" disabled={pending} onClick={save}
            style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 700, fontSize: 13, cursor: pending ? "wait" : "pointer" }}
          >
            {pending ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>

      <div style={{ position: "sticky", top: 16 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
          Live preview (sample data)
        </div>
        <div style={{ border: `1px solid ${c.line}`, borderRadius: 10, overflow: "hidden", background: "#e8ecf0" }}>
          <div style={{ transform: "scale(0.78)", transformOrigin: "top left", width: "128.2%", height: 900, overflowY: "auto" }}>
            <div style={{ background: "#fff", maxWidth: 800, margin: "16px auto" }}>
              <StandardQuotePrintDocument
                quote={mockQuote()}
                lines={MOCK_LINES}
                account={MOCK_ACCOUNT}
                contact={MOCK_CONTACT}
                companyInfo={companyInfo}
                logoUrl={logoUrl}
                template={previewTemplate}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const fieldInput: React.CSSProperties = {
  width: "100%", padding: "9px 12px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
