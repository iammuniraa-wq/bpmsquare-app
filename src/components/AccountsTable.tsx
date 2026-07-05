"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data";
import type { Account } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import { MapPin, CheckIcon, XIcon } from "@/components/Icons";
import type { PillarKey } from "@/lib/theme";
import type { AccountSummary } from "@/lib/data/live";

// ── Column definitions ────────────────────────────────────────────────────────

type ColId = "type" | "city" | "phone" | "contacts" | "cases" | "assets" | "contracts";

type ColDef = { id: ColId; label: string; defaultOn: boolean; align?: "center" | "right" };

const COLUMNS: ColDef[] = [
  { id: "type",      label: "Type",      defaultOn: true  },
  { id: "city",      label: "City",      defaultOn: true  },
  { id: "phone",     label: "Phone",     defaultOn: false },
  { id: "contacts",  label: "Contacts",  defaultOn: true,  align: "center" },
  { id: "cases",     label: "Cases",     defaultOn: true,  align: "center" },
  { id: "assets",    label: "Assets",    defaultOn: true,  align: "center" },
  { id: "contracts", label: "AMC",       defaultOn: false, align: "center" },
];

const LS_KEY = "bms_accounts_cols";

const typeTone: Record<Account["type"], PillarKey> = {
  prospect: "amber", oem: "purple", direct: "green", end_customer: "teal",
};

const initials = (name: string) =>
  name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  rows: AccountSummary[];
  q?: string;
  typeFilter?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AccountsTable({ rows, q, typeFilter }: Props) {
  const [visibleCols, setVisibleCols] = useState<Set<ColId>>(
    new Set(COLUMNS.filter((c) => c.defaultOn).map((c) => c.id))
  );
  const [adaptOpen, setAdaptOpen] = useState(false);

  // Load from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const arr = JSON.parse(stored) as ColId[];
        setVisibleCols(new Set(arr));
      }
    } catch { /* ignore */ }
  }, []);

  function toggleCol(id: ColId) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(LS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  const visibleDefs = COLUMNS.filter((col) => visibleCols.has(col.id));

  if (rows.length === 0) {
    return (
      <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        <div style={{ textAlign: "center", padding: "48px 24px", color: c.hint, fontSize: 14 }}>
          {q || typeFilter ? "No accounts match this filter." : "No accounts yet."}
          {!q && !typeFilter && (
            <div style={{ marginTop: 12 }}>
              <Link href={ROUTES.accountNew} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
                + Create your first account
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
      {/* Table toolbar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: `1px solid ${c.line}`, background: c.panel2,
      }}>
        <span style={{ fontSize: 12, color: c.hint, fontWeight: 500 }}>
          {rows.length} account{rows.length !== 1 ? "s" : ""}
        </span>

        {/* Adapt / columns button */}
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

          {/* Column picker dropdown */}
          {adaptOpen && (
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50,
              background: c.panel, border: `1px solid ${c.line}`, borderRadius: 10,
              boxShadow: "0 4px 16px rgba(0,0,0,0.10)", padding: "10px 0", minWidth: 180,
            }}>
              <div style={{ padding: "4px 14px 8px", fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6 }}>
                Show columns
              </div>
              {COLUMNS.map((col) => {
                const on = visibleCols.has(col.id);
                return (
                  <button
                    key={col.id}
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

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${c.line}` }}>
              <th style={th}>Account</th>
              {visibleDefs.map((col) => (
                <th key={col.id} style={{ ...th, textAlign: col.align ?? "left" }}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ account, referredBy, counts }, i) => {
              const tone = typeTone[account.type];
              const p = pillar[tone];
              return (
                <tr
                  key={account.id}
                  className="acc-row"
                  style={{ borderBottom: `1px solid ${c.line}` }}
                >
                  {/* Account name — always visible */}
                  <td style={td}>
                    <Link href={ROUTES.account(account.id)}
                      style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                        background: p.bg, color: p.fg,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 700,
                      }}>
                        {initials(account.name)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13.5, color: c.ink }}>{account.name}</div>
                        {referredBy && (
                          <div style={{ fontSize: 11, color: c.hint, marginTop: 1 }}>via {referredBy.name}</div>
                        )}
                      </div>
                    </Link>
                  </td>

                  {/* Optional columns */}
                  {visibleDefs.map((col) => {
                    if (col.id === "type") return (
                      <td key="type" style={td}>
                        <Pill label={ACCOUNT_TYPE_LABEL[account.type]} tone={tone} />
                      </td>
                    );
                    if (col.id === "city") return (
                      <td key="city" style={{ ...td, color: c.muted, whiteSpace: "nowrap" }}>
                        {account.city
                          ? <span style={{ display: "flex", alignItems: "center", gap: 4 }}><MapPin size={11} color={c.hint} />{account.city}</span>
                          : <span style={{ color: c.line }}>—</span>}
                      </td>
                    );
                    if (col.id === "phone") return (
                      <td key="phone" style={{ ...td, color: c.muted, whiteSpace: "nowrap" }}>
                        {account.phone ?? <span style={{ color: c.line }}>—</span>}
                      </td>
                    );
                    if (col.id === "contacts") return (
                      <td key="contacts" style={{ ...td, textAlign: "center" }}>
                        <CountBadge n={counts.contacts} />
                      </td>
                    );
                    if (col.id === "cases") return (
                      <td key="cases" style={{ ...td, textAlign: "center" }}>
                        <CountBadge n={counts.quotes} />
                      </td>
                    );
                    if (col.id === "assets") return (
                      <td key="assets" style={{ ...td, textAlign: "center" }}>
                        <CountBadge n={counts.assets} />
                      </td>
                    );
                    if (col.id === "contracts") return (
                      <td key="contracts" style={{ ...td, textAlign: "center" }}>
                        <CountBadge n={counts.contracts} />
                      </td>
                    );
                    return null;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style>{`
        .acc-row { transition: background 0.1s; }
        .acc-row:hover { background: ${c.panel2} !important; }
      `}</style>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: `1px solid ${c.line}`,
  borderRadius: 12,
};

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 600,
  padding: "9px 14px", fontSize: 11, letterSpacing: 0.4,
  textTransform: "uppercase", whiteSpace: "nowrap",
  background: c.panel2,
};

const td: React.CSSProperties = {
  padding: "11px 14px", fontSize: 13.5, verticalAlign: "middle",
};

function CountBadge({ n }: { n: number }) {
  if (!n) return <span style={{ color: c.line, fontSize: 12 }}>—</span>;
  return <span style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>{n}</span>;
}
