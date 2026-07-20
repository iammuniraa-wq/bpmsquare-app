"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c, pillar, type PillarKey } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { ROUTES, UOM_OPTIONS, OFFER_TYPE_LABEL } from "@/lib/constants";
import type { TenantEntity, TenantTaxConfig } from "@/lib/constants";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data/labels";
import type { Account, Asset, Contact, PricingItem, TextFragment, PricingCategory, Quote, QuoteLine } from "@/lib/types";
import { Gear, Zap, Droplet, Battery, Monitor, Activity } from "@/components/Icons";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";

// ── Styles ────────────────────────────────────────────────────────────────────

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  border: `1px solid ${c.line}`, borderRadius: 8,
  padding: "8px 12px", fontSize: 13, color: c.ink,
  background: c.panel, fontFamily: "inherit", outline: "none",
};
const selStyle: React.CSSProperties = { ...inp, cursor: "pointer" };
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

// ── Types ─────────────────────────────────────────────────────────────────────

type LineItem = {
  id: string; sl_no: string; description: string; uom: string;
  qty: string; rate: string; discount: string;
  category: PricingCategory | ""; deduction: string;
  group_id?: string | null; group_label?: string | null;
  inventory_item_id?: string | null;
};

type InventoryOption = { id: string; sku: string | null; name: string; uom: string; unit_cost: number | null; qty_on_hand: number };
type GroupRow = {
  kind: "group"; id: string; label: string; group_description: string;
  items: LineItem[]; group_type: "additive" | "alternative";
};
type LineRow = { kind: "line" } & LineItem;
type Row = LineRow | GroupRow;

type SowEntry = { id: string; text: string };

interface CFDef {
  id: string; field_key: string; field_label: string;
  field_type: "text" | "number" | "date" | "select" | "checkbox" | "textarea";
  field_section: string | null; options: string[] | null; is_required: boolean;
}

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

// Reconstruct grouped Row[] from the flat QuoteLine[] as stored in the DB — same
// shape QuoteEditPanel.tsx uses, just mapped onto this form's LineItem (which
// calls the discount field `discount`, not `discount_pct`).
function editLinesToRows(lines: QuoteLine[]): Row[] {
  const rows: Row[] = [];
  const groupIndex = new Map<string, number>();
  for (const l of lines) {
    const item: LineItem = {
      id: l.id, sl_no: l.sl_no ?? "", description: l.description, uom: l.uom ?? "",
      qty: String(l.qty), rate: String(l.rate), discount: String(l.discount_pct ?? 0),
      category: (l.category as PricingCategory) ?? "", deduction: String(l.deduction ?? 0),
      inventory_item_id: l.inventory_item_id ?? null,
    };
    if (l.group_id) {
      let idx = groupIndex.get(l.group_id);
      if (idx === undefined) {
        idx = rows.length;
        groupIndex.set(l.group_id, idx);
        rows.push({
          kind: "group", id: l.group_id, label: l.group_label ?? "Group",
          group_description: l.group_description ?? "",
          group_type: l.group_type === "alternative" ? "alternative" : "additive",
          items: [],
        });
      }
      (rows[idx] as GroupRow).items.push(item);
    } else {
      rows.push({ kind: "line", ...item });
    }
  }
  return rows.length ? rows : [{ kind: "line", id: "1", sl_no: "1", description: "", uom: "", qty: "1", rate: "0", discount: "", category: "", deduction: "0" }];
}

export type EditQuoteData = { quote: Quote & { custom_data?: Record<string, unknown> | null }; lines: QuoteLine[] };

type Props = {
  accounts: Account[];
  contacts: Contact[];
  assets: Asset[];
  pricingItems: PricingItem[];
  inventoryItems?: InventoryOption[];
  textFragments: TextFragment[];
  offerType: import("@/lib/types").QuoteOfferType;
  tenantEntities: TenantEntity[];
  tenantTax: TenantTaxConfig;
  isAdmin?: boolean;
  /** When set, the form pre-fills from an existing quote and saves via PATCH-style
   *  edit instead of creating a new one — the same page, just in edit mode. */
  editQuote?: EditQuoteData;
};

export default function QuoteForm({ accounts, contacts, assets: initialAssets, pricingItems, inventoryItems = [], textFragments, offerType, tenantEntities, isAdmin, editQuote }: Props) {
  const router = useRouter();
  const eq = editQuote?.quote;
  const isTechnical = offerType === "technical";
  const today        = new Date().toISOString().slice(0, 10);
  const defaultValid = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

  const [localAssets, setLocalAssets] = useState<Asset[]>(initialAssets);

  // Account & contact
  const [accountId, setAccountId] = useState(eq?.account_id ?? "");
  const [contactId, setContactId] = useState(eq?.contact_id ?? "");

  // Quote meta
  const [quoteName, setQuoteName]   = useState(eq?.name ?? "");
  const [quoteDate, setQuoteDate]   = useState(eq?.created_at ? eq.created_at.slice(0, 10) : today);
  const [validUntil, setValidUntil] = useState(eq?.valid_until ? eq.valid_until.slice(0, 10) : defaultValid);
  const [refNo, setRefNo]           = useState(eq?.ref_no ?? "");
  const [prNo, setPrNo]             = useState(eq?.pr_no ?? "");
  const [poNumber, setPoNumber]     = useState(eq?.po_number ?? "");
  const [poAmount, setPoAmount]     = useState(eq?.po_amount != null ? String(eq.po_amount) : "");
  const [owner, setOwner]           = useState("VP — Admin");

  // Linked assets
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>(eq?.asset_ids ?? []);
  const [assetPickerOpen, setAssetPickerOpen]   = useState(false);

  // Line items & groups
  const [rows, setRows] = useState<Row[]>(() => editQuote ? editLinesToRows(editQuote.lines) : [
    { kind: "line", id: "1", sl_no: "1", description: "", uom: "", qty: "1", rate: "0", discount: "", category: "", deduction: "0" },
  ]);
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [selectedAltId, setSelectedAltId] = useState<string | null>(eq?.selected_option_id ?? null);

  // Discount
  const [discountType, setDiscountType]   = useState<"pct" | "fixed">(eq?.discount_type ?? "pct");
  const [discountPct, setDiscountPct]     = useState(eq?.discount_pct != null ? String(eq.discount_pct) : "0");
  const [discountFixed, setDiscountFixed] = useState(eq?.discount_fixed != null ? String(eq.discount_fixed) : "0");

  // GST — optional; blank means no GST row anywhere (CR-010)
  const [gstRate, setGstRate] = useState(eq?.gst_rate != null ? String(eq.gst_rate) : "");

  // Entity & SOWs
  const [entityId, setEntityId] = useState(() => eq?.entity_id ?? tenantEntities.find((e) => e.is_default)?.id ?? "");
  const [sows, setSows] = useState<SowEntry[]>(() =>
    eq?.scope_of_work
      ? eq.scope_of_work.split("\n\n---\n\n").map((text, i) => ({ id: String(i + 1), text }))
      : [{ id: "1", text: "" }]
  );
  const [sowFragTarget, setSowFragTarget] = useState<string | null>(null); // SOW entry id

  // Notes & terms
  const [notes, setNotes] = useState(eq?.notes ?? "");
  const [terms, setTerms] = useState(eq?.terms ?? "");

  // Custom fields for quotes
  const [cfDefs, setCfDefs] = useState<CFDef[]>([]);
  const [cfValues, setCfValues] = useState<Record<string, unknown>>(eq?.custom_data ?? {});

  function fetchCFDefs() {
    fetch("/api/settings/custom-fields?object=quote")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setCfDefs(data); })
      .catch(() => {});
  }

  useEffect(() => {
    fetchCFDefs();
    const handler = () => fetchCFDefs();
    window.addEventListener("bpm:cf-changed", handler);
    return () => window.removeEventListener("bpm:cf-changed", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Renders custom fields that belong to a given section, inline within that section.
  function cfInputs(section: string) {
    const sfs = cfDefs.filter((f) => f.field_section === section);
    if (sfs.length === 0) return null;
    return (
      <>
        {sfs.map((f) => (
          <div key={f.id}>
            <span style={lbl}>{f.field_label}{f.is_required ? " *" : ""}</span>
            {f.field_type === "select" && f.options ? (
              <select style={selStyle} value={(cfValues[f.field_key] as string) ?? ""} onChange={(e) => setCfValues((v) => ({ ...v, [f.field_key]: e.target.value }))}>
                <option value="">— select —</option>
                {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.field_type === "checkbox" ? (
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: c.ink, height: 38 }}>
                <input type="checkbox" checked={!!(cfValues[f.field_key])} onChange={(e) => setCfValues((v) => ({ ...v, [f.field_key]: e.target.checked }))} style={{ width: 15, height: 15, accentColor: c.accent }} />
                {cfValues[f.field_key] ? "Yes" : "No"}
              </label>
            ) : f.field_type === "textarea" ? (
              <textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={(cfValues[f.field_key] as string) ?? ""} onChange={(e) => setCfValues((v) => ({ ...v, [f.field_key]: e.target.value }))} />
            ) : (
              <input style={inp} type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"} value={(cfValues[f.field_key] as string) ?? ""} onChange={(e) => setCfValues((v) => ({ ...v, [f.field_key]: e.target.value }))} />
            )}
          </div>
        ))}
      </>
    );
  }

  // Create-asset drawer
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
      const created: Asset = {
        id: json.id, account_id: accountId || null, ...newAsset,
        rpm: null, frame_type: null, insulation_class: null, connection: null, duty: null,
        ambient_temp: null, output_kw: null, stator_voltage: null, stator_current: null,
        excitation_voltage: null, excitation_current: null, frequency: null,
        is_loaner: false, loaner_status: null, custom_data: null,
      };
      setLocalAssets((p) => [...p, created]);
      setSelectedAssetIds((p) => [...p, json.id]);
      setCreateAssetOpen(false);
      setNewAsset({ name: "", kind: "motor", make: "", model: "", serial: "", rating: "", notes: "" });
    });
  }

  // UI panels
  const [catalogOpen, setCatalogOpen]     = useState(false);
  const [catalogTarget, setCatalogTarget] = useState<string | null>(null);
  const [catalogCat, setCatalogCat]       = useState<PricingCategory | "" | "inventory">("");
  const [fragTarget, setFragTarget]       = useState<"notes" | "terms" | null>(null);
  const [savedId, setSavedId]             = useState<string | null>(null);
  const [saveError, setSaveError]         = useState("");
  const [savePending, startSave]          = useTransition();
  const [hasDraft, setHasDraft]           = useState(false);

  // Case carry-over
  type CaseSource = { caseId: string; caseRef: string; accountId: string; assetIds?: string[]; findings: string; recommendations: string; estimatedCost: number | null };
  const [caseSource, setCaseSource] = useState<CaseSource | null>(null);
  const [carryoverDismissed, setCarryoverDismissed] = useState(false);

  useEffect(() => {
    if (editQuote) return; // editing an existing quote — no draft/case-carryover banners
    setHasDraft(!!sessionStorage.getItem(DRAFT_KEY));
    try {
      const raw = sessionStorage.getItem("vvcrm_quote_source");
      if (raw) {
        sessionStorage.removeItem("vvcrm_quote_source");
        setCaseSource(JSON.parse(raw) as CaseSource);
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyCarryover() {
    if (!caseSource) return;
    setAccountId(caseSource.accountId);
    setSelectedAssetIds(caseSource.assetIds ?? []);
    const parts: string[] = [];
    if (caseSource.findings) parts.push(`Findings:\n${caseSource.findings}`);
    if (caseSource.recommendations) parts.push(`Recommendations:\n${caseSource.recommendations}`);
    setNotes(parts.join("\n\n"));
    setCarryoverDismissed(true);
  }

  const [savedRef, setSavedRef] = useState<string | null>(null);

  // Restore draft or pre-fill from copy-quote
  useEffect(() => {
    if (editQuote) return; // editing pre-fills from the real quote data, not sessionStorage
    const copyRaw = sessionStorage.getItem("vvcrm_copy_quote");
    if (copyRaw) {
      sessionStorage.removeItem("vvcrm_copy_quote");
      try {
        const copy = JSON.parse(copyRaw);
        if (copy.accountId)   setAccountId(copy.accountId);
        if (copy.contactId)   setContactId(copy.contactId);
        if (copy.quoteName)   setQuoteName(copy.quoteName);
        if (copy.notes)       setNotes(copy.notes);
        if (copy.terms)       setTerms(copy.terms);
        if (Array.isArray(copy.sows) && copy.sows.length > 0) setSows(copy.sows);
        else if (copy.scopeOfWork) setSows([{ id: "1", text: copy.scopeOfWork }]);
        if (Array.isArray(copy.rows) && copy.rows.length > 0)
          setRows(copy.rows.map((r: Row) => r.kind === "group"
            ? { ...r, group_description: (r as GroupRow).group_description ?? "", group_type: (r as GroupRow).group_type ?? "additive" }
            : { ...r, sl_no: (r as LineItem).sl_no ?? "", category: (r as LineItem).category ?? "", deduction: (r as LineItem).deduction ?? "0" }
          ));
        else if (Array.isArray(copy.lines) && copy.lines.length > 0)
          setRows(copy.lines.map((l: LineItem, i: number) => ({ kind: "line" as const, ...l, sl_no: l.sl_no ?? String(i + 1) })));
      } catch { /* malformed */ }
      return;
    }
    const draft = loadDraft();
    if (!draft) return;
    if (draft.accountId)    setAccountId(draft.accountId);
    if (draft.contactId)    setContactId(draft.contactId);
    if (draft.quoteName)    setQuoteName(draft.quoteName);
    if (draft.quoteDate)    setQuoteDate(draft.quoteDate);
    if (draft.validUntil)   setValidUntil(draft.validUntil);
    if (draft.refNo)        setRefNo(draft.refNo);
    if (draft.prNo)         setPrNo(draft.prNo);
    if (draft.poNumber)     setPoNumber(draft.poNumber);
    if (draft.poAmount)     setPoAmount(draft.poAmount);

    if (draft.owner)        setOwner(draft.owner);
    if (draft.notes)        setNotes(draft.notes);
    if (draft.terms)        setTerms(draft.terms);
    if (draft.discountType) setDiscountType(draft.discountType);
    if (draft.discountPct)  setDiscountPct(draft.discountPct);
    if (draft.discountFixed) setDiscountFixed(draft.discountFixed);
    if (draft.gstRate)      setGstRate(draft.gstRate);
    if (draft.entityId)    setEntityId(draft.entityId);
    // SOW backward-compat: old drafts have scopeOfWork string
    if (Array.isArray(draft.sows) && draft.sows.length > 0) setSows(draft.sows);
    else if (draft.scopeOfWork) setSows([{ id: "1", text: draft.scopeOfWork }]);
    if (Array.isArray(draft.rows) && draft.rows.length > 0)
      setRows(draft.rows.map((r: Row) => r.kind === "group"
        ? { ...r, group_description: (r as GroupRow).group_description ?? "", group_type: (r as GroupRow).group_type ?? "additive" }
        : { ...r, sl_no: (r as LineItem).sl_no ?? "" }
      ));
    else if (Array.isArray(draft.lines) && draft.lines.length > 0)
      setRows(draft.lines.map((l: LineItem, i: number) => ({ kind: "line" as const, ...l, sl_no: l.sl_no ?? String(i + 1) })));
    if (draft.selectedAltId !== undefined) setSelectedAltId(draft.selectedAltId);
    if (Array.isArray(draft.selectedAssetIds) && draft.selectedAssetIds.length > 0) setSelectedAssetIds(draft.selectedAssetIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save draft — skipped while editing an existing quote, so it never
  // overwrites (or gets overwritten by) a separate in-progress "new quote" draft.
  useEffect(() => {
    if (editQuote) return;
    saveDraft({
      accountId, contactId, quoteName, quoteDate, validUntil,
      refNo, prNo, poNumber, poAmount, owner, notes, terms,
      discountType, discountPct, discountFixed, gstRate,
      entityId, sows,
      rows, selectedAssetIds, selectedAltId,
    });
  }, [accountId, contactId, quoteName, quoteDate, validUntil,
      refNo, prNo, poNumber, poAmount, owner, notes, terms,
      discountType, discountPct, discountFixed, gstRate,
      entityId, sows,
      rows, selectedAssetIds, selectedAltId]);

  const accountContacts = contacts.filter((ct) => ct.account_id === accountId);
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const accountAssets   = localAssets.filter((a) => a.account_id === accountId);
  const selectedAssets  = selectedAssetIds
    .map((id) => localAssets.find((a) => a.id === id))
    .filter((a): a is Asset => !!a);

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
    const ded  = l.category === "material" ? Math.max(0, parseFloat(l.deduction) || 0) : 0;
    return { ...l, qty, rate, disc, ded, amount: qty * rate * (1 - disc / 100) };
  });
  const subtotal = parsedLines.reduce((s, l) => s + l.amount, 0);
  const totalDeductions = parsedLines.reduce((s, l) => s + l.ded, 0);
  const discPct    = Math.max(0, Math.min(100, parseFloat(discountPct) || 0));
  const discAmount = discountType === "pct"
    ? Math.round(subtotal * discPct / 100)
    : Math.min(Math.round(parseFloat(discountFixed) || 0), subtotal);
  const total = subtotal - discAmount - totalDeductions;
  const gstAmount = gstRate !== "" ? Math.round(total * (parseFloat(gstRate) || 0) / 100) : 0;
  const grandTotal = total + gstAmount;
  const poVal = parseFloat(poAmount) || 0;

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  // ── Row / line / group handlers ─────────────────────────────────────────────

  const newLineItem = (sl_no = ""): LineItem => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sl_no, description: "", uom: "", qty: "1", rate: "0", discount: "",
    category: "", deduction: "0",
  });

  const addLine = () => setRows((p) => {
    const sl_no = String(p.length + 1);
    return [...p, { kind: "line", ...newLineItem(sl_no) }];
  });

  const addGroup = () => setRows((p) => {
    const pos = p.length + 1;
    return [...p, { kind: "group", id: `${Date.now()}`, label: "Group", group_description: "", group_type: "additive", items: [newLineItem(`${pos}.1`)] }];
  });

  const addAlternative = () => {
    const gid = `${Date.now()}`;
    setRows((p) => {
      const pos = p.length + 1;
      return [...p, { kind: "group", id: gid, label: "Option A", group_description: "", group_type: "alternative", items: [newLineItem(`${pos}.1`)] }];
    });
    setSelectedAltId((prev) => prev ?? gid);
  };

  const removeRow = (rowId: string) => {
    setRows((p) => { const n = p.filter((r) => r.id !== rowId); return n.length ? n : [{ kind: "line", ...newLineItem("1") }]; });
    setSelectedIds((p) => { const n = new Set(p); n.delete(rowId); return n; });
  };

  const updateLine = (lineId: string, field: keyof LineItem, val: string) =>
    setRows((p) => p.map((r) => {
      if (r.kind === "line"  && r.id === lineId) return { ...r, [field]: val };
      if (r.kind === "group") return { ...r, items: r.items.map((i) => i.id === lineId ? { ...i, [field]: val } : i) };
      return r;
    }));

  const addLineToGroup = (gid: string) => setRows((p) => {
    const gIdx = p.findIndex((r) => r.id === gid);
    const pos = gIdx + 1;
    return p.map((r) => r.kind === "group" && r.id === gid
      ? { ...r, items: [...r.items, newLineItem(`${pos}.${r.items.length + 1}`)] }
      : r
    );
  });

  const removeLineFromGroup = (gid: string, lid: string) => setRows((p) => p.map((r) => {
    if (r.kind !== "group" || r.id !== gid) return r;
    const items = r.items.filter((i) => i.id !== lid);
    return { ...r, items: items.length ? items : [newLineItem()] };
  }));

  const updateGroupLabel       = (gid: string, label: string) => setRows((p) => p.map((r) => r.kind === "group" && r.id === gid ? { ...r, label } : r));
  const updateGroupDescription = (gid: string, group_description: string) => setRows((p) => p.map((r) => r.kind === "group" && r.id === gid ? { ...r, group_description } : r));
  const ungroup                = (gid: string) => setRows((p) => p.flatMap((r) => r.kind === "group" && r.id === gid ? r.items.map((i): Row => ({ kind: "line", ...i })) : [r]));

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
        groupItems.push({ id: r.id, sl_no: r.sl_no, description: r.description, uom: r.uom ?? "", qty: r.qty, rate: r.rate, discount: r.discount, category: r.category, deduction: r.deduction });
      } else { rest.push(r); }
    });
    const group: GroupRow = { kind: "group", id: gid, label: "Group", group_description: "", group_type: "additive", items: groupItems };
    rest.splice(Math.max(0, insertAt), 0, group);
    setRows(rest);
    setSelectedIds(new Set());
  };

  const toggleAsset = (id: string) =>
    setSelectedAssetIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  // SOW handlers
  const addSow = () => setSows((p) => [...p, { id: `${Date.now()}`, text: "" }]);
  const removeSow = (id: string) => setSows((p) => { const n = p.filter((s) => s.id !== id); return n.length ? n : [{ id: "1", text: "" }]; });
  const updateSow = (id: string, text: string) => setSows((p) => p.map((s) => s.id === id ? { ...s, text } : s));

  // Catalog
  const openCatalog = (lineId: string) => { setCatalogTarget(lineId); setCatalogCat(""); setCatalogOpen(true); };
  const insertCatalogItem = (item: PricingItem) => {
    if (catalogTarget) { updateLine(catalogTarget, "description", item.description); updateLine(catalogTarget, "rate", String(item.rate)); }
    setCatalogOpen(false); setCatalogTarget(null);
  };
  const filteredCatalog = catalogCat && catalogCat !== "inventory" ? pricingItems.filter((p) => p.category === catalogCat) : pricingItems;
  const insertInventoryItem = (item: InventoryOption) => {
    const target = catalogTarget;
    if (target) {
      setRows((p) => p.map((r) => {
        if (r.kind === "line" && r.id === target) {
          return { ...r, description: item.sku ? `${item.name} (${item.sku})` : item.name, uom: item.uom, rate: item.unit_cost != null ? String(item.unit_cost) : r.rate, inventory_item_id: item.id };
        }
        if (r.kind === "group") {
          return { ...r, items: r.items.map((i) => i.id === target
            ? { ...i, description: item.sku ? `${item.name} (${item.sku})` : item.name, uom: item.uom, rate: item.unit_cost != null ? String(item.unit_cost) : i.rate, inventory_item_id: item.id }
            : i) };
        }
        return r;
      }));
    }
    setCatalogOpen(false); setCatalogTarget(null);
  };

  // Fragments (notes / terms)
  const insertFragment = (frag: TextFragment) => {
    if (fragTarget === "notes") setNotes((p) => p ? p + "\n\n" + frag.text : frag.text);
    if (fragTarget === "terms") setTerms((p) => p ? p + "\n\n" + frag.text : frag.text);
    setFragTarget(null);
  };
  // SOW fragment insert
  const insertSowFragment = (frag: TextFragment) => {
    if (sowFragTarget) updateSow(sowFragTarget, sows.find(s => s.id === sowFragTarget)?.text
      ? (sows.find(s => s.id === sowFragTarget)!.text + "\n\n" + frag.text)
      : frag.text
    );
    setSowFragTarget(null);
  };
  const noteFrags  = textFragments.filter((f) => f.category === "notes");
  const termsFrags = textFragments.filter((f) => f.category === "terms");
  const sowFrags   = textFragments.filter((f) => f.category === "sow");

  function handleSave() {
    setSaveError("");
    startSave(async () => {
      const scope_of_work = sows.map((s) => s.text).filter(Boolean).join("\n\n---\n\n") || null;
      const linesPayload = rows.flatMap((r): {
        sl_no: string | null; description: string; uom: string; qty: string; rate: string;
        discount_pct: number; group_id: string | null; group_label: string | null;
        group_type: string | null; group_description: string | null;
        category: PricingCategory | null; deduction: number; inventory_item_id: string | null;
      }[] =>
        r.kind === "line"
          ? [{ sl_no: r.sl_no || null, description: r.description, uom: r.uom ?? "", qty: r.qty, rate: r.rate, discount_pct: Math.max(0, Math.min(100, parseFloat(r.discount) || 0)), group_id: null, group_label: null, group_type: null, group_description: null, category: r.category || null, deduction: r.category === "material" ? Math.max(0, parseFloat(r.deduction) || 0) : 0, inventory_item_id: r.inventory_item_id ?? null }]
          : r.items.map((i) => ({ sl_no: i.sl_no || null, description: i.description, uom: i.uom ?? "", qty: i.qty, rate: i.rate, discount_pct: Math.max(0, Math.min(100, parseFloat(i.discount) || 0)), group_id: r.id, group_label: r.label, group_type: r.group_type, group_description: r.group_description || null, category: i.category || null, deduction: i.category === "material" ? Math.max(0, parseFloat(i.deduction) || 0) : 0, inventory_item_id: i.inventory_item_id ?? null }))
      );

      const url = editQuote ? `/api/quotes/${editQuote.quote.id}/edit` : "/api/quotes";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id:      accountId,
          type:            offerType,
          total,
          valid_until:     validUntil || null,
          notes,
          terms,
          scope_of_work,
          entity_id:       entityId || null,
          name:            quoteName || null,
          contact_id:      contactId || null,
          ref_no:          refNo || null,
          pr_no:           prNo || null,
          po_number:       poNumber || null,
          po_amount:       poAmount || null,
          discount_type:   discountType,
          discount_pct:    discPct,
          discount_fixed:  discAmount,
          gst_rate:        gstRate === "" ? null : gstRate,
          asset_ids:       selectedAssetIds,
          selected_option_id: effectiveAltId,
          case_id: caseSource?.caseId ?? null,
          custom_data: Object.keys(cfValues).length > 0 ? cfValues : undefined,
          lines: linesPayload,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setSaveError(json.error ?? "Save failed"); return; }

      if (editQuote) {
        router.push(ROUTES.quotation(editQuote.quote.id));
        return;
      }
      clearDraft();
      setSavedRef(json.ref);
      setSavedId(json.id);
    });
  }

  // ── Success screen ────────────────────────────────────────────────────────
  if (savedId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "55vh", gap: 14, textAlign: "center" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: pillar.green.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: pillar.green.base }}>✓</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: c.ink }}>Draft saved</div>
        <div style={{ fontFamily: "monospace", fontSize: 15, color: c.accent, background: c.accentbg, padding: "6px 16px", borderRadius: 8 }}>{savedRef}</div>
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

  // ── Column template helpers ───────────────────────────────────────────────
  // Standalone line: checkbox | sl_no | description | uom | category | qty | [rate | disc | deduction | amount] | delete
  const standaloneCols = isTechnical
    ? "20px 52px 1fr 58px 56px 50px 32px"
    : "20px 52px 1fr 58px 56px 50px 100px 54px 60px 100px 32px";
  const standaloneHeaders = isTechnical
    ? ["", "Sl No", "Description", "UOM", "Category", "Qty", ""]
    : ["", "Sl No", "Description", "UOM", "Category", "Qty", "Rate (₹)", "Disc %", "Deduction (₹)", "Amount", ""];

  // Group item line: sl_no | description | uom | category | qty | [rate | disc | deduction | amount] | delete
  const groupItemCols = isTechnical
    ? "52px 1fr 58px 56px 50px 32px"
    : "52px 1fr 58px 56px 50px 100px 54px 60px 100px 32px";
  const groupItemHeaders = isTechnical
    ? ["Sl No", "Description", "UOM", "Category", "Qty", ""]
    : ["Sl No", "Description", "UOM", "Category", "Qty", "Rate (₹)", "Disc %", "Deduction (₹)", "Amount", ""];

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link href={editQuote ? ROUTES.quotation(editQuote.quote.id) : ROUTES.quotations} style={{ fontSize: 12, color: c.muted, textDecoration: "none" }}>
          ← {editQuote ? editQuote.quote.ref : "Quotations"}
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: hasDraft ? 10 : 20, justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: c.ink, margin: 0 }}>{editQuote ? "Edit" : "New"} {OFFER_TYPE_LABEL[offerType] ?? "Quotation"}</h1>
          <div style={{ fontSize: 12.5, color: c.muted, marginTop: 3, fontFamily: "monospace" }}>{editQuote ? editQuote.quote.ref : "New draft"}</div>
        </div>
        <AdaptObjectDrawer objectType="quote" objectLabel="Quotation" isAdmin={isAdmin ?? false} />
      </div>

      {/* Case carry-over banner */}
      {caseSource && !carryoverDismissed && (
        <div style={{ marginBottom: 14, background: "#eef4ff", border: "1px solid #bfdbfe", borderLeft: "3px solid #378ADD", borderRadius: 8, padding: "12px 16px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1e3a5f", marginBottom: 6 }}>Creating quotation from case {caseSource.caseRef}</div>
          <div style={{ fontSize: 12, color: "#3a5a80", marginBottom: 10 }}>Carry over inspection findings to the quotation notes, and pre-select the account?</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={applyCarryover} style={{ fontSize: 12, fontWeight: 600, color: "#fff", background: "#378ADD", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer" }}>Yes, carry over</button>
            <button type="button" onClick={() => setCarryoverDismissed(true)} style={{ fontSize: 12, fontWeight: 500, color: "#3a5a80", background: "none", border: "1px solid #bfdbfe", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>Start fresh</button>
          </div>
        </div>
      )}

      {hasDraft && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 14px", fontSize: 12.5 }}>
          <span style={{ color: "#92400e" }}>⟳ Draft restored — your unsaved work has been recovered.</span>
          <button onClick={() => { clearDraft(); setHasDraft(false); window.location.reload(); }} style={{ marginLeft: "auto", fontSize: 11.5, color: "#b45309", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Discard draft</button>
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
                <select style={selStyle} value={accountId} onChange={(e) => { setAccountId(e.target.value); setContactId(""); setSelectedAssetIds([]); }}>
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
                <select style={{ ...selStyle, opacity: !accountId ? 0.5 : 1 }} value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!accountId}>
                  <option value="">{accountId ? "Select contact…" : "Choose account first"}</option>
                  {accountContacts.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}{ct.role ? ` · ${ct.role}` : ""}</option>)}
                </select>
              </div>
            </div>
            {cfInputs("Account & Contact")}
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
                  <span style={lbl}>Quote ID</span>
                  <input style={{ ...inp, color: c.muted, background: c.panel2 }} value={editQuote?.quote.ref ?? ""} readOnly placeholder="Assigned on save" />
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
              <div className="fg3">
                <div>
                  <span style={lbl}>Ref no.</span>
                  <input style={inp} value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="Your own reference" />
                </div>
                <div>
                  <span style={lbl}>Customer PR no.</span>
                  <input style={inp} value={prNo} onChange={(e) => setPrNo(e.target.value)} placeholder="PR-2026-XXXX" />
                </div>
                <div>
                  <span style={lbl}>Customer PO no.</span>
                  <input style={inp} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-2026-XXXX" />
                </div>
              </div>
              <div className="fg2">
                <div>
                  <span style={lbl}>PO amount (₹)</span>
                  <input style={inp} type="number" min="0" step="1000" value={poAmount} onChange={(e) => setPoAmount(e.target.value)} placeholder="0" />
                </div>
              </div>
              {tenantEntities.length > 0 && (
                <div>
                  <span style={lbl}>Issuing entity</span>
                  <select style={selStyle} value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                    <option value="">— Select entity —</option>
                    {tenantEntities.map((e) => <option key={e.id} value={e.id}>{e.name}{e.is_default ? " (default)" : ""}</option>)}
                  </select>
                </div>
              )}
              {cfInputs("Quote details")}
            </div>
          </section>

          {/* Scope of work — multiple SOWs */}
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ ...sectionTitle, margin: 0 }}>Scope of work</h3>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={addSow}
                  style={{ fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
                >
                  + Add SOW
                </button>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {sows.map((sow, idx) => (
                <div key={sow.id} style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 12px", background: c.panel2 }}>
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      SOW {idx + 1}
                    </span>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => { setSowFragTarget(sow.id); }}
                        style={{ fontSize: 11.5, color: c.accent, background: "none", border: `1px solid ${c.accent}40`, borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}
                      >
                        ↗ Link SOW template
                      </button>
                      {sows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeSow(sow.id)}
                          style={{ fontSize: 11.5, color: "#dc2626", background: "none", border: "1px solid #fecaca", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}
                        >
                          − Remove
                        </button>
                      )}
                    </div>
                  </div>
                  <textarea
                    style={{ ...inp, minHeight: 80, resize: "vertical", lineHeight: 1.6, background: c.panel }}
                    value={sow.text}
                    onChange={(e) => updateSow(sow.id, e.target.value)}
                    placeholder={`Describe scope of work${sows.length > 1 ? ` ${idx + 1}` : ""}…`}
                  />
                </div>
              ))}
            </div>
            {cfInputs("Scope of work")}
          </section>

          {/* Linked assets */}
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
                  <button onClick={() => setCreateAssetOpen(true)} style={{ fontSize: 11.5, color: c.accent, background: "none", border: "none", cursor: "pointer", fontWeight: 500, padding: 0 }}>+ Create asset first</button>
                )}
                <button
                  onClick={() => setAssetPickerOpen(true)}
                  disabled={!accountId || accountAssets.length === 0}
                  style={{ fontSize: 12, fontWeight: 600, borderRadius: 6, padding: "6px 14px", border: "none", cursor: !accountId || accountAssets.length === 0 ? "not-allowed" : "pointer", background: !accountId || accountAssets.length === 0 ? c.panel2 : c.accentbg, color: !accountId || accountAssets.length === 0 ? c.hint : c.accent }}
                >
                  {selectedAssets.length > 0 ? "Edit selection" : "+ Link asset"}
                </button>
              </div>
            </div>

            {!accountId && <div style={{ padding: "20px 0", textAlign: "center", color: c.hint, fontSize: 13 }}>Select an account to link its assets</div>}
            {accountId && accountAssets.length === 0 && (
              <div style={{ padding: "18px 0", textAlign: "center" }}>
                <div style={{ fontSize: 13, color: c.muted, marginBottom: 8 }}>No assets registered for this account yet.</div>
                <button onClick={() => setCreateAssetOpen(true)} style={{ fontSize: 13, color: c.accent, fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0 }}>+ Create one now</button>
              </div>
            )}
            {selectedAssets.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {selectedAssets.map((asset) => (
                  <div key={asset.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 8, background: c.panel2, border: `1px solid ${c.line}` }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, flexShrink: 0, background: pillar[KIND_TONE[asset.kind]].bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <KindIcon kind={asset.kind} size={16} color={pillar[KIND_TONE[asset.kind]].fg} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{asset.name}</span>
                        <Pill label={KIND_LABEL[asset.kind]} tone={KIND_TONE[asset.kind]} />
                      </div>
                      <div style={{ fontSize: 12, color: c.muted }}>
                        {asset.make && <span>{asset.make}</span>}
                        {asset.make && asset.model && <span style={{ margin: "0 5px", color: c.hint }}>·</span>}
                        {asset.model && <span style={{ fontWeight: 500 }}>{asset.model}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: c.hint }}>
                        {asset.serial && <span style={{ fontFamily: "monospace" }}>{asset.serial}</span>}
                        {asset.serial && asset.rating && <span style={{ margin: "0 5px" }}>·</span>}
                        {asset.rating && <span>{asset.rating}</span>}
                      </div>
                    </div>
                    <button onClick={() => toggleAsset(asset.id)} style={{ background: "none", border: "none", color: c.hint, fontSize: 18, cursor: "pointer", lineHeight: 1, flexShrink: 0 }} title="Unlink">×</button>
                  </div>
                ))}
              </div>
            )}
            {accountId && accountAssets.length > 0 && selectedAssets.length === 0 && (
              <div style={{ padding: "16px 0", textAlign: "center", color: c.hint, fontSize: 13 }}>No assets linked yet — click <strong>+ Link asset</strong></div>
            )}
          </section>

          {/* ── Line items (Particulars) ────────────────────────────────── */}
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <h3 style={{ ...sectionTitle, margin: 0 }}>Particulars</h3>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {selectedIds.size >= 2 && (
                  <button onClick={groupSelected} style={{ fontSize: 12, fontWeight: 600, color: "#0c447c", background: "#e6f1fb", border: "1px solid #c5dbf5", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>
                    ▦ Group selected ({selectedIds.size})
                  </button>
                )}
                <button onClick={addAlternative} style={{ fontSize: 12, fontWeight: 600, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>⊕ Add option</button>
                <button onClick={addGroup} style={{ fontSize: 12, fontWeight: 600, color: c.muted, background: c.panel2, border: `1px solid ${c.line}`, borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>+ Add group</button>
                <button onClick={addLine} style={{ fontSize: 12, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>+ Add line</button>
              </div>
            </div>

            {/* Column headers */}
            <div style={{ display: "grid", gridTemplateColumns: standaloneCols, gap: 8, marginBottom: 6 }}>
              {standaloneHeaders.map((h, i) => (
                <div key={i} style={{ fontSize: 10.5, fontWeight: 600, color: c.hint, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</div>
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
                    <div key={row.id} style={{ display: "grid", gridTemplateColumns: standaloneCols, gap: 8, alignItems: "start", borderBottom: `1px solid ${c.line}`, background: sel ? c.accentbg : "transparent", borderRadius: sel ? 6 : 0, padding: sel ? "4px 6px 8px" : "0 0 8px" }}>
                      <div style={{ paddingTop: 10 }}>
                        <input type="checkbox" checked={sel} onChange={() => toggleSelect(row.id)} style={{ width: 13, height: 13, accentColor: c.accent, cursor: "pointer" }} />
                      </div>
                      {/* Sl No */}
                      <input
                        style={{ ...inp, textAlign: "center", fontFamily: "monospace", fontSize: 12, padding: "8px 4px" }}
                        value={row.sl_no}
                        onChange={(e) => updateLine(row.id, "sl_no", e.target.value)}
                        placeholder="1"
                      />
                      <div>
                        <textarea style={{ ...inp, resize: "vertical", minHeight: 58, lineHeight: 1.5 }} value={row.description} onChange={(e) => updateLine(row.id, "description", e.target.value)} placeholder="Describe the service or item…" />
                        <button onClick={() => openCatalog(row.id)} style={{ marginTop: 4, fontSize: 11, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>◈ From catalog</button>
                      </div>
                      <select style={{ ...selStyle, fontSize: 12 }} value={row.uom ?? ""} onChange={(e) => updateLine(row.id, "uom", e.target.value)}>
                        <option value="">—</option>
                        {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <select style={{ ...selStyle, fontSize: 12 }} value={row.category} onChange={(e) => updateLine(row.id, "category", e.target.value as PricingCategory | "")}>
                        <option value="">—</option>
                        {(Object.keys(CAT_LABEL) as PricingCategory[]).map((cat) => <option key={cat} value={cat}>{CAT_LABEL[cat]}</option>)}
                      </select>
                      <input style={{ ...inp, textAlign: "center" }} type="number" min="0" step="1" value={row.qty} onChange={(e) => updateLine(row.id, "qty", e.target.value)} />
                      {!isTechnical && <input style={{ ...inp, textAlign: "right" }} type="number" min="0" step="100" value={row.rate} onChange={(e) => updateLine(row.id, "rate", e.target.value)} />}
                      {!isTechnical && <input style={{ ...inp, textAlign: "right", color: disc > 0 ? "#d97706" : c.muted }} type="number" min="0" max="100" step="0.5" value={row.discount} onChange={(e) => updateLine(row.id, "discount", e.target.value)} placeholder="0" />}
                      {!isTechnical && (
                        row.category === "material"
                          ? <input style={{ ...inp, textAlign: "right", color: "#b91c1c" }} type="number" min="0" step="10" value={row.deduction} onChange={(e) => updateLine(row.id, "deduction", e.target.value)} placeholder="0" title="Salvage / deduction credited back, subtracted once from the grand total" />
                          : <div />
                      )}
                      {!isTechnical && (
                        <div style={{ textAlign: "right", paddingTop: 8 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: c.ink }}>{fmt(amount)}</div>
                          {disc > 0 && <div style={{ fontSize: 10.5, color: "#d97706", marginTop: 1 }}>−{disc}%</div>}
                        </div>
                      )}
                      <button onClick={() => removeRow(row.id)} style={{ color: c.hint, background: "none", border: "none", fontSize: 18, cursor: "pointer", paddingTop: 6, lineHeight: 1 }} title="Remove">×</button>
                    </div>
                  );
                }

                // Group row
                const isAlt = row.group_type === "alternative";
                const isSelectedAlt = isAlt && row.id === effectiveAltId;
                const groupColor  = isAlt ? "#d97706" : c.accent;
                const groupBg     = isAlt ? "#fffbeb" : `${c.accent}06`;
                const groupBorder = isAlt ? "#fde68a" : `${c.accent}40`;
                const groupTotal  = row.items.reduce((s, i) => {
                  const qty  = parseFloat(i.qty) || 0;
                  const rate = parseFloat(i.rate) || 0;
                  const disc = Math.max(0, Math.min(100, parseFloat(i.discount) || 0));
                  return s + qty * rate * (1 - disc / 100);
                }, 0);
                return (
                  <div key={row.id} style={{ border: `1px solid ${groupBorder}`, borderLeft: `3px solid ${groupColor}`, borderRadius: 8, background: groupBg, padding: "10px 12px", marginBottom: 2, opacity: isAlt && !isSelectedAlt ? 0.6 : 1 }}>
                    {/* Group header row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: groupColor }}>{isAlt ? "⊕" : "▦"}</span>
                      {isAlt && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>OPTION</span>
                      )}
                      <input
                        value={row.label}
                        onChange={(e) => updateGroupLabel(row.id, e.target.value)}
                        style={{ flex: 1, fontSize: 13, fontWeight: 700, border: "none", background: "transparent", color: c.ink, outline: "none", borderBottom: `1px dashed ${c.line}`, padding: "2px 0" }}
                        placeholder={isAlt ? "Option name…" : "Group name (e.g. Group A)…"}
                      />
                      {isAlt && (
                        isSelectedAlt
                          ? <span style={{ fontSize: 11, fontWeight: 700, color: "#065f46", background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 5, padding: "2px 8px", whiteSpace: "nowrap" }}>✓ Selected</span>
                          : <button onClick={() => setSelectedAltId(row.id)} style={{ fontSize: 11, fontWeight: 600, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 5, padding: "2px 8px", cursor: "pointer", whiteSpace: "nowrap" }}>Select this option</button>
                      )}
                      <button onClick={() => ungroup(row.id)} style={{ fontSize: 11, color: c.muted, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", whiteSpace: "nowrap" }}>Ungroup</button>
                      <button onClick={() => removeRow(row.id)} style={{ color: c.hint, background: "none", border: "none", fontSize: 18, cursor: "pointer", lineHeight: 1 }} title="Delete group">×</button>
                    </div>

                    {/* Group description */}
                    <div style={{ marginBottom: 10 }}>
                      <input
                        value={row.group_description}
                        onChange={(e) => updateGroupDescription(row.id, e.target.value)}
                        style={{ ...inp, fontSize: 12.5, background: "transparent", borderColor: row.group_description ? c.line : `${c.line}60` }}
                        placeholder="Group description (e.g. Motor Stator Winding)…"
                      />
                    </div>

                    {/* Group item column headers */}
                    <div style={{ display: "grid", gridTemplateColumns: groupItemCols, gap: 8, marginBottom: 4, paddingLeft: 4 }}>
                      {groupItemHeaders.map((h, i) => (
                        <div key={i} style={{ fontSize: 10, fontWeight: 600, color: c.hint, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</div>
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
                          <div key={item.id} style={{ display: "grid", gridTemplateColumns: groupItemCols, gap: 8, alignItems: "start", paddingBottom: 6, borderBottom: `1px solid ${c.accent}20` }}>
                            {/* Sl No */}
                            <input
                              style={{ ...inp, textAlign: "center", fontFamily: "monospace", fontSize: 12, padding: "6px 4px" }}
                              value={item.sl_no}
                              onChange={(e) => updateLine(item.id, "sl_no", e.target.value)}
                              placeholder="1.1"
                            />
                            <div>
                              <textarea style={{ ...inp, resize: "vertical", minHeight: 48, lineHeight: 1.5, fontSize: 12.5 }} value={item.description} onChange={(e) => updateLine(item.id, "description", e.target.value)} placeholder="Line description…" />
                              <button onClick={() => openCatalog(item.id)} style={{ marginTop: 3, fontSize: 10.5, color: c.accent, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>◈ Catalog</button>
                            </div>
                            <select style={{ ...selStyle, fontSize: 12 }} value={item.uom ?? ""} onChange={(e) => updateLine(item.id, "uom", e.target.value)}>
                              <option value="">—</option>
                              {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                            <select style={{ ...selStyle, fontSize: 12 }} value={item.category} onChange={(e) => updateLine(item.id, "category", e.target.value as PricingCategory | "")}>
                              <option value="">—</option>
                              {(Object.keys(CAT_LABEL) as PricingCategory[]).map((cat) => <option key={cat} value={cat}>{CAT_LABEL[cat]}</option>)}
                            </select>
                            <input style={{ ...inp, textAlign: "center", fontSize: 12.5 }} type="number" min="0" step="1" value={item.qty} onChange={(e) => updateLine(item.id, "qty", e.target.value)} />
                            {!isTechnical && <input style={{ ...inp, textAlign: "right", fontSize: 12.5 }} type="number" min="0" step="100" value={item.rate} onChange={(e) => updateLine(item.id, "rate", e.target.value)} />}
                            {!isTechnical && <input style={{ ...inp, textAlign: "right", fontSize: 12.5, color: disc > 0 ? "#d97706" : c.muted }} type="number" min="0" max="100" step="0.5" value={item.discount} onChange={(e) => updateLine(item.id, "discount", e.target.value)} placeholder="0" />}
                            {!isTechnical && (
                              item.category === "material"
                                ? <input style={{ ...inp, textAlign: "right", fontSize: 12.5, color: "#b91c1c" }} type="number" min="0" step="10" value={item.deduction} onChange={(e) => updateLine(item.id, "deduction", e.target.value)} placeholder="0" title="Salvage / deduction credited back, subtracted once from the grand total" />
                                : <div />
                            )}
                            {!isTechnical && (
                              <div style={{ textAlign: "right", paddingTop: 8 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{fmt(amount)}</div>
                                {disc > 0 && <div style={{ fontSize: 10, color: "#d97706", marginTop: 1 }}>−{disc}%</div>}
                              </div>
                            )}
                            <button onClick={() => removeLineFromGroup(row.id, item.id)} style={{ color: c.hint, background: "none", border: "none", fontSize: 16, cursor: "pointer", paddingTop: 6, lineHeight: 1 }} title="Remove line">×</button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Group footer */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingTop: 6 }}>
                      <button onClick={() => addLineToGroup(row.id)} style={{ fontSize: 11.5, color: groupColor, background: "none", border: "none", cursor: "pointer", padding: 0 }}>+ Add line</button>
                      {!isTechnical && (
                        <span style={{ fontSize: 12, color: c.muted }}>
                          {isAlt ? "Option total" : "Group total"}:{" "}
                          <strong style={{ color: c.ink, marginLeft: 4 }}>{fmt(groupTotal)}</strong>
                        </span>
                      )}
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
            <textarea style={{ ...inp, minHeight: 88, resize: "vertical", lineHeight: 1.6 }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Additional notes for the customer…" />
            {cfInputs("Notes")}
          </section>

          {/* Terms */}
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ ...sectionTitle, margin: 0 }}>Terms & Conditions</h3>
              <button onClick={() => setFragTarget("terms")} style={{ marginLeft: "auto", fontSize: 11.5, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}>+ Use preset</button>
            </div>
            <textarea style={{ ...inp, minHeight: 100, resize: "vertical", lineHeight: 1.6, fontFamily: "inherit" }} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Standard terms and conditions…" />
            {cfInputs("Terms & Conditions")}
          </section>
        </div>

        {/* ── RIGHT ────────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "sticky", top: 20 }}>

          {/* Summary — hierarchical breakdown */}
          {!isTechnical && (
            <section style={cardStyle}>
              <h3 style={sectionTitle}>Summary</h3>

              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {rows.map((row) => {
                  if (row.kind === "line") {
                    const qty  = parseFloat(row.qty) || 0;
                    const rate = parseFloat(row.rate) || 0;
                    const disc = Math.max(0, Math.min(100, parseFloat(row.discount) || 0));
                    const amount = qty * rate * (1 - disc / 100);
                    if (amount === 0 && !row.description) return null;
                    return (
                      <div key={row.id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 12, borderTop: `1px solid ${c.line}`, color: c.muted }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>
                          {row.sl_no && <span style={{ fontFamily: "monospace", fontSize: 10.5, marginRight: 5, color: c.hint }}>{row.sl_no}</span>}
                          {row.description || "—"}
                        </span>
                        <span style={{ flexShrink: 0, marginLeft: 8 }}>{amount > 0 ? fmt(amount) : "—"}</span>
                      </div>
                    );
                  }

                  // Group row in summary
                  if (row.group_type === "alternative" && row.id !== effectiveAltId) return null;
                  const groupTotal = row.items.reduce((s, i) => {
                    const qty  = parseFloat(i.qty) || 0;
                    const rate = parseFloat(i.rate) || 0;
                    const disc = Math.max(0, Math.min(100, parseFloat(i.discount) || 0));
                    return s + qty * rate * (1 - disc / 100);
                  }, 0);
                  return (
                    <div key={row.id} style={{ borderTop: `1px solid ${c.line}` }}>
                      {/* Group header in summary */}
                      <div style={{ padding: "6px 0 3px", fontSize: 11, fontWeight: 700, color: c.accent, display: "flex", alignItems: "baseline", gap: 6 }}>
                        <span>{row.label}</span>
                        {row.group_description && <span style={{ fontSize: 10, fontWeight: 400, color: c.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>— {row.group_description}</span>}
                      </div>
                      {/* Group items indented */}
                      {row.items.map((item) => {
                        const qty  = parseFloat(item.qty) || 0;
                        const rate = parseFloat(item.rate) || 0;
                        const disc = Math.max(0, Math.min(100, parseFloat(item.discount) || 0));
                        const amount = qty * rate * (1 - disc / 100);
                        return (
                          <div key={item.id} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0 3px 10px", fontSize: 11.5, color: c.muted }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                              {item.sl_no && <span style={{ fontFamily: "monospace", fontSize: 10, marginRight: 4, color: c.hint }}>{item.sl_no}</span>}
                              {item.description || "—"}
                            </span>
                            <span style={{ flexShrink: 0, marginLeft: 6 }}>{amount > 0 ? fmt(amount) : "—"}</span>
                          </div>
                        );
                      })}
                      {/* Group total */}
                      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0 6px 10px", fontSize: 11.5, borderBottom: `1px dashed ${c.line}` }}>
                        <span style={{ color: c.hint, fontStyle: "italic" }}>{row.group_type === "alternative" ? "Option" : "Group"} total</span>
                        <span style={{ fontWeight: 700, color: c.ink }}>{fmt(groupTotal)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ borderTop: `2px solid ${c.line}`, marginTop: 10, paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
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

                {totalDeductions > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: c.muted }}>
                    <span>Deductions <span style={{ fontSize: 11, color: c.hint }}>(salvage)</span></span>
                    <span style={{ fontWeight: 600, color: pillar.red.fg }}>− {fmt(totalDeductions)}</span>
                  </div>
                )}

                {/* GST — optional; blank omits it from Order Summary and PDF (CR-010) */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: c.muted }}>GST % <span style={{ fontSize: 11, color: c.hint }}>(optional)</span></span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="number" min="0" max="100" step="0.5" value={gstRate} onChange={(e) => setGstRate(e.target.value)} placeholder="e.g. 18" style={{ width: 60, border: `1px solid ${c.line}`, borderRadius: 6, padding: "3px 6px", fontSize: 12, textAlign: "right", color: c.ink, fontFamily: "inherit" }} />
                    <span style={{ fontSize: 11, color: c.hint }}>%</span>
                  </div>
                </div>
                {gstRate !== "" && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: c.muted }}>
                    <span>GST @ {gstRate}%</span>
                    <span style={{ fontWeight: 600, color: c.ink }}>{fmt(gstAmount)}</span>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", background: pillar.green.bg, borderRadius: 9, marginTop: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: pillar.green.fg }}>{gstRate !== "" ? "Grand total" : "Total"}</span>
                  <span style={{ fontSize: 17, fontWeight: 800, color: pillar.green.fg }}>{fmt(grandTotal)}</span>
                </div>
              </div>
            </section>
          )}

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
              <div style={{ fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Assets · {selectedAssets.length}</div>
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
                  </div>
                </div>
              ))}
            </section>
          )}

          <div style={{ fontSize: 11, color: c.hint, textAlign: "center" }}>
            Created by <span style={{ color: c.muted, fontWeight: 600 }}>{owner || "—"}</span>
          </div>

          {/* Actions */}
          <section style={cardStyle}>
            <h3 style={sectionTitle}>Actions</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {saveError && <div style={{ fontSize: 12, color: "#dc2626", background: "#fef2f2", borderRadius: 7, padding: "6px 10px" }}>{saveError}</div>}
              <button onClick={handleSave} disabled={!accountId || savePending} style={{ width: "100%", padding: "10px 0", borderRadius: 9, fontSize: 13.5, fontWeight: 700, background: accountId ? c.accent : c.line, color: accountId ? "#fff" : c.hint, border: "none", cursor: accountId && !savePending ? "pointer" : "not-allowed" }}>
                {savePending ? "Saving…" : editQuote ? "Save changes" : "Save as draft"}
              </button>
              <button disabled style={{ width: "100%", padding: "9px 0", borderRadius: 9, fontSize: 13, fontWeight: 600, background: c.panel2, color: c.muted, border: `1px solid ${c.line}`, cursor: "not-allowed", opacity: 0.7 }}>Send to customer · Coming soon</button>
            </div>
          </section>

          <div style={{ fontSize: 11.5, color: c.hint, textAlign: "center" }}>
            {parsedLines.filter((l) => l.amount > 0).length} of {allLineItems.length} line{allLineItems.length !== 1 ? "s" : ""} have values
          </div>
        </div>
      </div>

      {/* ── Asset picker panel ─────────────────────────────────────────────── */}
      {assetPickerOpen && (
        <>
          <div onClick={() => setAssetPickerOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(14,26,40,.45)", zIndex: 998 }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 420, background: c.panel, zIndex: 999, display: "flex", flexDirection: "column", boxShadow: "-6px 0 32px rgba(0,0,0,.18)" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: c.ink }}>Link assets</div>
                <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>{selectedAccount?.name} · {accountAssets.length} asset{accountAssets.length !== 1 ? "s" : ""}</div>
              </div>
              <button onClick={() => setAssetPickerOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 20, color: c.muted, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {accountAssets.map((asset) => {
                const selected = selectedAssetIds.includes(asset.id);
                return (
                  <button key={asset.id} onClick={() => toggleAsset(asset.id)} style={{ width: "100%", textAlign: "left", padding: "14px 20px", background: selected ? c.accentbg : "none", border: "none", borderBottom: `1px solid ${c.line}`, cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}
                    onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = c.panel2; }}
                    onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "none"; }}
                  >
                    <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, border: `2px solid ${selected ? c.accent : c.line}`, background: selected ? c.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff", fontWeight: 700 }}>{selected ? "✓" : ""}</div>
                    <div style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, background: pillar[KIND_TONE[asset.kind]].bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <KindIcon kind={asset.kind} size={16} color={pillar[KIND_TONE[asset.kind]].fg} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{asset.name}</span>
                        <Pill label={KIND_LABEL[asset.kind]} tone={KIND_TONE[asset.kind]} />
                      </div>
                      <div style={{ fontSize: 12, color: c.muted }}>
                        {asset.make && <span>{asset.make}</span>}
                        {asset.make && asset.model && <span style={{ margin: "0 5px", color: c.hint }}>·</span>}
                        {asset.model && <span style={{ fontWeight: 500 }}>{asset.model}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ padding: "14px 20px", borderTop: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: c.muted }}>{selectedAssetIds.length} selected</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => { setAssetPickerOpen(false); setCreateAssetOpen(true); }} style={{ fontSize: 12, color: c.accent, background: "none", padding: "7px 14px", border: `1px solid ${c.accent}`, borderRadius: 7, fontWeight: 500, cursor: "pointer" }}>+ Create new asset</button>
                <button onClick={() => setAssetPickerOpen(false)} style={{ fontSize: 13, fontWeight: 600, color: "#fff", background: c.accent, border: "none", borderRadius: 7, padding: "7px 18px", cursor: "pointer" }}>Done</button>
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
                <div style={{ fontWeight: 700, fontSize: 14, color: c.ink }}>Catalog</div>
                <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>Click a pricing item or inventory item to insert it into the line</div>
              </div>
              <button onClick={() => setCatalogOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 20, color: c.muted, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "flex", gap: 6, padding: "12px 16px", borderBottom: `1px solid ${c.line}`, flexWrap: "wrap" }}>
              {(["", "labour", "material", "testing", "transport", ...(inventoryItems.length > 0 ? ["inventory" as const] : [])] as const).map((cat) => (
                <button key={cat} onClick={() => setCatalogCat(cat)} style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 20, border: "none", cursor: "pointer", fontWeight: 600, background: catalogCat === cat ? c.accent : c.panel2, color: catalogCat === cat ? "#fff" : c.muted }}>
                  {cat === "" ? "All" : cat === "inventory" ? "Inventory" : CAT_LABEL[cat as PricingCategory]}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {catalogCat === "inventory" && (
                <div>
                  <div style={{ padding: "8px 20px 4px", fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: "0.08em" }}>Inventory</div>
                  {inventoryItems.length === 0 ? (
                    <div style={{ padding: "10px 20px", fontSize: 12, color: c.hint }}>No inventory items yet.</div>
                  ) : inventoryItems.map((item) => (
                    <button key={item.id} onClick={() => insertInventoryItem(item)} style={{ width: "100%", textAlign: "left", padding: "10px 20px", background: "none", border: "none", cursor: "pointer", borderBottom: `1px solid ${c.line}` }} onMouseEnter={(e) => (e.currentTarget.style.background = c.panel2)} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
                      <div style={{ fontSize: 12.5, color: c.ink, fontWeight: 500, lineHeight: 1.4 }}>{item.name}{item.sku ? ` (${item.sku})` : ""}</div>
                      <div style={{ display: "flex", gap: 10, marginTop: 4, alignItems: "center" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: c.accent }}>{item.unit_cost != null ? `₹${item.unit_cost.toLocaleString("en-IN")}` : "—"}</span>
                        <span style={{ fontSize: 11, color: c.hint }}>/ {item.uom}</span>
                        <span style={{ fontSize: 11, color: c.hint }}>· {item.qty_on_hand} on hand</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
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
                <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>{selectedAccount ? `Linked to ${selectedAccount.name}` : "No account selected"}</div>
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
                  <select style={selStyle} value={newAsset.kind} onChange={setNA("kind")} required>
                    {ASSET_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Make / brand</label>
                  <input style={inp} value={newAsset.make} onChange={setNA("make")} placeholder="e.g. Crompton Greaves" />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div><label style={lbl}>Model</label><input style={inp} value={newAsset.model} onChange={setNA("model")} placeholder="e.g. ND315S-2" /></div>
                <div><label style={lbl}>Serial no.</label><input style={inp} value={newAsset.serial} onChange={setNA("serial")} placeholder="e.g. CG-75-2291" /></div>
              </div>
              <div><label style={lbl}>Rating / specs</label><input style={inp} value={newAsset.rating} onChange={setNA("rating")} placeholder="e.g. 75 kW · 415V · 1480 rpm" /></div>
              <div><label style={lbl}>Notes / history</label><textarea style={{ ...inp, resize: "vertical", minHeight: 64 }} value={newAsset.notes} onChange={setNA("notes")} placeholder="e.g. Rewound once — June 2024." /></div>
              {createAssetError && <div style={{ fontSize: 12, color: "#dc2626", background: "#fef2f2", borderRadius: 7, padding: "8px 12px" }}>{createAssetError}</div>}
              <div style={{ display: "flex", gap: 8, paddingTop: 4 }}>
                <button type="submit" disabled={createAssetPending} style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "none", background: c.accent, color: "#fff", fontWeight: 700, fontSize: 13, cursor: createAssetPending ? "wait" : "pointer" }}>
                  {createAssetPending ? "Creating…" : "Create & link asset"}
                </button>
                <button type="button" onClick={() => setCreateAssetOpen(false)} style={{ padding: "10px 16px", borderRadius: 8, border: `1px solid ${c.line}`, background: "none", color: c.muted, fontSize: 13, cursor: "pointer" }}>Cancel</button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* ── Notes / Terms fragment picker ────────────────────────────────── */}
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

      {/* ── SOW template picker ──────────────────────────────────────────── */}
      {sowFragTarget && (
        <>
          <div onClick={() => setSowFragTarget(null)} style={{ position: "fixed", inset: 0, background: "rgba(14,26,40,.45)", zIndex: 998 }} />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 400, background: c.panel, zIndex: 999, display: "flex", flexDirection: "column", boxShadow: "-6px 0 32px rgba(0,0,0,.18)" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: c.ink }}>SOW templates</div>
                <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2 }}>Click to insert into this SOW entry</div>
              </div>
              <button onClick={() => setSowFragTarget(null)} style={{ marginLeft: "auto", background: "none", border: "none", fontSize: 20, color: c.muted, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {sowFrags.length === 0 ? (
                <div style={{ padding: "32px 24px", textAlign: "center" }}>
                  <div style={{ fontSize: 13, color: c.muted, marginBottom: 8 }}>No SOW templates yet.</div>
                  <div style={{ fontSize: 12, color: c.hint, lineHeight: 1.6 }}>
                    Create SOW templates in <strong>Settings → Text templates</strong> with category <code>sow</code>.
                  </div>
                </div>
              ) : sowFrags.map((frag) => (
                <button key={frag.id} onClick={() => insertSowFragment(frag)} style={{ width: "100%", textAlign: "left", padding: "14px 20px", background: "none", border: "none", borderBottom: `1px solid ${c.line}`, cursor: "pointer" }} onMouseEnter={(e) => (e.currentTarget.style.background = c.panel2)} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
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
