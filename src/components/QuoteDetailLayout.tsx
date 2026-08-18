"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Quote, QuoteLine, Account, Contact, Asset, LayoutSection } from "@/lib/types";
import type { TenantTaxConfig, QuoteStatusDef, QuoteOutcome } from "@/lib/constants";
import { OFFER_TYPE_LABEL, DEFAULT_QUOTE_STATUSES } from "@/lib/constants";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import QuoteStatusPill from "@/components/QuoteStatusPill";
import ComingSoon from "@/components/ComingSoon";
import { ROUTES } from "@/lib/constants";
import { MessageSquare, CheckIcon } from "@/components/Icons";
import QuoteEditPanel from "@/components/QuoteEditPanel";
import EmailComposeModal from "@/components/EmailComposeModal";
import { useTenant, useTenantFeature, useIsNextgen3Layer } from "@/lib/tenant-context";
import { celebrate } from "@/lib/celebrate";
import { sanitizePhoneForWhatsApp, buildWhatsAppLink, buildQuoteWhatsAppMessage } from "@/lib/whatsapp";
import { richTextToDisplayHtml } from "@/lib/richText";

// ── Status helpers ────────────────────────────────────────────────────────────

function statusDef(statuses: QuoteStatusDef[], value: string): QuoteStatusDef {
  return statuses.find((s) => s.value === value) ?? { value, label: value, color: "#94a3b8" };
}

function StatusPill({ status, statuses }: { status: string; statuses: QuoteStatusDef[] }) {
  const def = statusDef(statuses, status);
  return (
    <span style={{
      display: "inline-block", padding: "3px 12px", borderRadius: 12,
      fontSize: 12, fontWeight: 600,
      background: `${def.color}22`, color: def.color, border: `1px solid ${def.color}55`,
    }}>
      {def.label}
    </span>
  );
}

function StatusChanger({ quoteId, currentStatus, statuses, onChanged }: {
  quoteId: string; currentStatus: string; statuses: QuoteStatusDef[]; onChanged: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const def = statusDef(statuses, currentStatus);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function change(value: string) {
    if (value === currentStatus) { setOpen(false); return; }
    setSaving(true);
    setError("");
    const res = await fetch(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: value }),
    });
    setSaving(false);
    if (res.ok) { onChanged(value); setOpen(false); }
    else { const j = await res.json().catch(() => ({})); setError(j.error ?? "Failed to update status"); }
  }

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "3px 12px 3px 10px", borderRadius: 12,
          fontSize: 12, fontWeight: 600, cursor: "pointer",
          background: `${def.color}22`, color: def.color, border: `1px solid ${def.color}55`,
        }}
      >
        {saving ? "…" : def.label} <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50,
          background: c.panel, border: `1px solid ${c.line}`, borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,.15)", minWidth: 160, overflow: "hidden",
        }}>
          {statuses.map((s) => (
            <button
              key={s.value}
              onClick={() => change(s.value)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "9px 14px", border: "none", cursor: "pointer",
                background: s.value === currentStatus ? `${s.color}15` : "transparent",
                color: s.value === currentStatus ? s.color : c.ink,
                fontSize: 13, fontWeight: s.value === currentStatus ? 700 : 400,
                textAlign: "left",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
              {s.label}
              {s.value === currentStatus && <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>}
            </button>
          ))}
          {error && (
            <div style={{ padding: "8px 14px", fontSize: 11.5, color: "var(--err-ink)", background: "var(--err-bg)", borderTop: `1px solid ${c.line}`, maxWidth: 220 }}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const OUTCOME_META: Record<QuoteOutcome, { label: string; color: string }> = {
  open:    { label: "Open",    color: "#94a3b8" },
  won:     { label: "Won",     color: "#10b981" },
  lost:    { label: "Lost",    color: "#ef4444" },
  dropped: { label: "Dropped", color: "#f59e0b" },
};

function OutcomePill({ outcome }: { outcome: QuoteOutcome }) {
  const meta = OUTCOME_META[outcome];
  return (
    <span style={{
      display: "inline-block", padding: "3px 12px", borderRadius: 12,
      fontSize: 12, fontWeight: 600,
      background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}55`,
    }}>
      {meta.label}
    </span>
  );
}

// Independent from the pipeline status -- a quote can be marked Lost/Dropped
// while still sitting in a non-closed status (customer went quiet), or Won
// ahead of the status catching up. A closed status always requires a decided
// (non-"open") outcome -- enforced server-side, not here.
function OutcomeChanger({ quoteId, currentOutcome, currentStatus, statuses, onChanged, onStatusChanged }: {
  quoteId: string; currentOutcome: QuoteOutcome; currentStatus: string; statuses: QuoteStatusDef[];
  onChanged: (o: QuoteOutcome) => void; onStatusChanged: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const meta = OUTCOME_META[currentOutcome];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function change(value: QuoteOutcome) {
    if (value === currentOutcome) { setOpen(false); return; }

    // Winning a quote that's still early in the pipeline (not yet closed) is
    // common when the paperwork catches up later -- offer to bump status to
    // Approved in the same motion instead of leaving it stranded on Draft/Sent.
    let bumpStatus = false;
    if (value === "won") {
      const statusDef = statuses.find((s) => s.value === currentStatus);
      const approvedDef = statuses.find((s) => s.value === "approved");
      if (statusDef && !statusDef.is_closed && approvedDef) {
        bumpStatus = window.confirm(
          `Mark this quotation as Won. Also move status from "${statusDef.label}" to "${approvedDef.label}"?`
        );
      }
    }

    setSaving(true);
    setError("");
    const body: Record<string, unknown> = { outcome: value };
    if (bumpStatus) body.status = "approved";
    const res = await fetch(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      onChanged(value);
      if (bumpStatus) onStatusChanged("approved");
      setOpen(false);
    }
    else { const j = await res.json().catch(() => ({})); setError(j.error ?? "Failed to update outcome"); }
  }

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "3px 12px 3px 10px", borderRadius: 12,
          fontSize: 12, fontWeight: 600, cursor: "pointer",
          background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}55`,
        }}
      >
        {saving ? "…" : meta.label} <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50,
          background: c.panel, border: `1px solid ${c.line}`, borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,.15)", minWidth: 140, overflow: "hidden",
        }}>
          {(["open", "won", "lost", "dropped"] as const).map((o) => (
            <button
              key={o}
              onClick={() => change(o)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "9px 14px", border: "none", cursor: "pointer",
                background: o === currentOutcome ? `${OUTCOME_META[o].color}15` : "transparent",
                color: o === currentOutcome ? OUTCOME_META[o].color : c.ink,
                fontSize: 13, fontWeight: o === currentOutcome ? 700 : 400,
                textAlign: "left",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: OUTCOME_META[o].color, flexShrink: 0 }} />
              {OUTCOME_META[o].label}
              {o === currentOutcome && <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>}
            </button>
          ))}
          {error && (
            <div style={{ padding: "8px 14px", fontSize: 11.5, color: "var(--err-ink)", background: "var(--err-bg)", borderTop: `1px solid ${c.line}`, maxWidth: 220 }}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
  tenantTax?: TenantTaxConfig;
  quoteStatuses?: QuoteStatusDef[];
  existingInvoice?: { id: string; ref: string } | null;
  assets?: Asset[];
  /** Signed, no-login link to this quote's PDF, for the WhatsApp message. Null when
   * QUOTE_PUBLIC_LINK_SECRET isn't configured (see lib/quotePublicLink.ts). */
  publicPdfLink?: string | null;
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

export default function QuoteDetailLayout({ quote, account, contact, lines, workOrders, tenantTax, quoteStatuses = DEFAULT_QUOTE_STATUSES, existingInvoice = null, assets = [], publicPdfLink = null }: Props) {
  const router = useRouter();
  const isTechnical = quote.type === "technical";
  const [currentStatus, setCurrentStatus] = useState<string>(quote.status);
  useEffect(() => { setCurrentStatus(quote.status); }, [quote.status]);
  const [currentOutcome, setCurrentOutcome] = useState<QuoteOutcome>(quote.outcome);
  useEffect(() => { setCurrentOutcome(quote.outcome); }, [quote.outcome]);
  // Engagement layer (3-layer theme only): marking a quote Won earns the
  // full celebration. Wired at the moment of the USER'S action -- a quote
  // that loads already-won stays quiet.
  const celebrateWins = useIsNextgen3Layer();
  const handleOutcomeChanged = (o: QuoteOutcome) => {
    if (o === "won" && currentOutcome !== "won" && celebrateWins) {
      celebrate("Quotation won!", `${quote.ref} · ${inr(quote.total)}`);
    }
    setCurrentOutcome(o);
  };
  // CR-010: GST is optional per quote — no rate entered means no tax row at all
  // (the "GST @ 18%" statement lives in Terms & Conditions text instead).
  const hasGst      = quote.gst_rate !== null && quote.gst_rate !== undefined;
  const taxRate     = quote.gst_rate ?? 0;
  const taxLabel    = tenantTax?.label ?? "GST";
  // Lines in an unselected alternative group are quoted but not sold — the print
  // document already excludes them from the totals, so the summary must too.
  const selectedAltId  = quote.selected_option_id ?? null;
  const effectiveLines = lines.filter((l) => !l.group_id || l.group_type !== "alternative" || l.group_id === selectedAltId);
  const subtotal    = effectiveLines.reduce((s, l) => s + l.amount, 0);
  const gst         = hasGst ? Math.round(subtotal * taxRate / 100) : 0;
  const grandTotal  = subtotal + gst;

  // ── Revisions (sibling quotes sharing same base ref) ────────────────────────
  type RevRow = { id: string; ref: string; status: string; revision: number; created_at: string; superseded_by: string | null };
  const [revisions, setRevisions] = useState<RevRow[]>([]);
  useEffect(() => {
    fetch(`/api/quotes/${quote.id}/revisions`)
      .then(r => r.ok ? r.json() : [])
      .then((data: RevRow[]) => setRevisions(data))
      .catch(() => {});
  }, [quote.id]);

  // ── Layout state ────────────────────────────────────────────────────────────
  const [layout, setLayout]           = useState<LayoutSection[]>([]);
  const [layoutLoading, setLayoutLoading] = useState(true);
  const [cfDefs, setCfDefs]           = useState<CfDef[]>([]);
  const [adaptMode, setAdaptMode]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [moreOpen, setMoreOpen]       = useState(false);
  const [copying, setCopying]         = useState(false);
  const [converting, setConverting]   = useState(false);
  const [emailState, setEmailState]   = useState<"idle" | "sent">("idle");
  const [composeOpen, setComposeOpen] = useState(false);
  const moreRef                       = useRef<HTMLDivElement>(null);
  const tenant = useTenant();
  const invoicesFeatureEnabled = useTenantFeature("invoices");
  const [activeTab, setActiveTab] = useState<"overview" | "versions">("overview");

  const emailRecipient = contact?.email || contact?.email2 || account?.email || account?.email2 || null;
  const emailVars = {
    customer_name: contact?.name ?? "Sir/Madam",
    company_name: tenant?.company_info?.name ?? tenant?.name ?? "our team",
    quote_ref: quote.ref,
    quote_total: inr(quote.total),
    valid_until: quote.valid_until ? fmtDate(quote.valid_until) : "—",
  };
  const waPhone = sanitizePhoneForWhatsApp(contact?.phone || contact?.phone2 || contact?.phone3 || account?.phone || account?.phone2);
  const waLink = waPhone ? buildWhatsAppLink(waPhone, buildQuoteWhatsAppMessage({ ...emailVars, pdfLink: publicPdfLink })) : null;
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

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

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

  // ── Shared custom-field rendering — "inline" matches CoreField style, "card" uses grid cards ──
  const renderCfCards = (section: LayoutSection, variant: "inline" | "card" = "card") => {
    const defs = section.field_keys
      .map(k => cfDefs.find(d => d.field_key === k))
      .filter((d): d is CfDef => !!d);
    if (defs.length === 0 && addingFieldTo !== section.id) return null;

    const renderField = (field: CfDef) => {
      const isEditing = editingKey === field.field_key;
      const val = cfData[field.field_key];
      const displayVal = val
        ? (field.field_type === "checkbox" ? (val ? "Yes" : "No") : String(val))
        : "—";

      if (variant === "inline") {
        // Matches CoreField: small muted label + value below, no box
        return (
          <div key={field.id} style={{ cursor: isEditing || adaptMode ? "default" : "pointer", position: "relative" }}
            onClick={() => { if (!isEditing && !adaptMode) { setEditingKey(field.field_key); setDraftValue(val ?? ""); } }}
          >
            <div style={{ fontSize: 11, color: c.muted, marginBottom: 2, display: "flex", alignItems: "center", gap: 4 }}>
              {field.field_label}
              {field.is_required && <span style={{ color: "var(--err-ink)" }}>*</span>}
              {adaptMode && (
                <button onClick={e => { e.stopPropagation(); removeFieldFromSection(section.id, field.field_key); }}
                  style={{ background: "none", border: "none", color: "var(--err-ink)", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: "0 2px", marginLeft: 2 }} title="Remove">×</button>
              )}
            </div>
            {isEditing ? (
              <div onClick={e => e.stopPropagation()} style={{ minWidth: 160 }}>
                {renderFieldInput(field)}
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button onClick={() => saveCfValue(field.field_key)} disabled={cfSaving} style={{ padding: "3px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600, background: c.accent, color: "#fff", border: "none", cursor: "pointer" }}>{cfSaving ? "…" : "Save"}</button>
                  <button onClick={() => setEditingKey(null)} style={{ padding: "3px 8px", borderRadius: 5, fontSize: 11, background: c.panel2, color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer" }}>×</button>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: val ? c.ink : c.hint }}>
                {displayVal}
                {!adaptMode && <span style={{ marginLeft: 4, fontSize: 10, color: c.hint, opacity: 0.4 }}>✎</span>}
              </div>
            )}
          </div>
        );
      }

      // Card variant (used by lines, notes, work_orders, custom sections)
      return (
        <div
          key={field.id}
          style={{ padding: "10px 12px", background: c.panel2, borderRadius: 8, border: `1px solid ${c.line}`, cursor: isEditing || adaptMode ? "default" : "pointer" }}
          onClick={() => { if (!isEditing && !adaptMode) { setEditingKey(field.field_key); setDraftValue(val ?? ""); } }}
        >
          <div style={{ fontSize: 10.5, color: c.hint, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>{field.field_label}{field.is_required && <span style={{ color: "var(--err-ink)", marginLeft: 3 }}>*</span>}</span>
            {adaptMode && (
              <button onClick={e => { e.stopPropagation(); removeFieldFromSection(section.id, field.field_key); }} style={{ background: "none", border: "none", color: "var(--err-ink)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }} title="Remove field">×</button>
            )}
          </div>
          {isEditing ? (
            <div onClick={e => e.stopPropagation()}>
              {renderFieldInput(field)}
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <button onClick={() => saveCfValue(field.field_key)} disabled={cfSaving} style={{ padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: c.accent, color: "#fff", border: "none", cursor: "pointer" }}>{cfSaving ? "…" : "Save"}</button>
                <button onClick={() => setEditingKey(null)} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, background: c.panel2, color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: val ? c.ink : c.hint, minHeight: 20 }}>
              {displayVal}
              {!adaptMode && <span style={{ float: "right", fontSize: 10, color: c.hint, opacity: 0.5 }}>✎</span>}
            </div>
          )}
        </div>
      );
    };

    return (
      <div style={{ marginTop: defs.length > 0 ? (variant === "inline" ? 0 : 12) : 0 }}>
        {defs.length > 0 && (
          variant === "inline"
            ? <>{defs.map(renderField)}</>
            : <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{defs.map(renderField)}</div>
        )}
        {/* Inline add-field form — shown when this section is being edited */}
        {addingFieldTo === section.id && (
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-end", background: "var(--bluebg)", borderRadius: 8, padding: "10px 12px", border: `1px dashed ${c.accent}` }}>
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
            <button onClick={() => addFieldToSection(section.id)} disabled={fieldCreating || !newFieldLabel.trim()} style={{ padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: c.accent, color: "#fff", border: "none", cursor: "pointer" }}>{fieldCreating ? "…" : "Add"}</button>
            <button onClick={() => { setAddingFieldTo(null); setNewFieldLabel(""); }} style={{ padding: "6px 10px", borderRadius: 6, fontSize: 12, background: c.panel2, color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer" }}>Cancel</button>
          </div>
        )}
      </div>
    );
  };

  // Line rows, grouped exactly the way the create/edit form and the print document
  // present them: a header row per group, the group's own subtotal after its last
  // line, and alternative groups marked selected / not selected.
  const renderLineRows = (): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    const seenGroups = new Set<string>();
    const closedGroups = new Set<string>();
    const groupItemCount: Record<string, number> = {};
    const groupTotals: Record<string, number> = {};
    for (const l of lines) {
      if (l.group_id) groupTotals[l.group_id] = (groupTotals[l.group_id] ?? 0) + l.amount;
    }
    let standaloneNum = 0;

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const nextLine = lines[idx + 1];

      if (!line.group_id) {
        standaloneNum++;
        out.push(
          <tr key={line.id}>
            <td style={{ ...td, color: c.hint, fontSize: 11 }}>{line.sl_no || standaloneNum}</td>
            <td style={td}>{line.description}</td>
            <td style={{ ...td, textAlign: "right", color: c.muted }}>{line.qty}</td>
            <td style={{ ...td, textAlign: "right", color: c.muted }}>{line.rate.toLocaleString("en-IN")}</td>
            <td style={{ ...td, textAlign: "right", fontWeight: 500 }}>{inr(line.amount)}</td>
          </tr>
        );
        continue;
      }

      const isAlt      = line.group_type === "alternative";
      const isSelected = !isAlt || line.group_id === selectedAltId;
      const tone       = isAlt ? pillar.amber : pillar.blue;
      const headerBg   = isSelected ? tone.bg : c.panel2;
      const headerFg   = isSelected ? tone.fg : c.hint;

      if (!seenGroups.has(line.group_id)) {
        seenGroups.add(line.group_id);
        standaloneNum++;
        groupItemCount[line.group_id] = 0;
        out.push(
          <tr key={`gh-${line.group_id}`} style={{ background: headerBg }}>
            <td colSpan={5} style={{ ...td, fontWeight: 700, fontSize: 11.5, color: headerFg, letterSpacing: 0.3 }}>
              {isAlt ? (isSelected ? "✓ " : "✗ ") : ""}{line.group_label ?? (isAlt ? "Option" : "Group")}
              {line.group_description && (
                <span style={{ fontWeight: 400, marginLeft: 8, fontSize: 11 }}>— {line.group_description}</span>
              )}
              {isAlt && !isSelected && (
                <span style={{ fontWeight: 400, marginLeft: 8, fontSize: 10 }}>(not selected)</span>
              )}
            </td>
          </tr>
        );
      }

      groupItemCount[line.group_id] = (groupItemCount[line.group_id] ?? 0) + 1;
      out.push(
        <tr key={line.id} style={{ opacity: isSelected ? 1 : 0.45 }}>
          <td style={{ ...td, color: c.hint, fontSize: 11, paddingLeft: 22 }}>
            {line.sl_no || `${standaloneNum}.${groupItemCount[line.group_id]}`}
          </td>
          <td style={td}>{line.description}</td>
          <td style={{ ...td, textAlign: "right", color: c.muted }}>{line.qty}</td>
          <td style={{ ...td, textAlign: "right", color: c.muted }}>{line.rate.toLocaleString("en-IN")}</td>
          <td style={{ ...td, textAlign: "right", fontWeight: 500 }}>{inr(line.amount)}</td>
        </tr>
      );

      const isLastInGroup = !nextLine || nextLine.group_id !== line.group_id;
      if (isLastInGroup && !closedGroups.has(line.group_id) && !isTechnical) {
        closedGroups.add(line.group_id);
        out.push(
          <tr key={`gt-${line.group_id}`} style={{ background: headerBg }}>
            <td colSpan={4} style={{ ...td, textAlign: "right", fontSize: 11.5, fontWeight: 600, color: headerFg }}>
              {line.group_label ?? "Group"} total
            </td>
            <td style={{ ...td, textAlign: "right", fontWeight: 700, color: headerFg }}>
              {inr(groupTotals[line.group_id] ?? 0)}
            </td>
          </tr>
        );
      }
    }
    return out;
  };

  // ── Section content renderers (builtin content only — cf cards added separately) ──
  const renderSectionContent = (section: LayoutSection): React.ReactNode => {
    switch (section.id) {

      case "core":
        return (
          <div style={{ ...cardStyle, display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <CoreField label="Quote ID" value={<span style={{ fontSize: 16, fontWeight: 600, fontFamily: "monospace", color: c.ink }}>{quote.ref}</span>} />
            {quote.ref_no && <CoreField label="Ref no." value={quote.ref_no} />}
            {quote.inquiry_date && <CoreField label="Inquiry" value={fmtDate(quote.inquiry_date)} />}
            <CoreField label="Issued"       value={fmtDate(quote.quote_date ?? quote.created_at)} />
            {quote.submitted_at && <CoreField label="Submitted" value={fmtDate(quote.submitted_at)} />}
            <CoreField label="Valid until"  value={quote.valid_until ? fmtDate(quote.valid_until) : "—"} />
            {quote.closed_at && <CoreField label="Closed" value={fmtDate(quote.closed_at)} />}
            <CoreField label="Changed on"   value={fmtDate(quote.updated_at)} />
            <CoreField label="Status"       value={<StatusPill status={currentStatus} statuses={quoteStatuses} />} />
            {renderCfCards(section, "inline")}
          </div>
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
                {renderLineRows()}
              </tbody>
            </table>
            {!isTechnical && (
              <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", borderTop: `1px solid ${c.line}` }}>
                <TotalRow label="Subtotal"                value={inr(subtotal)} />
                {hasGst && <TotalRow label={`${taxLabel} @ ${taxRate}%`} value={inr(gst)} muted />}
                <div style={{ display: "flex", justifyContent: "space-between", width: 220, paddingTop: 8, borderTop: `2px solid ${c.ink}` }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Grand total</span>
                  <span style={{ fontSize: 15, fontWeight: 600, color: c.accent }}>{inr(grandTotal)}</span>
                </div>
              </div>
            )}
            {section.field_keys.length > 0 || addingFieldTo === section.id ? (
              <div style={{ padding: "0 14px 12px" }}>{renderCfCards(section)}</div>
            ) : null}
          </section>
        );

      case "notes": {
        const hasContent = quote.scope_of_work || quote.notes || quote.terms || adaptMode || section.field_keys.length > 0 || addingFieldTo === section.id;
        return hasContent ? (
          <section style={cardStyle}>
            {quote.scope_of_work && (
              <div style={{ marginBottom: 14 }}>
                <h3 style={{ fontSize: 13, margin: "0 0 8px", fontWeight: 600 }}>Scope of work</h3>
                <div
                  className="rich-content"
                  style={{ fontSize: 12.5, color: c.muted, lineHeight: 1.6 }}
                  dangerouslySetInnerHTML={{ __html: richTextToDisplayHtml(quote.scope_of_work) }}
                />
              </div>
            )}
            {quote.notes && (
              <div style={{ marginBottom: quote.terms ? 14 : 0 }}>
                <h3 style={{ fontSize: 13, margin: "0 0 8px", fontWeight: 600 }}>Notes</h3>
                <p style={{ fontSize: 12.5, color: c.muted, margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{quote.notes}</p>
              </div>
            )}
            {quote.terms && (
              <div>
                <h3 style={{ fontSize: 13, margin: "0 0 8px", fontWeight: 600, color: "var(--amberink)" }}>Terms &amp; Conditions</h3>
                <p style={{ fontSize: 12.5, color: c.muted, margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{quote.terms}</p>
              </div>
            )}
            {!quote.scope_of_work && !quote.notes && !quote.terms && adaptMode && (
              <p style={{ fontSize: 12.5, color: c.hint, margin: 0, fontStyle: "italic" }}>Scope, notes &amp; terms (empty)</p>
            )}
            {renderCfCards(section)}
          </section>
        ) : null;
      }

      case "work_orders":
        return (workOrders.length > 0 || adaptMode || section.field_keys.length > 0 || addingFieldTo === section.id) ? (
          <section style={cardStyle}>
            <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>Work order — authorized by this quote</h3>
            {workOrders.length === 0 && adaptMode && (
              <p style={{ fontSize: 12.5, color: c.hint, fontStyle: "italic", margin: "0 0 8px" }}>Work orders (none yet)</p>
            )}
            {workOrders.map(wo => (
              <div key={wo.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: `1px solid ${c.line}`, fontSize: 12.5 }}>
                <span style={{ fontWeight: 600, fontFamily: "monospace" }}>{wo.ref}</span>
                <Pill label={wo.status.replace("_", " ")} tone="amber" />
              </div>
            ))}
            {renderCfCards(section)}
          </section>
        ) : null;

      default:
        if (section.kind !== "custom_fields") return null;
        return (
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h3 style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>{section.label}</h3>
              {cfSaved && <span style={{ fontSize: 11, color: "var(--teal)", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 3 }}><CheckIcon size={11} color="var(--teal)" /> Saved</span>}
            </div>
            {section.field_keys.length === 0 && !adaptMode && (
              <div style={{ fontSize: 12.5, color: c.hint, textAlign: "center", padding: "12px 0" }}>
                No fields yet — click <strong>⊙ Adapt</strong> to add fields.
              </div>
            )}
            {renderCfCards(section)}
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
        <div style={{ background: "var(--modern-accent, var(--blueink))", color: "#fff", padding: "10px 16px", borderRadius: 8, marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13 }}>⊙ Adapt mode — drag sections to reorder, add custom sections &amp; fields</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              onClick={() => saveLayout()}
              disabled={saving}
              style={{ padding: "6px 18px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: saving ? "#5a7a9c" : "var(--panel)", color: "var(--modern-accent, var(--blueink))", border: "none", cursor: "pointer" }}
            >
              {saving ? "Saving…" : "Save layout"}
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
        {quote.superseded_by ? (
          <>
            <StatusPill status={currentStatus} statuses={quoteStatuses} />
            <OutcomePill outcome={currentOutcome} />
            <Link
              href={ROUTES.quotation(quote.superseded_by)}
              style={{ fontSize: 12, color: c.accent, fontWeight: 600, textDecoration: "none" }}
            >
              Read-only — view latest version →
            </Link>
          </>
        ) : (
          <>
            <StatusChanger quoteId={quote.id} currentStatus={currentStatus} statuses={quoteStatuses} onChanged={setCurrentStatus} />
            <OutcomeChanger
              quoteId={quote.id}
              currentOutcome={currentOutcome}
              currentStatus={currentStatus}
              statuses={quoteStatuses}
              onChanged={handleOutcomeChanged}
              onStatusChanged={setCurrentStatus}
            />
          </>
        )}

        {currentOutcome === "won" && invoicesFeatureEnabled && (
          existingInvoice ? (
            <Link
              href={ROUTES.invoice(existingInvoice.id)}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, background: c.accentbg, color: c.accent, borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, textDecoration: "none" }}
            >
              View invoice {existingInvoice.ref}
            </Link>
          ) : !quote.superseded_by ? (
            <button
              onClick={async () => {
                setConverting(true);
                const res = await fetch(`/api/quotes/${quote.id}/convert-to-invoice`, { method: "POST" });
                setConverting(false);
                if (res.ok) { const j = await res.json(); router.push(ROUTES.invoice(j.id)); }
              }}
              disabled={converting}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--teal)", color: "#fff", borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, border: "none", cursor: converting ? "wait" : "pointer" }}
            >
              {converting ? "Converting…" : "⊟ Convert to Invoice"}
            </button>
          ) : null
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {!adaptMode && <QuoteEditPanel quote={quote} quoteStatuses={quoteStatuses} />}

          {/* More dropdown */}
          {!adaptMode && (
            <div ref={moreRef} style={{ position: "relative" }}>
              <button
                onClick={() => setMoreOpen((o) => !o)}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, background: c.panel2, color: c.ink, border: `1px solid ${c.line}`, borderRadius: 7, padding: "6px 14px", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
              >
                More <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
              </button>
              {moreOpen && (
                <div style={{
                  position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 100,
                  background: c.panel, border: `1px solid ${c.line}`, borderRadius: 10,
                  boxShadow: "0 8px 24px rgba(0,0,0,.15)", minWidth: 200, overflow: "hidden",
                }}>
                  <Link
                    href={ROUTES.quotationPrint(quote.id)}
                    target="_blank"
                    rel="noopener"
                    onClick={() => setMoreOpen(false)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", fontSize: 13, color: c.ink, textDecoration: "none", borderBottom: `1px solid ${c.line}` }}
                  >
                    <span style={{ fontSize: 15 }}>↓</span> Download PDF
                  </Link>
                  <Link
                    href={`/api/quotes/${quote.id}/export`}
                    onClick={() => setMoreOpen(false)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", fontSize: 13, color: c.ink, textDecoration: "none", borderBottom: `1px solid ${c.line}` }}
                  >
                    <span style={{ fontSize: 15 }}>↓</span> Download CSV
                  </Link>
                  <button
                    onClick={() => { setAdaptMode(true); setMoreOpen(false); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "11px 16px", fontSize: 13, color: c.ink, background: "none", border: "none", borderBottom: `1px solid ${c.line}`, cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ fontSize: 15 }}>⊙</span> Adapt layout
                  </button>
                  <button
                    onClick={async () => {
                      setMoreOpen(false);
                      setCopying(true);
                      const res = await fetch(`/api/quotes/${quote.id}/copy`, { method: "POST" });
                      setCopying(false);
                      if (res.ok) { const j = await res.json(); router.push(ROUTES.quotation(j.id)); }
                    }}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "11px 16px", fontSize: 13, color: c.ink, background: "none", border: "none", borderBottom: `1px solid ${c.line}`, cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ fontSize: 15 }}>⎘</span> {copying ? "Copying…" : "Copy quote"}
                  </button>
                  <button
                    onClick={() => { setMoreOpen(false); setComposeOpen(true); }}
                    disabled={emailState === "sent"}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, width: "100%",
                      padding: "11px 16px", fontSize: 13, background: "none", border: "none",
                      borderBottom: `1px solid ${c.line}`, textAlign: "left",
                      color: emailState === "sent" ? "#10b981" : c.ink,
                      cursor: emailState === "sent" ? "not-allowed" : "pointer",
                    }}
                  >
                    <span style={{ fontSize: 13 }}>✉</span>
                    {emailState === "sent" ? "Sent" : "Email quote"}
                  </button>
                  {waLink ? (
                    <a
                      href={waLink}
                      target="_blank"
                      rel="noopener"
                      onClick={() => setMoreOpen(false)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", fontSize: 13, color: c.ink, textDecoration: "none", borderBottom: `1px solid ${c.line}` }}
                    >
                      <MessageSquare size={13} color={c.ink} /> WhatsApp
                    </a>
                  ) : (
                    <div style={{ padding: "11px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "not-allowed", opacity: 0.5, borderBottom: `1px solid ${c.line}` }} title="No phone number on file for this contact/account">
                      <MessageSquare size={13} color={c.ink} />
                      <span style={{ fontSize: 13, color: c.ink }}>WhatsApp</span>
                    </div>
                  )}
                  <div style={{ padding: "11px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "not-allowed", opacity: 0.5 }}>
                    <MessageSquare size={13} color={c.ink} />
                    <span style={{ fontSize: 13, color: c.ink }}>WhatsApp (embedded)</span>
                    <ComingSoon size="xs" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content tabs */}
      {!adaptMode && (
        <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${c.line}`, marginBottom: 14 }}>
          {(["overview", "versions"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "8px 16px", fontSize: 13, fontWeight: 600, background: "none", border: "none",
                borderBottom: activeTab === tab ? `2px solid ${c.accent}` : "2px solid transparent",
                color: activeTab === tab ? c.accent : c.muted, cursor: "pointer", marginBottom: -1,
              }}
            >
              {tab === "overview" ? "Overview" : `Versions${revisions.length > 1 ? ` · ${revisions.length}` : ""}`}
            </button>
          ))}
        </div>
      )}

      {activeTab === "versions" && !adaptMode ? (
        <section style={cardStyle}>
          {revisions.length <= 1 ? (
            <div style={{ fontSize: 13, color: c.muted, padding: "16px 4px" }}>
              No other versions yet. Create one any time from "Create new version" in the
              quote actions, or "Copy quote" in the More menu for a brand-new quote instead.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${c.line}` }}>
                  {["Version", "Ref", "Status", "Created", "", ""].map((h, i) => (
                    <th key={i} style={{ textAlign: "left", padding: "8px 10px", color: c.muted, fontWeight: 600, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {revisions.map((rev) => {
                  const isCurrent = rev.id === quote.id;
                  const isSuperseded = !!rev.superseded_by;
                  return (
                    <tr key={rev.id} style={{ borderBottom: `1px solid ${c.line}`, background: isCurrent ? c.accentbg : "transparent" }}>
                      <td style={{ padding: "9px 10px", fontWeight: isCurrent ? 700 : 500 }}>Rev {rev.revision}{isCurrent ? " (current)" : ""}</td>
                      <td style={{ padding: "9px 10px", fontFamily: "monospace", color: isCurrent ? c.accent : c.ink }}>{rev.ref}</td>
                      <td style={{ padding: "9px 10px" }}><QuoteStatusPill status={rev.status} statuses={quoteStatuses} /></td>
                      <td style={{ padding: "9px 10px", color: c.muted }}>
                        {new Date(rev.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td style={{ padding: "9px 10px" }}>
                        {isSuperseded && (
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, background: c.panel2, border: `1px solid ${c.line}`, borderRadius: 5, padding: "2px 7px", letterSpacing: 0.3 }}>
                            Read-only
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right" }}>
                        {!isCurrent && <Link href={ROUTES.quotation(rev.id)} style={{ fontSize: 12, color: c.accent, textDecoration: "none", fontWeight: 600 }}>View →</Link>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ) : (

      /* Main grid */
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
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "var(--bluebg)", borderRadius: "8px 8px 0 0", border: "1px dashed #378ADD", borderBottom: "none" }}>
                  <span style={{ cursor: "grab", color: "#378ADD", fontSize: 16, userSelect: "none" }}>⠿</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--blueink)", flex: 1 }}>{section.label}</span>
                  <button
                    onClick={() => { setAddingFieldTo(addingFieldTo === section.id ? null : section.id); setNewFieldLabel(""); }}
                    style={{ background: addingFieldTo === section.id ? c.accent : "none", border: `1px solid ${addingFieldTo === section.id ? c.accent : "#378ADD"}`, color: addingFieldTo === section.id ? "#fff" : "#378ADD", cursor: "pointer", fontSize: 11.5, fontWeight: 600, padding: "2px 10px", borderRadius: 5 }}
                  >
                    + Add field
                  </button>
                  {section.kind === "custom_fields" && (
                    <button
                      onClick={() => removeSection(section.id)}
                      style={{ background: "none", border: "none", color: "var(--err-ink)", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "0 4px" }}
                    >
                      × Remove
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

          {assets.length > 0 && (
            <section style={cardStyle}>
              <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>Linked assets · {assets.length}</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {assets.map((asset, idx) => (
                  <Link
                    key={asset.id}
                    href={ROUTES.asset(asset.id)}
                    style={{ display: "block", paddingTop: idx > 0 ? 8 : 0, borderTop: idx > 0 ? `1px solid ${c.line}` : "none", textDecoration: "none" }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: c.accent }}>{asset.name}</div>
                    <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2, textTransform: "capitalize" }}>
                      {asset.kind}{asset.make ? ` · ${asset.make}` : ""}{asset.model ? ` · ${asset.model}` : ""}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section style={cardStyle}>
            <h3 style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>Summary</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Detail label="Line items" value={String(lines.length)} />
              <Detail label="Offer type" value={OFFER_TYPE_LABEL[quote.type] ?? quote.type} />
              {!isTechnical && <>
                <Detail label="Subtotal"              value={inr(subtotal)} />
                {hasGst && <Detail label={`${taxLabel} ${taxRate}%`} value={inr(gst)} />}
                <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: `1px solid ${c.line}`, fontSize: 13, fontWeight: 600 }}>
                  <span>Total</span>
                  <span style={{ color: c.accent }}>{inr(grandTotal)}</span>
                </div>
              </>}
            </div>
          </section>

        </div>
      </div>
      )}

      {composeOpen && (
        <EmailComposeModal
          quoteId={quote.id}
          defaultRecipient={emailRecipient}
          vars={emailVars}
          onClose={() => setComposeOpen(false)}
          onSent={() => { setComposeOpen(false); setEmailState("sent"); }}
        />
      )}
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
