"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Account, Contact } from "@/lib/types";
import { c, pillar } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import { CheckIcon, XIcon, Phone, Mail } from "@/components/Icons";
import type { PillarKey } from "@/lib/theme";

const ACCOUNT_TYPE_LABEL: Record<Account["type"], string> = {
  prospect: "Prospect", oem: "OEM", direct: "Direct", end_customer: "End customer",
};

// ── Column definitions ────────────────────────────────────────────────────────

type ColId = "role" | "account" | "phone" | "email" | "acct_type";

type ColDef = { id: ColId; label: string; defaultOn: boolean };

const COLUMNS: ColDef[] = [
  { id: "account",   label: "Account",      defaultOn: true  },
  { id: "role",      label: "Role",         defaultOn: true  },
  { id: "phone",     label: "Phone",        defaultOn: true  },
  { id: "email",     label: "Email",        defaultOn: false },
  { id: "acct_type", label: "Account type", defaultOn: false },
];

const LS_KEY = "bms_contacts_cols";

const TYPE_TONE: Record<Account["type"], PillarKey> = {
  prospect: "amber", oem: "purple", direct: "blue", end_customer: "teal",
};

const initials = (name: string) =>
  name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

// ── Props ─────────────────────────────────────────────────────────────────────

interface Row { contact: Contact; account: Account }

interface Props { rows: Row[] }

// ── Component ─────────────────────────────────────────────────────────────────

export default function ContactsTable({ rows }: Props) {
  const [visibleCols, setVisibleCols] = useState<Set<ColId>>(
    new Set(COLUMNS.filter((c) => c.defaultOn).map((c) => c.id))
  );
  const [adaptOpen, setAdaptOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) setVisibleCols(new Set(JSON.parse(stored) as ColId[]));
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
      <div style={cardStyle}>
        <div style={{ textAlign: "center", padding: "48px 24px", color: c.hint, fontSize: 14 }}>
          No contacts yet.
          <div style={{ marginTop: 12 }}>
            <Link href={ROUTES.contactNew} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
              + Add first contact
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: `1px solid ${c.line}`, background: c.panel2,
      }}>
        <span style={{ fontSize: 12, color: c.hint, fontWeight: 500 }}>
          {rows.length} contact{rows.length !== 1 ? "s" : ""}
        </span>
        <div style={{ position: "relative" }}>
          <button type="button" onClick={() => setAdaptOpen((v) => !v)} style={adaptBtn(adaptOpen)}>
            ⚙ Columns
          </button>
          {adaptOpen && (
            <ColPicker cols={COLUMNS} visible={visibleCols} toggle={toggleCol} onClose={() => setAdaptOpen(false)} />
          )}
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${c.line}` }}>
              <th style={th}>Name</th>
              {visibleDefs.map((col) => (
                <th key={col.id} style={th}>{col.label}</th>
              ))}
              <th style={{ ...th, width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ contact, account }) => {
              const tone = TYPE_TONE[account.type];
              const p = pillar[tone];
              return (
                <tr key={contact.id} className="ct-row" style={{ borderBottom: `1px solid ${c.line}` }}>
                  {/* Name — always visible */}
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                        background: p.bg, color: p.fg,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 700,
                      }}>
                        {initials(contact.name)}
                      </div>
                      <span style={{ fontWeight: 600, fontSize: 13.5, color: c.ink }}>{contact.name}</span>
                    </div>
                  </td>

                  {/* Optional columns */}
                  {visibleDefs.map((col) => {
                    if (col.id === "account") return (
                      <td key="account" style={td}>
                        <Link href={ROUTES.account(account.id)} style={{ fontSize: 13, fontWeight: 500, color: c.accent, textDecoration: "none" }}>
                          {account.name}
                        </Link>
                      </td>
                    );
                    if (col.id === "role") return (
                      <td key="role" style={{ ...td, color: c.muted }}>
                        {contact.role ?? <span style={{ color: c.line }}>—</span>}
                      </td>
                    );
                    if (col.id === "phone") return (
                      <td key="phone" style={td}>
                        {contact.phone
                          ? <a href={`tel:${contact.phone}`} style={{ display: "flex", alignItems: "center", gap: 4, color: c.muted, textDecoration: "none", fontSize: 13 }}>
                              <Phone size={11} color={c.hint} />{contact.phone}
                            </a>
                          : <span style={{ color: c.line }}>—</span>}
                      </td>
                    );
                    if (col.id === "email") return (
                      <td key="email" style={td}>
                        {contact.email
                          ? <a href={`mailto:${contact.email}`} style={{ display: "flex", alignItems: "center", gap: 4, color: c.accent, textDecoration: "none", fontSize: 13 }}>
                              <Mail size={11} color={c.accent} />{contact.email}
                            </a>
                          : <span style={{ color: c.line }}>—</span>}
                      </td>
                    );
                    if (col.id === "acct_type") return (
                      <td key="acct_type" style={td}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 0.3,
                          color: p.base, background: p.bg, borderRadius: 4, padding: "2px 6px",
                        }}>
                          {ACCOUNT_TYPE_LABEL[account.type]}
                        </span>
                      </td>
                    );
                    return null;
                  })}

                  {/* Open link */}
                  <td style={{ ...td, textAlign: "right" }}>
                    <Link href={ROUTES.contact(contact.id)} style={openLink}>Open →</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style>{`.ct-row:hover { background: ${c.panel2} !important; }`}</style>
    </div>
  );
}

// ── Shared sub-components & styles ────────────────────────────────────────────

function ColPicker({ cols, visible, toggle, onClose }: {
  cols: ColDef[]; visible: Set<ColId>; toggle: (id: ColId) => void; onClose: () => void;
}) {
  return (
    <div style={{
      position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50,
      background: "#fff", border: `1px solid ${c.line}`, borderRadius: 10,
      boxShadow: "0 4px 16px rgba(0,0,0,0.10)", padding: "10px 0", minWidth: 180,
    }}>
      <div style={{ padding: "4px 14px 8px", fontSize: 10.5, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.6 }}>
        Show columns
      </div>
      {cols.map((col) => {
        const on = visible.has(col.id);
        return (
          <button key={col.id} type="button" onClick={() => toggle(col.id)} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 10,
            padding: "7px 14px", background: "none", border: "none", cursor: "pointer",
          }}>
            <div style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              background: on ? c.accent : "none", border: `1.5px solid ${on ? c.accent : c.line}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {on && <CheckIcon size={10} color="#fff" />}
            </div>
            <span style={{ fontSize: 12.5, color: on ? c.ink : c.hint, fontWeight: on ? 600 : 400 }}>{col.label}</span>
          </button>
        );
      })}
      <div style={{ borderTop: `1px solid ${c.line}`, margin: "8px 0 4px" }} />
      <button type="button" onClick={onClose} style={{
        width: "100%", padding: "6px 14px", background: "none", border: "none",
        cursor: "pointer", fontSize: 12, color: c.muted, textAlign: "left",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <XIcon size={11} color={c.muted} /> Close
      </button>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#fff", border: `1px solid ${c.line}`, borderRadius: 12, overflow: "hidden",
};

const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 600,
  padding: "9px 14px", fontSize: 11, letterSpacing: 0.4,
  textTransform: "uppercase", whiteSpace: "nowrap", background: c.panel2,
};

const td: React.CSSProperties = {
  padding: "11px 14px", fontSize: 13.5, verticalAlign: "middle",
};

const openLink: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: c.accent,
  background: c.accentbg, borderRadius: 6, padding: "4px 10px",
  textDecoration: "none", whiteSpace: "nowrap",
};

function adaptBtn(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 5,
    background: active ? c.accentbg : "none",
    color: active ? c.accent : c.muted,
    border: `1px solid ${active ? c.accent + "60" : c.line}`,
    borderRadius: 6, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer",
  };
}
