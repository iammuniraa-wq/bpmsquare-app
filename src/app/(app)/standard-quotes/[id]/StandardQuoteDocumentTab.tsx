"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Textarea } from "@/components/ui/Input";
import type { ClauseSectionData, DocSectionEntry, DocSections, ScopeMatrixData } from "@/lib/types";

export type DocSectionDef =
  | { id: string; kind: "clause"; data: ClauseSectionData }
  | { id: string; kind: "matrix"; data: ScopeMatrixData };

/** The "Document" tab: the sections of the layout marked "edit per document", one collapsible row each. Fixed text is shown
 *  read-only; what is typed here is stored on this quotation only (standard_quotes.doc_sections). */
export default function StandardQuoteDocumentTab({ quoteId, sections, initial, canEdit }: {
  quoteId: string;
  sections: DocSectionDef[];
  initial: DocSections;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [doc, setDoc] = useState<DocSections>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(doc) !== JSON.stringify(initial) && !saved;

  const entry = (id: string): DocSectionEntry => doc[id] ?? {};
  const patch = (id: string, p: Partial<DocSectionEntry>) => { setSaved(false); setDoc((d) => ({ ...d, [id]: { ...(d[id] ?? {}), ...p } })); };

  async function save() {
    setSaving(true); setError("");
    const res = await fetch(`/api/standard-quotes/${quoteId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc_sections: doc }) }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) { setError(res ? ((await res.json().catch(() => ({}))).error ?? "Could not save") : "Network error"); return; }
    setSaved(true);
    router.refresh();
  }

  if (sections.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} data-guide="sq-document-tab">
      {sections.map((sec) => (
        <Card key={sec.id} padding={0}>
          <details>
            <summary style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", cursor: "pointer", fontWeight: 600, fontSize: 13.5 }}>
              {sec.data.title || (sec.kind === "matrix" ? "Scope matrix" : "Section")}
              {sec.kind === "clause" && entry(sec.id).hidden && <span style={{ fontSize: 11.5, color: "var(--hint)", fontWeight: 500 }}>not on this quotation</span>}
              {sec.kind === "matrix" && typeof entry(sec.id).not_applicable === "string" && <span style={{ fontSize: 11.5, color: "var(--hint)", fontWeight: 500 }}>does not apply</span>}
            </summary>
            <div style={{ padding: "4px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              {sec.kind === "clause" ? <ClauseEditor sec={sec} e={entry(sec.id)} patch={(p) => patch(sec.id, p)} canEdit={canEdit} /> : <MatrixEditor sec={sec} e={entry(sec.id)} patch={(p) => patch(sec.id, p)} canEdit={canEdit} />}
            </div>
          </details>
        </Card>
      ))}
      {canEdit && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44 }}>
          <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>Save sections</Button>
          {saved && !dirty && <span role="status" style={{ fontSize: 12.5, color: "var(--greenink)" }}>Saved</span>}
          {error && <span role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</span>}
        </div>
      )}
    </div>
  );
}

function ClauseEditor({ sec, e, patch, canEdit }: { sec: Extract<DocSectionDef, { kind: "clause" }>; e: DocSectionEntry; patch: (p: Partial<DocSectionEntry>) => void; canEdit: boolean }) {
  const editable = sec.data.items.filter((i) => i.edit);
  const fixed = sec.data.items.filter((i) => !i.edit);
  const setItem = (id: string, p: { text?: string; sub?: string[] }) => patch({ items: { ...(e.items ?? {}), [id]: { ...(e.items?.[id] ?? {}), ...p } } });
  return (
    <>
      {sec.data.optional && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, fontSize: 13 }}>
          <input type="checkbox" checked={!e.hidden} disabled={!canEdit} onChange={(ev) => patch({ hidden: !ev.target.checked })} />
          Print this section on the quotation
        </label>
      )}
      {editable.map((it) => {
        const over = e.items?.[it.id];
        const text = over?.text ?? it.text;
        const sub = over?.sub ?? it.sub ?? [];
        return (
          <div key={it.id}>
            <div className="bpm-t-label" style={{ marginBottom: 4 }}>{it.heading || "Text"}</div>
            <Textarea value={text} disabled={!canEdit} onChange={(ev) => setItem(it.id, { text: ev.target.value })} style={{ minHeight: 70 }} />
            {(sub.length > 0 || canEdit) && (
              <>
                <div className="bpm-label-row" style={{ margin: "8px 0 4px" }}><span className="bpm-t-label">More lines</span><InfoTip label="More lines">One paragraph per line, printed under the text above.</InfoTip></div>
                <Textarea value={sub.join("\n")} disabled={!canEdit} onChange={(ev) => setItem(it.id, { sub: ev.target.value.split("\n") })} style={{ minHeight: 70 }} />
              </>
            )}
          </div>
        );
      })}
      {fixed.length > 0 && (
        <details>
          <summary style={{ minHeight: 44, display: "flex", alignItems: "center", cursor: "pointer", fontSize: 12.5, color: "var(--muted)" }}>Fixed text ({fixed.length})</summary>
          {fixed.map((it) => <p key={it.id} style={{ fontSize: 12.5, color: "var(--muted)", whiteSpace: "pre-line", margin: "0 0 8px" }}>{it.heading ? `${it.heading} ` : ""}{it.text}</p>)}
        </details>
      )}
      {editable.length === 0 && fixed.length === 0 && <span className="bpm-t-help">This section has no text.</span>}
    </>
  );
}

function MatrixEditor({ sec, e, patch, canEdit }: { sec: Extract<DocSectionDef, { kind: "matrix" }>; e: DocSectionEntry; patch: (p: Partial<DocSectionEntry>) => void; canEdit: boolean }) {
  const na = typeof e.not_applicable === "string";
  const extra = e.extra_rows ?? [];
  const rows = [...sec.data.rows, ...extra];
  const cols = sec.data.columns;
  return (
    <>
      <label style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, fontSize: 13 }}>
        <input type="checkbox" checked={na} disabled={!canEdit} onChange={(ev) => patch({ not_applicable: ev.target.checked ? "N/A" : undefined })} />
        This part does not apply
      </label>
      {na ? (
        <Input value={e.not_applicable ?? ""} disabled={!canEdit} maxLength={120} onChange={(ev) => patch({ not_applicable: ev.target.value })} aria-label="Reason printed next to the title" placeholder="N/A" />
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--hint)" }}>
                  <th style={{ padding: "4px 6px" }}>Description</th>
                  {cols.map((c) => <th key={c} style={{ padding: "4px 6px", textAlign: "center" }}>{c}</th>)}
                  {sec.data.remark && <th style={{ padding: "4px 6px" }}>Remark</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "4px 6px" }}>{r.text}</td>
                    {[0, 1, 2].map((k) => (
                      <td key={k} style={{ textAlign: "center" }}>
                        <label style={{ display: "inline-flex", minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                          <input type="radio" name={`${sec.id}-${r.id}`} aria-label={`${r.text}: ${cols[k]}`} checked={e.ticks?.[r.id] === k} disabled={!canEdit}
                            onChange={() => patch({ ticks: { ...(e.ticks ?? {}), [r.id]: k as 0 | 1 | 2 } })} />
                        </label>
                      </td>
                    ))}
                    {sec.data.remark && (
                      <td style={{ padding: "4px 6px", minWidth: 140 }}>
                        <Input value={e.remarks?.[r.id] ?? ""} disabled={!canEdit} maxLength={300} aria-label={`Remark for ${r.text}`} onChange={(ev) => patch({ remarks: { ...(e.remarks ?? {}), [r.id]: ev.target.value } })} />
                      </td>
                    )}
                    <td>
                      {idx >= sec.data.rows.length && canEdit && (
                        <Button variant="quiet" onClick={() => patch({ extra_rows: extra.filter((x) => x.id !== r.id) })}>Remove</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit && <div><Button onClick={() => patch({ extra_rows: [...extra, { id: `x${extra.length + 1}`, text: "New row" }] })}>+ Add row</Button></div>}
          {extra.length > 0 && canEdit && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {extra.map((x) => <Input key={x.id} value={x.text} maxLength={300} aria-label="Extra row text" onChange={(ev) => patch({ extra_rows: extra.map((y) => (y.id === x.id ? { ...y, text: ev.target.value } : y)) })} />)}
            </div>
          )}
        </>
      )}
    </>
  );
}
