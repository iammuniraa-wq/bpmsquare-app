"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { ServiceCase, Account } from "@/lib/types";
import { CASE_STATUS_LABEL, CASE_TYPE_LABEL } from "@/lib/data";
import { c, pillar } from "@/lib/theme";
import type { PillarKey } from "@/lib/theme";
import Pill from "@/components/Pill";
import { ROUTES } from "@/lib/constants";
import { CheckIcon, XIcon } from "@/components/Icons";

// ── Column definitions ────────────────────────────────────────────────────────

type ColId = "stage" | "account" | "type" | "technician" | "intake" | "complaint";

type ColDef = { id: ColId; label: string; defaultOn: boolean };

const COLUMNS: ColDef[] = [
  { id: "stage",      label: "Stage",      defaultOn: true  },
  { id: "account",    label: "Account",    defaultOn: true  },
  { id: "type",       label: "Type",       defaultOn: true  },
  { id: "technician", label: "Technician", defaultOn: true  },
  { id: "intake",     label: "Intake",     defaultOn: true  },
  { id: "complaint",  label: "Complaint",  defaultOn: false },
];

const LS_KEY = "bms_cases_cols";

const statusTone: Record<ServiceCase["status"], PillarKey> = {
  intake: "blue", inspection: "blue",
  report_sent: "purple", report_approved: "purple",
  quote_sent: "amber", quote_approved: "amber",
  in_repair: "teal", qa: "teal", ready: "green",
  closed: "green", buyback: "purple", scrapped: "red",
};

const typeTone: Record<ServiceCase["type"], PillarKey> = {
  amc: "teal", adhoc: "amber", direct: "blue",
};

const fmtDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

// ── Props ─────────────────────────────────────────────────────────────────────

interface Row { serviceCase: ServiceCase; account: Account; technicianName: string | null }

interface Props { rows: Row[]; q?: string; filter: string }

// ── Component ─────────────────────────────────────────────────────────────────

export default function CasesTable({ rows, q, filter }: Props) {
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
          {q ? `No cases match "${q}".` : "No cases in this category."}
          {!q && filter === "open" && (
            <div style={{ marginTop: 12 }}>
              <Link href={ROUTES.caseNew} style={{ color: c.accent, fontWeight: 600, textDecoration: "none" }}>
                + Create your first case
              </Link>
            </div>
          )}
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
          {rows.length} case{rows.length !== 1 ? "s" : ""}
          {q && (
            <> · <Link href={`${ROUTES.cases}?filter=${filter}`} style={{ color: c.accent, textDecoration: "none", marginLeft: 2 }}>Clear search</Link></>
          )}
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
              <th style={th}>Ref · Equipment</th>
              {visibleDefs.map((col) => (
                <th key={col.id} style={th}>{col.label}</th>
              ))}
              <th style={{ ...th, width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ serviceCase: sc, account, technicianName }) => (
              <tr key={sc.id} className="cs-row" style={{ borderBottom: `1px solid ${c.line}` }}>
                {/* Ref + equipment — always visible */}
                <td style={td}>
                  <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color: c.accent }}>{sc.ref}</div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: c.ink, marginTop: 2 }}>{sc.equipment_label || "—"}</div>
                </td>

                {/* Optional columns */}
                {visibleDefs.map((col) => {
                  if (col.id === "stage") return (
                    <td key="stage" style={td}>
                      <Pill label={CASE_STATUS_LABEL[sc.status]} tone={statusTone[sc.status]} />
                    </td>
                  );
                  if (col.id === "account") return (
                    <td key="account" style={td}>
                      <Link href={ROUTES.account(account.id)} style={{ fontSize: 13, fontWeight: 500, color: c.ink, textDecoration: "none" }}>
                        {account.name}
                      </Link>
                    </td>
                  );
                  if (col.id === "type") return (
                    <td key="type" style={td}>
                      <Pill label={CASE_TYPE_LABEL[sc.type]} tone={typeTone[sc.type]} />
                    </td>
                  );
                  if (col.id === "technician") return (
                    <td key="technician" style={{ ...td, color: technicianName ? c.muted : c.hint, fontSize: 13 }}>
                      {technicianName ?? "—"}
                    </td>
                  );
                  if (col.id === "intake") return (
                    <td key="intake" style={{ ...td, color: c.hint, fontSize: 12.5, whiteSpace: "nowrap" }}>
                      {fmtDate(sc.intake_at)}
                    </td>
                  );
                  if (col.id === "complaint") return (
                    <td key="complaint" style={{ ...td, maxWidth: 200 }}>
                      <div style={{ fontSize: 12.5, color: c.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {sc.complaint || <span style={{ color: c.line }}>—</span>}
                      </div>
                    </td>
                  );
                  return null;
                })}

                {/* Open link */}
                <td style={{ ...td, textAlign: "right" }}>
                  <Link href={ROUTES.case(sc.id)} style={openLink}>Open →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style>{`.cs-row:hover { background: ${c.panel2} !important; }`}</style>
    </div>
  );
}

// ── Sub-components & styles ───────────────────────────────────────────────────

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
