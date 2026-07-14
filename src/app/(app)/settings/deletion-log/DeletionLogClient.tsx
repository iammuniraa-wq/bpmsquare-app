"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";

type ObjectType = "quote" | "case" | "work_order" | "account";

interface DeletedRecord {
  id: string;
  ref?: string;
  name?: string;
  status?: string;
  total?: number;
  account_id?: string;
  account_name?: string;
  created_at?: string;
  deleted_at: string;
  deleted_by?: string;
}

interface Logs {
  deleted_quotes:      unknown[];
  deleted_cases:       unknown[];
  deleted_work_orders: unknown[];
  deleted_accounts:    unknown[];
}

const TYPE_LABEL: Record<ObjectType, string> = {
  quote: "Quote", case: "Case", work_order: "Work Order", account: "Account",
};
const TYPE_COLOR: Record<ObjectType, string> = {
  quote: "#3b82f6", case: "#f59e0b", work_order: "#10b981", account: "#8b5cf6",
};

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 11.5, whiteSpace: "nowrap", background: c.panel2,
};
const td: React.CSSProperties = {
  padding: "10px 12px", borderBottom: `1px solid ${c.line}`,
  fontSize: 12.5, verticalAlign: "middle",
};

const fmtDate = (s: string) => {
  try {
    return new Date(s).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return s; }
};

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

export default function DeletionLogClient({ logs, isPlatformAdmin }: { logs: Logs; isPlatformAdmin: boolean }) {
  const [activeType, setActiveType] = useState<ObjectType | "all">("all");
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [allLogs, setAllLogs] = useState(logs);

  // Flatten all logs into a unified list
  const unified: Array<DeletedRecord & { objectType: ObjectType }> = [
    ...(allLogs.deleted_quotes      as DeletedRecord[]).map((r) => ({ ...r, objectType: "quote"      as ObjectType })),
    ...(allLogs.deleted_cases        as DeletedRecord[]).map((r) => ({ ...r, objectType: "case"       as ObjectType })),
    ...(allLogs.deleted_work_orders  as DeletedRecord[]).map((r) => ({ ...r, objectType: "work_order" as ObjectType })),
    ...(allLogs.deleted_accounts     as DeletedRecord[]).map((r) => ({ ...r, objectType: "account"    as ObjectType })),
  ].sort((a, b) => new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime());

  const filtered = activeType === "all" ? unified : unified.filter((r) => r.objectType === activeType);

  const counts: Record<ObjectType | "all", number> = {
    all:        unified.length,
    quote:      allLogs.deleted_quotes.length,
    case:       allLogs.deleted_cases.length,
    work_order: allLogs.deleted_work_orders.length,
    account:    allLogs.deleted_accounts.length,
  };

  async function clearAll() {
    if (!confirm("Clear the entire deletion log? This cannot be undone.")) return;
    setClearing(true);
    const res = await fetch("/api/deletion-log", { method: "DELETE" });
    setClearing(false);
    if (res.ok) {
      setAllLogs({ deleted_quotes: [], deleted_cases: [], deleted_work_orders: [], deleted_accounts: [] });
      setCleared(true);
      setTimeout(() => setCleared(false), 3000);
    }
  }

  const filterBtnStyle = (t: ObjectType | "all"): React.CSSProperties => ({
    padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
    border: "none", cursor: "pointer",
    background: activeType === t ? (t === "all" ? c.accent : TYPE_COLOR[t as ObjectType]) : c.panel2,
    color: activeType === t ? "#fff" : c.muted,
  });

  return (
    <div>
      {/* Filter + clear row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        <button style={filterBtnStyle("all")}      onClick={() => setActiveType("all")}>All ({counts.all})</button>
        <button style={filterBtnStyle("quote")}      onClick={() => setActiveType("quote")}>Quotes ({counts.quote})</button>
        <button style={filterBtnStyle("case")}       onClick={() => setActiveType("case")}>Cases ({counts.case})</button>
        <button style={filterBtnStyle("work_order")} onClick={() => setActiveType("work_order")}>Work Orders ({counts.work_order})</button>
        <button style={filterBtnStyle("account")}    onClick={() => setActiveType("account")}>Accounts ({counts.account})</button>

        {isPlatformAdmin && unified.length > 0 && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {cleared && <span style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>✓ Log cleared</span>}
            <button
              onClick={clearAll}
              disabled={clearing}
              style={{
                padding: "6px 14px", borderRadius: 7, border: "1px solid #fecaca",
                background: "#fef2f2", color: "#dc2626", fontSize: 12, fontWeight: 600,
                cursor: clearing ? "wait" : "pointer",
              }}
            >
              {clearing ? "Clearing…" : "Clear all logs"}
            </button>
          </div>
        )}
      </div>

      {unified.length === 0 ? (
        <div style={{ ...cardStyle, padding: "48px 24px", textAlign: "center", color: c.hint, fontSize: 14 }}>
          No deletion records yet.
        </div>
      ) : (
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Type</th>
                  <th style={th}>Ref / Name</th>
                  <th style={th}>Account</th>
                  <th style={th}>Status / Total</th>
                  <th style={th}>Original created</th>
                  <th style={th}>Deleted at</th>
                  <th style={th}>Deleted by</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ ...td, textAlign: "center", padding: "32px 0", color: c.hint }}>
                      No {TYPE_LABEL[activeType as ObjectType]} deletions logged.
                    </td>
                  </tr>
                ) : filtered.map((r, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : c.panel2 + "55" }}>
                    <td style={td}>
                      <span style={{
                        display: "inline-block", padding: "2px 9px", borderRadius: 12,
                        fontSize: 11, fontWeight: 700,
                        background: TYPE_COLOR[r.objectType] + "18",
                        color: TYPE_COLOR[r.objectType],
                        border: `1px solid ${TYPE_COLOR[r.objectType]}44`,
                      }}>
                        {TYPE_LABEL[r.objectType]}
                      </span>
                    </td>
                    <td style={td}>
                      <div style={{ fontWeight: 600, color: c.ink, fontFamily: r.ref ? "monospace" : "inherit", fontSize: r.ref ? 12 : 13 }}>
                        {r.ref ?? r.name ?? r.id}
                      </div>
                      {r.ref && r.name && (
                        <div style={{ fontSize: 11, color: c.muted, marginTop: 1 }}>{r.name}</div>
                      )}
                    </td>
                    <td style={{ ...td, color: c.muted, fontSize: 12 }}>
                      {r.account_name ?? r.account_id ?? "—"}
                    </td>
                    <td style={{ ...td, fontSize: 12 }}>
                      {r.status && <div style={{ color: c.muted }}>{r.status}</div>}
                      {r.total !== undefined && r.total !== null && (
                        <div style={{ fontWeight: 600, color: c.ink }}>{inr(r.total)}</div>
                      )}
                      {!r.status && r.total === undefined && "—"}
                    </td>
                    <td style={{ ...td, color: c.muted, fontSize: 12 }}>
                      {r.created_at ? fmtDate(r.created_at) : "—"}
                    </td>
                    <td style={{ ...td, color: "#dc2626", fontSize: 12, fontWeight: 500 }}>
                      {fmtDate(r.deleted_at)}
                    </td>
                    <td style={{ ...td, color: c.hint, fontSize: 11, fontFamily: "monospace" }}>
                      {r.deleted_by ? r.deleted_by.slice(0, 8) + "…" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
