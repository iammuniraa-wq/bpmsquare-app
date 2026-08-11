"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ROUTES, OFFER_TYPE_LABEL, DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import { CheckIcon, XIcon } from "@/components/Icons";
import QuoteStatusPill from "@/components/QuoteStatusPill";
import AdvancedFilterPanel from "@/components/AdvancedFilterPanel";
import { parseConds, matchesConds, flattenForFilter } from "@/lib/advancedFilter";
import AdaptObjectDrawer from "@/components/AdaptObjectDrawer";
import { useUserRole, useUiTheme } from "@/lib/tenant-context";
import type { EffectiveField } from "@/lib/fieldRegistry";
import type { QuoteSummary } from "@/lib/data/labels";
import { sortRows, type SortExtractor } from "@/lib/listSort";
import Pager from "@/components/Pager";
import { paginate, clampPage, DEFAULT_PAGE_SIZE } from "@/lib/paginate";

// ── Column definitions ────────────────────────────────────────────────────────
//
// Every column the list can show -- standard Quote fields plus, appended at
// render time, whatever custom fields this tenant has defined for "quote"
// (via the Adapt drawer below). Not scoped to a hardcoded subset: any field
// on the Quote record is available here, and any new custom field a tenant
// adds shows up automatically (see the bpm:cf-changed listener).

type ColDef = {
  id: string;
  label: string;
  defaultOn: boolean;
  align?: "right" | "center";
  group: "standard" | "custom";
  render: (row: QuoteSummary) => React.ReactNode;
  cellStyle?: React.CSSProperties;
  /** Raw value for sorting -- separate from `render` since render often
   * returns a pill/link/formatted node, not a directly comparable value. */
  sortValue: SortExtractor<QuoteSummary>;
};

const LS_KEY = "bms_quotes_cols";
const TILES_LS_KEY = "bms_quotes_tiles";
const INSIGHTS_LS_KEY = "bms_quotes_insights";

// Summary tiles -- a lean default set (one row); the rest are opt-in via the
// Columns/Adapt popover, same personalization model as table columns.
const TILE_DEFS: { id: string; label: string; defaultOn: boolean }[] = [
  { id: "total",             label: "Total quotes",      defaultOn: true },
  { id: "overall_value",     label: "Overall value",     defaultOn: true },
  { id: "won_value",         label: "Won value",         defaultOn: true },
  { id: "lost_value",        label: "Lost value",        defaultOn: false },
  { id: "in_pipeline",       label: "In pipeline",       defaultOn: true },
  { id: "overdue",           label: "Overdue",           defaultOn: true },
  { id: "awaiting_approval", label: "Awaiting approval", defaultOn: false },
  { id: "from_cases",        label: "From cases",        defaultOn: false },
  { id: "standalone",        label: "Standalone",        defaultOn: false },
];
const LS_SEEN_KEY = "bms_quotes_cols_seen";

// ── Helpers ───────────────────────────────────────────────────────────────────

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const muted = (v: React.ReactNode): React.ReactNode => <span style={{ color: c.muted }}>{v}</span>;
const truncated = (s: string, max = 60): React.ReactNode =>
  s.length > max ? <span title={s}>{s.slice(0, max - 1)}…</span> : s;

// Summary tiles are narrow (minWidth 130) -- a lakhs/crores total at a fixed
// font size overflows the tile instead of shrinking to fit. Same approach as
// DashboardLayout's kpiNumFontSize: scale down as the string gets longer.
const tileNumFontSize = (text: string): number => {
  const len = text.length;
  if (len >= 13) return 12;
  if (len >= 11) return 14;
  if (len >= 9) return 16;
  if (len >= 7) return 18;
  return 20;
};

const BUSINESS_STATUS_LABEL: Record<string, string> = { pending: "Pending", po_received: "PO received" };
const OUTCOME_COLOR: Record<string, string> = { won: pillar.teal.fg, lost: pillar.red.fg, open: pillar.blue.fg };
const OUTCOME_LABEL: Record<string, string> = { won: "Won", lost: "Lost", open: "Open" };

function discountDisplay(q: QuoteSummary["quote"]): React.ReactNode {
  if (q.discount_type === "pct" && q.discount_pct) return `${q.discount_pct}%`;
  if (q.discount_type === "fixed" && q.discount_fixed) return inr(q.discount_fixed);
  return muted("—");
}

/** Standard Quote fields, built per-render since a couple (status) need
 * props (quoteStatuses) that aren't available at module scope. */
function buildStandardColumns(quoteStatuses: QuoteStatusDef[]): ColDef[] {
  return [
    { id: "type",        label: "Type",           defaultOn: true,  group: "standard",
      render: (r) => muted(OFFER_TYPE_LABEL[r.quote.type] ?? r.quote.type), sortValue: (r) => r.quote.type },
    { id: "account",     label: "Account",         defaultOn: true,  group: "standard",
      render: (r) => <Link href={ROUTES.account(r.account.id)} onClick={(e) => e.stopPropagation()} style={{ color: c.ink }}>{r.account.name}</Link>, sortValue: (r) => r.account.name },
    { id: "status",      label: "Status",          defaultOn: true,  group: "standard",
      render: (r) => <QuoteStatusPill status={r.quote.status} statuses={quoteStatuses} />, sortValue: (r) => r.quote.status },
    { id: "lines",       label: "Lines",           defaultOn: true,  group: "standard", align: "center",
      render: (r) => muted(`${r.lineCount} items`), sortValue: (r) => r.lineCount },
    { id: "total",       label: "Total",           defaultOn: true,  group: "standard", align: "right",
      render: (r) => inr(r.quote.total), cellStyle: { fontWeight: 600 }, sortValue: (r) => r.quote.total },
    { id: "date",        label: "Date",            defaultOn: true,  group: "standard",
      render: (r) => muted(fmtDate(r.quote.quote_date ?? r.quote.created_at)), sortValue: (r) => r.quote.quote_date ?? r.quote.created_at },
    { id: "valid_until", label: "Valid until",     defaultOn: false, group: "standard",
      render: (r) => muted(r.quote.valid_until ? fmtDate(r.quote.valid_until) : "—"), sortValue: (r) => r.quote.valid_until },
    { id: "territory",   label: "Territory",       defaultOn: false, group: "standard",
      render: (r) => muted(r.quote.territory ?? "—"), sortValue: (r) => r.quote.territory },
    { id: "name",        label: "Quote name",      defaultOn: false, group: "standard",
      render: (r) => r.quote.name || muted("—"), sortValue: (r) => r.quote.name },
    { id: "sales_org",   label: "Sales org",       defaultOn: false, group: "standard",
      render: (r) => muted(r.quote.sales_org ?? "—"), sortValue: (r) => r.quote.sales_org },
    { id: "business_status", label: "Business status", defaultOn: false, group: "standard",
      render: (r) => muted(r.quote.business_status ? BUSINESS_STATUS_LABEL[r.quote.business_status] ?? r.quote.business_status : "—"), sortValue: (r) => r.quote.business_status },
    { id: "outcome",     label: "Outcome",         defaultOn: false, group: "standard",
      render: (r) => <span style={{ color: OUTCOME_COLOR[r.quote.outcome], fontWeight: 600 }}>{OUTCOME_LABEL[r.quote.outcome] ?? r.quote.outcome}</span>, sortValue: (r) => r.quote.outcome },
    { id: "ref_no",      label: "Ref No.",         defaultOn: false, group: "standard",
      render: (r) => muted(r.quote.ref_no ?? "—"), sortValue: (r) => r.quote.ref_no },
    { id: "pr_no",       label: "PR No.",          defaultOn: false, group: "standard",
      render: (r) => muted(r.quote.pr_no ?? "—"), sortValue: (r) => r.quote.pr_no },
    { id: "po_number",   label: "PO number",       defaultOn: false, group: "standard",
      render: (r) => muted(r.quote.po_number ?? "—"), sortValue: (r) => r.quote.po_number },
    { id: "po_amount",   label: "PO amount",       defaultOn: false, group: "standard", align: "right",
      render: (r) => r.quote.po_amount != null ? inr(r.quote.po_amount) : muted("—"), sortValue: (r) => r.quote.po_amount },
    { id: "discount",    label: "Discount",        defaultOn: false, group: "standard",
      render: (r) => discountDisplay(r.quote), sortValue: (r) => r.quote.discount_type === "fixed" ? r.quote.discount_fixed : r.quote.discount_pct },
    { id: "gst_rate",    label: "GST %",           defaultOn: false, group: "standard",
      render: (r) => muted(r.quote.gst_rate != null ? `${r.quote.gst_rate}%` : "—"), sortValue: (r) => r.quote.gst_rate },
    { id: "revision",    label: "Revision",        defaultOn: false, group: "standard", align: "center",
      render: (r) => muted(`Rev ${r.quote.revision ?? 1}`), sortValue: (r) => r.quote.revision ?? 1 },
    { id: "notes",       label: "Notes",           defaultOn: false, group: "standard",
      render: (r) => r.quote.notes ? truncated(r.quote.notes) : muted("—"), sortValue: (r) => r.quote.notes },
    { id: "terms",       label: "Terms",           defaultOn: false, group: "standard",
      render: (r) => r.quote.terms ? truncated(r.quote.terms) : muted("—"), sortValue: (r) => r.quote.terms },
  ];
}

function customValueDisplay(field: EffectiveField, raw: unknown): React.ReactNode {
  if (raw === null || raw === undefined || raw === "") return muted("—");
  if (field.widget === "checkbox") return raw ? "Yes" : "No";
  if (field.widget === "date" && typeof raw === "string") {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? raw : fmtDate(raw);
  }
  return truncated(String(raw));
}

function buildCustomColumns(fields: EffectiveField[]): ColDef[] {
  return fields
    // kind filter matters since quote became a registry (pilot) object:
    // field-config now returns standard fields too, and those already have
    // their own dedicated columns above -- only tenant custom fields become
    // generated custom_data columns.
    .filter((f) => f.kind === "custom" && !f.hidden)
    .map((f) => ({
      id: f.field_key,
      label: f.label,
      defaultOn: true, // shown as soon as a tenant adds one -- no extra step to "discover" it
      group: "custom" as const,
      render: (r: QuoteSummary) => customValueDisplay(f, (r.quote.custom_data ?? {})[f.field_key]),
      sortValue: (r: QuoteSummary) => {
        const v = (r.quote.custom_data ?? {})[f.field_key];
        return typeof v === "string" || typeof v === "number" ? v : v == null ? null : String(v);
      },
    }));
}

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12, whiteSpace: "nowrap", background: c.panel2,
};
const td: React.CSSProperties = {
  padding: "11px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5, verticalAlign: "middle",
};

// ── Component ─────────────────────────────────────────────────────────────────

/** C4C-style column search: a small ⌕ on each header opens an inline
 * popover that matches only that column (against its sort value). Active
 * filters tint the icon; Escape/outside-click closes, ✕ clears. */
function ColSearch({ id, label, colFilters, openId, setOpenId, setColFilter }: {
  id: string; label: string;
  colFilters: Record<string, string>;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  setColFilter: (id: string, term: string) => void;
}) {
  const active = !!colFilters[id];
  const open = openId === id;
  return (
    <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-block" }}>
      <button
        type="button"
        title={`Search in ${label}`}
        onClick={() => setOpenId(open ? null : id)}
        style={{
          background: "none", border: "none", cursor: "pointer", padding: "0 2px",
          marginLeft: 4, fontSize: 11, lineHeight: 1,
          color: active || open ? c.accent : c.hint, opacity: active || open ? 1 : 0.55,
        }}
      >⌕</button>
      {open && (
        <>
          <span onClick={() => setOpenId(null)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <span style={{
            position: "absolute", left: 0, top: "calc(100% + 4px)", zIndex: 61,
            display: "flex", alignItems: "center", gap: 4,
            background: c.panel, border: `1px solid ${c.line}`, borderRadius: 8,
            boxShadow: "0 6px 20px rgba(0,0,0,0.18)", padding: "6px 8px",
          }}>
            <input
              autoFocus
              value={colFilters[id] ?? ""}
              onChange={(e) => setColFilter(id, e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setOpenId(null); }}
              placeholder={`Search ${label}…`}
              style={{
                border: `1px solid ${c.line}`, borderRadius: 6, padding: "5px 8px",
                fontSize: 12, color: c.ink, background: c.panel, outline: "none", width: 150,
                fontWeight: 400, textTransform: "none", letterSpacing: "normal",
              }}
            />
            {active && (
              <button
                type="button"
                title="Clear"
                onClick={() => { setColFilter(id, ""); setOpenId(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: c.hint, fontSize: 12, padding: 2 }}
              >✕</button>
            )}
          </span>
        </>
      )}
    </span>
  );
}

export default function QuotationsList({ initialRows, quoteStatuses = DEFAULT_QUOTE_STATUSES, caseLinkedQuoteIds = [] }: { initialRows: QuoteSummary[]; quoteStatuses?: QuoteStatusDef[]; caseLinkedQuoteIds?: string[] }) {
  const router = useRouter();
  const role = useUserRole();
  const modern = useUiTheme() !== "classic";
  const isAdmin = role === "admin";

  const [rows, setRows]                 = useState<QuoteSummary[]>(initialRows);
  // Advanced filter (the `af` searchParam) applied over the LIVE client rows
  // -- evaluating here (not in the server page) is what makes the summary
  // tiles, the "N of M" counts and the table all reflect the same filtered
  // set, and it survives client-side navigations where useState(initialRows)
  // wouldn't re-seed from fresh server props.
  const searchParams = useSearchParams();
  const afConds = useMemo(() => parseConds(searchParams.get("af")), [searchParams]);
  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterAccount, setFilterAccount] = useState("");
  const [sortKey, setSortKey]           = useState<string | undefined>("created");
  const [sortDir, setSortDir]           = useState<"asc" | "desc">("desc");
  const [page, setPage]                 = useState(1);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }
  function sortIndicator(key: string) {
    const active = sortKey === key;
    return (
      <span style={{ fontSize: 9, opacity: active ? 1 : 0.35, color: active ? c.accent : "inherit", marginLeft: 4 }}>
        {active ? (sortDir === "desc" ? "↓" : "↑") : "↕"}
      </span>
    );
  }
  const [toast, setToast]               = useState<string | null>(null);
  const [visibleTiles, setVisibleTiles] = useState<Set<string>>(
    new Set(TILE_DEFS.filter((t) => t.defaultOn).map((t) => t.id))
  );
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TILES_LS_KEY);
      if (stored) setVisibleTiles(new Set(JSON.parse(stored) as string[]));
    } catch { /* ignore */ }
  }, []);
  // Insights container (tiles + advanced filters) -- collapsed by default,
  // C4C-style: the list itself is the page; analytics/query tooling opens on
  // demand and the choice sticks per browser.
  const [insightsOpen, setInsightsOpen] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem(INSIGHTS_LS_KEY) === "1") setInsightsOpen(true); } catch { /* ignore */ }
  }, []);
  function toggleInsights() {
    setInsightsOpen((v) => {
      try { localStorage.setItem(INSIGHTS_LS_KEY, v ? "0" : "1"); } catch { /* ignore */ }
      return !v;
    });
  }

  // C4C-style per-column search: click the ⌕ on a header, type, and only
  // that column is matched (against the same value the column sorts by).
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [openColSearch, setOpenColSearch] = useState<string | null>(null);
  function setColFilter(id: string, term: string) {
    setColFilters((prev) => {
      const next = { ...prev };
      if (term) next[id] = term; else delete next[id];
      return next;
    });
  }

  function toggleTile(id: string) {
    setVisibleTiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(TILES_LS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }
  const [adaptOpen, setAdaptOpen]       = useState(false);
  const [customFields, setCustomFields] = useState<EffectiveField[]>([]);

  const standardColumns = useMemo(() => buildStandardColumns(quoteStatuses), [quoteStatuses]);
  const customColumns   = useMemo(() => buildCustomColumns(customFields), [customFields]);
  const columns         = useMemo(() => [...standardColumns, ...customColumns], [standardColumns, customColumns]);

  const [visibleCols, setVisibleCols]   = useState<Set<string>>(
    new Set(standardColumns.filter((col) => col.defaultOn).map((col) => col.id))
  );

  // Custom fields for "quote" -- the same fields a tenant admin manages via
  // the Adapt drawer (also mounted on the quote create/edit form). Fetched
  // client-side and refetched whenever the drawer reports a change, so a
  // newly-added field appears as a column with no page reload needed.
  const seenCustomIds = useRef<Set<string>>(new Set());
  function fetchCustomFields() {
    fetch("/api/settings/field-config?object=quote")
      .then((r) => r.json())
      .then((data: { sections?: { fields: EffectiveField[] }[] }) => {
        setCustomFields((data.sections ?? []).flatMap((s) => s.fields));
      })
      .catch(() => {});
  }
  useEffect(() => {
    fetchCustomFields();
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ objectType?: string }>).detail;
      if (!detail || detail.objectType === "quote") fetchCustomFields();
    };
    window.addEventListener("bpm:cf-changed", handler);
    return () => window.removeEventListener("bpm:cf-changed", handler);
  }, []);

  // Show newly-discovered custom fields by default (so adding one via Adapt
  // makes it visible immediately), without re-showing a field the user has
  // since explicitly hidden via the column picker. "Seen" is persisted so a
  // hide sticks across page loads instead of being re-defaulted every visit.
  useEffect(() => {
    if (customColumns.length === 0) return;
    if (seenCustomIds.current.size === 0) {
      try { (JSON.parse(localStorage.getItem(LS_SEEN_KEY) ?? "[]") as string[]).forEach((id) => seenCustomIds.current.add(id)); } catch { /* ignore */ }
    }
    setVisibleCols((prev) => {
      const next = new Set(prev);
      let changed = false;
      customColumns.forEach((col) => {
        if (!seenCustomIds.current.has(col.id)) {
          next.add(col.id);
          changed = true;
        }
        seenCustomIds.current.add(col.id);
      });
      try { localStorage.setItem(LS_SEEN_KEY, JSON.stringify([...seenCustomIds.current])); } catch { /* ignore */ }
      if (changed) { try { localStorage.setItem(LS_KEY, JSON.stringify([...next])); } catch { /* ignore */ } }
      return changed ? next : prev;
    });
  }, [customColumns]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) setVisibleCols(new Set(JSON.parse(stored) as string[]));
    } catch { /* ignore */ }
  }, []);

  function toggleCol(id: string) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(LS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  // ── Filtering ──────────────────────────────────────────────────────────────

  const afRows = useMemo(
    () => (afConds.length === 0
      ? rows
      : rows.filter((r) => matchesConds(flattenForFilter(r.quote as unknown as Record<string, unknown>), afConds))),
    [rows, afConds]
  );

  const searched = useMemo(() =>
    afRows
      .filter((r) => !filterStatus || r.quote.status === filterStatus)
      .filter((r) => !filterAccount || r.account.name.toLowerCase().includes(filterAccount.toLowerCase())),
    [afRows, filterStatus, filterAccount]
  );

  // Sort extractors are built from `columns` (render-only fields skip
  // sorting) plus "ref" for the always-visible Ref No column, which isn't
  // part of the ColDef array.
  const sortExtractors = useMemo(() => {
    const map: Record<string, SortExtractor<QuoteSummary>> = {
      ref: (r) => r.quote.ref_no || r.quote.ref,
      // Default sort key -- not a visible column, so it needs its own entry
      // here rather than living in `columns`.
      created: (r) => r.quote.created_at,
    };
    for (const col of columns) map[col.id] = col.sortValue;
    return map;
  }, [columns]);
  const colFiltered = useMemo(() => {
    const entries = Object.entries(colFilters).filter(([, term]) => term.trim() !== "");
    if (entries.length === 0) return searched;
    return searched.filter((r) =>
      entries.every(([colId, term]) => {
        const ex = sortExtractors[colId];
        if (!ex) return true;
        return String(ex(r) ?? "").toLowerCase().includes(term.trim().toLowerCase());
      })
    );
  }, [searched, colFilters, sortExtractors]);
  const filtered = useMemo(
    () => sortRows(colFiltered, sortKey, sortDir, sortExtractors),
    [colFiltered, sortKey, sortDir, sortExtractors]
  );
  // A filter/search change can shrink the result set below the current page
  // -- clamp rather than strand the user on a now-empty page.
  useEffect(() => {
    setPage((p) => clampPage(p, filtered.length, DEFAULT_PAGE_SIZE));
  }, [filtered.length]);
  const pageRows = useMemo(() => paginate(filtered, page, DEFAULT_PAGE_SIZE), [filtered, page]);

  // Summary strip values -- outcome (Won/Lost/Open) is the source of truth for
  // value reporting: it's auto-synced from the pipeline status but can also be
  // set independently (e.g. marked Lost while still "Sent"), so it reflects
  // reality even when status alone wouldn't.
  const totalOverall  = afRows.reduce((s, r) => s + r.quote.total, 0);
  const totalWon      = afRows.filter((r) => r.quote.outcome === "won").reduce((s, r) => s + r.quote.total, 0);
  const totalLost     = afRows.filter((r) => r.quote.outcome === "lost").reduce((s, r) => s + r.quote.total, 0);
  // "In pipeline" = any quote not yet won or lost -- includes drafts, since not
  // every team reliably marks a quote "Sent" as its own separate step.
  const totalPipeline = afRows.filter((r) => r.quote.outcome === "open").reduce((s, r) => s + r.quote.total, 0);

  const today = new Date().toISOString().slice(0, 10);
  const overdueCount = afRows.filter((r) => r.quote.outcome === "open" && r.quote.valid_until && r.quote.valid_until < today).length;

  const sentStatuses = new Set(quoteStatuses.filter((s) => !s.is_initial && !s.is_closed).map((s) => s.value));
  const awaitingApprovalCount = afRows.filter((r) => sentStatuses.has(r.quote.status)).length;

  const caseLinkedSet = new Set(caseLinkedQuoteIds);
  const caseLinked  = afRows.filter((r) => caseLinkedSet.has(r.quote.id))
    .reduce((acc, r) => ({ count: acc.count + 1, value: acc.value + r.quote.total }), { count: 0, value: 0 });
  const standalone  = afRows.filter((r) => !caseLinkedSet.has(r.quote.id))
    .reduce((acc, r) => ({ count: acc.count + 1, value: acc.value + r.quote.total }), { count: 0, value: 0 });

  // ── Selection helpers ──────────────────────────────────────────────────────

  const allSelected  = filtered.length > 0 && filtered.every((r) => selected.has(r.quote.id));
  const someSelected = filtered.some((r) => selected.has(r.quote.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected((p) => { const n = new Set(p); filtered.forEach((r) => n.delete(r.quote.id)); return n; });
    } else {
      setSelected((p) => { const n = new Set(p); filtered.forEach((r) => n.add(r.quote.id)); return n; });
    }
  };

  const toggle = (id: string) =>
    setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Actions ────────────────────────────────────────────────────────────────

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  const deleteSelected = async () => {
    const ids = [...selected];
    const results = await Promise.all(
      ids.map((id) => fetch(`/api/quotes/${id}`, { method: "DELETE" }))
    );
    const failed = results.filter((r) => !r.ok).length;
    const deleted = ids.length - failed;
    if (deleted > 0) {
      setRows((r) => r.filter((row) => !selected.has(row.quote.id)));
      setSelected(new Set());
    }
    showToast(failed > 0
      ? `${deleted} deleted, ${failed} failed`
      : `${deleted} quote${deleted > 1 ? "s" : ""} deleted`
    );
  };

  const copyQuote = () => {
    const [firstId] = selected;
    const row = rows.find((r) => r.quote.id === firstId);
    if (!row) return;
    sessionStorage.setItem("vvcrm_copy_quote", JSON.stringify({
      accountId:   row.quote.account_id,
      contactId:   row.quote.contact_id ?? "",
      quoteName:   `Copy of ${row.quote.name || row.quote.ref}`,
      notes:       row.quote.notes ?? "",
      terms:       row.quote.terms ?? "",
      scopeOfWork: row.quote.scope_of_work ?? "",
      rows: row.lines.map((l, i) => ({
        kind:        "line",
        id:          String(Date.now() + i),
        description: l.description,
        uom:         l.uom ?? "",
        qty:         String(l.qty),
        rate:        String(l.rate),
        discount:    String(l.discount_pct ?? 0),
        group_id:    l.group_id ?? null,
        group_label: l.group_label ?? null,
      })),
    }));
    router.push(ROUTES.quotationNew);
  };

  const selectedCount = selected.size;
  const shownColumns = columns.filter((col) => visibleCols.has(col.id));
  const colCount = 1 + 1 + shownColumns.length; // checkbox + ref + visible

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Insights container: summary tiles + advanced filters, collapsed by
          default so the page is header -> filters -> table. The badge keeps
          an active advanced filter discoverable while collapsed. */}
      <button
        type="button"
        onClick={toggleInsights}
        style={{
          display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 12,
          padding: "6px 12px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
          border: `1px solid ${insightsOpen || afConds.length > 0 ? `var(--modern-accent, ${c.accent})` : c.line}`,
          background: "var(--panel)", color: insightsOpen || afConds.length > 0 ? `var(--modern-accent, ${c.accent})` : c.muted,
        }}
      >
        ▦ Insights &amp; filters
        {afConds.length > 0 && (
          <span style={{
            minWidth: 17, height: 17, borderRadius: 9, padding: "0 5px",
            background: `var(--modern-accent, ${c.accent})`, color: "#fff",
            fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>{afConds.length}</span>
        )}
        <span style={{ fontSize: 10, color: c.hint }}>{insightsOpen ? "▲" : "▼"}</span>
      </button>

      {insightsOpen && (<>
      {/* Summary strip -- modern themes get the same pillar-tinted tile
          treatment as the dashboard KPI tiles; classic keeps flat white. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 14 }}>
        {[
          { id: "total",             label: "Total quotes",      value: afRows.length,                    color: c.ink,   tint: pillar.blue },
          { id: "overall_value",     label: "Overall value",     value: inr(totalOverall),               color: c.ink,   tint: pillar.purple },
          { id: "won_value",         label: "Won value",         value: inr(totalWon),                   color: pillar.teal.fg,  tint: pillar.teal },
          { id: "lost_value",        label: "Lost value",        value: inr(totalLost),                  color: pillar.red.fg,   tint: pillar.red },
          { id: "in_pipeline",       label: "In pipeline",       value: inr(totalPipeline),              color: pillar.blue.fg,  tint: pillar.blue },
          { id: "overdue",           label: "Overdue",           value: overdueCount,                    color: overdueCount > 0 ? pillar.amber.fg : c.muted, tint: overdueCount > 0 ? pillar.amber : pillar.green },
          { id: "awaiting_approval", label: "Awaiting approval", value: awaitingApprovalCount,           color: c.muted, tint: pillar.amber },
          { id: "from_cases",        label: "From cases",        value: caseLinked.count,                color: pillar.purple.fg, tint: pillar.purple, sub: inr(caseLinked.value) },
          { id: "standalone",        label: "Standalone",        value: standalone.count,                color: c.muted, tint: pillar.green,  sub: inr(standalone.value) },
        ].filter((s) => visibleTiles.has(s.id)).map((s) => (
          <div
            key={s.label}
            className="modern-lift"
            style={{
              background: modern ? s.tint.bg : "var(--card-bg)",
              border: `1px solid ${modern ? `${s.tint.base}55` : "var(--line)"}`,
              borderRadius: "var(--card-radius)", padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: modern ? 700 : 400, color: modern ? s.tint.fg : c.muted, ...(modern ? { textTransform: "uppercase" as const, letterSpacing: 0.5, fontSize: 10 } : {}) }}>{s.label}</div>
            <div
              style={{
                fontSize: tileNumFontSize(String(s.value)), fontWeight: modern ? 700 : 600, color: modern ? s.tint.fg : s.color, marginTop: 4,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}
              title={String(s.value)}
            >
              {s.value}
            </div>
            {"sub" in s && <div style={{ fontSize: 11.5, color: c.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={String(s.sub)}>{s.sub}</div>}
          </div>
        ))}
      </div>

      <AdvancedFilterPanel object="quote" />
      </>)}

      {/* Filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{
            padding: "7px 10px", borderRadius: 7, border: `1px solid ${c.line}`,
            fontSize: 13, color: filterStatus ? c.ink : c.hint,
            background: c.panel, fontFamily: "inherit", outline: "none", cursor: "pointer",
          }}
        >
          <option value="">All statuses</option>
          {quoteStatuses.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        <input
          value={filterAccount}
          onChange={(e) => setFilterAccount(e.target.value)}
          placeholder="Search account…"
          style={{
            border: `1px solid ${c.line}`, borderRadius: 7, padding: "7px 12px",
            fontSize: 13, color: c.ink, background: c.panel, fontFamily: "inherit",
            outline: "none", width: 200,
          }}
        />

        {(filterStatus || filterAccount || Object.keys(colFilters).length > 0) && (
          <button
            onClick={() => { setFilterStatus(""); setFilterAccount(""); setColFilters({}); }}
            style={{ fontSize: 12, color: c.hint, background: "none", border: "none", cursor: "pointer" }}
          >
            Clear ✕
          </button>
        )}

        <div style={{ marginLeft: "auto", fontSize: 12, color: c.hint }}>
          {filtered.length} of {afRows.length} quotes
        </div>
      </div>

      {/* Table */}
      <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        {/* Toolbar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", borderBottom: `1px solid ${c.line}`, background: c.panel2,
        }}>
          <span style={{ fontSize: 12, color: c.hint, fontWeight: 500 }}>
            {filtered.length} quote{filtered.length !== 1 ? "s" : ""}
          </span>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Adapt drawer -- lets an admin add/rename/hide quote fields; a
                field added here becomes a column in this list immediately. */}
            <AdaptObjectDrawer objectType="quote" objectLabel="Quotation" isAdmin={isAdmin} />

            {/* Columns picker */}
            <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setAdaptOpen((v) => !v)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                background: adaptOpen ? c.accentbg : "none",
                color: adaptOpen ? c.accent : c.muted,
                border: `1px solid ${adaptOpen ? c.accent + "60" : c.line}`,
                borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}
            >
              ⚙ Columns
            </button>

            {adaptOpen && (
              <div style={{
                position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50,
                background: c.panel, border: `1px solid ${c.line}`, borderRadius: 10,
                boxShadow: "0 4px 16px rgba(0,0,0,0.10)", padding: "10px 0", minWidth: 200,
                maxHeight: 420, overflowY: "auto",
              }}>
                <div style={{ padding: "4px 14px 8px", fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6 }}>
                  Show columns
                </div>
                {columns.map((col, i) => {
                  const on = visibleCols.has(col.id);
                  const firstCustom = col.group === "custom" && columns[i - 1]?.group !== "custom";
                  return (
                    <div key={col.id}>
                      {firstCustom && (
                        <div style={{ padding: "8px 14px 4px", fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6, borderTop: `1px solid ${c.line}`, marginTop: 6 }}>
                          Custom fields
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleCol(col.id)}
                        style={{
                          width: "100%", display: "flex", alignItems: "center", gap: 10,
                          padding: "7px 14px", background: "none", border: "none",
                          cursor: "pointer", textAlign: "left",
                        }}
                      >
                        <div style={{
                          width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                          background: on ? c.accent : "none",
                          border: `1.5px solid ${on ? c.accent : c.line}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          {on && <CheckIcon size={10} color="#fff" />}
                        </div>
                        <span style={{ fontSize: 12.5, color: on ? c.ink : c.hint, fontWeight: on ? 600 : 400 }}>
                          {col.label}
                        </span>
                      </button>
                    </div>
                  );
                })}
                <div style={{ padding: "8px 14px 4px", fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6, borderTop: `1px solid ${c.line}`, marginTop: 6 }}>
                  Summary tiles
                </div>
                {TILE_DEFS.map((t) => {
                  const on = visibleTiles.has(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleTile(t.id)}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 10,
                        padding: "7px 14px", background: "none", border: "none",
                        cursor: "pointer", textAlign: "left",
                      }}
                    >
                      <div style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                        background: on ? c.accent : "none",
                        border: `1.5px solid ${on ? c.accent : c.line}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {on && <CheckIcon size={10} color="#fff" />}
                      </div>
                      <span style={{ fontSize: 12.5, color: on ? c.ink : c.hint, fontWeight: on ? 600 : 400 }}>
                        {t.label}
                      </span>
                    </button>
                  );
                })}
                <div style={{ borderTop: `1px solid ${c.line}`, margin: "8px 0 4px" }} />
                <button
                  type="button"
                  onClick={() => setAdaptOpen(false)}
                  style={{
                    width: "100%", padding: "6px 14px", background: "none", border: "none",
                    cursor: "pointer", fontSize: 12, color: c.muted, textAlign: "left",
                    display: "flex", alignItems: "center", gap: 6,
                  }}
                >
                  <XIcon size={11} color={c.muted} /> Close
                </button>
              </div>
            )}
            </div>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 36, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll}
                    style={{ cursor: "pointer", accentColor: c.accent }}
                  />
                </th>
                <th style={{ ...th, cursor: "pointer", position: "relative" }} onClick={() => toggleSort("ref")}>
                  Ref No{sortIndicator("ref")}
                  <ColSearch id="ref" label="Ref No" colFilters={colFilters} openId={openColSearch} setOpenId={setOpenColSearch} setColFilter={setColFilter} />
                </th>
                {shownColumns.map((col) => (
                  <th
                    key={col.id}
                    style={{ ...th, textAlign: col.align ?? "left", cursor: "pointer", position: "relative" }}
                    onClick={() => toggleSort(col.id)}
                  >
                    {col.label}{sortIndicator(col.id)}
                    <ColSearch id={col.id} label={col.label} colFilters={colFilters} openId={openColSearch} setOpenId={setOpenColSearch} setColFilter={setColFilter} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={colCount} style={{ ...td, textAlign: "center", padding: "32px 0", color: c.hint }}>
                    No quotes match the current filters
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => {
                  const { quote } = row;
                  const isSelected = selected.has(quote.id);
                  return (
                    <tr
                      key={quote.id}
                      style={{ background: isSelected ? c.accentbg : "transparent", cursor: "pointer" }}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).tagName === "INPUT") return;
                        toggle(quote.id);
                      }}
                    >
                      <td style={{ ...td, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(quote.id)}
                          style={{ cursor: "pointer", accentColor: c.accent }}
                        />
                      </td>
                      <td style={td}>
                        <Link
                          href={ROUTES.quotation(quote.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontWeight: 600, color: c.accent, fontFamily: "monospace" }}
                        >
                          {quote.ref_no || quote.ref}
                        </Link>
                      </td>
                      {shownColumns.map((col) => (
                        <td key={col.id} style={{ ...td, textAlign: col.align ?? "left", ...col.cellStyle }}>
                          {col.render(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pager page={page} total={filtered.length} pageSize={DEFAULT_PAGE_SIZE} onPage={setPage} />
      </div>

      {/* Floating action bar */}
      {selectedCount > 0 && (
        <div style={{
          position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)",
          display: "flex", alignItems: "center", gap: 10,
          background: c.ink, borderRadius: 12, padding: "10px 16px",
          boxShadow: "0 8px 32px rgba(0,0,0,.35)", zIndex: 500, whiteSpace: "nowrap",
        }}>
          <span style={{ fontSize: 13, color: "#8fa8c0", fontWeight: 500 }}>
            {selectedCount} selected
          </span>
          <div style={{ width: 1, height: 18, background: "#2e4257" }} />

          <button
            onClick={copyQuote}
            disabled={selectedCount !== 1}
            title={selectedCount !== 1 ? "Select exactly one quote to copy" : "Copy this quote into a new draft"}
            style={{
              fontSize: 13, fontWeight: 600, padding: "6px 14px", borderRadius: 7, border: "none", cursor: selectedCount === 1 ? "pointer" : "not-allowed",
              background: selectedCount === 1 ? pillar.blue.bg : "#1a2d3e",
              color:      selectedCount === 1 ? pillar.blue.fg : "#4a6070",
            }}
          >
            ⎘ Copy quote
          </button>

          <button
            onClick={deleteSelected}
            style={{
              fontSize: 13, fontWeight: 600, padding: "6px 14px", borderRadius: 7, border: "none", cursor: "pointer",
              background: pillar.red.bg, color: pillar.red.fg,
            }}
          >
            ✕ Delete
          </button>

          <div style={{ width: 1, height: 18, background: "#2e4257" }} />
          <button
            onClick={() => setSelected(new Set())}
            style={{ background: "none", border: "none", color: "#8fa8c0", fontSize: 18, cursor: "pointer", lineHeight: 1 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
          background: "#1c2733", color: "#fff", fontSize: 13, fontWeight: 500,
          padding: "10px 20px", borderRadius: 9, zIndex: 600,
          boxShadow: "0 4px 16px rgba(0,0,0,.25)",
        }}>
          {toast}
        </div>
      )}
    </>
  );
}
