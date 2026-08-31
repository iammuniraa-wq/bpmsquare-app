"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ROUTES, type QuoteStatusDef } from "@/lib/constants";
import type { QuoteSummary } from "@/lib/data";
import QuoteStatusPill from "@/components/QuoteStatusPill";

/**
 * Nova — List, redrawn (third slice of the Quotations redesign, owner
 * discussion 2026-08-31). Same rows QuotationsList.tsx shows classic
 * tenants, deliberately NOT that component -- "gated strictly for Nova
 * theme, no exceptions" means a new component swapped in only when
 * FlowBoardSlot already knows the tenant is on Nova, never a change to
 * the shared one every tenant renders.
 *
 * Deliberately narrower than the full written spec for this first pass --
 * ported only what's real:
 *  - Row actions are Open and Copy, not "Send, Duplicate, Open". There is
 *    no one-click send from a list row anywhere in this app (sending
 *    happens from the quote's own print page); a button that CLAIMED to
 *    send without taking you there would be a lie. Copy reuses the exact
 *    sessionStorage handoff QuotationsList's own bulk-bar Copy already
 *    uses, single-quote version.
 *  - The bulk action bar offers exactly what already exists as a real
 *    capability: Delete (any count) and Copy (exactly one, same
 *    single-quote-only constraint the classic list already enforces).
 *    Nothing invented.
 *  - Adapt, Columns, per-column search and sort are NOT ported here yet --
 *    this pass is the row and the selection model, not the whole toolbar.
 *    They stay real, just not yet in this view; noting rather than hiding
 *    the gap.
 */

const DAY = 86_400_000;
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

function ageChip(days: number) {
  const color = days >= 14 ? "#E4634A" : days >= 7 ? "#F0A93B" : "var(--nova-ink-faint)";
  const bg = days >= 14 ? "rgba(228,99,74,.12)" : days >= 7 ? "rgba(240,169,59,.12)" : "var(--nova-glass-bg)";
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 6, fontSize: 11,
      fontFamily: "var(--nova-font-body)", fontVariantNumeric: "tabular-nums",
      color, background: bg, border: `1px solid ${color}44`, whiteSpace: "nowrap",
    }}>
      {days}d idle
    </span>
  );
}

export default function QuoteListNova({ rows, quoteStatuses }: { rows: QuoteSummary[]; quoteStatuses: QuoteStatusDef[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const now = Date.now();
  const withAge = useMemo(() => rows.map((r) => ({
    row: r,
    ageDays: Math.max(0, Math.round((now - new Date(r.quote.updated_at ?? r.quote.created_at).getTime()) / DAY)),
  })), [rows, now]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.quote.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.quote.id)));
  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3200); };

  const copyOne = (id: string) => {
    const row = rows.find((r) => r.quote.id === id);
    if (!row) return;
    sessionStorage.setItem("vvcrm_copy_quote", JSON.stringify({
      accountId: row.quote.account_id,
      contactId: row.quote.contact_id ?? "",
      quoteName: `Copy of ${row.quote.name || row.quote.ref}`,
      notes: row.quote.notes ?? "",
      terms: row.quote.terms ?? "",
      scopeOfWork: row.quote.scope_of_work ?? "",
      rows: row.lines.map((l, i) => ({
        kind: "line", id: String(Date.now() + i), description: l.description,
        uom: l.uom ?? "", qty: String(l.qty), rate: String(l.rate),
        discount: String(l.discount_pct ?? 0), group_id: l.group_id ?? null, group_label: l.group_label ?? null,
      })),
    }));
    router.push(ROUTES.quotationNew);
  };

  const deleteSelected = async () => {
    setBusy(true);
    const ids = [...selected];
    const results = await Promise.all(ids.map((id) => fetch(`/api/quotes/${id}`, { method: "DELETE" })));
    const failed = results.filter((r) => !r.ok).length;
    const deleted = ids.length - failed;
    setBusy(false);
    setSelected(new Set());
    showToast(failed > 0 ? `${deleted} deleted, ${failed} failed` : `${deleted} quote${deleted === 1 ? "" : "s"} deleted`);
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
            <th style={{ textAlign: "right", padding: "8px 6px", fontSize: 11, color: "var(--nova-ink-faint)", fontWeight: 500 }}>Value</th>
            <th style={{ textAlign: "left", padding: "8px 6px", fontSize: 11, color: "var(--nova-ink-faint)", fontWeight: 500 }}>Status</th>
            <th style={{ width: 120 }} />
          </tr>
        </thead>
        <tbody>
          {withAge.map(({ row: r, ageDays }) => (
            <tr
              key={r.quote.id}
              className="nova-list-row"
              style={{ borderBottom: "1px solid var(--nova-line-soft)" }}
            >
              <td style={{ padding: "10px 6px" }}>
                <input type="checkbox" checked={selected.has(r.quote.id)} onChange={() => toggle(r.quote.id)} aria-label={`Select ${r.account.name}`} />
              </td>
              <td style={{ padding: "10px 6px", cursor: "pointer" }} onClick={() => router.push(`${ROUTES.quotations}/${r.quote.id}`)}>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--nova-ink)" }}>{r.account.name}</div>
                <div style={{ fontFamily: "var(--nova-font-body)", fontSize: 11, color: "var(--nova-ink-faint)", marginTop: 2 }}>
                  {r.quote.ref} · {r.lineCount} line{r.lineCount === 1 ? "" : "s"}
                </div>
              </td>
              <td style={{ padding: "10px 6px" }}>{ageChip(ageDays)}</td>
              <td style={{ padding: "10px 6px", textAlign: "right", fontFamily: "var(--nova-font-body)", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--nova-ink)" }}>
                {inr(r.quote.total)}
              </td>
              <td style={{ padding: "10px 6px" }}>
                <QuoteStatusPill status={r.quote.status} statuses={quoteStatuses} />
              </td>
              <td style={{ padding: "10px 6px" }} className="nova-list-actions">
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", opacity: 0 }}>
                  <Link
                    href={`${ROUTES.quotations}/${r.quote.id}`}
                    style={{ fontSize: 11.5, padding: "5px 9px", borderRadius: 6, border: "1px solid var(--nova-line)", color: "var(--nova-ink-dim)", textDecoration: "none" }}
                  >
                    Open
                  </Link>
                  <button
                    type="button"
                    onClick={() => copyOne(r.quote.id)}
                    style={{ fontSize: 11.5, padding: "5px 9px", borderRadius: 6, border: "1px solid var(--nova-line)", background: "none", color: "var(--nova-ink-dim)", cursor: "pointer" }}
                  >
                    Copy
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div style={{ padding: 28, textAlign: "center", color: "var(--nova-ink-faint)", fontSize: 13 }}>No quotes match.</div>
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
            type="button" disabled={selected.size !== 1} onClick={() => copyOne([...selected][0])}
            title={selected.size !== 1 ? "Select exactly one quote to copy" : "Copy this quote into a new draft"}
            style={{
              fontSize: 12.5, fontWeight: 600, padding: "6px 13px", borderRadius: 7, border: "none",
              cursor: selected.size === 1 ? "pointer" : "not-allowed",
              background: selected.size === 1 ? "var(--nova-orange)" : "var(--nova-glass-bg)",
              color: selected.size === 1 ? "#160F02" : "var(--nova-ink-faint)",
            }}
          >
            Copy
          </button>
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
