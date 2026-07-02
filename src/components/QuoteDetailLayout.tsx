"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import type { Quote, QuoteLine, Account, Contact, LayoutSection } from "@/lib/types";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import ComingSoon from "@/components/ComingSoon";
import { ROUTES } from "@/lib/constants";

// ── Static label maps (safe for client — no server imports) ───────────────────

const QUOTE_STATUS: Record<Quote["status"], string> = {
  draft: "Draft", sent: "Sent", approved: "Approved", rejected: "Rejected",
};
const STATUS_TONE: Record<Quote["status"], "blue" | "purple" | "teal" | "red"> = {
  draft: "blue", sent: "purple", approved: "teal", rejected: "red",
};
const ACCT_LABEL: Record<string, string> = {
  prospect: "Prospect", oem: "OEM / Vendor",
  direct: "Direct customer", end_customer: "End-customer (under OEM)",
};
const ACCT_TONE: Record<string, "amber" | "purple" | "green" | "teal"> = {
  prospect: "amber", oem: "purple", direct: "green", end_customer: "teal",
};

// ── Types ─────────────────────────────────────────────────────────────────────

type FieldType = "text" | "number" | "date" | "select" | "checkbox" | "textarea";

interface CfDef {
  id: string;
  field_key: string;
  field_label: string;
  field_type: FieldType;
  options: string[] | null;
  is_required: boolean;
}

type WOItem = { id: string; ref: string; status: string };

interface Props {
  quote: Quote & { custom_data?: Record<string, unknown> | null };
  account: Account | null;
  contact: Contact | null;
  lines: QuoteLine[];
  workOrders: WOItem[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5,
};
const td: React.CSSProperties = {
  padding: "10px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5, verticalAlign: "top",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function QuoteDetailLayout({ quote, account, contact, lines, workOrders }: Props) {
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const gst      = Math.round(subtotal * 0.18);
  const grandTotal = subtotal + gst;

  // ── Layout state ────────────────────────────────────────────────────────────
  const [layout, setLayout]           = useState<LayoutSection[]>([]);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const [cfDefs, setCfDefs]           = useState<CfDef[]>([]);
  const [adaptMode, setAdaptMode]     = useState(false);
  const [saving, setSaving]           = useState(false);

  // Section drag
  const dragSectionId   = useRef<string | null>(null);
  const dragOverSectionId = useRef<string | null>(null);
  const [draggingSection, setDraggingSection] = useState<string | null>(null);

  // Add section
  const [showAddSection, setShowAddSection]   = useState(false);
  const [addSectionLabel, setAddSectionLabel] = useState("");

  // Add field to section
  const [addingFieldTo, setAddingFieldTo]   = useState<string | null>(null);
  const [newFieldLabel, setNewFieldLabel]   = useState("");
  const [newFieldType, setNewFieldType]     = useState<FieldType>("text");
  const [fieldCreating, setFieldCreating]   = useState(false);

  // Custom field values
  const [cfData, setCfData]       = useState<Record<string, unknown>>(quote.custom_data ?? {});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState<unknown>("");
  const [cfSaving, setCfSaving]   = useState(false);
  const [cfSaved, setCfSaved]     = useState(false);

  // ── Load layout + cf definitions ────────────────────────────────────────────
  const loadCfDefs = useCallback(async () => {
    const r = await fetch("/api/settings/custom-fields?object=quote");
    if (r.ok) setCfDefs(await r.json());
  }, []);

  useEffect(() => {
    fetch("/api/layouts/quote")
      .then(r => r.json())
      .then((data: LayoutSection[]) => { setLayout(data); setLayoutLoading(false); })
      .catch(() => setLayoutLoading(false));
    loadCfDefs();
  }, [loadCfDefs]);

  // ── Section drag handlers ────────────────────────────────────────────────────
  const handleSectionDragEnd = () => {
    const from = dragSectionId.current;
    const to   = dragOverSectionId.current;
    setDraggingSection(null);
    dragSectionId.current   = null;
    dragOverSectionId.current = null;
    if (!from || !to || from === to) return;
    setLayout(prev => {
      const next = [...prev];
      const fi = next.findIndex(s => s.id === from);
      const ti = next.findIndex(s => s.id === to);
      const [moved] = next.splice(fi, 1);
      next.splice(ti, 0, moved);
      return next;
    });
  };

  // ── Layout persistence ───────────────────────────────────────────────────────
  const saveLayout = async (layoutToSave?: LayoutSection[]) => {
    setSaving(true);
    await fetch("/api/layouts/quote", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout: layoutToSave ?? layout }),
    });
    setSaving(false);
    setAdaptMode(false);
  };

  // ── Add / remove section ─────────────────────────────────────────────────────
  const addSection = () => {
    if (!addSectionLabel.trim()) return;
    const id = `cfs_${Date.now()}`;
    const newSection: LayoutSection = { id, kind: "custom_fields", label: addSectionLabel.trim(), field_keys: [] };
    setLayout(prev => [...prev, newSection]);
    setAddSectionLabel("");
    setShowAddSection(false);
  };

  const removeSection = (id: string) =>
    setLayout(prev => prev.filter(s => s.id !== id));

  // ── Add field to a custom section ────────────────────────────────────────────
  const addFieldToSection = async (sectionId: string) => {
    if (!newFieldLabel.trim()) return;
    setFieldCreating(true);
    const res = await fetch("/api/settings/custom-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ object_type: "quote", field_label: newFieldLabel.trim(), field_type: newFieldType }),
    });
    if (res.ok) {
      const created: CfDef = await res.json();
      const updated = layout.map(s =>
        s.id === sectionId ? { ...s, field_keys: [...s.field_keys, created.field_key] } : s
      );
      setLayout(updated);
      // Auto-save layout when a field is added so the placement persists
      await fetch("/api/layouts/quote", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: updated }),
      });
      await loadCfDefs();
      setNewFieldLabel("");
      setNewFieldType("text");
      setAddingFieldTo(null);
    }
    setFieldCreating(false);
  };

  const removeFieldFromSection = (sectionId: string, fieldKey: string) =>
    setLayout(prev => prev.map(s =>
      s.id === sectionId ? { ...s, field_keys: s.field_keys.filter(k => k !== fieldKey) } : s
    ));

  // ── Custom field value editing ───────────────────────────────────────────────
  const saveCfValue = async (key: string) => {
    setCfSaving(true);
    const updated = { ...cfData, [key]: draftValue };
    const res = await fetch(`/api/quotes/${quote.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custom_data: updated }),
    });
    setCfSaving(false);
    if (res.ok) {
      setCfData(updated);
      setCfSaved(true);
      setTimeout(() => setCfSaved(false), 1800);
    }
    setEditingKey(null);
  };

  const renderFieldInput = (field: CfDef) => {
    const s: React.CSSProperties = { width: "100%", padding: "5px 8px", borderRadius: 6, border: `1px solid ${c.accent}`, fontSize: 13, outline: "none", boxSizing: "border-box" };
    if (field.field_type === "select" && field.options?.length) return (
      <select autoFocus value={draftValue as string} onChange={e => setDraftValue(e.target.value)} style={s}>
        <option value="">— select —</option>
        {field.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
    if (field.field_type === "checkbox") return (
      <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 13 }}>
        <input autoFocus type="checkbox" checked={!!draftValue} onChange={e => setDraftValue(e.target.checked)} style={{ width: 15, height: 15, accentColor: c.accent }} />
        {draftValue ? "Yes" : "No"}
      </label>
    );
    if (field.field_type === "textarea") return (
      <textarea autoFocus value={draftValue as string} onChange={e => setDraftValue(e.target.value)} rows={3} style={{ ...s, resize: "vertical" }} />
    );
    return (
      <input autoFocus type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"} value={draftValue as string} onChange={e => setDraftValue(e.target.value)} style={s} />
    );
  };

  // ── Section content renderers ────────────────────────────────────────────────
  const renderSectionContent = (section: LayoutSection): React.ReactNode => {
    switch (section.id) {

      case "core":
        return (
          <section style={{ ...cardStyle, display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <CoreField label="Quotation ref" value={<span style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace", color: c.ink }}>{quote.ref}</span>} />
            <CoreField label="Issued"       value={fmtDate(quote.created_at)} />
            <CoreField label="Valid until"  value={quote.valid_until ? fmtDate(quote.valid_until) : "—"} />
            <CoreField label="Status"       value={<Pill label={QUOTE_STATUS[quote.status]} tone={STATUS_TONE[quote.status]} />} />
          </section>
        );

      case "lines":
        return (
          <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
            <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${c.line}` }}>
              <h3 style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>Scope of work</h3>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...th, width: 28 }}>#</th>
                  <th style={th}>Description</th>
                  <th style={{ ...th, textAlign: "right", whiteSpace: "nowrap" }}>Qty</th>
                  <th style={{ ...th, textAlign: "right", whiteSpace: "nowrap" }}>Rate (₹)</th>
                  <th style={{ ...th, textAlign: "right", whiteSpace: "nowrap" }}>Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={line.id}>
                    <td style={{ ...td, color: c.hint, fontSize: 11 }}>{i + 1}</td>
                    <td style={td}>{line.description}</td>
                    <td style={{ ...td, textAlign: "right", color: c.muted }}>{line.qty}</td>
                    <td style={{ ...td, textAlign: "right", color: c.muted }}>{line.rate.toLocaleString("en-IN")}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 500 }}>{inr(line.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", borderTop: `1px solid ${c.line}` }}>
              <TotalRow label="Subtotal"   value={inr(subtotal)} />
              <TotalRow label="GST @ 18%" value={inr(gst)} muted />
              <div style={{ display: "flex", justifyContent: "space-between", width: 220, paddingTop: 8, borderTop: `2px solid ${c.ink}` }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Grand total</span>
                <span style={{ fontSize: 15, fontWeight: 600, color: c.accent }}>{inr(grandTotal)}</span>
              </div>
            </div>
          </section>
        );

      case "notes":
        return quote.notes ? (
          <section style={cardStyle}>
            <h3 style={{ fontSize: 13, margin: "0 0 8px", fontWeight: 600 }}>Notes &amp; terms</h3>
            <p style={{ fontSize: 12.5, color: c.muted, margin: 0, lineHeight: 1.6 }}>{quote.notes}</p>
          </section>
        ) : adaptMode ? (
          <section style={{ ...cardStyle, color: c.hint, fontSize: 12.5, fontStyle: "italic" }}>Notes &amp; terms (empty)</section>
        ) : null;

      case "work_orders":
        return workOrders.length > 0 ? (
          <section style={cardStyle}>
            <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>Work order — authorized by this quote</h3>
            {workOrders.map(wo => (
              <div key={wo.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: `1px solid ${c.line}`, fontSize: 12.5 }}>
                <span style={{ fontWeight: 600, fontFamily: "monospace" }}>{wo.ref}</span>
                <Pill label={wo.status.replace("_", " ")} tone="amber" />
              </div>
            ))}
          </section>
        ) : adaptMode ? (
          <section style={{ ...cardStyle, color: c.hint, fontSize: 12.5, fontStyle: "italic" }}>Work orders (none yet)</section>
        ) : null;

      default:
        if (section.kind !== "custom_fields") return null;
        const sectionDefs = section.field_keys
          .map(k => cfDefs.find(d => d.field_key === k))
          .filter((d): d is CfDef => !!d);

        return (
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: sectionDefs.length > 0 || adaptMode ? 12 : 0 }}>
              <h3 style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>{section.label}</h3>
              {cfSaved && <span style={{ fontSize: 11, color: "#1d9e75", fontWeight: 500 }}>✓ Saved</span>}
            </div>

            {sectionDefs.length === 0 && !adaptMode && (
              <div style={{ fontSize: 12.5, color: c.hint, textAlign: "center", padding: "12px 0" }}>
                No fields yet — click <strong>⊙ Adapt</strong> to add fields.
              </div>
            )}

            {sectionDefs.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {sectionDefs.map(field => {
                  const isEditing = editingKey === field.field_key;
                  const val = cfData[field.field_key];
                  return (
                    <div
                      key={field.id}
                      style={{ padding: "10px 12px", background: c.panel2, borderRadius: 8, border: `1px solid ${c.line}`, cursor: isEditing || adaptMode ? "default" : "pointer" }}
                      onClick={() => !isEditing && !adaptMode && (() => { setEditingKey(field.field_key); setDraftValue(val ?? ""); })()}
                    >
                      <div style={{ fontSize: 10.5, color: c.hint, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span>{field.field_label}{field.is_required && <span style={{ color: "#e05252", marginLeft: 3 }}>*</span>}</span>
                        {adaptMode && (
                          <button
                            onClick={e => { e.stopPropagation(); removeFieldFromSection(section.id, field.field_key); }}
                            style={{ background: "none", border: "none", color: "#e05252", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}
                            title="Remove field from section"
                          >×</button>
                        )}
                      </div>
                      {isEditing ? (
                        <div onClick={e => e.stopPropagation()}>
                          {renderFieldInput(field)}
                          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                            <button onClick={() => saveCfValue(field.field_key)} disabled={cfSaving} style={{ padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: c.accent, color: "#fff", border: "none", cursor: "pointer" }}>
                              {cfSaving ? "…" : "Save"}
                            </button>
                            <button onClick={() => setEditingKey(null)} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, background: c.panel2, color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer" }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 13, color: val ? c.ink : c.hint, minHeight: 20 }}>
                          {val ? (field.field_type === "checkbox" ? (val ? "Yes" : "No") : String(val)) : "—"}
                          {!adaptMode && <span style={{ float: "right", fontSize: 10, color: c.hint, opacity: 0.5 }}>✎</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add field row — adapt mode only */}
            {adaptMode && (
              addingFieldTo === section.id ? (
                <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-end", background: "#f0f7ff", borderRadius: 8, padding: "10px 12px", border: `1px dashed ${c.accent}` }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10.5, color: c.hint, marginBottom: 4 }}>Field label</div>
                    <input
                      autoFocus
                      value={newFieldLabel}
                      onChange={e => setNewFieldLabel(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && addFieldToSection(section.id)}
                      placeholder="e.g. Motor Frame Size"
                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: `1px solid ${c.line}`, fontSize: 13, boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, color: c.hint, marginBottom: 4 }}>Type</div>
                    <select value={newFieldType} onChange={e => setNewFieldType(e.target.value as FieldType)} style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${c.line}`, fontSize: 13 }}>
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="date">Date</option>
                      <option value="select">Dropdown</option>
                      <option value="checkbox">Yes / No</option>
                      <option value="textarea">Long text</option>
                    </select>
                  </div>
                  <button onClick={() => addFieldToSection(section.id)} disabled={fieldCreating || !newFieldLabel.trim()} style={{ padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: c.accent, color: "#fff", border: "none", cursor: "pointer" }}>
                    {fieldCreating ? "…" : "Add"}
                  </button>
                  <button onClick={() => { setAddingFieldTo(null); setNewFieldLabel(""); }} style={{ padding: "6px 10px", borderRadius: 6, fontSize: 12, background: c.panel2, color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setAddingFieldTo(section.id)}
                  style={{ marginTop: sectionDefs.length > 0 ? 10 : 0, width: "100%", padding: "7px 0", borderRadius: 6, border: `1px dashed ${c.line}`, background: "transparent", color: c.accent, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                >
                  + Add field
                </button>
              )
            )}
          </section>
        );
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  if (layoutLoading) return (
    <div style={{ color: c.hint, fontSize: 13, padding: "32px 0", textAlign: "center" }}>Loading layout…</div>
  );

  return (
    <>
      {/* Adapt mode banner */}
      {adaptMode && (
        <div style={{ background: "#0c447c", color: "#fff", padding: "10px 16px", borderRadius: 8, marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13 }}>⊙ Adapt mode — drag sections to reorder, add custom sections &amp; fields</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              onClick={() => saveLayout()}
              disabled={saving}
              style={{ padding: "6px 18px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: saving ? "#5a7a9c" : "#fff", color: "#0c447c", border: "none", cursor: "pointer" }}
            >
              {saving ? "Saving…" : "✓ Save layout"}
            </button>
            <button
              onClick={() => { setAdaptMode(false); setShowAddSection(false); setAddingFieldTo(null); }}
              style={{ padding: "6px 14px", borderRadius: 6, fontSize: 12, background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Page action bar */}
      <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Link href={ROUTES.quotations} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>← All quotations</Link>
        <Pill label={QUOTE_STATUS[quote.status]} tone={STATUS_TONE[quote.status]} />

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {!adaptMode && (
            <button
              onClick={() => setAdaptMode(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, background: c.panel2, color: c.muted, border: `1px solid ${c.line}`, borderRadius: 7, padding: "6px 12px", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
            >
              ⊙ Adapt
            </button>
          )}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f4f6f9", color: c.hint, borderRadius: 7, padding: "6px 12px", fontSize: 12.5, cursor: "not-allowed" }}>
            📧 Email quote <ComingSoon size="xs" />
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f0faf5", color: "#3d7a5a", borderRadius: 7, padding: "6px 12px", fontSize: 12.5, cursor: "not-allowed" }}>
            💬 WhatsApp <ComingSoon size="xs" />
          </span>
          <Link
            href={ROUTES.quotationPrint(quote.id)}
            target="_blank"
            rel="noopener"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: c.accent, color: "#fff", borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 500, textDecoration: "none" }}
          >
            ↓ Download PDF
          </Link>
        </div>
      </div>

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 12 }} className="hub-grid">

        {/* Left — layout-driven sections */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {layout.map(section => {
            const content = renderSectionContent(section);
            const isDragging = draggingSection === section.id;

            // Normal mode: just render content, skip if null
            if (!adaptMode) {
              return content ? <div key={section.id}>{content}</div> : null;
            }

            // Adapt mode: wrap each section with drag handle + controls
            return (
              <div
                key={section.id}
                draggable
                onDragStart={() => { dragSectionId.current = section.id; setDraggingSection(section.id); }}
                onDragEnter={() => { dragOverSectionId.current = section.id; }}
                onDragOver={e => e.preventDefault()}
                onDragEnd={handleSectionDragEnd}
                style={{ opacity: isDragging ? 0.45 : 1, borderRadius: 10 }}
              >
                {/* Adapt header bar */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "#e6f1fb", borderRadius: "8px 8px 0 0", border: "1px dashed #378ADD", borderBottom: "none" }}>
                  <span style={{ cursor: "grab", color: "#378ADD", fontSize: 16, userSelect: "none" }}>⠿</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "#0c447c", flex: 1 }}>{section.label}</span>
                  {section.kind === "custom_fields" && (
                    <button
                      onClick={() => removeSection(section.id)}
                      style={{ background: "none", border: "none", color: "#e05252", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "0 4px" }}
                    >
                      × Remove section
                    </button>
                  )}
                </div>
                <div style={{ border: "1px dashed #378ADD", borderTop: "none", borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
                  {content}
                </div>
              </div>
            );
          })}

          {/* Add section button — adapt mode only */}
          {adaptMode && (
            showAddSection ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", background: c.panel2, borderRadius: 8, border: `1px dashed ${c.line}` }}>
                <input
                  autoFocus
                  value={addSectionLabel}
                  onChange={e => setAddSectionLabel(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addSection()}
                  placeholder="Section name (e.g. Technical specs)"
                  style={{ flex: 1, padding: "7px 10px", borderRadius: 6, border: `1px solid ${c.line}`, fontSize: 13 }}
                />
                <button onClick={addSection} style={{ padding: "7px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: c.accent, color: "#fff", border: "none", cursor: "pointer" }}>Add</button>
                <button onClick={() => setShowAddSection(false)} style={{ padding: "7px 10px", borderRadius: 6, fontSize: 12, background: c.panel2, color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer" }}>Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddSection(true)}
                style={{ padding: "11px 0", borderRadius: 8, border: `1px dashed ${c.line}`, background: "transparent", color: c.accent, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                ⊕ Add section
              </button>
            )
          )}
        </div>

        {/* Right — fixed sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {account && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, margin: "0 0 12px", fontWeight: 600 }}>Account</h3>
              <Link href={ROUTES.account(account.id)} style={{ fontSize: 14, fontWeight: 600, color: c.accent, display: "block", marginBottom: 4 }}>{account.name}</Link>
              <Pill label={ACCT_LABEL[account.type]} tone={ACCT_TONE[account.type]} />
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {account.city  && <Detail label="City"  value={account.city} />}
                {account.phone && <Detail label="Phone" value={account.phone} />}
                {account.email && <Detail label="Email" value={account.email} />}
              </div>
            </section>
          )}

          {contact && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>Contact</h3>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{contact.name}</div>
              {contact.role && <div style={{ fontSize: 12, color: c.muted, marginBottom: 8 }}>{contact.role}</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {contact.phone && <Detail label="Phone" value={contact.phone} />}
                {contact.email && <Detail label="Email" value={contact.email} />}
              </div>
            </section>
          )}

          <section style={cardStyle}>
            <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>Summary</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Detail label="Line items" value={String(lines.length)} />
              <Detail label="Subtotal"   value={inr(subtotal)} />
              <Detail label="GST 18%"    value={inr(gst)} />
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: `1px solid ${c.line}`, fontSize: 13, fontWeight: 600 }}>
                <span>Total</span>
                <span style={{ color: c.accent }}>{inr(grandTotal)}</span>
              </div>
            </div>
          </section>

        </div>
      </div>
    </>
  );
}

// ── Small helper components ───────────────────────────────────────────────────

function CoreField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: c.muted, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13 }}>{value}</div>
    </div>
  );
}

function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", width: 220, fontSize: 12.5 }}>
      <span style={{ color: muted ? c.muted : c.ink }}>{label}</span>
      <span style={{ color: muted ? c.muted : c.ink }}>{value}</span>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
      <span style={{ color: c.muted }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}
