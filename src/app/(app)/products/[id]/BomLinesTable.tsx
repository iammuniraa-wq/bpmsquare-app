"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import { useCurrency } from "@/lib/tenant-context";
import { formatMoney } from "@/lib/currency";
import { useFeel } from "@/components/FeelProvider";
import Button from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import ItemTypeBadge from "@/components/products/ItemTypeBadge";
import type { BomRowView } from "@/lib/products/bomView";

const th: React.CSSProperties = {
  textAlign: "left", fontSize: 11, fontWeight: 600, color: c.hint, background: c.panel2, textTransform: "uppercase",
  letterSpacing: 0.4, padding: "9px 12px", whiteSpace: "nowrap", borderBottom: `1px solid ${c.line}`,
};
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, verticalAlign: "middle" };
const num: React.CSSProperties = { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", textAlign: "right" };

type Draft = { qty: string; uom: string; scrap: string; kind: "consumed" | "used"; note: string };

export default function BomLinesTable({ productId, rows, canEdit }: { productId: string; rows: BomRowView[]; canEdit: boolean }) {
  const cur = useCurrency();
  const router = useRouter();
  const { confirm, toast } = useFeel();
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const money = (n: number | null, dp = 2) => (n == null ? "—" : formatMoney(n, cur, { minimumFractionDigits: 2, maximumFractionDigits: dp }));

  function startEdit(r: BomRowView) {
    setEditId(r.lineId); setError("");
    setDraft({ qty: String(r.qty), uom: r.uom ?? "", scrap: String(r.scrapPct), kind: r.lineKind, note: r.note ?? "" });
  }

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true); setError("");
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!res.ok && res.status !== 204) { setError((await res.json().catch(() => ({}))).error ?? "That did not work"); return false; }
      router.refresh();
      return true;
    } catch { setError("Network error"); return false; } finally { setBusy(false); }
  }

  async function saveEdit(r: BomRowView) {
    if (!draft) return;
    const ok = await call(`/api/products/${productId}/bom/${r.lineId}`, "PATCH", {
      qty: draft.qty, uom: draft.uom || null, scrap_pct: draft.scrap || 0, line_kind: draft.kind, note: draft.note || null,
    });
    if (ok) setEditId(null);
  }

  async function remove(r: BomRowView) {
    const ok = await confirm({ title: `Remove ${r.name}?`, body: "It is taken out of this BOM. The item itself is not deleted.", tone: "danger", confirmLabel: "Remove" });
    if (!ok) return;
    if (await call(`/api/products/${productId}/bom/${r.lineId}`, "DELETE")) toast({ text: `${r.name} removed`, tone: "success" });
  }

  if (rows.length === 0) {
    return <div style={{ padding: "26px 16px", textAlign: "center", color: c.muted, fontSize: 13 }}>No components yet. Add the first one below.</div>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
        <thead>
          <tr>
            <th style={th}>Item</th><th style={{ ...th, textAlign: "right" }}>Qty</th><th style={th}>Unit</th>
            <th style={{ ...th, textAlign: "right" }}>Scrap %</th><th style={th}>Kind</th>
            <th style={{ ...th, textAlign: "right" }}>Unit cost</th><th style={{ ...th, textAlign: "right" }}>Line cost</th>
            <th style={th}>Note</th>{canEdit && <th style={th}><span className="bpm-sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const editing = editId === r.lineId && draft;
            return (
              <tr key={r.lineId} style={{ borderTop: `1px solid ${c.line}`, opacity: r.lineKind === "used" && !editing ? 0.85 : 1 }}>
                <td style={td}>
                  <Link href={ROUTES.product(r.componentId)} style={{ fontWeight: 600, color: c.ink, textDecoration: "none" }}>{r.name}</Link>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
                    {r.sku && <span style={{ fontFamily: "monospace", fontSize: 11.5, color: c.hint }}>{r.sku}</span>}
                    <ItemTypeBadge typeKey={r.itemType} label={r.itemTypeLabel} />
                    {r.source === "rolled_up" && <span style={{ fontSize: 11.5, color: c.hint }}>kit, cost rolled up</span>}
                  </div>
                </td>
                {editing ? (
                  <>
                    <td style={td}><Input type="number" min="0" step="any" aria-label="Quantity" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} style={{ width: 90 }} /></td>
                    <td style={td}><Input aria-label="Unit" value={draft.uom} onChange={(e) => setDraft({ ...draft, uom: e.target.value })} style={{ width: 70 }} /></td>
                    <td style={td}><Input type="number" min="0" max="100" step="any" aria-label="Scrap percent" value={draft.scrap} onChange={(e) => setDraft({ ...draft, scrap: e.target.value })} style={{ width: 72 }} /></td>
                    <td style={td}>
                      <Select aria-label="Kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft["kind"] })}>
                        <option value="consumed">Consumed</option><option value="used">Used (tool)</option>
                      </Select>
                    </td>
                    <td style={{ ...td, ...num }}>{money(r.unitCost, 4)}</td>
                    <td style={{ ...td, ...num }}>{money(r.lineCost)}</td>
                    <td style={td}><Input aria-label="Note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} style={{ minWidth: 140 }} /></td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <Button variant="primary" size="sm" loading={busy} onClick={() => saveEdit(r)}>Save</Button>{" "}
                      <Button size="sm" disabled={busy} onClick={() => { setEditId(null); setError(""); }}>Cancel</Button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ ...td, ...num }}>{r.qty}</td>
                    <td style={{ ...td, color: c.muted }}>{r.uom ?? "—"}</td>
                    <td style={{ ...td, ...num }}>{r.scrapPct ? r.scrapPct : "—"}</td>
                    <td style={{ ...td, color: c.muted }}>{r.lineKind === "used" ? "Used (tool)" : "Consumed"}</td>
                    <td style={{ ...td, ...num, color: r.source === "missing" && r.lineKind === "consumed" ? "var(--amberink)" : c.ink }}>
                      {r.source === "missing" && r.lineKind === "consumed" ? "No cost" : money(r.unitCost, 4)}
                    </td>
                    <td style={{ ...td, ...num, fontWeight: 600 }}>{r.lineKind === "used" ? "—" : money(r.lineCost)}</td>
                    <td style={{ ...td, color: c.muted, maxWidth: 220, overflowWrap: "anywhere" }}>{r.note ?? ""}</td>
                    {canEdit && (
                      <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                        <Button variant="quiet" size="sm" onClick={() => startEdit(r)}>Edit</Button>
                        <Button variant="quiet" size="sm" onClick={() => remove(r)}>Remove</Button>
                      </td>
                    )}
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <div role="alert" style={{ margin: 12, background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
    </div>
  );
}
