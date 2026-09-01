"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ROUTES, CASE_STATUS_LABEL } from "@/lib/constants";
import type { CaseSummary } from "@/lib/data";
import Pill from "@/components/Pill";
import type { PillarKey } from "@/lib/theme";

/**
 * Nova — Cases List, redrawn (ported from Quotations' QuoteListNova,
 * owner request 2026-09-01). Same rows CasesTable.tsx shows classic
 * tenants, deliberately NOT that component -- gated strictly for Nova,
 * swapped in only after CaseBoardSlot already knows the tenant is on
 * Nova.
 *
 * Narrower than QuoteListNova's bulk bar on purpose: Cases has no
 * duplicate-case concept the way a quote can be copied into a new draft,
 * so the only real bulk capability is Delete (DELETE /api/cases/[id]
 * already exists per-case; nothing invented here).
 *
 * "Age" here is days since intake_at, not since a last-touched
 * timestamp -- ServiceCase has no updated_at at all. Same honest caveat
 * as CaseField.tsx.
 */

const DAY = 86_400_000;

const STATUS_TONE: Record<string, PillarKey> = {
  intake: "blue", inspection: "blue",
  report_sent: "purple", report_approved: "purple",
  quote_sent: "amber", quote_approved: "amber",
  in_repair: "teal", qa: "teal", ready: "green",
  closed: "green", buyback: "purple", scrapped: "red",
};

function ageChip(days: number) {
  const color = days >= 30 ? "#E4634A" : days >= 14 ? "#F0A93B" : "var(--nova-ink-faint)";
  const bg = days >= 30 ? "rgba(228,99,74,.12)" : days >= 14 ? "rgba(240,169,59,.12)" : "var(--nova-glass-bg)";
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 11,
      fontFamily: "var(--nova-font-body)", fontVariantNumeric: "tabular-nums",
      color, background: bg, border: `1px solid ${color}44`, whiteSpace: "nowrap",
    }}>
      {days}d
    </span>
  );
}

export default function CaseListNova({ rows }: { rows: CaseSummary[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const now = Date.now();
  const withAge = useMemo(() => rows.map((r) => ({
    row: r,
    ageDays: Math.max(0, Math.round((now - new Date(r.serviceCase.intake_at).getTime()) / DAY)),
  })), [rows, now]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.serviceCase.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.serviceCase.id)));
  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3200); };

  const deleteSelected = async () => {
    setBusy(true);
    const ids = [...selected];
    const results = await Promise.all(ids.map((id) => fetch(`/api/cases/${id}`, { method: "DELETE" })));
    const failed = results.filter((r) => !r.ok).length;
    const deleted = ids.length - failed;
    setBusy(false);
    setSelected(new Set());
    showToast(failed > 0 ? `${deleted} deleted, ${failed} failed` : `${deleted} case${deleted === 1 ? "" : "s"} deleted`);
    if (deleted > 0) router.refresh();
  };

  return (
    <div style={{ position: "relative", paddingBottom: selected.size > 0 ? 56 : 0 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--nova-line)" }}>
            <th style={{ width: 32, padding: "8px 6px" }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
            </th>
            <th style={{ textAlign: "left", padding: "8px 6px", fontSize: 11, color: "var(--nova-ink-faint)", fontWeight: 500 }}>Account</th>
            <th style={{ textAlign: "left", padding: "8px 6px", fontSize: 11, color: "var(--nova-ink-faint)", fontWeight: 500 }}>Age</th>
            <th style={{ textAlign: "left", padding: "8px 6px", fontSize: 11, color: "var(--nova-ink-faint)", fontWeight: 500 }}>Stage</th>
            <th style={{ textAlign: "left", padding: "8px 6px", fontSize: 11, color: "var(--nova-ink-faint)", fontWeight: 500 }}>Technician</th>
            <th style={{ width: 90 }} />
          </tr>
        </thead>
        <tbody>
          {withAge.map(({ row: r, ageDays }) => (
            <tr
              key={r.serviceCase.id}
              className="nova-list-row"
              style={{ borderBottom: "1px solid var(--nova-line-soft)" }}
            >
              <td style={{ padding: "10px 6px" }}>
                <input type="checkbox" checked={selected.has(r.serviceCase.id)} onChange={() => toggle(r.serviceCase.id)} aria-label={`Select ${r.account.name}`} />
              </td>
              <td style={{ padding: "10px 6px", cursor: "pointer" }} onClick={() => router.push(ROUTES.case(r.serviceCase.id))}>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--nova-ink)" }}>{r.account.name}</div>
                <div style={{ fontFamily: "var(--nova-font-body)", fontSize: 11, color: "var(--nova-ink-faint)", marginTop: 2 }}>
                  {r.serviceCase.ref} · {r.serviceCase.equipment_label || "—"}
                </div>
              </td>
              <td style={{ padding: "10px 6px" }}>{ageChip(ageDays)}</td>
              <td style={{ padding: "10px 6px" }}>
                <Pill label={CASE_STATUS_LABEL[r.serviceCase.status] ?? r.serviceCase.status} tone={STATUS_TONE[r.serviceCase.status] ?? "blue"} />
              </td>
              <td style={{ padding: "10px 6px", fontSize: 13, color: r.technicianName ? "var(--nova-ink-dim)" : "var(--nova-ink-faint)" }}>
                {r.technicianName ?? "—"}
              </td>
              <td style={{ padding: "10px 6px" }} className="nova-list-actions">
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", opacity: 0 }}>
                  <Link
                    href={ROUTES.case(r.serviceCase.id)}
                    style={{ fontSize: 11.5, padding: "5px 9px", borderRadius: 6, border: "1px solid var(--nova-line)", color: "var(--nova-ink-dim)", textDecoration: "none" }}
                  >
                    Open
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div style={{ padding: 28, textAlign: "center", color: "var(--nova-ink-faint)", fontSize: 13 }}>No cases match.</div>
      )}

      <style>{`.nova-list-row:hover .nova-list-actions > div { opacity: 1 !important; }`}</style>

      {selected.size > 0 && (
        <div style={{
          position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", zIndex: 30,
          display: "flex", alignItems: "center", gap: 12,
          background: "var(--nova-bg)", border: "1px solid var(--nova-line)", borderRadius: 12,
          padding: "10px 16px", boxShadow: "0 20px 50px -20px rgba(0,0,0,.8)",
        }}>
          <span style={{ fontSize: 13, color: "var(--nova-ink)", fontWeight: 500 }}>{selected.size} selected</span>
          <button
            type="button" disabled={busy} onClick={deleteSelected}
            style={{
              fontSize: 12.5, fontWeight: 600, padding: "6px 13px", borderRadius: 7, border: "1px solid #E4634A55",
              cursor: busy ? "not-allowed" : "pointer", background: "rgba(228,99,74,.14)", color: "#E4634A",
            }}
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
          <button
            type="button" onClick={() => setSelected(new Set())}
            style={{ fontSize: 12.5, padding: "6px 10px", borderRadius: 7, border: "none", background: "none", color: "var(--nova-ink-faint)", cursor: "pointer" }}
          >
            Clear
          </button>
        </div>
      )}
      {toast && (
        <div style={{
          position: "fixed", left: "50%", bottom: selected.size > 0 ? 78 : 20, transform: "translateX(-50%)", zIndex: 30,
          background: "var(--nova-bg)", border: "1px solid var(--nova-line)", borderRadius: 10,
          padding: "8px 16px", fontSize: 12.5, color: "var(--nova-ink)",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
