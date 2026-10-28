"use client";

import { Fragment, useState, useEffect } from "react";
import { c } from "@/lib/theme";
import { downloadCsv } from "@/lib/import/template";
import { buildCsv, byLabel, formatValue, viaLabel, type ChangeLogRow } from "./changeHistoryRows";
import Pager from "@/components/Pager";
import { paginate, clampPage, DEFAULT_PAGE_SIZE } from "@/lib/paginate";
import { useTenantFeature } from "@/lib/tenant-context";

// Mirrors the objectType strings src/lib/changeLog.ts records -- kept as its
// own small list rather than importing ImportObjectId, since not every
// object with change history is (or ever will be) an import target, and the
// coupling would be one more place a rename has to be remembered twice.
export const OBJECT_TYPES: { value: string; label: string }[] = [
  { value: "accounts", label: "Accounts" },
  { value: "webhooks", label: "Webhooks" },
  { value: "integration_mapping", label: "Integration mappings" },
  { value: "value_list", label: "Value lists" },
  { value: "contacts", label: "Contacts" },
  { value: "assets", label: "Assets" },
  { value: "suppliers", label: "Suppliers" },
  { value: "supplier_groups", label: "Supplier groups" },
  { value: "products", label: "Products" },
  { value: "opportunities", label: "Deals" },
  { value: "opportunity_tenders", label: "Deals: Tender details" },
  { value: "opportunity_competitors", label: "Deals: Competitors" },
  { value: "deal_rooms", label: "Deals: Deal Room" },
  { value: "contract_projects", label: "Contract projects" },
  { value: "quotes", label: "Quotes" },
  { value: "standard_quotes", label: "Standard Quotes" },
  { value: "sales_orders", label: "Sales Orders" },
  { value: "sales_order_types", label: "Sales order types" },
  { value: "cases", label: "Cases" },
  { value: "work_orders", label: "Work Orders" },
  { value: "invoices", label: "Invoices" },
  { value: "purchase_orders", label: "Purchase Orders" },
  { value: "rfqs", label: "RFQs" },
  { value: "estimates", label: "Estimates" },
  { value: "process_studies", label: "Process studies" },
  { value: "newsletters", label: "Newsletters" },
  { value: "leads", label: "Leads" },
  { value: "inbound_emails", label: "Inbox: Emails" },
  { value: "inbox_channels", label: "Inbox: Channels" },
  { value: "signal_topics", label: "Signal topics" },
  { value: "account_intent", label: "Buying signals" },
  { value: "forms", label: "Forms" },
  { value: "abm_programs", label: "ABM programs" },
  { value: "abm_target_accounts", label: "ABM target accounts" },
  { value: "abm_buying_group_members", label: "ABM buying group members" },
  { value: "journeys", label: "Journeys" },
  { value: "whatsapp_templates", label: "WhatsApp templates" },
  { value: "whatsapp_identity", label: "WhatsApp number" },
  { value: "marketing_events", label: "Events" },
  { value: "event_registrations", label: "Event registrations" },
  { value: "estimate_templates", label: "Estimate templates" },
  { value: "inventory", label: "Inventory" },
  { value: "employees", label: "Employees" },
  { value: "tenant_users", label: "People and access" },
  { value: "wfm_projects", label: "Workforce: Projects" },
  { value: "wfm_leave_types", label: "Workforce: Leave types" },
  { value: "pricing_config", label: "Pricing: Versions" },
  { value: "pricing_rfqs", label: "Pricing: RFQs" },
  { value: "teams", label: "Coverage: Teams" },
  { value: "segments", label: "Coverage: Segments" },
  { value: "coverages", label: "Coverage: Assignments" },
  { value: "marketing_settings", label: "Marketing settings" },
];

const ACTION_TONE: Record<ChangeLogRow["action"], { bg: string; fg: string }> = {
  create: { bg: "#e5f6ee", fg: "#1c8a5a" },
  update: { bg: "#eaf2fd", fg: "#2563eb" },
  delete: { bg: "#fbe9e7", fg: "#c62828" },
  reopen: { bg: "#fef3e0", fg: "#b7791f" },
};

export default function ChangeHistoryClient() {
  // Newsletters are listed only for a workspace that has the Newsletter Studio: nobody else has any.
  const hasNewsletters = useTenantFeature("newsletter_studio");
  // Lead changes are recorded only by the lead-scoring program.
  const hasLeadScoring = useTenantFeature("marketing_scoring");
  const hasSignals = useTenantFeature("buying_signals");
  const hasForms = useTenantFeature("marketing_forms");
  const hasAbm = useTenantFeature("abm");
  const hasJourneys = useTenantFeature("journeys");
  const hasWebhooks = useTenantFeature("webhooks_library");
  const hasMiddleware = useTenantFeature("integration_middleware");
  const hasWhatsapp = useTenantFeature("whatsapp_marketing");
  const hasEvents = useTenantFeature("marketing_events");
  const hasInbox = useTenantFeature("inbox");
  const hasTender = useTenantFeature("gcc_tender");
  const hasDealRoom = useTenantFeature("deal_room");
  const hasContractProjects = useTenantFeature("contract_projects");
  const objectTypes = OBJECT_TYPES.filter((o) => (o.value !== "contract_projects" || hasContractProjects) && (!["inbound_emails", "inbox_channels"].includes(o.value) || hasInbox) && (!["opportunity_tenders", "opportunity_competitors"].includes(o.value) || hasTender) && (o.value !== "deal_rooms" || (hasTender && hasDealRoom)) &&(!o.value.startsWith("whatsapp_") || hasWhatsapp) && (!["marketing_events", "event_registrations"].includes(o.value) || hasEvents) && (o.value !== "newsletters" || hasNewsletters) && (!["leads", "marketing_settings"].includes(o.value) || hasLeadScoring) && (!["signal_topics", "account_intent"].includes(o.value) || hasSignals) && (o.value !== "forms" || hasForms) && (!o.value.startsWith("abm_") || hasAbm) && (o.value !== "journeys" || hasJourneys) && (o.value !== "webhooks" || hasWebhooks) && (!["integration_mapping", "value_list"].includes(o.value) || hasMiddleware));
  const [objectType, setObjectType] = useState(OBJECT_TYPES[0].value);
  const [objectId, setObjectId] = useState("");
  const [rows, setRows] = useState<ChangeLogRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ object_type: objectType });
      if (objectId.trim()) params.set("object_id", objectId.trim());
      const res = await fetch(`/api/change-log?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Search failed (${res.status})`);
        setRows(null);
        return;
      }
      setRows(json.rows as ChangeLogRow[]);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setRows(null);
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!rows || rows.length === 0) return;
    const csv = buildCsv(rows);
    const label = OBJECT_TYPES.find((o) => o.value === objectType)?.label ?? objectType;
    downloadCsv(`change_history_${label.toLowerCase().replace(/\s+/g, "_")}${objectId ? `_${objectId}` : ""}.csv`, csv);
  }

  const visible = paginate(rows ?? [], page, DEFAULT_PAGE_SIZE);

  useEffect(() => {
    setPage((p) => clampPage(p, rows?.length ?? 0, DEFAULT_PAGE_SIZE));
  }, [rows]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>
            Object
          </label>
          <select
            value={objectType}
            onChange={(e) => { setObjectType(e.target.value); setRows(null); }}
            style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${c.line}`, fontSize: 13, background: c.panel, color: c.ink, minWidth: 180 }}
          >
            {objectTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>
            Record ID (optional)
          </label>
          <input
            value={objectId}
            onChange={(e) => setObjectId(e.target.value)}
            placeholder="Leave blank for all records"
            style={{ padding: "8px 10px", borderRadius: 8, border: `1px solid ${c.line}`, fontSize: 13, background: c.panel, color: c.ink, minWidth: 260 }}
          />
        </div>
        <button
          onClick={search}
          disabled={loading}
          style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: c.accent, color: c.panel, border: "none", cursor: loading ? "wait" : "pointer" }}
        >
          {loading ? "Searching…" : "Search"}
        </button>
        {rows && rows.length > 0 && (
          <button
            onClick={download}
            style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, background: "none", color: c.muted, border: `1px solid ${c.line}`, cursor: "pointer" }}
          >
            ↓ Download CSV
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: "#fbe9e7", border: "1px solid #c6282840", borderRadius: 10, padding: "13px 16px", fontSize: 12.5, color: "#c62828" }}>
          {error}
        </div>
      )}

      {rows && (
        <div style={{ overflowX: "auto", border: `1px solid ${c.line}`, borderRadius: 9 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                {["When", "Action", "Record", "By"].map((h) => (
                  <th key={h} style={{ padding: "9px 11px", textAlign: "left", color: c.hint, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${c.line}`, background: c.panel2, whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const tone = ACTION_TONE[row.action];
                const detail = row.action === "update" && row.changes.length > 0;
                const isOpen = open === row.id;
                const cell = { padding: "8px 11px", borderBottom: isOpen ? "none" : `1px solid ${c.line}` } as const;
                return (
                  <Fragment key={row.id}>
                    <tr
                      onClick={detail ? () => setOpen(isOpen ? null : row.id) : undefined}
                      onKeyDown={detail ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : row.id); } } : undefined}
                      tabIndex={detail ? 0 : undefined}
                      aria-expanded={detail ? isOpen : undefined}
                      style={{ cursor: detail ? "pointer" : "default" }}
                    >
                      <td style={{ ...cell, color: c.hint, whiteSpace: "nowrap", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                      <td style={cell}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: tone.fg, background: tone.bg, borderRadius: 6, padding: "3px 9px", whiteSpace: "nowrap" }}>
                          {row.action}
                        </span>
                      </td>
                      <td style={{ ...cell, color: c.ink }}>
                        {row.object_label ?? row.object_id}
                        {detail && <span aria-hidden style={{ marginLeft: 8, color: c.hint, fontSize: 11 }}>{isOpen ? "▾" : "▸"}</span>}
                      </td>
                      <td style={{ ...cell, color: c.muted, whiteSpace: "nowrap" }}>
                        {byLabel(row)}
                        {viaLabel(row.via) && (
                          <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: c.hint, border: `1px solid ${c.line}`, borderRadius: 6, padding: "1px 6px" }}>
                            {viaLabel(row.via)}
                          </span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={4} style={{ padding: "2px 11px 10px", borderBottom: `1px solid ${c.line}`, background: c.panel2 }}>
                          {row.changes.map((ch, k) => (
                            <div key={k} style={{ fontSize: 12.5, color: c.ink, padding: "3px 0", wordBreak: "break-word" }}>
                              <span style={{ color: c.hint }}>{ch.field}</span>: {formatValue(ch.from)} → {formatValue(ch.to)}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: "20px 11px", textAlign: "center", color: c.hint }}>
                    No changes recorded yet for this {objectId ? "record" : "object"}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length > 0 && (
        <Pager page={page} total={rows.length} pageSize={DEFAULT_PAGE_SIZE} onPage={setPage} />
      )}
      {rows && rows.length >= 5000 && (
        <div style={{ fontSize: 11.5, color: c.hint, marginTop: 6 }}>
          Showing the most recent 5000 entries — the CSV download includes all of them.
        </div>
      )}
    </div>
  );
}
