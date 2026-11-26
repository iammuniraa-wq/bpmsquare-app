"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select } from "@/components/ui/Input";
import { useFeel } from "@/components/FeelProvider";
import { ROUTES } from "@/lib/constants";
import type { MatchKind, MatchedRow } from "@/lib/elements/compare";
import { MATCH_LABEL } from "@/lib/elements/compare";
import { ELEMENT_TIPS } from "@/lib/elements/tips";
import { MODEL_PENDING } from "@/lib/elements/types";
import { call } from "./api";
import s from "./Buildings.module.css";

// The model comparison of a contract project (docs/design/pcbs-buildings-elements.md section 2.4): a model or the drawings arrive as a file (or the
// connector's post), are set beside the budget, and NOTHING changes until rows are ticked and applied. Same rows are hidden, a row the model does not
// mention is flagged and never deleted or zeroed, and a change that is really extra work for the client goes to a client variation, not here.

type ImportRow = { id: string; import_no: number; source: string; model_ref: string | null; received_at: string; status: "open" | "applied" | "dismissed"; row_count: number };
type Detail = { import: ImportRow; rows: MatchedRow[]; target: { rev_no: number; status: string } | null };

const KIND_ORDER: MatchKind[] = ["qty_changed", "new_element", "new_building", "not_in_model", "same"];
const KIND_CLASS: Record<MatchKind, string> = { same: s.mutedPill, qty_changed: s.amberPill, new_element: s.bluePill, new_building: s.bluePill, not_in_model: s.mutedPill };
const nf = (n: number | null) => (n === null ? "–" : n.toLocaleString("en-US", { maximumFractionDigits: 3 }));
const selectable = (r: MatchedRow) => (r.kind === "qty_changed" || r.kind === "new_element" || r.kind === "new_building") && !r.ambiguous;
const STATUS_WORDS = { open: "Open", applied: "Applied", dismissed: "Dismissed" } as const;

export default function ModelComparison({ projectId, canEdit, onChanged }: {
  projectId: string;
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const { confirm } = useFeel();
  const root = `/api/contract-projects/${projectId}/model-imports`;
  const [list, setList] = useState<ImportRow[] | null>(null);
  const [pending, setPending] = useState(false);
  // 404: the workspace has no Buildings add-on, so there is nothing to show.
  const [off, setOff] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [closed, setClosed] = useState<Set<MatchKind>>(new Set(["same"]));
  const [reasons, setReasons] = useState<{ code: string; name: string }[]>([]);
  const [reason, setReason] = useState("scope_change");
  const [reasonNote, setReasonNote] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await call<{ imports: ImportRow[]; needsDatabaseUpdate?: boolean }>(root, "GET");
    if (r.status === 404) { setOff(true); setList([]); return; }
    if (r.status === 503) { setPending(true); setList([]); return; }
    if (!r.ok) { setError(r.j.error ?? "Could not load the comparisons"); setList([]); return; }
    setPending(false); setList(r.j.imports ?? []);
  }, [root]);
  useEffect(() => { void load(); }, [load]);
  // The budget the numbers would land on is an approved one: applying starts a draft revision, which needs a reason from the list.
  const needsReason = detail?.target?.status === "approved";
  useEffect(() => {
    if (!open || !needsReason || reasons.length > 0) return;
    void (async () => {
      const r = await call<{ rows: { code: string; name: string }[] }>("/api/contract-projects/masters?kind=justification", "GET");
      if (r.ok) setReasons(r.j.rows ?? []);
    })();
  }, [open, needsReason, reasons.length]);

  async function openOne(id: string) {
    setBusy(true); setError(""); setNotice("");
    const r = await call<Detail>(`${root}/${id}`, "GET");
    setBusy(false);
    if (!r.ok) { setError(r.j.error ?? "Could not open it"); return; }
    setDetail(r.j as Detail); setPicked(new Set());
  }

  async function upload(file: File) {
    setBusy(true); setError(""); setNotice("");
    const form = new FormData();
    form.set("file", file);
    if (ref.trim()) form.set("model_ref", ref.trim());
    try {
      const res = await fetch(root, { method: "POST", body: form });
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string; import_no?: number };
      if (!res.ok || !j.id) { setError(j.error ?? "Could not read that file"); return; }
      setNotice(`Comparison M-${j.import_no} added. Nothing in the budget has changed.`); setRef("");
      await load(); await openOne(j.id);
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function apply() {
    if (!detail) return;
    const baseline = needsReason;
    if (!(await confirm({
      title: `Apply ${picked.size} row${picked.size === 1 ? "" : "s"}?`,
      body: baseline ? "This starts a draft revision with your reason, for approval. The approved baseline is not touched." : "This writes the ticked rows into the draft budget.",
      confirmLabel: "Apply",
    }))) return;
    setBusy(true); setError(""); setNotice("");
    const r = await call<{ text?: string; started_revision?: boolean; revision_rev_no?: number; notes?: string[] }>(`${root}/${detail.import.id}`, "PATCH", {
      action: "apply", rows: [...picked], justification_code: baseline ? reason : undefined, justification_text: reasonNote.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) { setError(r.j.error ?? "Could not apply"); return; }
    setNotice(`Applied to revision ${r.j.revision_rev_no}${r.j.started_revision ? " (a new draft)" : ""}: ${r.j.text}${r.j.notes?.length ? `. ${r.j.notes.slice(0, 3).join(" ")}` : ""}`);
    setDetail(null); await load(); onChanged?.(); router.refresh();
  }

  async function dismiss() {
    if (!detail) return;
    if (!(await confirm({ title: `Dismiss M-${detail.import.import_no}?`, body: "It stays on the list for the record. The budget is not changed.", confirmLabel: "Dismiss" }))) return;
    setBusy(true); setError("");
    const r = await call(`${root}/${detail.import.id}`, "PATCH", { action: "dismiss" });
    setBusy(false);
    if (!r.ok) { setError(r.j.error ?? "Could not dismiss"); return; }
    setDetail(null); await load();
  }

  const toggle = (n: number) => setPicked((cur) => { const next = new Set(cur); if (next.has(n)) next.delete(n); else next.add(n); return next; });
  const grouped = detail ? KIND_ORDER.map((k) => ({ kind: k, rows: detail.rows.filter((r) => r.kind === k) })).filter((g) => g.rows.length > 0) : [];
  const editable = canEdit && detail?.import.status === "open";

  if (!list || off) return null;
  return (
    <section className={s.wrap} data-guide="model" aria-label="Model comparison">
      <div className={s.head}>
        <Button variant="quiet" size="sm" aria-expanded={open} style={{ minHeight: 44 }} data-guide="model.toggle" onClick={() => setOpen((v) => !v)}>
          Model comparison{list.length > 0 ? ` (${list.length})` : ""}
        </Button>
        <InfoTip label="Model comparison">{ELEMENT_TIPS.comparison}</InfoTip>
      </div>
      {open && (
        <div className={s.stack}>
          {pending && <div role="alert" className={s.warn}>{MODEL_PENDING}</div>}
          {!pending && canEdit && (
            <div className={s.form} data-guide="model.new" style={{ gridTemplateColumns: "minmax(140px, 2fr) auto" }}>
              <Field label="Model reference"><Input value={ref} maxLength={200} placeholder="For example Revit v3" style={{ minHeight: 44 }} data-guide="model.ref" onChange={(e) => setRef(e.target.value)} /></Field>
              <div>
                <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden data-guide="model.file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
                <Button variant="secondary" loading={busy} style={{ minHeight: 44 }} data-guide="model.upload" onClick={() => fileRef.current?.click()}>Add a file</Button>
              </div>
            </div>
          )}
          {!pending && list.length === 0 && <div className={s.note}>No comparisons yet. Add an Excel or CSV file with Element type, Element code, Quantity and Unit columns.</div>}
          {list.length > 0 && !detail && (
            <ul className={s.list} aria-label="Comparisons">
              {list.map((m) => (
                <li key={m.id} className={s.item}>
                  <div className={s.row} style={{ gridTemplateColumns: "minmax(120px, 2fr) minmax(100px, 2fr) 90px 90px 90px" }}>
                    <button type="button" className={s.link} onClick={() => void openOne(m.id)} data-guide="model.open">M-{m.import_no}{m.model_ref ? ` · ${m.model_ref}` : ""}</button>
                    <span className={s.cell}>{new Date(m.received_at).toLocaleDateString("en-GB")}</span>
                    <span className={s.cell}>{m.row_count} rows</span>
                    <span className={s.cell}><span className={`${s.pill} ${m.status === "open" ? s.amberPill : m.status === "applied" ? s.tealPill : s.mutedPill}`}>{STATUS_WORDS[m.status]}</span></span>
                    <span className={s.cell}>{m.source}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {detail && (
            <div className={s.stack} data-guide="model.detail">
              <div className={s.head}>
                <Button variant="quiet" size="sm" style={{ minHeight: 44 }} onClick={() => setDetail(null)}>All comparisons</Button>
                <strong>M-{detail.import.import_no}{detail.import.model_ref ? ` · ${detail.import.model_ref}` : ""}</strong>
                <span className={`${s.pill} ${detail.import.status === "open" ? s.amberPill : s.mutedPill}`}>{STATUS_WORDS[detail.import.status]}</span>
                <InfoTip label="Rows">{ELEMENT_TIPS.modelRows}</InfoTip>
              </div>
              {grouped.map((g) => {
                const fold = closed.has(g.kind);
                return (
                  <div key={g.kind} className={s.group} data-guide={`model.group.${g.kind}`}>
                    <button type="button" className={s.groupHead} aria-expanded={!fold} onClick={() => setClosed((cur) => { const n = new Set(cur); if (n.has(g.kind)) n.delete(g.kind); else n.add(g.kind); return n; })}>
                      <span aria-hidden="true">{fold ? "▸" : "▾"}</span> {MATCH_LABEL[g.kind]} <span className={`${s.pill} ${KIND_CLASS[g.kind]}`}>{g.rows.length}</span>
                    </button>
                    {!fold && g.rows.map((r) => {
                      const diff = r.current_qty !== null && g.kind === "qty_changed" ? r.qty - r.current_qty : null;
                      return (
                        <div key={r.row_no} className={s.mrow} data-guide="model.row">
                          <span className={s.checkCell}>{editable && selectable(r) ? <input type="checkbox" aria-label={`Apply row ${r.row_no}`} checked={picked.has(r.row_no)} onChange={() => toggle(r.row_no)} /> : null}</span>
                          <span className={`${s.mcell} ${s.mono}`}><span className={s.label}>Element</span>{r.element_code ?? r.element_type ?? "–"}</span>
                          <span className={s.mcell}><span className={s.label}>Building</span>{r.building_code ?? "–"}</span>
                          <span className={`${s.mcell} ${s.wide}`}><span className={s.label}>Type</span>{r.element_type ?? "–"}{r.ambiguous ? <> <span className={`${s.pill} ${s.amberPill}`}>Several lines fit</span></> : null}{r.drawing_no ? ` · ${r.drawing_no}${r.drawing_rev ? ` rev ${r.drawing_rev}` : ""}` : ""}</span>
                          <span className={`${s.mcell} ${s.num}`}><span className={s.label}>Budget</span>{nf(r.current_qty)}</span>
                          <span className={`${s.mcell} ${s.num}`}><span className={s.label}>Model</span>{g.kind === "not_in_model" ? "–" : nf(r.qty)}{diff !== null ? ` (${diff > 0 ? "+" : ""}${nf(diff)})` : ""}</span>
                          <span className={s.mcell}>{g.kind === "qty_changed" && !r.ambiguous && <a href={`${ROUTES.contractProject(projectId)}?tab=variations`} style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>Raise a client variation</a>}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {needsReason && detail.import.status === "open" && editable && (
                <div className={s.two} data-guide="model.reason">
                  <Field label="Reason for the revision" info={ELEMENT_TIPS.applyModel}>
                    <Select value={reason} style={{ minHeight: 44 }} onChange={(e) => setReason(e.target.value)}>
                      {(reasons.length ? reasons : [{ code: "scope_change", name: "Scope change" }]).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Note"><Input value={reasonNote} maxLength={300} placeholder={`Model import M-${detail?.import.import_no}`} style={{ minHeight: 44 }} onChange={(e) => setReasonNote(e.target.value)} /></Field>
                </div>
              )}
              {editable && (
                <div className={s.tools}>
                  <Button variant="primary" loading={busy} disabled={picked.size === 0} style={{ minHeight: 44 }} data-guide="model.apply" onClick={() => void apply()}>Apply selected ({picked.size})</Button>
                  <Button variant="quiet" disabled={busy} style={{ minHeight: 44 }} data-guide="model.dismiss" onClick={() => void dismiss()}>Dismiss</Button>
                  <InfoTip label="Variation">{ELEMENT_TIPS.variation}</InfoTip>
                </div>
              )}
            </div>
          )}
          {error && <div role="alert" className={s.err}>{error}</div>}
          {notice && !error && <div role="status" className={s.ok}>{notice}</div>}
        </div>
      )}
    </section>
  );
}
