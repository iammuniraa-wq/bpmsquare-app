"use client";

import { useState, useMemo, useEffect, useTransition } from "react";
import Link from "next/link";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data/labels";
import type { Account, Asset, Contact, PricingItem, TextFragment, PricingCategory } from "@/lib/types";
import { Gear, Zap, Droplet, Battery, Monitor, Activity } from "@/components/Icons";

// ── Styles ────────────────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  border: `1px solid ${c.line}`, borderRadius: 8,
  padding: "8px 12px", fontSize: 13, color: c.ink,
  background: c.panel, fontFamily: "inherit", outline: "none",
};
const sel: React.CSSProperties = { ...inp, cursor: "pointer" };
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em",
  marginBottom: 5,
};
const sectionTitle: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: c.muted,
  textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px",
};

const ACCOUNT_TYPE_TONE: Record<Account["type"], PillarKey> = {
  prospect: "amber", oem: "purple", direct: "blue", end_customer: "teal",
};
const CAT_LABEL: Record<PricingCategory, string> = {
  labour: "Labour", material: "Materials", testing: "Testing", transport: "Transport",
};

const KIND_LABEL: Record<Asset["kind"], string> = {
  motor: "Motor", transformer: "Transformer", pump: "Pump",
  generator: "Generator", panel: "Panel",
};
function KindIcon({ kind, size = 14, color }: { kind: string; size?: number; color?: string }) {
  const p = { size, color: color ?? "currentColor" };
  switch (kind) {
    case "motor":       return <Gear {...p} />;
    case "transformer": return <Zap {...p} />;
    case "pump":        return <Droplet {...p} />;
    case "generator":   return <Battery {...p} />;
    case "panel":       return <Monitor {...p} />;
    default:            return <Activity {...p} />;
  }
}
const KIND_TONE: Record<Asset["kind"], PillarKey> = {
  motor: "blue", transformer: "amber", pump: "teal", generator: "green", panel: "purple",
};

type LineItem = { id: string; description: string; qty: string; rate: string; discount: string; group_id?: string | null; group_label?: string | null };
type GroupRow = { kind: "group"; id: string; label: string; items: LineItem[]; group_type: "additive" | "alternative" };
type LineRow  = { kind: "line" } & LineItem;
type Row = LineRow | GroupRow;

const DRAFT_KEY = "vvcrm_quote_draft";

function saveDraft(data: object) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch { /* noop */ }
}
function loadDraft() {
  try { const r = sessionStorage.getItem(DRAFT_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* noop */ }
}

const ASSET_KINDS: { value: Asset["kind"]; label: string }[] = [
  { value: "motor",       label: "Motor" },
  { value: "transformer", label: "Transformer" },
  { value: "pump",        label: "Pump" },
  { value: "generator",   label: "Generator" },
  { value: "panel",       label: "Panel" },
];

type Props = {
  accounts: Account[];
  contacts: Contact[];
  assets: Asset[];
  pricingItems: PricingItem[];
  textFragments: TextFragment[];
};

export default function QuoteForm({ accounts, contacts, assets: initialAssets, pricingItems, textFragments }: Props) {
  const today        = new Date().toISOString().slice(0, 10);
  const defaultValid = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

  // Local assets — starts from server-loaded list, new ones appended without page reload
  const [localAssets, setLocalAssets] = useState<Asset[]>(initialAssets);

  // Account & contact
  const [accountId, setAccountId] = useState("");
  const [contactId, setContactId] = useState("");

  // Quote meta
  const [quoteName, setQuoteName]   = useState("");
  const [quoteDate, setQuoteDate]   = useState(today);
  const [validUntil, setValidUntil] = useState(defaultValid);
  const [poNumber, setPoNumber]     = useState("");
  const [poAmount, setPoAmount]     = useState("");
  const [owner, setOwner]           = useState("VP — Admin");

  // Linked assets
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [assetPickerOpen, setAssetPickerOpen]   = useState(false);

  // Line items & groups
  const [rows, setRows] = useState<Row[]>([
    { kind: "line", id: "1", description: "", qty: "1", rate: "0", discount: "" },
  ]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedAltId, setSelectedAltId] = useState<string | null>(null);

  // Discount
  const [discountType, setDiscountType]   = useState<"pct" | "fixed">("pct");
  const [discountPct, setDiscountPct]     = useState("0");
  const [discountFixed, setDiscountFixed] = useState("0");

  // Notes & terms
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");

  // Create-asset drawer (opened from within the form — no page navigation)
  const [createAssetOpen, setCreateAssetOpen] = useState(false);
  const [newAsset, setNewAsset] = useState({ name: "", kind: "motor" as Asset["kind"], make: "", model: "", serial: "", rating: "", notes: "" });
  const [createAssetPending, startCreateAsset] = useTransition();
  const [createAssetError, setCreateAssetError] = useState("");
  const setNA = (k: keyof typeof newAsset) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setNewAsset((p) => ({ ...p, [k]: e.target.value }));

  function handleCreateAsset(e: React.FormEvent) {
    e.preventDefault();
    setCreateAssetError("");
    startCreateAsset(async () => {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newAsset, account_id: accountId || null }),
      });
      const json = await res.json();
      if (!res.ok) { setCreateAssetError(json.error ?? "Failed to create asset"); return; }
      // Append to local list and auto-select it
      const created: Asset = { id: json.id, account_id: accountId || null, ...newAsset, is_loaner: false, loaner_status: null };
      setLocalAssets((p) => [...p, created]);
      setSelectedAssetIds((p) => [...p, json.id]);
      setCreateAssetOpen(false);
      setNewAsset({ name: "", kind: "motor", make: "", model: "", serial: "", rating: "", notes: "" });
    });
  }

  // UI panels
  const [catalogOpen, setCatalogOpen]     = useState(false);
  const [catalogTarget, setCatalogTarget] = useState<string | null>(null);
  const [catalogCat, setCatalogCat]       = useState<PricingCategory | "">("");
  const [fragTarget, setFragTarget]       = useState<"notes" | "terms" | null>(null);
  const [savedId, setSavedId]             = useState<string | null>(null);
  const [saveError, setSaveError]         = useState("");
  const [savePending, startSave]          = useTransition();
  const [hasDraft, setHasDraft]           = useState(false);

  // Case carry-over
  type CaseSource = { caseId: string; caseRef: string; accountId: string; findings: string; recommendations: string; estimatedCost: number | null };
  const [caseSource, setCaseSource] = useState<CaseSource | null>(null);
  const [carryoverDismissed, setCarryoverDismissed] = useState(false);

  useEffect(() => {
    setHasDraft(!!sessionStorage.getItem(DRAFT_KEY));
    try {
      const raw = sessionStorage.getItem("vvcrm_quote_source");
      if (raw) {
        sessionStorage.removeItem("vvcrm_quote_source");
        setCaseSource(JSON.parse(raw) as CaseSource);
      }
    } catch { /* ignore */ }
  }, []);

  function applyCarryover() {
    if (!caseSource) return;
    setAccountId(caseSource.accountId);
    const parts: string[] = [];
    if (caseSource.findings) parts.push(`Findings:\n${caseSource.findings}`);
    if (caseSource.recommendations) parts.push(`Recommendations:\n${caseSource.recommendations}`);
    setNotes(parts.join("\n\n"));
    setCarryoverDismissed(true);
  }

  const quoteRef = useMemo(() => {
    const n = 160 + Math.floor(Math.random() * 30);
    return `QT-2026-${String(n).padStart(4, "0")}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore draft or pre-fill from copy-quote on first mount
  useEffect(() => {
    // Copy-quote takes priority over draft
    const copyRaw = sessionStorage.getItem("vvcrm_copy_quote");
    if (copyRaw) {
      sessionStorage.removeItem("vvcrm_copy_quote");
      try {
        const copy = JSON.parse(copyRaw);
        if (copy.accountId) setAccountId(copy.accountId);
        if (copy.quoteName) setQuoteName(copy.quoteName);
        if (copy.notes)     setNotes(copy.notes);
        if (Array.isArray(copy.rows)  && copy.rows.length  > 0) setRows(copy.rows);
        else if (Array.isArray(copy.lines) && copy.lines.length > 0)
          setRows(copy.lines.map((l: LineItem) => ({ kind: "line" as const, ...l })));
      } catch { /* malformed — ignore */ }
      return;
    }
    // Restore auto-saved draft
    const draft = loadDraft();
    if (!draft) return;
    if (draft.accountId)    setAccountId(draft.accountId);
    if (draft.contactId)    setContactId(draft.contactId);
    if (draft.quoteName)    setQuoteName(draft.quoteName);
    if (draft.quoteDate)    setQuoteDate(draft.quoteDate);
    if (draft.validUntil)   setValidUntil(draft.validUntil);
    if (draft.poNumber)     setPoNumber(draft.poNumber);
    if (draft.poAmount)     setPoAmount(draft.poAmount);
    if (draft.owner)        setOwner(draft.owner);
    if (draft.notes)        setNotes(draft.notes);
    if (draft.terms)        setTerms(draft.terms);
    if (draft.discountType) setDiscountType(draft.discountType);
    if (draft.discountPct)  setDiscountPct(draft.discountPct);
    if (draft.discountFixed) setDiscountFixed(draft.discountFixed);
    if (Array.isArray(draft.rows) && draft.rows.length > 0)
      setRows(draft.rows.map((r: Row) => r.kind === "group" ? { ...r, group_type: r.group_type ?? "additive" } : r));
    else if (Array.isArray(draft.lines) && draft.lines.length > 0)
      setRows(draft.lines.map((l: LineItem) => ({ kind: "line" as const, ...l })));
    if (draft.selectedAltId !== undefined) setSelectedAltId(draft.selectedAltId);
    if (Array.isArray(draft.selectedAssetIds) && draft.selectedAssetIds.length > 0) setSelectedAssetIds(draft.selectedAssetIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save draft on every change
  useEffect(() => {
    saveDraft({
      accountId, contactId, quoteName, quoteDate, validUntil,
      poNumber, poAmount, owner, notes, terms,
      discountType, discountPct, discountFixed,
      rows, selectedAssetIds, selectedAltId,
    });
  }, [accountId, contactId, quoteName, quoteDate, validUntil,
      poNumber, poAmount, owner, notes, terms,
      discountType, discountPct, discountFixed,
      rows, selectedAssetIds, selectedAltId]);

  const accountContacts = contacts.filter((ct) => ct.account_id === accountId);
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const accountAssets   = localAssets.filter((a) => a.account_id === accountId);
  const selectedAssets  = selectedAssetIds
    .map((id) => localAssets.find((a) => a.id === id))
    .filter((a): a is Asset => !!a);

  // For total: standalone lines + additive groups + only the selected alternative group
  const altGroups = rows.filter((r): r is GroupRow => r.kind === "group" && r.group_type === "alternative");
  const effectiveAltId = selectedAltId ?? altGroups[0]?.id ?? null;
  const allLineItems: LineItem[] = rows.flatMap((r) => {
    if (r.kind === "line") return [r];
    if (r.group_type === "additive") return r.items;
    return r.id === effectiveAltId ? r.items : [];
  });
  const parsedLines = allLineItems.map((l) => {
    const qty  = parseFloat(l.qty) || 0;
    const rate = parseFloat(l.rate) || 0;
    const disc = Math.max(0, Math.min(100, parseFloat(l.discount) || 0));
    const amount = qty * rate * (1 - disc / 100);
    return { ...l, qty, rate, disc, amount };
  });
  const subtotal = parsedLines.reduce((s, l) => s + l.amount, 0);
  const discPct    = Math.max(0, Math.min(100, parseFloat(discountPct) || 0));
  const discAmount = discountType === "pct"
    ? Math.round(subtotal * discPct / 100)
    : Math.min(Math.round(parseFloat(discountFixed) || 0), subtotal);
  const total  = subtotal - discAmount;
  const poVal  = parseFloat(poAmount) || 0;

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  // ── Row / line / group handlers ─────────────────────────────────────────────
  const newLineItem = (): LineItem => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, description: "", qty: "1", rate: "0", discount: "" });

  const addLine  = () => setRows((p) => [...p, { kind: "line", ...newLineItem() }]);
  const addGroup = () => setRows((p) => [...p, { kind: "group", id: `${Date.now()}`, label: "Group", group_type: "additive", items: [newLineItem()] }]);
  const addAlternative = () => {
    const gid = `${Date.now()}`;
    setRows((p) => [...p, { kind: "group", id: gid, label: "Option A", group_type: "alternative", items: [newLineItem()] }]);
    setSelectedAltId((prev) => prev ?? gid);
  };

  const removeRow = (rowId: string) => {
    setRows((p) => { const n = p.filter((r) => r.id !== rowId); return n.length ? n : [{ kind: "line", ...newLineItem() }]; });
    setSelectedIds((p) => { const n = new Set(p); n.delete(rowId); return n; });
  };

  const updateLine = (lineId: string, field: keyof LineItem, val: string) =>
    setRows((p) => p.map((r) => {
      if (r.kind === "line"  && r.id === lineId) return { ...r, [field]: val };
      if (r.kind === "group") return { ...r, items: r.items.map((i) => i.id === lineId ? { ...i, [field]: val } : i) };
      return r;
    }));

  const addLineToGroup    = (gid: string) => setRows((p) => p.map((r) => r.kind === "group" && r.id === gid ? { ...r, items: [...r.items, newLineItem()] } : r));
  const removeLineFromGroup = (gid: string, lid: string) => setRows((p) => p.map((r) => {
    if (r.kind !== "group" || r.id !== gid) return r;
    const items = r.items.filter((i) => i.id !== lid);
    return { ...r, items: items.length ? items : [newLineItem()] };
  }));
  const updateGroupLabel  = (gid: string, label: string) => setRows((p) => p.map((r) => r.kind === "group" && r.id === gid ? { ...r, label } : r));
  const ungroup           = (gid: string) => setRows((p) => p.flatMap((r) => r.kind === "group" && r.id === gid ? r.items.map((i): Row => ({ kind: "line", ...i })) : [r]));

  const toggleSelect = (lid: string) => setSelectedIds((p) => { const n = new Set(p); n.has(lid) ? n.delete(lid) : n.add(lid); return n; });

  const groupSelected = () => {
    if (selectedIds.size < 2) return;
    const gid = `${Date.now()}`;
    const groupItems: LineItem[] = [];
    let insertAt = -1;
    const rest: Row[] = [];
    rows.forEach((r, i) => {
      if (r.kind === "line" && selectedIds.has(r.id)) {
        if (insertAt === -1) insertAt = i - groupItems.length;
        groupItems.push({ id: r.id, description: r.description, qty: r.qty, rate: r.rate, discount: r.discount });
      } else { rest.push(r); }
    });
    const group: GroupRow = { kind: "group", id: gid, label: "Group", group_type: "additive", items: groupItems };
    rest.splice(Math.max(0, insertAt), 0, group);
    setRows(rest);
    setSelectedIds(new Set());
  };

  const toggleAsset = (id: string) =>
    setSelectedAssetIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  // Catalog
  const openCatalog = (lineId: string) => { setCatalogTarget(lineId); setCatalogCat(""); setCatalogOpen(true); };
  const insertCatalogItem = (item: PricingItem) => {
    if (catalogTarget) { updateLine(catalogTarget, "description", item.description); updateLine(catalogTarget, "rate", String(item.rate)); }
    setCatalogOpen(false); setCatalogTarget(null);
  };
  const filteredCatalog = catalogCat ? pricingItems.filter((p) => p.category === catalogCat) : pricingItems;

  // Fragments
  const insertFragment = (frag: TextFragment) => {
    if (fragTarget === "notes") setNotes((p) => p ? p + "\n\n" + frag.text : frag.text);
    if (fragTarget === "terms") setTerms((p) => p ? p + "\n\n" + frag.text : frag.text);
    setFragTarget(null);
  };
  const noteFrags  = textFragments.filter((f) => f.category === "notes");
  const termsFrags = textFragments.filter((f) => f.category === "terms");

  function handleSave() {
    setSaveError("");
    startSave(async () => {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: accountId,
          ref: quoteRef,
          type: "repair",
          total,
          valid_until: null,
          notes,
          terms,
          selected_option_id: effectiveAltId,
          lines: rows.flatMap((r): { description: string; qty: string; rate: string; discount_pct: number; group_id: string | null; group_label: string | null; group_type: string | null }[] =>
            r.kind === "line"
              ? [{ description: r.description, qty: r.qty, rate: r.rate, discount_pct: Math.max(0, Math.min(100, parseFloat(r.discount) || 0)), group_id: null, group_label: null, group_type: null }]
              : r.items.map((i) => ({ description: i.description, qty: i.qty, rate: i.rate, discount_pct: Math.max(0, Math.min(100, parseFloat(i.discount) || 0)), group_id: r.id, group_label: r.label, group_type: r.group_type }))
          ),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setSaveError(json.error ?? "Save failed"); return; }
      clearDraft();
      setSavedId(json.id);
    });
  }

  // ── Success screen ────────────────────────────────────────────────────────
  if (savedId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "55vh", gap: 14, textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: pillar.green.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: pillar.green.base }}>✓</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: c.ink }}>Draft saved</div>
        <div style={{ fontFamily: "monospace", fontSize: 15, color: c.accent, background: c.accentbg, padding: "6px 16px", borderRadius: 8 }}>{quoteRef}</div>
        <p style={{ fontSize: 13, color: c.muted, maxWidth: 340, lineHeight: 1.6 }}>
          Saved as draft for {selectedAccount?.name ?? "the customer"}.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Link href={ROUTES.quotations} style={{ background: c.accent, color: "#fff", padding: "8px 20px", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>All quotations</Link>
          <Link href={ROUTES.quotationPrint(savedId)} target="_blank" style={{ background: pillar.teal.bg, color: pillar.teal.fg, padding: "8px 20px", borderRadius: 8, textDecoration: "none", fontSize: 13, fontWeight: 600 }}>🖨 Preview PDF</Link>
          <button onClick={() => setSavedId(null)} style={{ border: `1px solid ${c.line}`, background: c.panel, color: c.muted, padding: "8px 20px", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>Edit again</button>
        </div>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link href={ROUTES.quotations} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>← Quotations</Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: hasDraft ? 10 : 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>New Quotation</h1>
          <div style={{ fontSize: 12.5, color: c.muted, marginTop: 3, fontFamily: "monospace" }}>{quoteRef} · Draft</div>
        </div>
      </div>

      {/* Case carry-over banner */}
      {caseSource && !carryoverDismissed && (
        <div style={{
          marginBottom: 14, background: "#eef4ff", border: "1px solid #bfdbfe",
          borderLeft: "3px solid #378ADD", borderRadius: 8, padding: "12px 16px",
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1e3a5f", marginBottom: 6 }}>
            Creating quotation from case {caseSource.caseRef}
          </div>
          <div style={{ fontSize: 12, color: "#3a5a80", marginBottom: 10 }}>
            Carry over inspection findings to the quotation notes, and pre-select the account?
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={applyCarryover}
              style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "#378ADD", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer" }}>
              Yes, carry over
            </button>
            <button type="button" onClick={() => setCarryoverDismissed(true)}
              style={{ fontSize: 12, fontWeight: 500, color: "#3a5a80", background: "none", border: "1px solid #bfdbfe", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>
              Start fresh
            </button>
          </div>
        </div>
      )}

      {hasDraft && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, marginBottom: 16,
          background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8,
          padding: "8px 14px", fontSize: 12.5,
        }}>
          <span style={{ color: "#92400e" }}>⟳ Draft restored — your unsaved work has been recovered.</span>
          <button
            onClick={() => { clearDraft(); setHasDraft(false); window.location.reload(); }}
            style={{ marginLeft: "auto", fontSize: 11.5, color: "#b45309", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Discard draft
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 288px", gap: 14, alignItems: "start" }} className="hub-grid">

        {/* ── LEFT ─────────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Account & Contact */}
          <section style={cardStyle}>
            <h3 style={sectionTitle}>Account & Contact</h3>
            <div className="fg2">
              <div>
                <span style={lbl}>Account *</span>
                <select
                  style={sel}
                  value={accountId}
                  onChange={(e) => { setAccountId(e.target.value); setContactId(""); setSelectedAssetIds([]); }}
                >
                  <option value="">Select account…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {selectedAccount && (
                  <div style={{ display: "flex", gap: 6, marginTop: 7, alignItems: "center" }}>
                    <Pill label={ACCOUNT_TYPE_LABEL[selectedAccount.type]} tone={ACCOUNT_TYPE_TONE[selectedAccount.type]} />
                    {selectedAccount.city && <span style={{ fontSize: 11.5, color: c.muted }}>{selectedAccount.city}</span>}
                  </div>
                )}
              </div>
              <div>
                <span style={lbl}>Contact</span>
                <select style={{ ...sel, opacity: !accountId ? 0.5 : 1 }} value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!accountId}>
                  <option value="">{accountId ? "Select contact…" : "Choose account first"}</option>
                  {accountContacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}{ct.role ? ` · ${ct.role}` : ""}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* Quote details */}
          <section style={cardStyle}>
            <h3 style={sectionTitle}>Quote details</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="fg2">
                <div>
                  <span style={lbl}>Quote name</span>
                  <input style={inp} value={quoteName} onChange={(e) => setQuoteName(e.target.value)} placeholder="e.g. Annual maintenance — Pump rewinding" />
                </div>
                <div>
                  <span style={lbl}>Created by</span>
                  <input style={inp} value={owner} onChange={(e) => setOwner(e.target.value)} />
                </div>
              </div>
              <div className="fg3">
                <div>
                  <span style={lbl}>Reference</span>
                  <input style={{ ...inp, color: c.muted, background: c.panel2 }} value={quoteRef} readOnly />
                </div>
                <div>
                  <span style={lbl}>Date</span>
                  <input style={inp} type="date" value={quoteDate} onChange={(e) => setQuoteDate(e.target.value)} />
                </div>
                <div>
                  <span style={lbl}>Valid until</span>
                  <input style={inp} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </div>
              </div>
              <div className="fg2">
                <div>
                  <span style={lbl}>Customer PO no.</span>
                  <input style={inp} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-2026-XXXX" />
                </div>
                <div>
                  <span style={lbl}>PO amount (₹)</span>
                  <input style={inp} type="number" min="0" step="1000" value={poAmount} onChange={(e) => setPoAmount(e.target.value)} placeholder="0" />
                </div>
              </div>
            </div>
          </section>

          {/* ── Linked assets ─────────────────────────────────────────────── */}
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: selectedAssets.length > 0 ? 12 : 0 }}>
              <div>
                <h3 style={{ ...sectionTitle, margin: 0 }}>Linked assets</h3>
                {selectedAccount && (
                  <div style={{ fontSize: 11, color: c.hint, marginTop: 3 }}>
                    {accountAssets.length} asset{accountAssets.length !== 1 ? "s" : ""} registered for {selectedAccount.name}
                  </div>
                )}
              </div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                {accountId && accountAssets.length === 0 && (
                  <button
                    onClick={() => setCreateAssetOpen(true)}
                    style={{ fontSize: 11.5, color: c.accent, background: "none", border: "none", cursor: "pointer", fontWeight: 500, padding: 0 }}
                  >
                    + Create asset first
                  </button>
                )}
                <button
                  onClick={() => setAssetPickerOpen(true)}
                  disabled={!accountId || accountAssets.length === 0}
                  style={{
                    fontSize: 12, fontWeight: 600, borderRadius: 6, padding: "6px 14px", border: "none", cursor: !accountId || accountAssets.length === 0 ? "not-allowed" : "pointer",
                    background: !accountId || accountAssets.length === 0 ? c.panel2 : c.accentbg,
                    color: !accountId || accountAssets.length === 0 ? c.hint : c.accent,
                  }}
                >
                  {selectedAssets.length > 0 ? "Edit selection" : "+ Link asset"}
                </button>
              </div>
            </div>

            {/* No account selected */}
            {!accountId && (
              <div style={{ padding: "20px 0", textAlign: "center", color: c.hint, fontSize: 13 }}>
                Select an account to link its assets
              </div>
            )}

            {/* Account selected but no assets */}
            {accountId && accountAssets.length === 0 && (
              <div style={{ padding: "18px 0", textAlign: "center" }}>
                <div style={{ fontSize: 13, color: c.muted, marginBottom: 8 }}>No assets registered for this account yet.</div>
                <button
                  onClick={() => setCreateAssetOpen(true)}
                  style={{ fontSize: 13, color: c.accent, fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  + Create one now
                </button>
              </div>
            )}

            {/* Selected asset cards */}
            {selectedAssets.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {selectedAssets.map((asset) => (
                  <div
                    key={asset.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 14px", borderRadius: 8,
                      background: c.panel2, border: `1px solid ${c.line}`,
                    }}
                  >
                    {/* Kind badge */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                      background: pillar[KIND_TONE[asset.kind]].bg,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <KindIcon kind={asset.kind} size={16} color={pillar[KIND_TONE[asset.kind]].fg} />
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{asset.name}</span>
                        <Pill label={KIND_LABEL[asset.kind]} tone={KIND_TONE[asset.kind]} />
                      </div>
                      <div style={{ fontSize: 12, color: c.muted, marginBottom: 2 }}>
                        {asset.make && <span>{asset.make}</span>}
                        {asset.make && asset.model && <span style={{ margin: "0 5px", color: c.hint }}>·</span>}
                        {asset.model && <span style={{ fontWeight: 500 }}>{asset.model}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: c.hint }}>
                        {asset.serial && <span style={{ fontFamily: "monospace" }}>{asset.serial}</span>}
                        {asset.serial && asset.rating && <span style={{ margin: "0 5px" }}>·</span>}
                        {asset.rating && <span>{asset.rating}</span>}
                      </div>
                      {asset.notes && (
                        <div style={{ fontSize: 10.5, color: c.hint, marginTop: 3, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {asset.notes}
                        </div>
                      )}
                    </div>
                    {/* Remove */}
                    <button
                      onClick={() => toggleAsset(asset.id)}
                      style={{ background: "none", border: "none", color: c.hint, fontSize: 18, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}
                      title="Unlink asset"
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state when account has assets but none selected */}
            {accountId && accountAssets.length > 0 && selectedAssets.length === 0 && (
              <div style={{ padding: "16px 0", textAlign: "center", color: c.hint, fontSize: 13 }}>
                No assets linked yet — click <strong>+ Link asset</strong> to choose
              </div>
            )}
          </section>

          {/* Line items */}
          <section style={cardStyle}>
            {/* Toolbar */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <h3 style={{ ...sectionTitle, margin: 0 }}>Line items</h3>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {selectedIds.size >= 2 && (
                  <button onClick={groupSelected} style={{ fontSize: 12, fontWeight: 600, color: "#0c447c", background: "#e6f1fb", border: "1px solid #c5dbf5", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>
                    ▦ Group selected ({selectedIds.size})
                  </button>
                )}
                <button onClick={addAlternative} style={{ fontSize: 12, fontWeight: 600, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>
                  ⊕ Add option
                </button>
                <button onClick={addGroup} style={{ fontSize: 12, fontWeight: 600, color: c.muted, background: c.panel2, border: `1px solid ${c.line}`, borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>
                  + Add group
                </button>
                <button onClick={addLine} style={{ fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>
                  + Add line
                </button>
              </div>
            </div>

            {/* Column headers — only shown above standalone lines */}
            <div style={{ display: "grid", gridTemplateColumns: "20px 1fr 60px 100px 68px 100px 32px", gap: 8, marginBottom: 6 }}>
              {["", "Description", "Qty", "Rate (₹)", "Disc %", "Amount", ""].map((h) => (
                <div key={h} style={{ fontSize: 10.5, fontWeight: 600, color: c.hint, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</div>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.map((row) => {
                if (row.kind === "line") {
                  const qty    = parseFloat(row.qty) || 0;
                  const rate   = parseFloat(row.rate) || 0;
                  const disc   = Math.max(0, Math.min(100, parseFloat(row.discount) || 0));
                  const amount = qty * rate * (1 - disc / 100);
                  const sel    = selectedIds.has(row.id);
                  return (
                    <div key={row.id} style={{ display: "grid", gridTemplateColumns: "20px 1fr 60px 100px 68px 100px 32px", gap: 8, alignItems: "start", borderBottom: `1px solid ${c.line}`, background: sel ? c.accentbg : "transparent", borderRadius: sel ? 6 : 0, padding: sel ? "4px 6px 8px" : "0 0 8px" }}>
                      <div style={{ paddingTop: 10 }}>
                        <input type="checkbox" checked={sel} onChange={() => toggleSelect(row.id)} style={{ width: 13, height: 13, accentColor: c.accent, cursor: "pointer" }} />
                      </div>
                      <div>
                        <textarea style={{ ...inp, resize: "vertical", minHeight: 58, lineHeight: 1.5 }} value={row.description} onChange={(e) => updateLine(row.id, "description", e.target.value)} placeholder="Describe the service or item…" />
                        <button onClick={() => openCatalog(row.id)} style={{ marginTop: 4, fontSize: 11, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>◈ From catalog</button>
                      </div>
                      <input style={{ ...inp, textAlign: "center" }} type="number" min="0" step="1" value={row.qty} onChange={(e) => updateLine(row.id, "qty", e.target.value)} />
                      <input style={{ ...inp, textAlign: "right" }} type="number" min="0" step="100" value={row.rate} onChange={(e) => updateLine(row.id, "rate", e.target.value)} />
                      <input style={{ ...inp, textAlign: "right", color: disc > 0 ? "#d97706" : c.muted }} type="number" min="0" max="100" step="0.5" value={row.discount} onChange={(e) => updateLine(row.id, "discount", e.target.value)} placeholder="0" />
                      <div style={{ textAlign: "right", paddingTop: 8 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: c.ink }}>{fmt(amount)}</div>
                        {disc > 0 && <div style={{ fontSize: 10.5, color: "#d97706", marginTop: 1 }}>−{disc}%</div>}
                      </div>
                      <button onClick={() => removeRow(row.id)} style={{ color: c.hint, background: "none", border: "none", fontSize: 18, cursor: "pointer", paddingTop: 6, lineHeight: 1 }} title="Remove">×</button>
                    </div>
                  );
                }

                // Group row
                const isAlt = row.group_type === "alternative";
                const isSelectedAlt = isAlt && row.id === effectiveAltId;
                const groupColor = isAlt ? "#d97706" : c.accent;
                const groupBg    = isAlt ? "#fffbeb" : `${c.accent}06`;
                const groupBorder = isAlt ? "#fde68a" : `${c.accent}40`;
                const groupTotal = row.items.reduce((s, i) => {
                  const qty  = parseFloat(i.qty) || 0;
                  const rate = parseFloat(i.rate) || 0;
                  const disc = Math.max(0, Math.min(100, parseFloat(i.discount) || 0));
                  return s + qty * rate * (1 - disc / 100);
                }, 0);
                return (
                  <div key={row.id} style={{ border: `1px solid ${groupBorder}`, borderLeft: `3px solid ${groupColor}`, borderRadius: 8, background: groupBg, padding: "10px 12px", marginBottom: 2, opacity: isAlt && !isSelectedAlt ? 0.6 : 1 }}>
                    {/* Group header */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 12, color: groupColor }}>{isAlt ? "⊕" : "▦"}</span>
                      {isAlt && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>
                          OPTION
                        </span>
                      )}
                      <input
                        value={row.label}
                        onChange={(e) => updateGroupLabel(row.id, e.target.value)}
                        style={{ flex: 1, fontSize: 13, fontWeight: 600, border: "none", background: "transparent", color: c.ink, outline: "none", borderBottom: `1px dashed ${c.line}`, padding: "2px 0" }}
                        placeholder={isAlt ? "Option name (e.g. Option A)…" : "Group name…"}
                      />
                      {isAlt && (
                        isSelectedAlt ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#065f46", background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 5, padding: "2px 8px", whiteSpace: "nowrap" }}>✓ Selected</span>
                        ) : (
                          <button onClick={() => setSelectedAltId(row.id)} style={{ fontSize: 11, fontWeight: 600, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 5, padding: "2px 8px", cursor: "pointer", whiteSpace: "nowrap" }}>
                            Select this option
                          </button>
                        )
                      )}
                      <button onClick={() => ungroup(row.id)} style={{ fontSize: 11, color: c.muted, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", whiteSpace: "nowrap" }}>Ungroup</button>
                      <button onClick={() => removeRow(row.id)} style={{ color: c.hint, background: "none", border: "none", fontSize: 18, cursor: "pointer", lineHeight: 1 }} title="Delete group">×</button>
                    </div>

                    {/* Column headers inside group */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 100px 68px 100px 32px", gap: 8, marginBottom: 4, paddingLeft: 4 }}>
                      {["Description", "Qty", "Rate (₹)", "Disc %", "Amount", ""].map((h) => (
                        <div key={h} style={{ fontSize: 10, fontWeight: 600, color: c.hint, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</div>
                      ))}
                    </div>

                    {/* Group line items */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {row.items.map((item) => {
                        const qty    = parseFloat(item.qty) || 0;
                        const rate   = parseFloat(item.rate) || 0;
                        const disc   = Math.max(0, Math.min(100, parseFloat(item.discount) || 0));
                        const amount = qty * rate * (1 - disc / 100);
                        return (
                          <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 60px 100px 68px 100px 32px", gap: 8, alignItems: "start", paddingBottom: 6, borderBottom: `1px solid ${c.accent}20` }}>
                            <div>
                              <textarea style={{ ...inp, resize: "vertical", minHeight: 48, lineHeight: 1.5, fontSize: 12.5 }} value={item.description} onChange={(e) => updateLine(item.id, "description", e.target.value)} placeholder="Line description…" />
                              <button onClick={() => openCatalog(item.id)} style={{ marginTop: 3, fontSize: 10.5, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>◈ Catalog</button>
                            </div>
                            <input style={{ ...inp, textAlign: "center", fontSize: 12.5 }} type="number" min="0" step="1" value={item.qty} onChange={(e) => updateLine(item.id, "qty", e.target.value)} />
                            <input style={{ ...inp, textAlign: "right", fontSize: 12.5 }} type="number" min="0" step="100" value={item.rate} onChange={(e) => updateLine(item.id, "rate", e.target.value)} />
                            <input style={{ ...inp, textAlign: "right", fontSize: 12.5, color: disc > 0 ? "#d97706" : c.muted }} type="number" min="0" max="100" step="0.5" value={item.discount} onChange={(e) => updateLine(item.id, "discount", e.target.value)} placeholder="0" />
                            <div style={{ textAlign: "right", paddingTop: 8 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{fmt(amount)}</div>
                              {disc > 0 && <div style={{ fontSize: 10, color: "#d97706", marginTop: 1 }}>−{disc}%</div>}
                            </div>
                            <button onClick={() => removeLineFromGroup(row.id, item.id)} style={{ color: c.hint, background: "none", border: "none", fontSize: 16, cursor: "pointer", paddingTop: 6, lineHeight: 1 }} title="Remove line">×</button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Group footer */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingTop: 6 }}>
                      <button onClick={() => addLineToGroup(row.id)} style={{ fontSize: 11.5, color: groupColor, background: "none", border: "none", cursor: "pointer", padding: 0 }}>+ Add line</button>
                      <span style={{ fontSize: 12, color: c.muted }}>{isAlt ? "Option total" : "Group total"}: <strong style={{ color: c.ink, marginLeft: 4 }}>{fmt(groupTotal)}</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Notes */}
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ ...sectionTitle, margin: 0 }}>Notes</h3>
              <button onClick={() => setFragTarget("notes")} style={{ marginLeft: "auto", fontSize: 11.5, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>+ Insert template</button>
            </div>
            <textarea style={{ ...inp, minHeight: 88, resize: "vertical", lineHeight: 1.6 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes for the customer (payment terms, special conditions, delivery notes)…" />
          </section>

          {/* Terms */}
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ ...sectionTitle, margin: 0 }}>Terms & Conditions</h3>
              <button onClick={() => setFragTarget("terms")} style={{ marginLeft: "auto", fontSize: 11.5, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>+ Use preset</button>
            </div>
            <textarea style={{ ...inp, minHeight: 100, resize: "vertical", lineHeight: 1.6, fontFamily: "inherit" }} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Standard terms and conditions…" />
          </section>
        </div>

        {/* ── RIGHT ────────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "sticky", top: 20 }}>

          {/* Summary */}
          <section style={cardStyle}>
            <h3 style={sectionTitle}>Summary</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {parsedLines.map((l, i) => l.amount > 0 && (
                <div key={l.id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, borderTop: `1px solid ${c.line}`, color: c.muted }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{l.description || `Line ${i + 1}`}</span>
                  <span style={{ flexShrink: 0, marginLeft: 8 }}>{fmt(l.amount)}</span>
                </div>
              ))}
            </div>

            <div style={{ borderTop: `1px solid ${c.line}`, marginTop: 10, paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: c.muted }}>
                <span>Subtotal</span>
                <span style={{ fontWeight: 600, color: c.ink }}>{fmt(subtotal)}</span>
              </div>

              {/* Discount */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: c.muted }}>Discount</span>
                  <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: `1px solid ${c.line}` }}>
                    {(["pct", "fixed"] as const).map((t) => (
                      <button key={t} onClick={() => setDiscountType(t)} style={{ padding: "3px 11px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: discountType === t ? c.accent : c.panel2, color: discountType === t ? "#fff" : c.muted }}>
                        {t === "pct" ? "%" : "₹"}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                  {discountType === "pct" ? (
                    <>
                      <input type="number" min="0" max="100" step="0.5" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} style={{ width: 52, border: `1px solid ${c.line}`, borderRadius: 6, padding: "3px 6px", fontSize: 12, textAlign: "right", color: c.ink, fontFamily: "inherit" }} />
                      <span style={{ fontSize: 11, color: c.hint }}>%</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, color: c.hint }}>₹</span>
                      <input type="number" min="0" step="100" value={discountFixed} onChange={(e) => setDiscountFixed(e.target.value)} style={{ width: 84, border: `1px solid ${c.line}`, borderRadius: 6, padding: "3px 6px", fontSize: 12, textAlign: "right", color: c.ink, fontFamily: "inherit" }} />
                    </>
                  )}
                  <span style={{ fontWeight: 600, color: discAmount > 0 ? pillar.red.fg : c.muted, minWidth: 60, textAlign: "right" }}>
                    {discAmount > 0 ? `− ${fmt(discAmount)}` : "—"}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: pillar.green.bg, borderRadius: 9, marginTop: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: pillar.green.fg }}>Total</span>
                <span style={{ fontSize: 17, fontWeight: 800, color: pillar.green.fg }}>{fmt(total)}</span>
              </div>
            </div>
          </section>

          {/* PO status */}
          {(poNumber || poAmount) && (
            <section style={{ ...cardStyle, background: c.panel2, padding: "12px 14px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Customer PO</div>
              {poNumber && <div style={{ fontSize: 12.5, color: c.ink, fontFamily: "monospace", marginBottom: 6 }}>{poNumber}</div>}
              {poAmount && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 11.5, color: c.muted }}>PO value</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>{fmt(poVal)}</span>
                </div>
              )}
              {poAmount && total > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 6, borderTop: `1px solid ${c.line}` }}>
                  <span style={{ fontSize: 11, color: c.hint }}>Quote vs PO</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: total <= poVal ? pillar.green.fg : pillar.red.fg }}>
                    {total <= poVal ? "✓ Within PO" : `▲ Exceeds by ${fmt(total - poVal)}`}
                  </span>
                </div>
              )}
            </section>
          )}

          {/* Linked assets summary */}
          {selectedAssets.length > 0 && (
            <section style={{ ...cardStyle, padding: "12px 14px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                Assets · {selectedAssets.length}
              </div>
              {selectedAssets.map((asset, idx) => (
                <div key={asset.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: idx > 0 ? `1px solid ${c.line}` : "none" }}>
                  <KindIcon kind={asset.kind} size={14} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: c.ink, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.name}</div>
                    {(asset.make || asset.model) && (
                      <div style={{ fontSize: 10.5, color: c.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[asset.make, asset.model].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    {asset.serial && <div style={{ fontSize: 10.5, color: c.hint, fontFamily: "monospace" }}>{asset.serial}</div>}
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* Owner */}
          <div style={{ fontSize: 11, color: c.hint, textAlign: "center" }}>
            Created by <span style={{ color: c.muted, fontWeight: 600 }}>{owner || "—"}</span>
          </div>

          {/* Actions */}
          <section style={cardStyle}>
            <h3 style={sectionTitle}>Actions</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {saveError && <div style={{ fontSize: 12, color: "#dc2626", background: "#fef2f2", borderRadius: 7, padding: "6px 10px" }}>{saveError}</div>}
              <button onClick={handleSave} disabled={!accountId || savePending} style={{ width: "100%", padding: "10px 0", borderRadius: 9, fontSize: 13.5, fontWeight: 700, background: accountId ? c.accent : c.line, color: accountId ? "#fff" : c.hint, border: "none", cursor: accountId && !savePending ? "pointer" : "not-allowed" }}>
                {savePending ? "Saving…" : "Save as draft"}
              </button>
              <button disabled style={{ width: "100%", padding: "9px 0", borderRadius: 9, fontSize: 13, fontWeight: 600, background: c.panel2, color: c.muted, border: `1px solid ${c.line}`, cursor: "not-allowed", opacity: 0.7 }}>Send to customer · Coming soon</button>
            </div>
          </section>

          <div style={{ fontSize: 11.5, color: c.hint, textAlign: "center" }}>
            {parsedLines.filter((l) => l.amount > 0).length} of {allLineItems.length} line{allLineItems.length !== 1 ? "s" : ""} have values
          </div>
        </div>
      </div>

      {/* ── Asset picker panel ────────────────────────────────────────────── */}
      {assetPickerOpen && (
        <>
          <div onClick={() => setAssetPickerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(14,26,40,.45)", zIndex: 998 }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 420, background: c.panel, zIndex: 999, display: "flex", flexDirection: "column", boxShadow: "-6px 0 32px rgba(0,0,0,.18)" }}>
            {/* Header */}
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: c.ink }}>Link assets</div>
                <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>
                  {selectedAccount?.name} · {accountAssets.length} asset{accountAssets.length !== 1 ? "s" : ""}
                </div>
              </div>
              <button onClick={() => setAssetPickerOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 20, color: c.muted, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>

            {/* Asset list */}
            <div style={{ flex: 1, overflowY: "auto" }}>
              {accountAssets.map((asset) => {
                const selected = selectedAssetIds.includes(asset.id);
                return (
                  <button
                    key={asset.id}
                    onClick={() => toggleAsset(asset.id)}
                    style={{
                      width: "100%", textAlign: "left", padding: "14px 20px",
                      background: selected ? c.accentbg : "none",
                      border: "none", borderBottom: `1px solid ${c.line}`,
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 12,
                    }}
                    onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = c.panel2; }}
                    onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "none"; }}
                  >
                    {/* Checkbox */}
                    <div style={{
                      width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                      border: `2px solid ${selected ? c.accent : c.line}`,
                      background: selected ? c.accent : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 11, color: "#fff", fontWeight: 700,
                    }}>
                      {selected ? "✓" : ""}
                    </div>
                    {/* Kind icon */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      background: pillar[KIND_TONE[asset.kind]].bg,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <KindIcon kind={asset.kind} size={16} color={pillar[KIND_TONE[asset.kind]].fg} />
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{asset.name}</span>
                        <Pill label={KIND_LABEL[asset.kind]} tone={KIND_TONE[asset.kind]} />
                      </div>
                      <div style={{ fontSize: 12, color: c.muted, marginBottom: 2 }}>
                        {asset.make && <span>{asset.make}</span>}
                        {asset.make && asset.model && <span style={{ margin: "0 5px", color: c.hint }}>·</span>}
                        {asset.model && <span style={{ fontWeight: 500 }}>{asset.model}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: c.hint }}>
                        {asset.serial && <span style={{ fontFamily: "monospace" }}>{asset.serial}</span>}
                        {asset.serial && asset.rating && <span style={{ margin: "0 5px" }}>·</span>}
                        {asset.rating && <span>{asset.rating}</span>}
                      </div>
                      {asset.notes && (
                        <div style={{ fontSize: 10.5, color: c.hint, marginTop: 3, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {asset.notes}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div style={{ padding: "14px 20px", borderTop: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: c.muted }}>
                {selectedAssetIds.length} selected
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => { setAssetPickerOpen(false); setCreateAssetOpen(true); }}
                  style={{ fontSize: 12, color: c.accent, background: "none", padding: "7px 14px", border: `1px solid ${c.accent}`, borderRadius: 7, fontWeight: 500, cursor: "pointer" }}
                >
                  + Create new asset
                </button>
                <button
                  onClick={() => setAssetPickerOpen(false)}
                  style={{ fontSize: 13, fontWeight: 600, color: "#fff", background: c.accent, border: "none", borderRadius: 7, padding: "7px 18px", cursor: "pointer" }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Catalog slide panel ──────────────────────────────────────────── */}
      {catalogOpen && (
        <>
          <div onClick={() => setCatalogOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(14,26,40,.45)", zIndex: 998 }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 400, background: c.panel, zIndex: 999, display: "flex", flexDirection: "column", boxShadow: "-6px 0 32px rgba(0,0,0,.18)" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: c.ink }}>Pricing catalog</div>
                <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>Click an item to insert it into the line</div>
              </div>
              <button onClick={() => setCatalogOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 20, color: c.muted, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "flex", gap: 6, padding: "12px 16px", borderBottom: `1px solid ${c.line}`, flexWrap: "wrap" }}>
              {(["", "labour", "material", "testing", "transport"] as const).map((cat) => (
                <button key={cat} onClick={() => setCatalogCat(cat as PricingCategory | "")} style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, background: catalogCat === cat ? c.accent : c.panel2, color: catalogCat === cat ? "#fff" : c.muted }}>
                  {cat === "" ? "All" : CAT_LABEL[cat as PricingCategory]}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {(["labour", "material", "testing", "transport"] as PricingCategory[]).filter((cat) => !catalogCat || catalogCat === cat).map((cat) => {
                const items = filteredCatalog.filter((p) => p.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat}>
                    <div style={{ padding: "8px 20px 4px", fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: "0.08em" }}>{CAT_LABEL[cat]}</div>
                    {items.map((item) => (
                      <button key={item.id} onClick={() => insertCatalogItem(item)} style={{ width: "100%", textAlign: "left", padding: "10px 20px", background: "none", border: "none", cursor: "pointer", borderBottom: `1px solid ${c.line}` }} onMouseEnter={(e) => (e.currentTarget.style.background = c.panel2)} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
                        <div style={{ fontSize: 12.5, color: c.ink, fontWeight: 500, lineHeight: 1.4 }}>{item.description}</div>
                        <div style={{ display: "flex", gap: 10, marginTop: 4, alignItems: "center" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: c.accent }}>₹{item.rate.toLocaleString("en-IN")}</span>
                          <span style={{ fontSize: 11, color: c.hint }}>/ {item.unit}</span>
                          {item.notes && <span style={{ fontSize: 10.5, color: c.hint, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>· {item.notes}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Create asset drawer ─────────────────────────────────────────── */}
      {createAssetOpen && (
        <>
          <div onClick={() => setCreateAssetOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(14,26,40,.45)", zIndex: 998 }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 440, background: c.panel, zIndex: 999, display: "flex", flexDirection: "column", boxShadow: "-6px 0 32px rgba(0,0,0,.18)" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: c.ink }}>New asset</div>
                <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>
                  {selectedAccount ? `Linked to ${selectedAccount.name}` : "No account selected"}
                </div>
              </div>
              <button onClick={() => setCreateAssetOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 20, color: c.muted, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>

            <form onSubmit={handleCreateAsset} style={{ flex: 1, overflowY: "auto", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={lbl}>Asset name *</label>
                <input style={inp} value={newAsset.name} onChange={setNA("name")} required placeholder="e.g. Ring-frame drive motor" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={lbl}>Kind *</label>
                  <select style={sel} value={newAsset.kind} onChange={setNA("kind")} required>
                    {ASSET_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Make / brand</label>
                  <input style={inp} value={newAsset.make} onChange={setNA("make")} placeholder="e.g. Crompton Greaves" />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={lbl}>Model</label>
                  <input style={inp} value={newAsset.model} onChange={setNA("model")} placeholder="e.g. ND315S-2" />
                </div>
                <div>
                  <label style={lbl}>Serial no.</label>
                  <input style={inp} value={newAsset.serial} onChange={setNA("serial")} placeholder="e.g. CG-75-2291" />
                </div>
              </div>
              <div>
                <label style={lbl}>Rating / specs</label>
                <input style={inp} value={newAsset.rating} onChange={setNA("rating")} placeholder="e.g. 75 kW · 415V · 1480 rpm" />
              </div>
              <div>
                <label style={lbl}>Notes / history</label>
                <textarea style={{ ...inp, resize: "vertical", minHeight: 64 }} value={newAsset.notes} onChange={setNA("notes")} placeholder="e.g. Rewound once — June 2024." />
              </div>

              {createAssetError && (
                <div style={{ fontSize: 12, color: "#dc2626", background: "#fef2f2", borderRadius: 7, padding: "8px 12px" }}>{createAssetError}</div>
              )}

              <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
                <button
                  type="submit"
                  disabled={createAssetPending}
                  style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 700, fontSize: 13, cursor: createAssetPending ? "wait" : "pointer" }}
                >
                  {createAssetPending ? "Creating…" : "Create & link asset"}
                </button>
                <button
                  type="button"
                  onClick={() => setCreateAssetOpen(false)}
                  style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${c.line}`, background: "none", color: c.muted, fontSize: 13, cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* ── Fragment picker panel ────────────────────────────────────────── */}
      {fragTarget && (
        <>
          <div onClick={() => setFragTarget(null)} style={{ position: "fixed", inset: 0, background: "rgba(14,26,40,.45)", zIndex: 998 }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 380, background: c.panel, zIndex: 999, display: "flex", flexDirection: "column", boxShadow: "-6px 0 32px rgba(0,0,0,.18)" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: c.ink }}>{fragTarget === "notes" ? "Note templates" : "Terms presets"}</div>
                <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>Click to append to the text area</div>
              </div>
              <button onClick={() => setFragTarget(null)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 20, color: c.muted, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {(fragTarget === "notes" ? noteFrags : termsFrags).map((frag) => (
                <button key={frag.id} onClick={() => insertFragment(frag)} style={{ width: "100%", textAlign: "left", padding: "14px 20px", background: "none", border: "none", borderBottom: `1px solid ${c.line}`, cursor: "pointer" }} onMouseEnter={(e) => (e.currentTarget.style.background = c.panel2)} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: c.ink, marginBottom: 5 }}>{frag.label}</div>
                  <div style={{ fontSize: 11.5, color: c.muted, lineHeight: 1.55, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{frag.text}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
