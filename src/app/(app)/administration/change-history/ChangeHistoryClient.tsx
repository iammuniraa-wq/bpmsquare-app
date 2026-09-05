"use client";

import { useState, useEffect } from "react";
import { c } from "@/lib/theme";
import { csvCell, downloadCsv } from "@/lib/import/template";
import Pager from "@/components/Pager";
import { paginate, clampPage, DEFAULT_PAGE_SIZE } from "@/lib/paginate";

// Mirrors the objectType strings src/lib/changeLog.ts records -- kept as its
// own small list rather than importing ImportObjectId, since not every
// object with change history is (or ever will be) an import target, and the
// coupling would be one more place a rename has to be remembered twice.
const OBJECT_TYPES: { value: string; label: string }[] = [
  { value: "accounts", label: "Accounts" },
  { value: "contacts", label: "Contacts" },
  { value: "assets", label: "Assets" },
  { value: "suppliers", label: "Suppliers" },
  { value: "products", label: "Products" },
  { value: "quotes", label: "Quotes" },
  { value: "standard_quotes", label: "Standard Quotes" },
  { value: "cases", label: "Cases" },
  { value: "work_orders", label: "Work Orders" },
  { value: "invoices", label: "Invoices" },
  { value: "purchase_orders", label: "Purchase Orders" },
  { value: "inventory", label: "Inventory" },
  { value: "employees", label: "Employees" },
  { value: "wfm_projects", label: "Workforce: Projects" },
  { value: "wfm_leave_types", label: "Workforce: Leave types" },
  { value: "pricing_config", label: "Pricing: Versions" },
  { value: "pricing_rfqs", label: "Pricing: RFQs" },
  { value: "teams", label: "Coverage: Teams" },
  { value: "segments", label: "Coverage: Segments" },
  { value: "coverages", label: "Coverage: Assignments" },
];

type ChangeEntry = { field: string; from: unknown; to: unknown; redacted?: boolean };
type ChangeLogRow = {
  id: string;
  object_type: string;
  object_id: string;
  object_label: string | null;
  action: "create" | "update" | "delete" | "reopen";
  changes: ChangeEntry[];
  actor_id: string | null;
  actor_email: string | null;
  created_at: string;
};

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function summarizeChanges(row: ChangeLogRow): string {
  if (row.action === "create") return "Record created";
  if (row.action === "delete") return "Record deleted";
  if (row.changes.length === 0) return "—";
  return row.changes.map((ch) => `${ch.field}: ${formatValue(ch.from)} → ${formatValue(ch.to)}`).join("; ");
}

const ACTION_TONE: Record<ChangeLogRow["action"], { bg: string; fg: string }> = {
  create: { bg: "#e5f6ee", fg: "#1c8a5a" },
  update: { bg: "#eaf2fd", fg: "#2563eb" },
  delete: { bg: "#fbe9e7", fg: "#c62828" },
  reopen: { bg: "#fef3e0", fg: "#b7791f" },
};

export default function ChangeHistoryClient() {
  const [objectType, setObjectType] = useState(OBJECT_TYPES[0].value);
  const [objectId, setObjectId] = useState("");
  const [rows, setRows] = useState<ChangeLogRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);

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
    const header = ["Date", "Action", "Object Type", "Object ID", "Record", "Changed by", "Changes"];
    const body = rows.map((r) =>
      [r.created_at, r.action, r.object_type, r.object_id, r.object_label ?? "", r.actor_email ?? "", summarizeChanges(r)]
        .map((v) => csvCell(String(v)))
        .join(",")
    );
    const csv = "﻿" + [header.join(","), ...body].join("\r\n") + "\r\n";
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
            {OBJECT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                {["When", "Action", "Record", "Changes", "By"].map((h) => (
                  <th key={h} style={{ padding: "9px 11px", textAlign: "left", color: c.hint, fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, borderBottom: `1px solid ${c.line}`, background: c.panel2, whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const tone = ACTION_TONE[row.action];
                return (
                  <tr key={row.id}>
                    <td style={{ padding: "8px 11px", borderBottom: `1px solid ${c.line}`, color: c.hint, whiteSpace: "nowrap", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: "8px 11px", borderBottom: `1px solid ${c.line}` }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: tone.fg, background: tone.bg, borderRadius: 6, padding: "3px 9px", whiteSpace: "nowrap" }}>
                        {row.action}
                      </span>
                    </td>
                    <td style={{ padding: "8px 11px", borderBottom: `1px solid ${c.line}`, color: c.ink }}>
                      {row.object_label ?? row.object_id}
                    </td>
                    <td style={{ padding: "8px 11px", borderBottom: `1px solid ${c.line}`, color: c.ink, maxWidth: 420 }}>
                      {summarizeChanges(row)}
                    </td>
                    <td style={{ padding: "8px 11px", borderBottom: `1px solid ${c.line}`, color: c.muted, whiteSpace: "nowrap" }}>
                      {row.actor_email ?? "—"}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "20px 11px", textAlign: "center", color: c.hint }}>
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
