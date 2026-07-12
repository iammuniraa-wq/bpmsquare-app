"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { c } from "@/lib/theme";
import type { Quote, QuoteLine } from "@/lib/types";
import { ROUTES, UOM_OPTIONS, DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import { Pencil } from "@/components/Icons";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

type LineItem = {
  id: string; sl_no: string; description: string; uom: string;
  qty: string; rate: string; discount_pct: string;
};
type GroupRow = {
  kind: "group"; id: string; label: string; group_description: string;
  group_type: "additive" | "alternative"; items: LineItem[];
};
type LineRow = { kind: "line" } & LineItem;
type Row = LineRow | GroupRow;

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "7px 9px", fontSize: 12.5,
  border: `1px solid ${c.line}`, borderRadius: 6,
  background: c.panel, color: c.ink, outline: "none", fontFamily: "inherit",
};
const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4,
};

function lineAmount(l: LineItem): number {
  const qty  = Math.max(0, parseFloat(l.qty) || 0);
  const rate = Math.max(0, parseFloat(l.rate) || 0);
  const disc = Math.max(0, Math.min(100, parseFloat(l.discount_pct) || 0));
  return qty * rate * (1 - disc / 100);
}

function newLineItem(sl_no = ""): LineItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sl_no, description: "", uom: "", qty: "1", rate: "0", discount_pct: "0",
  };
}

// Reconstruct grouped rows from the flat QuoteLine[] as stored in the DB.
function linesToRows(lines: QuoteLine[]): Row[] {
  const rows: Row[] = [];
  const groupIndex = new Map<string, number>();
  for (const l of lines) {
    const item: LineItem = {
      id: l.id, sl_no: l.sl_no ?? "", description: l.description, uom: l.uom ?? "",
      qty: String(l.qty), rate: String(l.rate), discount_pct: String(l.discount_pct ?? 0),
    };
    if (l.group_id) {
      let idx = groupIndex.get(l.group_id);
      if (idx === undefined) {
        idx = rows.length;
        groupIndex.set(l.group_id, idx);
        rows.push({
          kind: "group", id: l.group_id, label: l.group_label ?? "Group",
          group_description: l.group_description ?? "",
          group_type: l.group_type === "alternative" ? "alternative" : "additive",
          items: [],
        });
      }
      (rows[idx] as GroupRow).items.push(item);
    } else {
      rows.push({ kind: "line", ...item });
    }
  }
  return rows.length ? rows : [{ kind: "line", ...newLineItem("1") }];
}

const lineCols = "44px 1fr 60px 44px 62px 42px 66px 24px";
const lineHeaders = ["Sl No", "Description", "UOM", "Qty", "Rate", "Disc%", "Amount", ""];

export default function QuoteEditPanel({ quote, lines, quoteStatuses = DEFAULT_QUOTE_STATUSES, onSaved }: { quote: Quote; lines: QuoteLine[]; quoteStatuses?: QuoteStatusDef[]; onSaved?: (newStatus: string) => void }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const currentDef = quoteStatuses.find((s) => s.value === quote.status);
  const isEditable = !currentDef?.is_terminal;

  const [openEditor, setOpenEditor] = useState(false);
  const [status, setStatus] = useState<string>(quote.status);
  const [validUntil, setValidUntil] = useState(quote.valid_until ?? "");
  const [notes, setNotes] = useState(quote.notes ?? "");
  const [terms, setTerms] = useState(quote.terms ?? "");
  const [scopeOfWork, setScopeOfWork] = useState(quote.scope_of_work ?? "");
  const [rows, setRows] = useState<Row[]>(() => linesToRows(lines));
  const [selectedAltId, setSelectedAltId] = useState<string | null>(quote.selected_option_id ?? null);

  // Sync form fields from the latest quote prop every time the modal opens
  useEffect(() => {
    if (openEditor) {
      setStatus(quote.status);
      setValidUntil(quote.valid_until ?? "");
      setNotes(quote.notes ?? "");
      setTerms(quote.terms ?? "");
      setScopeOfWork(quote.scope_of_work ?? "");
      setRows(linesToRows(lines));
      setSelectedAltId(quote.selected_option_id ?? null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEditor]);

  const altGroups = rows.filter((r): r is GroupRow => r.kind === "group" && r.group_type === "alternative");
  const effectiveAltId = selectedAltId ?? altGroups[0]?.id ?? null;

  const allLineItems: LineItem[] = rows.flatMap((r) => {
    if (r.kind === "line") return [r];
    if (r.group_type === "additive") return r.items;
    return r.id === effectiveAltId ? r.items : [];
  });
  const total = allLineItems.reduce((s, l) => s + lineAmount(l), 0);

  const updateLine = (lineId: string, field: keyof LineItem, val: string) =>
    setRows((p) => p.map((r) => {
      if (r.kind === "line" && r.id === lineId) return { ...r, [field]: val };
      if (r.kind === "group") return { ...r, items: r.items.map((i) => i.id === lineId ? { ...i, [field]: val } : i) };
      return r;
    }));

  const addRow = () =>
    setRows((rs) => [...rs, { kind: "line", ...newLineItem(String(rs.length + 1)) }]);

  const addGroup = () =>
    setRows((rs) => [...rs, { kind: "group", id: `${Date.now()}`, label: "Group", group_description: "", group_type: "additive", items: [newLineItem(`${rs.length + 1}.1`)] }]);

  const addAlternative = () => {
    const gid = `${Date.now()}`;
    setRows((rs) => [...rs, { kind: "group", id: gid, label: `Option ${String.fromCharCode(65 + altGroups.length)}`, group_description: "", group_type: "alternative", items: [newLineItem(`${rs.length + 1}.1`)] }]);
    setSelectedAltId((prev) => prev ?? gid);
  };

  const removeRow = (rowId: string) =>
    setRows((rs) => { const n = rs.filter((r) => r.id !== rowId); return n.length ? n : [{ kind: "line", ...newLineItem("1") }]; });

  const addLineToGroup = (gid: string) =>
    setRows((rs) => rs.map((r) => r.kind === "group" && r.id === gid
      ? { ...r, items: [...r.items, newLineItem(`${r.items.length + 1}`)] }
      : r
    ));

  const removeLineFromGroup = (gid: string, lid: string) =>
    setRows((rs) => rs.map((r) => {
      if (r.kind !== "group" || r.id !== gid) return r;
      const items = r.items.filter((i) => i.id !== lid);
      return { ...r, items: items.length ? items : [newLineItem()] };
    }));

  const updateGroupLabel = (gid: string, label: string) =>
    setRows((rs) => rs.map((r) => r.kind === "group" && r.id === gid ? { ...r, label } : r));
  const updateGroupDescription = (gid: string, group_description: string) =>
    setRows((rs) => rs.map((r) => r.kind === "group" && r.id === gid ? { ...r, group_description } : r));
  const ungroup = (gid: string) =>
    setRows((rs) => rs.flatMap((r) => r.kind === "group" && r.id === gid ? r.items.map((i): Row => ({ kind: "line", ...i })) : [r]));

  async function saveDraft() {
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      const flatLines = rows.flatMap((r): {
        sl_no: string | null; description: string; uom: string | null; qty: string; rate: string;
        discount_pct: string; group_id: string | null; group_label: string | null;
        group_type: string | null; group_description: string | null;
      }[] =>
        r.kind === "line"
          ? [{
              sl_no: r.sl_no || null, description: r.description, uom: r.uom || null,
              qty: r.qty, rate: r.rate, discount_pct: r.discount_pct,
              group_id: null, group_label: null, group_type: null, group_description: null,
            }]
          : r.items.map((i) => ({
              sl_no: i.sl_no || null, description: i.description, uom: i.uom || null,
              qty: i.qty, rate: i.rate, discount_pct: i.discount_pct,
              group_id: r.id, group_label: r.label, group_type: r.group_type,
              group_description: r.group_description || null,
            }))
      );
      const res = await fetch(`/api/quotes/${quote.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          valid_until: validUntil, notes, terms, scope_of_work: scopeOfWork,
          lines: flatLines, selected_option_id: effectiveAltId,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        let msg = "Failed to save";
        try { msg = JSON.parse(text).error ?? msg; } catch { msg = text.slice(0, 200) || msg; }
        setError(msg);
        return;
      }

      if (status !== quote.status) {
        const patchRes = await fetch(`/api/quotes/${quote.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        if (!patchRes.ok) {
          const text = await patchRes.text();
          let msg = "Failed to update status";
          try { msg = JSON.parse(text).error ?? msg; } catch { msg = text.slice(0, 200) || msg; }
          setError(msg);
          return;
        }
      }

      onSaved?.(status);
      setSaved(true);
      router.refresh();
      setTimeout(() => { setOpenEditor(false); setSaved(false); }, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setSaving(false);
    }
  }

  async function createVersion() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/quotes/${quote.id}/revise`, { method: "POST" });
      if (res.ok) { const j = await res.json(); router.push(ROUTES.quotation(j.id)); }
      else { const text = await res.text(); let msg = "Failed to create version"; try { msg = JSON.parse(text).error ?? msg; } catch { msg = text.slice(0, 200) || msg; } setError(msg); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setSaving(false);
    }
  }

  // ── Terminal status: create-new-version action ────────────────────────────────
  if (!isEditable) {
    return (
      <>
        <button
          type="button"
          onClick={createVersion}
          disabled={saving}
          title="This quote is locked. Create an editable copy as a new revision."
          style={{
            display: "inline-flex", alignItems: "center", gap: 5, background: c.panel2, color: c.muted,
            border: `1px solid ${c.line}`, borderRadius: 7, padding: "6px 12px",
            fontSize: 12.5, fontWeight: 600, cursor: "pointer",
          }}
        >
          <Pencil size={13} color={c.muted} /> {saving ? "Creating…" : "Create new version"}
        </button>
        {error && <span style={{ fontSize: 12, color: "#dc2626", marginLeft: 8 }}>{error}</span>}
      </>
    );
  }

  // ── Draft: edit button + modal editor ─────────────────────────────────────────
  return (
    <>
      <button
        type="button"
        onClick={() => setOpenEditor(true)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, background: c.accent, color: "#fff",
          border: "none", borderRadius: 7, padding: "6px 14px",
          fontSize: 12.5, fontWeight: 600, cursor: "pointer",
        }}
      >
        <Pencil size={13} color="#fff" /> Edit quote
      </button>

      {openEditor && (
        <div
          style={{
            position: "fixed", inset: 0, background: c.panel, zIndex: 200,
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}
        >
          <div
            style={{ display: "contents" }}
          >
            <div style={{ padding: "14px 24px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: c.panel }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>Edit quotation</div>
                <div style={{ fontSize: 12, color: c.hint, fontFamily: "monospace" }}>{quote.ref}</div>
              </div>
              <button onClick={() => setOpenEditor(false)} style={{ background: "none", border: "none", fontSize: 22, color: c.hint, cursor: "pointer", lineHeight: 1, padding: "4px 8px" }}>×</button>
            </div>

            <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto", maxWidth: 1100, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={lbl}>Status</label>
                  <select style={{ ...inp, cursor: "pointer" }} value={status} onChange={(e) => setStatus(e.target.value)}>
                    {quoteStatuses.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Valid until</label>
                  <input style={inp} type="date" value={validUntil ? validUntil.slice(0, 10) : ""} onChange={(e) => setValidUntil(e.target.value)} />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <label style={{ ...lbl, marginBottom: 0 }}>Line items</label>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button type="button" onClick={addAlternative} style={{ fontSize: 11.5, fontWeight: 600, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>⊕ Add option</button>
                  <button type="button" onClick={addGroup} style={{ fontSize: 11.5, fontWeight: 600, color: c.muted, background: c.panel2, border: `1px solid ${c.line}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>+ Add group</button>
                  <button type="button" onClick={addRow} style={{ fontSize: 11.5, fontWeight: 600, color: c.accent, background: c.accentbg, border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>+ Add line</button>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                {rows.map((row) => {
                  if (row.kind === "line") {
                    return (
                      <div key={row.id} style={{ border: `1px solid ${c.line}`, borderRadius: 8, overflow: "hidden" }}>
                        <div style={{ display: "grid", gridTemplateColumns: lineCols, gap: 6, padding: "8px 10px", background: c.panel2, fontSize: 10, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.3 }}>
                          {lineHeaders.map((h, hi) => <span key={hi}>{h}</span>)}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: lineCols, gap: 6, padding: "7px 10px", alignItems: "center" }}>
                          <input style={{ ...inp, textAlign: "center", fontFamily: "monospace", padding: "6px 4px" }} value={row.sl_no} onChange={(e) => updateLine(row.id, "sl_no", e.target.value)} placeholder="1" />
                          <input style={inp} value={row.description} onChange={(e) => updateLine(row.id, "description", e.target.value)} placeholder="Work / part…" />
                          <select style={{ ...inp, cursor: "pointer" }} value={row.uom} onChange={(e) => updateLine(row.id, "uom", e.target.value)}>
                            <option value="">—</option>
                            {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                          </select>
                          <input style={{ ...inp, textAlign: "center" }} type="number" min={0} value={row.qty} onChange={(e) => updateLine(row.id, "qty", e.target.value)} />
                          <input style={{ ...inp, textAlign: "right" }} type="number" min={0} value={row.rate} onChange={(e) => updateLine(row.id, "rate", e.target.value)} />
                          <input style={{ ...inp, textAlign: "right" }} type="number" min={0} max={100} value={row.discount_pct} onChange={(e) => updateLine(row.id, "discount_pct", e.target.value)} />
                          <span style={{ fontSize: 12.5, textAlign: "right", fontWeight: 600, color: c.ink }}>{inr(lineAmount(row))}</span>
                          <button type="button" onClick={() => removeRow(row.id)} title="Remove" style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
                        </div>
                      </div>
                    );
                  }

                  // Group row (additive group or alternative option)
                  const isAlt = row.group_type === "alternative";
                  const isSelectedAlt = isAlt && row.id === effectiveAltId;
                  const groupColor  = isAlt ? "#92400e" : c.accent;
                  const groupBg     = isAlt ? (isSelectedAlt ? "#fffbeb" : "#fafafa") : `${c.accent}08`;
                  const groupBorder = isAlt ? "#fde68a" : `${c.accent}40`;
                  const groupTotal  = row.items.reduce((s, item) => s + lineAmount(item), 0);
                  return (
                    <div key={row.id} style={{ border: `1px solid ${groupBorder}`, borderLeft: `3px solid ${groupColor}`, borderRadius: 8, background: groupBg, padding: "10px 12px", opacity: isAlt && !isSelectedAlt ? 0.65 : 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, color: groupColor }}>{isAlt ? "⊕" : "▦"}</span>
                        {isAlt && <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 4, padding: "1px 6px", whiteSpace: "nowrap" }}>OPTION</span>}
                        <input
                          value={row.label}
                          onChange={(e) => updateGroupLabel(row.id, e.target.value)}
                          style={{ flex: 1, minWidth: 100, fontSize: 13, fontWeight: 700, border: "none", background: "transparent", color: c.ink, outline: "none", borderBottom: `1px dashed ${c.line}`, padding: "2px 0" }}
                          placeholder={isAlt ? "Option name…" : "Group name…"}
                        />
                        {isAlt && (
                          isSelectedAlt
                            ? <span style={{ fontSize: 11, fontWeight: 700, color: "#065f46", background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 5, padding: "2px 8px", whiteSpace: "nowrap" }}>✓ Selected</span>
                            : <button type="button" onClick={() => setSelectedAltId(row.id)} style={{ fontSize: 11, fontWeight: 600, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 5, padding: "2px 8px", cursor: "pointer", whiteSpace: "nowrap" }}>Select this option</button>
                        )}
                        <button type="button" onClick={() => ungroup(row.id)} style={{ fontSize: 11, color: c.muted, background: "none", border: "none", cursor: "pointer", textDecoration: "underline", whiteSpace: "nowrap" }}>Ungroup</button>
                        <button type="button" onClick={() => removeRow(row.id)} style={{ color: c.hint, background: "none", border: "none", fontSize: 16, cursor: "pointer", lineHeight: 1 }} title="Delete group">×</button>
                      </div>

                      <div style={{ marginBottom: 8 }}>
                        <input
                          value={row.group_description}
                          onChange={(e) => updateGroupDescription(row.id, e.target.value)}
                          style={{ ...inp, fontSize: 12, background: "transparent" }}
                          placeholder="Group description…"
                        />
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: lineCols, gap: 6, marginBottom: 4, paddingLeft: 2 }}>
                        {lineHeaders.map((h, hi) => <span key={hi} style={{ fontSize: 9.5, fontWeight: 600, color: c.hint, textTransform: "uppercase", letterSpacing: 0.3 }}>{h}</span>)}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {row.items.map((item) => (
                          <div key={item.id} style={{ display: "grid", gridTemplateColumns: lineCols, gap: 6, alignItems: "center", paddingBottom: 6, borderBottom: `1px solid ${c.accent}20` }}>
                            <input style={{ ...inp, textAlign: "center", fontFamily: "monospace", padding: "6px 4px" }} value={item.sl_no} onChange={(e) => updateLine(item.id, "sl_no", e.target.value)} placeholder="1.1" />
                            <input style={inp} value={item.description} onChange={(e) => updateLine(item.id, "description", e.target.value)} placeholder="Line description…" />
                            <select style={{ ...inp, cursor: "pointer" }} value={item.uom} onChange={(e) => updateLine(item.id, "uom", e.target.value)}>
                              <option value="">—</option>
                              {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                            <input style={{ ...inp, textAlign: "center" }} type="number" min={0} value={item.qty} onChange={(e) => updateLine(item.id, "qty", e.target.value)} />
                            <input style={{ ...inp, textAlign: "right" }} type="number" min={0} value={item.rate} onChange={(e) => updateLine(item.id, "rate", e.target.value)} />
                            <input style={{ ...inp, textAlign: "right" }} type="number" min={0} max={100} value={item.discount_pct} onChange={(e) => updateLine(item.id, "discount_pct", e.target.value)} />
                            <span style={{ fontSize: 12, textAlign: "right", fontWeight: 600, color: c.ink }}>{inr(lineAmount(item))}</span>
                            <button type="button" onClick={() => removeLineFromGroup(row.id, item.id)} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 15, lineHeight: 1 }} title="Remove line">×</button>
                          </div>
                        ))}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                        <button type="button" onClick={() => addLineToGroup(row.id)} style={{ fontSize: 11.5, color: groupColor, background: "none", border: "none", cursor: "pointer", padding: 0 }}>+ Add line</button>
                        <span style={{ fontSize: 12, color: c.muted }}>
                          {isAlt ? "Option total" : "Group total"}: <strong style={{ color: c.ink, marginLeft: 4 }}>{inr(groupTotal)}</strong>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={lbl}>Scope of work</label>
                <textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={scopeOfWork} onChange={(e) => setScopeOfWork(e.target.value)} placeholder="Describe the scope of work…" />
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={lbl}>Notes</label>
                <textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment terms, validity, exclusions…" />
              </div>

              <div style={{ marginBottom: 4 }}>
                <label style={lbl}>Terms &amp; Conditions</label>
                <textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Standard T&C…" />
              </div>

              {error && (
                <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 7, padding: "8px 12px", fontSize: 12.5, color: "#dc2626", marginTop: 10 }}>
                  {error}
                </div>
              )}
            </div>

            <div style={{ padding: "14px 24px", borderTop: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0, background: c.panel, maxWidth: 1100, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
              <div style={{ fontSize: 12.5, color: c.muted }}>
                Subtotal <strong style={{ color: c.ink, fontSize: 14, marginLeft: 6 }}>{inr(total)}</strong>
                <span style={{ marginLeft: 8, fontSize: 11, color: c.hint }}>+ GST on view</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => setOpenEditor(false)} disabled={saving} style={{ padding: "8px 14px", borderRadius: 7, border: `1px solid ${c.line}`, background: "none", color: c.muted, fontWeight: 500, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                <button type="button" onClick={saveDraft} disabled={saving} style={{ padding: "8px 20px", borderRadius: 7, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{saved ? "✓ Saved!" : saving ? "Saving…" : "Save changes"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
